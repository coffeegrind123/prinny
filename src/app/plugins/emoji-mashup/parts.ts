import baseNameByCodepoint from './assets/bases.json';

/**
 * Twemoji face parts — base / eyes / mouth / special — keyed by codepoint.
 *
 * Every part is a complete `viewBox="0 0 36 36"` overlay in Twemoji's own
 * coordinate space, so composing a mashup is a plain stack of layers with no
 * offsets and no per-base special cases. See `assets/README.md` for where they
 * came from and how they were optimised.
 *
 * This module holds ~233 KB of inlined SVG, so nothing may import it from the
 * statically reachable graph — it is pulled in only through the lazy chunk
 * `MashupPicker` sits in.
 */

/** A part's inner markup, with the `<svg>` wrapper already removed. */
type PartMarkup = string;
type PartMap = Record<string, PartMarkup>;

const SVG_EXT = '.svg';

/**
 * Strips the `<svg …>` wrapper, leaving markup that can be dropped straight
 * into a composed document. Development builds assert the viewBox first: a
 * re-vendored part that lost it would not fail loudly, it would silently
 * compose at the wrong scale.
 */
const toPartMarkup = (svg: string, path: string): PartMarkup => {
  if (import.meta.env.DEV && !svg.includes('viewBox="0 0 36 36"')) {
    throw new Error(`emoji-mashup: ${path} is not a 36×36 part`);
  }
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
};

const byCodepoint = (glob: Record<string, unknown>): PartMap => {
  const map: PartMap = {};
  Object.entries(glob).forEach(([path, svg]) => {
    const name = path.slice(path.lastIndexOf('/') + 1, -SVG_EXT.length);
    map[name] = toPartMarkup(svg as string, path);
  });
  return map;
};

// The glob pattern and its options have to be inline literals — Vite resolves
// these at build time and cannot follow a variable.
const basePart = byCodepoint(
  import.meta.glob('./assets/base/*.svg', { eager: true, query: '?raw', import: 'default' })
);
const sharedBasePart = byCodepoint(
  import.meta.glob('./assets/base-shared/*.svg', { eager: true, query: '?raw', import: 'default' })
);
const eyesPart = byCodepoint(
  import.meta.glob('./assets/eyes/*.svg', { eager: true, query: '?raw', import: 'default' })
);
const mouthPart = byCodepoint(
  import.meta.glob('./assets/mouth/*.svg', { eager: true, query: '?raw', import: 'default' })
);
const specialPart = byCodepoint(
  import.meta.glob('./assets/special/*.svg', { eager: true, query: '?raw', import: 'default' })
);

const sharedBaseName: Record<string, string> = baseNameByCodepoint;

/**
 * The head shape for a codepoint: its own if it has one, otherwise the shared
 * shape `bases.json` assigns it. 135 codepoints have one; the rest of Unicode
 * has no face to take apart.
 */
export const getBasePart = (codepoint: string): PartMarkup | undefined => {
  const own = basePart[codepoint];
  if (own) return own;
  const shared = sharedBaseName[codepoint];
  return shared ? sharedBasePart[shared] : undefined;
};

export const getEyesPart = (codepoint: string): PartMarkup | undefined => eyesPart[codepoint];

export const getMouthPart = (codepoint: string): PartMarkup | undefined => mouthPart[codepoint];

/**
 * The extras that ride along with a mouth — tears, sweat, a halo, a mask.
 * A few emoji (😷 🤭 🥸) have one *instead of* a mouth rather than as well as,
 * which is why {@link mouthDonors} accepts either.
 */
export const getSpecialPart = (codepoint: string): PartMarkup | undefined => specialPart[codepoint];

/**
 * Codepoints that can donate the left half of a mashup — a head shape and the
 * eyes drawn on it. Both are required: eyes floating with no head is not a
 * face.
 */
export const faceDonors = (): string[] =>
  Object.keys(eyesPart).filter((codepoint) => getBasePart(codepoint) !== undefined);

/**
 * Codepoints that can donate the right half — a mouth, a special, or both.
 * Accepting a special on its own is deliberate: 😷's mask and 🤭's hand are
 * *replacements* for a mouth, and a masked face with no mouth under it is the
 * correct picture.
 */
export const mouthDonors = (): string[] =>
  Array.from(new Set([...Object.keys(mouthPart), ...Object.keys(specialPart)]));
