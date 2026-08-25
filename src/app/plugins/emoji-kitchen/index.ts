import { IEmoji, emojis } from '../emoji';
import kitchenIndex from './kitchen-index.json';

/**
 * Google's Emoji Kitchen: 147,000 hand-drawn pairings of 619 emoji.
 *
 * The pictures are Google's and are fetched from `gstatic.com` — this module
 * only works out which pairings exist and what their URLs are. See
 * `scripts/build-emoji-kitchen-index.mjs` for the index's shape and why it has
 * to exist at all.
 *
 * It holds ~300 KB of index, so nothing may import it from the statically
 * reachable graph — it arrives with the lazy chunk `MashupPicker` sits in.
 */

const { baseUrl, count, dates, codepoints, pairs } = kitchenIndex;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Uint8Array(128);
for (let i = 0; i < B64.length; i += 1) B64_VALUE[B64.charCodeAt(i)] = i;

const GAP_ESCAPE = '_'.charCodeAt(0);

/**
 * One end of a pairing: the emoji a user picks, tied to its slot in the index.
 */
export type KitchenEmoji = {
  /** Hyphen-joined lowercase hex, as the index stores it — `2639-fe0f`. */
  codepoint: string;
  /** Slot in the index's codepoint table. */
  index: number;
  emoji: IEmoji;
};

export type KitchenCombo = {
  partner: KitchenEmoji;
  /** Ready to put in an `<img src>`. */
  url: string;
};

/* ------------------------------------------------------------------ *
 * Decode
 * ------------------------------------------------------------------ */

const leftOf = new Uint16Array(count);
const rightOf = new Uint16Array(count);
const dateOf = new Uint8Array(count);

let written = 0;
pairs.forEach((row, left) => {
  let at = 0;
  let partner = 0;
  while (at < row.length) {
    let gap: number;
    if (row.charCodeAt(at) === GAP_ESCAPE) {
      gap = (B64_VALUE[row.charCodeAt(at + 1)] << 6) | B64_VALUE[row.charCodeAt(at + 2)];
      at += 3;
    } else {
      gap = B64_VALUE[row.charCodeAt(at)];
      at += 1;
    }
    partner += gap;

    leftOf[written] = left;
    rightOf[written] = partner;
    dateOf[written] = B64_VALUE[row.charCodeAt(at)];
    at += 1;
    written += 1;
  }
});

if (import.meta.env.DEV && written !== count) {
  throw new Error(`emoji-kitchen: decoded ${written} pairings, expected ${count}`);
}

/* ------------------------------------------------------------------ *
 * Adjacency
 * ------------------------------------------------------------------ *
 *
 * Only one direction of each pairing is stored, so both ends are indexed here
 * to answer "what can this emoji be mashed with" without walking all 147,000
 * every time the grid re-renders. Compressed-sparse-row: one offset per emoji
 * into a flat neighbour list.
 *
 * The high bit of a neighbour says whether *this* emoji is the one that comes
 * first in the URL, which is the half of the pairing the index does not store
 * twice and the URL cannot do without.
 */

const SELF_IS_LEFT = 0x8000;
const PARTNER_MASK = 0x7fff;

const emojiCount = codepoints.length;
const adjacencyStart = new Int32Array(emojiCount + 1);

for (let i = 0; i < count; i += 1) {
  adjacencyStart[leftOf[i]] += 1;
  // A pairing of an emoji with itself is one neighbour, not two.
  if (rightOf[i] !== leftOf[i]) adjacencyStart[rightOf[i]] += 1;
}

let runningTotal = 0;
for (let i = 0; i <= emojiCount; i += 1) {
  const degree = i < emojiCount ? adjacencyStart[i] : 0;
  adjacencyStart[i] = runningTotal;
  runningTotal += degree;
}

const adjacencyPartner = new Uint16Array(runningTotal);
const adjacencyDate = new Uint8Array(runningTotal);
const cursor = Int32Array.from(adjacencyStart.subarray(0, emojiCount));

for (let i = 0; i < count; i += 1) {
  const left = leftOf[i];
  const right = rightOf[i];
  const date = dateOf[i];

  let slot = cursor[left];
  adjacencyPartner[slot] = right | SELF_IS_LEFT;
  adjacencyDate[slot] = date;
  cursor[left] = slot + 1;

  if (right !== left) {
    slot = cursor[right];
    adjacencyPartner[slot] = left;
    adjacencyDate[slot] = date;
    cursor[right] = slot + 1;
  }
}

/* ------------------------------------------------------------------ *
 * Roster
 * ------------------------------------------------------------------ */

/**
 * Every spelling of a codepoint emojibase might file it under.
 *
 * Three things disagree about how to write one. The index uses bare lowercase
 * hex, the URL wants a `u` on every segment, and emojibase uppercases,
 * zero-pads each segment to four (©️ is `00A9-FE0F`, not `A9-FE0F`) and is
 * inconsistent about carrying the FE0F variation selector at all.
 */
const emojibaseSpellings = (codepoint: string): string[] => {
  const upper = codepoint.toUpperCase();
  const padded = upper
    .split('-')
    .map((part) => part.padStart(4, '0'))
    .join('-');

  const spellings = new Set<string>();
  [upper, padded].forEach((base) => {
    spellings.add(base);
    spellings.add(base.replace(/-FE0F/g, ''));
    spellings.add(`${base}-FE0F`);
  });
  return Array.from(spellings);
};

const indexByHexcode = new Map<string, number>();
codepoints.forEach((codepoint, index) => {
  emojibaseSpellings(codepoint).forEach((hexcode) => {
    if (!indexByHexcode.has(hexcode)) indexByHexcode.set(hexcode, index);
  });
});

const byIndex = new Array<KitchenEmoji | undefined>(emojiCount);

/**
 * The 619 mashable emoji, walked in the emoji catalogue's own order so the
 * picker reads like the rest of the board rather than in codepoint order.
 */
export const kitchenEmojis: KitchenEmoji[] = [];

emojis.forEach((emoji) => {
  const index = indexByHexcode.get(emoji.hexcode);
  if (index === undefined || byIndex[index]) return;

  const kitchenEmoji: KitchenEmoji = { codepoint: codepoints[index], index, emoji };
  byIndex[index] = kitchenEmoji;
  kitchenEmojis.push(kitchenEmoji);
});

/** Where each emoji sits in the display order above. */
const displayRank = new Int32Array(emojiCount).fill(Number.MAX_SAFE_INTEGER);
kitchenEmojis.forEach((kitchenEmoji, rank) => {
  displayRank[kitchenEmoji.index] = rank;
});

if (import.meta.env.DEV && kitchenEmojis.length !== emojiCount) {
  const orphans = codepoints.filter((_, index) => !byIndex[index]);
  // Loud on purpose: an unmatched codepoint is simply missing from the picker,
  // and would otherwise only surface as "why can't I pick ©️".
  // eslint-disable-next-line no-console
  console.warn(`emoji-kitchen: ${orphans.length} codepoints match no known emoji`, orphans);
}

export const findKitchenEmoji = (codepoint: string): KitchenEmoji | undefined => {
  const index = indexByHexcode.get(codepoint.toUpperCase());
  return index === undefined ? undefined : byIndex[index];
};

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

/** `2639-fe0f` -> `u2639-ufe0f`, the spelling the URL path uses. */
const urlToken = (codepoint: string): string =>
  codepoint
    .split('-')
    .map((part) => `u${part}`)
    .join('-');

const comboUrl = (left: string, right: string, dateIndex: number): string => {
  const from = urlToken(left);
  return `${baseUrl}${dates[dateIndex]}/${from}/${from}_${urlToken(right)}.png`;
};

/**
 * Everything this emoji can be mashed with, in the picker's display order.
 *
 * Google drew a specific set of pairings rather than every combination, so
 * this is also what stops the grid offering dead ends.
 */
export const kitchenPartners = (subject: KitchenEmoji): KitchenCombo[] => {
  const from = adjacencyStart[subject.index];
  const to = adjacencyStart[subject.index + 1];

  const combos: KitchenCombo[] = [];
  for (let slot = from; slot < to; slot += 1) {
    const packed = adjacencyPartner[slot];
    const partner = byIndex[packed & PARTNER_MASK];
    if (!partner) continue;

    const subjectIsLeft = (packed & SELF_IS_LEFT) !== 0;
    combos.push({
      partner,
      url: subjectIsLeft
        ? comboUrl(subject.codepoint, partner.codepoint, adjacencyDate[slot])
        : comboUrl(partner.codepoint, subject.codepoint, adjacencyDate[slot]),
    });
  }

  combos.sort((a, b) => displayRank[a.partner.index] - displayRank[b.partner.index]);
  return combos;
};

/** The pairing of two specific emoji, if Google drew one. */
export const kitchenCombo = (a: KitchenEmoji, b: KitchenEmoji): KitchenCombo | undefined => {
  const from = adjacencyStart[a.index];
  const to = adjacencyStart[a.index + 1];

  for (let slot = from; slot < to; slot += 1) {
    const packed = adjacencyPartner[slot];
    if ((packed & PARTNER_MASK) !== b.index) continue;

    const aIsLeft = (packed & SELF_IS_LEFT) !== 0;
    return {
      partner: b,
      url: aIsLeft
        ? comboUrl(a.codepoint, b.codepoint, adjacencyDate[slot])
        : comboUrl(b.codepoint, a.codepoint, adjacencyDate[slot]),
    };
  }
  return undefined;
};

/* ------------------------------------------------------------------ *
 * Naming
 * ------------------------------------------------------------------ */

/**
 * Reduces a shortcode to `[a-z0-9]` separated by **single** underscores.
 *
 * Collapsing runs is what makes {@link mashupShortcode} unambiguous. A single
 * underscore joiner is not enough: sweat_smile + cat and sweat + smile_cat
 * both spell `mash_sweat_smile_cat`, which would make two different mashups
 * one reaction — and serve the second one the first one's upload. Since no
 * half can contain `__` after this, the first `__` in the result is always
 * the join, by construction rather than by luck.
 */
const sanitize = (shortcode: string): string =>
  shortcode
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** The two halves in a fixed order, so naming does not depend on pick order. */
const ordered = (a: KitchenEmoji, b: KitchenEmoji): [KitchenEmoji, KitchenEmoji] =>
  a.index <= b.index ? [a, b] : [b, a];

/**
 * The name a mashup is known by, everywhere.
 *
 * Derived purely from the two halves, because it is the only thing two people
 * who mash the same pair have in common: their uploads get different `mxc://`
 * URIs, so a reaction can only be recognised as "the same reaction" by
 * matching this string.
 *
 * Sorted first. Emoji Kitchen draws one picture per pair — 😹+🎂 and 🎂+😹 are
 * the same artwork — so letting pick order into the name would give one picture
 * two names, and split its reactions for no reason.
 */
export const mashupShortcode = (a: KitchenEmoji, b: KitchenEmoji): string => {
  const [first, second] = ordered(a, b);
  return `mash_${sanitize(first.emoji.shortcode)}__${sanitize(second.emoji.shortcode)}`;
};

/** Human-readable description, used as image alt text and the pack `body`. */
export const mashupBody = (a: KitchenEmoji, b: KitchenEmoji): string => {
  const [first, second] = ordered(a, b);
  return `${first.emoji.unicode} + ${second.emoji.unicode}`;
};

export const mashupLabel = (a: KitchenEmoji, b: KitchenEmoji): string => {
  const [first, second] = ordered(a, b);
  return `${first.emoji.label} + ${second.emoji.label}`;
};
