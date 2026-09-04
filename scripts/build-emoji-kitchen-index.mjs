#!/usr/bin/env node
/**
 * Rebuilds `src/app/plugins/emoji-kitchen/kitchen-index.json`.
 *
 * Emoji Kitchen artwork lives at a URL that embeds the date Google shipped
 * that particular pairing:
 *
 *   {base}/{date}/u{a}/u{a}_u{b}.png
 *
 * There is no rule for the date and no way to probe for it — every one of the
 * 147,000 pairings has to be looked up. That is the only reason this index
 * exists. The canonical dump of it (xsalazar/emoji-kitchen-backend) is a
 * 99 MB JSON carrying alt text, keywords, ordering and every superseded
 * revision, none of which we use, so this reduces it to the three facts a URL
 * needs — which pairs exist, in which direction, and on what date — and
 * re-encodes them small enough to bundle.
 *
 * Encoding, `pairs[i]` being the row for codepoint `i`:
 *
 *   Each entry is a base64 digit for the gap to the next partner index, then a
 *   base64 digit for the index into `dates`. A gap of 64 or more is written as
 *   `_` followed by two digits. Partners are sorted, so the gaps are small and
 *   the row compresses hard — 303 KB of text becomes about 61 KB gzipped,
 *   against 132 KB for the same data with absolute indices.
 *
 * Only one direction of each pair is stored, because only one exists: Google
 * draws 😹+🎂 or 🎂+😹, never both. The reader indexes it from both ends.
 *
 * Codepoints are stored as plain hyphen-joined hex (`2639-fe0f`). The URL wants
 * a `u` on every segment (`u2639-ufe0f`) and emojibase wants them uppercase and
 * zero-padded to four (`2639-FE0F`, and `00A9-FE0F` for ©️), so neither spelling
 * is a good canonical form; the reader derives both.
 *
 * Usage: node scripts/build-emoji-kitchen-index.mjs
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE =
  'https://raw.githubusercontent.com/USYDShawnTan/emojimix/main/data/emojimix_data_compact.json';

// `baseUrl` is copied out of the fetched document into the committed index, and
// the runtime builds EVERY artwork URL from it. The rest of the document is
// shape-checked below, but this one field decides where every client sends its
// requests, so it is the one field that must not be taken on trust: a poisoned
// regeneration would otherwise repoint the whole client at another origin as a
// single-field diff inside a ~300 KB single-line JSON file.
const ALLOWED_BASE_URLS = ['https://www.gstatic.com/android/keyboard/emojikitchen/'];

const assertAllowedBaseUrl = (value) => {
  if (typeof value !== 'string' || !ALLOWED_BASE_URLS.includes(value)) {
    throw new Error(
      `Refusing baseUrl ${JSON.stringify(value)}: not in the allowlist. ` +
        'If the upstream legitimately moved, add the new origin to ALLOWED_BASE_URLS ' +
        'in this script as a reviewed change.',
    );
  }
  return value;
};

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'app',
  'plugins',
  'emoji-kitchen',
  'kitchen-index.json',
);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** `u2639-ufe0f` -> `2639-fe0f`. */
const toHexcode = (token) =>
  token
    .split('-')
    .map((part) => part.slice(1))
    .join('-');

const main = async () => {
  process.stdout.write(`Fetching ${SOURCE}\n`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Source fetch failed: ${res.status} ${res.statusText}`);
  const source = await res.json();

  const { dates, emojis } = source;
  if (!Array.isArray(dates) || typeof emojis !== 'object') {
    throw new Error('Source is not in the expected {dates, emojis} shape');
  }

  const entries = [];
  for (const [dateIndex, pairList] of Object.entries(emojis)) {
    const date = Number(dateIndex);
    if (!Number.isInteger(date) || date < 0 || date >= dates.length) {
      throw new Error(`Pair list keyed by ${dateIndex}, which is not a date index`);
    }
    for (const pair of pairList) {
      const [left, right] = pair.split('_');
      if (!left || !right) throw new Error(`Malformed pair: ${pair}`);
      entries.push([toHexcode(left), toHexcode(right), date]);
    }
  }

  const codepoints = [...new Set(entries.flatMap(([l, r]) => [l, r]))].sort();
  const indexOf = new Map(codepoints.map((cp, i) => [cp, i]));

  const byLeft = new Map(codepoints.map((_, i) => [i, []]));
  for (const [left, right, date] of entries) {
    byLeft.get(indexOf.get(left)).push([indexOf.get(right), date]);
  }

  const pairs = codepoints.map((_, i) => {
    let previous = 0;
    let row = '';
    for (const [right, date] of byLeft.get(i).sort((a, b) => a[0] - b[0])) {
      const gap = right - previous;
      previous = right;
      row += gap < 64 ? B64[gap] : `_${B64[gap >> 6]}${B64[gap & 63]}`;
      row += B64[date];
    }
    return row;
  });

  const index = {
    source: SOURCE,
    baseUrl: assertAllowedBaseUrl(source.baseUrl),
    count: entries.length,
    dates,
    codepoints,
    pairs,
  };

  await writeFile(OUT, JSON.stringify(index), 'utf8');
  process.stdout.write(
    `Wrote ${OUT}\n  ${codepoints.length} emoji, ${entries.length} pairings, ${dates.length} dates\n`,
  );
};

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
