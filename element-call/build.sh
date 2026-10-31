#!/usr/bin/env bash
# Apply the patch queue to an Element Call checkout and build its embedded
# package the way upstream's release does. CI only: this installs EC's
# dependencies and runs its build, so never run it on a developer box.
#
#   element-call/build.sh <ec-checkout> <log-dir>
#
# The checkout must be element-hq/element-call at the tag to build, with Node
# set up from its .node-version and corepack enabled (see the workflows).
#
# Stages, each logged to <log-dir>/<stage>.log:
#   am         git am every element-call/patches/*.patch, in order
#   install    pnpm install --frozen-lockfile --ignore-pnpmfile
#   typecheck  pnpm run lint:types (tsc over the whole of EC)
#   test       vitest's unit project over the test files the patches touch
#   build      pnpm run build:embedded:production (EC's build-element-call.yaml)
#   csp        the built index.html's inline scripts are in our nginx CSPs
#
# On failure <log-dir>/stage names the stage that failed and, for `am`,
# <log-dir>/patch names the patch that did not apply.
set -euo pipefail

EC_DIR=$(cd "$1" && pwd)
LOG_DIR=$(mkdir -p "$2" && cd "$2" && pwd)
QUEUE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CINNY_DIR=$(dirname "$QUEUE_DIR")

# The inline-script hashes the widget's index.html needs live in these two
# Content-Security-Policy headers.
CSP_FILES=(
  "$CINNY_DIR/docker-nginx.conf"
  "$CINNY_DIR/.github/webapp-release-template/nginx.conf"
)

stage() {
  local name=$1
  shift
  echo "::group::$name"
  echo "$name" > "$LOG_DIR/stage"
  set +e
  # errexit is re-armed inside the subshell: a pipeline element otherwise
  # runs a function with it off, and a failing line would not stop it.
  (set -e; "$@") 2>&1 | tee "$LOG_DIR/$name.log"
  local rc=${PIPESTATUS[0]}
  set -e
  echo "::endgroup::"
  if [ "$rc" -ne 0 ]; then
    echo "::error::element-call $name failed (exit $rc)"
    exit "$rc"
  fi
}

apply_patches() {
  local base
  base=$(git -C "$EC_DIR" rev-parse HEAD)
  echo "$base" > "$LOG_DIR/base"

  local patches=("$QUEUE_DIR"/patches/*.patch)
  if [ ! -e "${patches[0]}" ]; then
    echo "no patches in $QUEUE_DIR/patches"
    return 0
  fi

  for p in "${patches[@]}"; do
    basename "$p" > "$LOG_DIR/patch"
    # --3way lets a patch whose context moved but whose base blobs are
    # still in upstream history resolve itself instead of failing.
    if ! git -C "$EC_DIR" am --3way "$p"; then
      echo
      echo "=== git am --show-current-patch=diff (first 200 lines)"
      git -C "$EC_DIR" am --show-current-patch=diff | head -200 || true
      echo
      echo "=== git status"
      git -C "$EC_DIR" status --short || true
      git -C "$EC_DIR" am --abort || true
      return 1
    fi
  done
  rm -f "$LOG_DIR/patch"

  git -C "$EC_DIR" log --oneline "$base..HEAD"
}

run_patch_tests() {
  local base tests
  base=$(cat "$LOG_DIR/base")
  tests=$(git -C "$EC_DIR" diff --name-only "$base" HEAD -- '*.test.ts' '*.test.tsx' \
    | while read -r f; do [ -f "$EC_DIR/$f" ] && echo "$f"; done || true)
  if [ -z "$tests" ]; then
    echo "the patches touch no unit tests"
    return 0
  fi
  echo "$tests"
  # shellcheck disable=SC2086 # one argument per test file
  (cd "$EC_DIR" && pnpm exec vitest run --project=unit $tests)
}

check_csp() {
  python3 - "$EC_DIR/dist/index.html" "${CSP_FILES[@]}" <<'EOF'
import base64, hashlib, re, sys

html_path, *conf_paths = sys.argv[1:]
html = open(html_path, encoding="utf-8").read()
hashes = [
    "sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode()
    for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
    if m.group(1).strip()
]
print("inline script hashes in the built index.html:", hashes or "none")

missing = []
for path in conf_paths:
    conf = open(path, encoding="utf-8").read()
    for h in hashes:
        if f"'{h}'" not in conf:
            missing.append(f"{path}: {h}")
if missing:
    print("The widget's inline scripts changed; the CSP would block them and calls would")
    print("not load. Add these to script-src (the regenerate recipe is in nginx.conf):")
    print("\n".join("  " + m for m in missing))
    sys.exit(1)
print("every hash is in", ", ".join(conf_paths))
EOF
}

build() {
  # Same command and environment as upstream's build-element-call.yaml.
  # Sentry is off because its secrets are absent, exactly as on a fork.
  (cd "$EC_DIR" && NODE_OPTIONS=--max-old-space-size=4096 pnpm run build:embedded:production)
  test -f "$EC_DIR/dist/index.html"
  find "$EC_DIR/dist" -maxdepth 1 | sort
}

stage am apply_patches
stage install bash -c "cd '$EC_DIR' && pnpm install --frozen-lockfile --ignore-pnpmfile"
stage typecheck bash -c "cd '$EC_DIR' && pnpm run lint:types"
stage test run_patch_tests
stage build build
stage csp check_csp
rm -f "$LOG_DIR/stage"
echo "element-call built with $(find "$QUEUE_DIR/patches" -name '*.patch' | wc -l) patches"
