#!/usr/bin/env node
/**
 * Guards the assumptions the shipped Content-Security-Policy relies on.
 *
 * `src-tauri/tauri.conf.json` serves this build under
 * `script-src 'self' 'wasm-unsafe-eval' ...` - no `'unsafe-inline'`, no
 * `'unsafe-eval'`. That is only safe to ship while the build actually produces
 * no inline script, because an inline `<script>` or an `onclick=` attribute
 * would be silently blocked at runtime and the app would come up blank with
 * only a console message to explain it.
 *
 * The policy was previously `'unsafe-inline' 'unsafe-eval'`, which meant any
 * script-injection defect in the frontend reached the app's native command
 * surface - the webview origin holds the Tauri capability grant. Tightening it
 * is only durable if a regression is loud, so this runs as part of `npm run
 * build` and fails the build rather than the app.
 *
 * Run manually: node scripts/check-csp.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

if (!existsSync(DIST)) {
  console.error('[check-csp] no dist/ - run the build first');
  process.exit(1);
}

const problems = [];

for (const name of readdirSync(DIST)) {
  if (!name.endsWith('.html')) continue;
  const html = readFileSync(join(DIST, name), 'utf8');

  // An inline <script> is any <script> without a src attribute that has a body.
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .filter((m) => m[1].trim().length > 0);
  for (const m of inline) {
    problems.push(
      `${name}: inline <script> (${m[1].trim().slice(0, 60)}...) - blocked without 'unsafe-inline'`,
    );
  }

  // Inline event handlers need 'unsafe-inline' too.
  for (const m of html.matchAll(/\son[a-z]+\s*=\s*["'][^"']*["']/gi)) {
    problems.push(`${name}: inline event handler ${m[0].trim().slice(0, 40)}`);
  }

  // javascript: URLs are blocked by script-src as well.
  if (/(?:href|src)\s*=\s*["']\s*javascript:/i.test(html)) {
    problems.push(`${name}: javascript: URL`);
  }
}

if (problems.length > 0) {
  console.error('[check-csp] the shipped CSP forbids inline script, but the build emitted some:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nEither keep the script in a separate file (see public/global-shim.js for the\n' +
      'precedent), or - if it genuinely cannot be - add its sha256 to script-src in\n' +
      'src-tauri/tauri.conf.json and to the nginx templates. Do NOT reintroduce\n' +
      "'unsafe-inline': the webview origin holds this app's native command grant.",
  );
  process.exit(1);
}

console.log('[check-csp] OK - no inline script, no inline handlers, no javascript: URLs');
