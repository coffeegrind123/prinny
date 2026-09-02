/**
 * Which emoji the platform can actually draw.
 *
 * `emojibase-data` is pinned at 17.0.0, so the picker knows every emoji through
 * Unicode 17 — while the fonts that have to draw them lag by a year or more.
 * Segoe UI Emoji and Noto Color Emoji both trail the standard, so the newest
 * entries come out as tofu: an empty box offered as if it were a usable emoji,
 * which is then sent to people who see a box too.
 *
 * It is a small set — 8 emoji from Unicode 16 and 8 from Unicode 17, 16 of
 * 1949 — which is exactly why this is a filter and not a bundled emoji font.
 * Shipping one would be several hundred kilobytes and a changed appearance for
 * all 1949 to rescue 16.
 *
 * Testing what the font can draw, rather than filtering on a Unicode version,
 * means this needs no extra data and no maintenance: the same check hides
 * Unicode 15 emoji on an old Android that lacks them, and stops hiding
 * anything the moment the platform's font is updated.
 */

/**
 * A codepoint permanently unassigned by Unicode, so no font will ever have a
 * glyph for it. Whatever the platform draws here IS its tofu.
 */
const TOFU = '\u{10FFFF}';
/**
 * Unicode 6.0, present everywhere colour emoji exist at all. Gives the width of
 * an emoji the font really does have, to measure candidates against.
 */
const KNOWN_GOOD = '\u{1F600}';

/** Comparisons are of font metrics, so a hair of slack rather than equality. */
const EPSILON = 0.5;

let cache: Map<string, boolean> | undefined;
let measure: ((text: string) => number) | undefined;
let tofuWidth = 0;
let goodWidth = 0;

function init(): boolean {
  if (measure) return true;
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  // Whatever the app actually renders emoji in, so the answer is about the font
  // that will draw them and not some canvas default.
  const { font } = window.getComputedStyle(document.body);
  ctx.font = font || '16px sans-serif';
  measure = (text: string) => ctx.measureText(text).width;
  tofuWidth = measure(TOFU);
  goodWidth = measure(KNOWN_GOOD);
  cache = new Map();
  // If the platform cannot tell us these two apart there is nothing to detect
  // with, and guessing would hide emoji that render perfectly well.
  return Math.abs(goodWidth - tofuWidth) > EPSILON;
}

/**
 * True when the platform has a glyph for this emoji.
 *
 * Width is the signal. A missing single codepoint falls back to tofu and takes
 * tofu's advance; a sequence the font does not know decomposes into its parts
 * and comes out roughly a multiple of one emoji wide. Both differ from the
 * width of an emoji the font actually has, which is what `KNOWN_GOOD` supplies.
 *
 * Fails open. If the canvas is unavailable, or the platform draws tofu at the
 * same width as a real emoji, every emoji is reported supported — the picker
 * then behaves exactly as it did before this existed, which is the right way to
 * be wrong.
 */
export function isEmojiSupported(unicode: string): boolean {
  if (!init() || !measure || !cache) return true;
  const cached = cache.get(unicode);
  if (cached !== undefined) return cached;

  const width = measure(unicode);
  const supported = Math.abs(width - tofuWidth) > EPSILON && Math.abs(width - goodWidth) <= EPSILON;

  cache.set(unicode, supported);
  return supported;
}
