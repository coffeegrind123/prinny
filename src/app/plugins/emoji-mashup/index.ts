import { IEmoji, emojis } from '../emoji';
import { faceDonors, mouthDonors } from './parts';

export { composeMashupSvg, mashupDataUri, renderMashupPng, MASHUP_PNG_SIZE, MASHUP_MIME_TYPE } from './render';

/**
 * One side of a mashup: the emoji a user picks, paired with the codepoint the
 * part files are keyed by.
 *
 * The two are not always the same string. Part files follow Twemoji's naming,
 * which keeps or drops the FE0F variation selector case by case, while
 * emojibase has its own answer — so ❄️ is `2744-fe0f` in one and `2744` in the
 * other. {@link matchCodepoint} reconciles them once, here, instead of leaving
 * every call site to guess.
 */
export type MashupEmoji = {
  /** The key the part files use — lowercase hex, hyphen-joined. */
  codepoint: string;
  emoji: IEmoji;
};

const matchCodepoint = (emoji: IEmoji, roster: Set<string>): string | undefined => {
  const hexcode = emoji.hexcode.toLowerCase();
  if (roster.has(hexcode)) return hexcode;

  const bare = hexcode.replace(/-fe0f/g, '');
  if (roster.has(bare)) return bare;

  const decorated = `${hexcode}-fe0f`;
  if (roster.has(decorated)) return decorated;

  return undefined;
};

/**
 * Walks the emoji catalogue in its own order so the picker's grid reads like
 * the rest of the board — smileys, then animals, then the odd object — rather
 * than in whatever order the parts directory happened to list.
 */
const collect = (codepoints: string[], label: string): MashupEmoji[] => {
  const roster = new Set(codepoints);
  const found: MashupEmoji[] = [];
  const claimed = new Set<string>();

  emojis.forEach((emoji) => {
    const codepoint = matchCodepoint(emoji, roster);
    if (codepoint === undefined || claimed.has(codepoint)) return;
    claimed.add(codepoint);
    found.push({ codepoint, emoji });
  });

  if (import.meta.env.DEV && claimed.size !== roster.size) {
    const orphans = codepoints.filter((codepoint) => !claimed.has(codepoint));
    // Loud on purpose. An orphaned part is invisible in the picker and would
    // otherwise only show up as "why can't I pick 🥲" months later.
    console.warn(`emoji-mashup: ${orphans.length} ${label} parts match no known emoji`, orphans);
  }

  return found;
};

/** Emoji that can donate a head shape and eyes — the left half. */
export const mashupFaces: MashupEmoji[] = collect(faceDonors(), 'face');

/** Emoji that can donate a mouth, a special, or both — the right half. */
export const mashupMouths: MashupEmoji[] = collect(mouthDonors(), 'mouth');

export const findMashupFace = (codepoint: string): MashupEmoji | undefined =>
  mashupFaces.find((face) => face.codepoint === codepoint);

export const findMashupMouth = (codepoint: string): MashupEmoji | undefined =>
  mashupMouths.find((mouth) => mouth.codepoint === codepoint);

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

/**
 * The name a mashup is known by, everywhere.
 *
 * It has to be derived purely from the two halves, because it is the only
 * thing two people who mash the same pair have in common: their uploads get
 * different `mxc://` URIs, so a reaction can only be recognised as "the same
 * reaction" by matching this string. The `mash_` prefix keeps them together in
 * `:` autocomplete and out of the way of a real pack's names.
 */
export const mashupShortcode = (face: MashupEmoji, mouth: MashupEmoji): string =>
  `mash_${sanitize(face.emoji.shortcode)}__${sanitize(mouth.emoji.shortcode)}`;

/** Human-readable description, used as image alt text and the pack `body`. */
export const mashupBody = (face: MashupEmoji, mouth: MashupEmoji): string =>
  `${face.emoji.unicode} + ${mouth.emoji.unicode}`;

export const mashupLabel = (face: MashupEmoji, mouth: MashupEmoji): string =>
  `${face.emoji.label} + ${mouth.emoji.label}`;
