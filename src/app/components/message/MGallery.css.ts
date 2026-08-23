import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

/**
 * The grid a multi-attachment message lays its pictures out in.
 *
 * Column count comes from the item count rather than from available width: a
 * gallery of two should read as a pair at any window size, and one of four as a
 * square. `auto-fit` would reflow those into a single row on a wide window and
 * a single column on a narrow one, which is the one thing a gallery must not
 * do — the arrangement is part of what the sender composed.
 */
export const Gallery = style([
  DefaultReset,
  {
    display: 'grid',
    gap: config.space.S100,
    width: '100%',
    maxWidth: toRem(560),
  },
]);

export const GalleryItem = style([
  DefaultReset,
  {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: config.radii.R400,
    // Every tile is square so the grid stays a grid whatever the aspect ratios
    // in it; the media inside is cropped to fill, and the full frame is one tap
    // away in the viewer.
    aspectRatio: '1 / 1',
    minWidth: 0,
  },
]);

/**
 * A single attachment fills its tile edge to edge.
 *
 * The attachment renderers size themselves from the sender's `info.w`/`info.h`,
 * which is right in a timeline and wrong in a tile — so their box is overridden
 * here rather than at each call site.
 */
export const GalleryItemMedia = style([
  DefaultReset,
  {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  },
]);

// `globalStyle`, because these reach the attachment renderer's own elements and
// vanilla-extract only allows `&` as a selector's target.
globalStyle(`.${GalleryItemMedia} > *`, {
  width: '100%',
  height: '100%',
  maxWidth: 'none',
  margin: 0,
});
globalStyle(`.${GalleryItemMedia} img, .${GalleryItemMedia} video`, {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
});

/** Files and audio keep their normal cards, listed under the picture grid. */
export const GalleryColumn = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
    width: '100%',
    maxWidth: toRem(560),
  },
]);
