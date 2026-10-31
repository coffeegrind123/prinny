#!/usr/bin/env node
/**
 * The Element Call patch queue: which build of the call widget this checkout
 * ships, and where to get it.
 *
 *   element-call/UPSTREAM          upstream tag, e.g. v0.24.0
 *   element-call/patches/*.patch   `git format-patch` files, applied in order
 *
 * The queue's identity is a hash of both, so any change to the tag or to a
 * patch names a different build. `.github/workflows/element-call.yml` builds
 * each queue once and publishes it as a release of this repository, tagged
 * `element-call-<UPSTREAM>-<hash>`; the frontend build downloads it from there.
 *
 *   node scripts/element-call.mjs tag     print the release tag for this queue
 *   node scripts/element-call.mjs fetch   download + verify it into element-call/dist
 *
 * `fetch` is part of `npm start` / `npm run build`. With
 * PRINNY_ELEMENT_CALL=npm it does nothing and vite.config.js ships the
 * unpatched @element-hq/element-call-embedded package instead; that is an
 * explicit opt-out for offline work, never a fallback.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_DIR = join(ROOT, 'element-call');
const PATCH_DIR = join(QUEUE_DIR, 'patches');
export const ELEMENT_CALL_DIST = join(QUEUE_DIR, 'dist');
// Written into the extracted build so a stale element-call/dist from another
// queue (a checkout switched branches, an old local fetch) is never shipped.
const MARKER = '.prinny-queue';

export const ASSET = 'element-call-embedded.tar.gz';
const REPO = process.env.PRINNY_ELEMENT_CALL_REPO || 'coffeegrind123/prinny';

// CI jobs can start before the build of a freshly pushed queue has been
// published (a manual prinny-client push racing publish-webapp). Wait for it
// there; anywhere else a missing release is reported at once.
const CI_WAIT_MS = 45 * 60_000;
const POLL_MS = 30_000;

const HASH_LENGTH = 12;

/** The queue this checkout describes: upstream tag, hash and release tag. */
export function readQueue() {
  const upstream = readFileSync(join(QUEUE_DIR, 'UPSTREAM'), 'utf8').trim();
  if (!/^v\d+\.\d+\.\d+$/.test(upstream)) {
    throw new Error(
      `[element-call] element-call/UPSTREAM must be a release tag like v0.24.0, got "${upstream}"`,
    );
  }

  const patches = readdirSync(PATCH_DIR)
    .filter((name) => name.endsWith('.patch'))
    .sort();

  // CRLF is folded so a Windows checkout with core.autocrlf (the default on
  // GitHub's Windows runners) names the same build as a Linux one.
  const hash = createHash('sha256');
  hash.update(`UPSTREAM ${upstream}\n`);
  for (const name of patches) {
    const body = readFileSync(join(PATCH_DIR, name), 'utf8').replace(/\r\n/g, '\n');
    hash.update(`PATCH ${name} ${Buffer.byteLength(body)}\n`);
    hash.update(body);
  }
  const key = hash.digest('hex').slice(0, HASH_LENGTH);

  return {
    upstream,
    patches,
    key,
    tag: `element-call-${upstream}-${key}`,
    // Shown in the widget URL (cache busting) and in the build's VITE_APP_VERSION.
    version: `${upstream.slice(1)}-prinny.${key}`,
  };
}

/** True when element-call/dist holds the build of exactly this queue. */
export function hasBuild(queue = readQueue()) {
  const marker = join(ELEMENT_CALL_DIST, MARKER);
  if (!existsSync(join(ELEMENT_CALL_DIST, 'index.html')) || !existsSync(marker)) return false;
  return readFileSync(marker, 'utf8').trim() === queue.key;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`[element-call] GET ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchRelease(queue) {
  const base = `https://github.com/${REPO}/releases/download/${queue.tag}`;
  const waitUntil = process.env.CI ? Date.now() + CI_WAIT_MS : 0;

  for (;;) {
    const sums = await download(`${base}/${ASSET}.sha256`);
    if (sums) {
      const tarball = await download(`${base}/${ASSET}`);
      if (!tarball) throw new Error(`[element-call] ${queue.tag} has a checksum but no ${ASSET}`);
      return { sums: sums.toString('utf8'), tarball };
    }
    if (Date.now() >= waitUntil) {
      throw new Error(
        [
          `[element-call] no published build for this patch queue: ${REPO} release ${queue.tag} does not exist.`,
          '  It is made by .github/workflows/element-call.yml (publish-webapp runs it on every push',
          '  to main, or run it from the Actions tab). If it failed, the patches do not build.',
          '  For offline work only: PRINNY_ELEMENT_CALL=npm ships the unpatched npm package.',
        ].join('\n'),
      );
    }
    console.log(`[element-call] ${queue.tag} not published yet, waiting ${POLL_MS / 1000}s`);
    await sleep(POLL_MS);
  }
}

async function fetchBuild() {
  if (process.env.PRINNY_ELEMENT_CALL === 'npm') {
    console.log(
      '[element-call] PRINNY_ELEMENT_CALL=npm: using the unpatched npm package, nothing to fetch',
    );
    return;
  }

  const queue = readQueue();
  if (hasBuild(queue)) {
    console.log(`[element-call] element-call/dist already holds ${queue.tag}`);
    return;
  }

  console.log(
    `[element-call] fetching ${queue.tag} (${queue.patches.length} patches on ${queue.upstream})`,
  );
  const { sums, tarball } = await fetchRelease(queue);

  const expected = sums.trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(tarball).digest('hex');
  if (expected !== actual) {
    throw new Error(
      `[element-call] ${ASSET} checksum mismatch: release says ${expected}, got ${actual}`,
    );
  }

  // Extract beside the destination and swap it in, so an interrupted fetch
  // never leaves a half-written build that a later run would trust.
  const staging = `${ELEMENT_CALL_DIST}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const archive = join(staging, ASSET);
  writeFileSync(archive, tarball);
  execFileSync('tar', ['-xzf', ASSET], { cwd: staging, stdio: 'inherit' });
  rmSync(archive);

  if (!existsSync(join(staging, 'index.html'))) {
    throw new Error(`[element-call] ${ASSET} from ${queue.tag} has no index.html at its root`);
  }
  writeFileSync(join(staging, MARKER), `${queue.key}\n`);

  rmSync(ELEMENT_CALL_DIST, { recursive: true, force: true });
  renameSync(staging, ELEMENT_CALL_DIST);
  console.log(`[element-call] element-call/dist now holds ${queue.tag} (sha256 ${actual})`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const command = process.argv[2];
  try {
    if (command === 'tag') {
      console.log(readQueue().tag);
    } else if (command === 'version') {
      console.log(readQueue().version);
    } else if (command === 'fetch') {
      await fetchBuild();
    } else {
      console.error('usage: node scripts/element-call.mjs <tag|version|fetch>');
      process.exit(2);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
