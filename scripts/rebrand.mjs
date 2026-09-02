/**
 * Pre-build: rename Cinny → Prinny across the cinny tree.
 *
 * Used by .github/workflows/publish-webapp.yml so the standalone webapp
 * build carries the same Prinny branding the prinny-client desktop build
 * gets via its `rename-prinny.mjs` beforeBuildCommand.
 *
 * Scope: this script walks only the cinny tree and handles user-facing
 * strings. The desktop counterpart in prinny-client/scripts/rename-prinny.mjs
 * also handles Android package dirs and Tauri config — none of that
 * applies here.
 *
 * Revert:  git checkout -- .
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

const TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.html',
  '.css',
  '.svg',
  '.xml',
  '.json',
  '.json5',
  '.webmanifest',
  '.md',
  '.txt',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'scripts', // don't self-rename
]);

// Paths relative to ROOT, not bare names. Matching on the basename meant any
// file called About.tsx or accountData.ts anywhere in the tree was silently
// exempt — a second About.tsx under a feature folder would keep saying Cinny
// and nothing would say so.
const SKIP_PATHS = new Set([
  'src/types/matrix/accountData.ts', // Matrix protocol constant — leave alone
  'src/app/features/settings/about/About.tsx', // Credit upstream Cinny, not Prinny
]);

const BRAND_RE = /\b(Cinny|CINNY)\b/;

/** Leftover branding this run could not rewrite, reported at the end. */
const leftovers = [];

function safeRead(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function replaceInFile(filePath) {
  if (filePath === SCRIPT_PATH) return false;
  try {
    let content = readFileSync(filePath, 'utf8');
    const original = content;
    // Case-sensitive title-case and all-caps only. Lowercase "cinny" is
    // left untouched on purpose so paths, package names, and SEO keywords
    // referencing upstream stay intact.
    content = content.replace(/\bCinny\b/g, 'Prinny');
    content = content.replace(/\bCINNY\b/g, 'PRINNY');
    if (content !== original) {
      writeFileSync(filePath, content, 'utf8');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function walk(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitmodules') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += walk(path);
    } else if (entry.isFile()) {
      const rel = relative(ROOT, path).split(sep).join('/');
      if (SKIP_PATHS.has(rel)) continue;
      if (TEXT_EXTS.has(extname(entry.name).toLowerCase())) {
        if (replaceInFile(path)) {
          console.log(`  ${rel}`);
          count++;
        }
      } else if (BRAND_RE.test(safeRead(path))) {
        // Reachable, but the extension is not one we rewrite. Worth saying out
        // loud: this is how branding leaks into a build unnoticed.
        leftovers.push(`${rel} (extension ${extname(entry.name) || '(none)'} not rewritten)`);
      }
    }
  }
  return count;
}

console.log('[rebrand] Renaming Cinny → Prinny (cinny tree)...');
const changed = walk(ROOT);
console.log(`[rebrand] Done — ${changed} files changed.`);

/*
 * Warn, never fail. A publish that ships one stale string is better than no
 * publish at all, and some of these are deliberate — SKIP_PATHS credits
 * upstream on purpose. The point is that a NEW one cannot arrive silently, the
 * way the whole binary icon set did: this script rewrites text, so the artwork
 * in favicon.ico and the android/apple PNGs was never Prinny's no matter how
 * many times it ran. Those are Prinny's own files now; nothing here can check
 * that, which is exactly why it is worth writing down.
 */
if (leftovers.length > 0) {
  console.warn(`[rebrand] ${leftovers.length} file(s) still mention Cinny and were not rewritten:`);
  leftovers.forEach((entry) => console.warn(`  ${entry}`));
}
