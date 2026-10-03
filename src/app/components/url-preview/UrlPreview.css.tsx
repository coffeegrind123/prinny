import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const UrlPreview = style([
  DefaultReset,
  {
    // 2x the compact 216 — larger embeds across the board (YouTube/Twitter/
    // Bsky/generic). Everything inside is width:100% of the card, so widening
    // the card scales every embed type proportionally.
    maxWidth: toRem(432),
    minHeight: toRem(80),
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    borderLeft: `4px solid ${color.Success.Main}`,
    borderRadius: config.radii.R300,
    overflow: 'hidden',
    cursor: 'pointer',

    ':hover': {
      filter: 'brightness(0.8)',
    },

    '@media': {
      '(max-width: 640px)': {
        maxWidth: '100%',
        width: '100%',
        minWidth: 0,
      },
    },
  },
]);

export const UrlPreviewContent = style([
  DefaultReset,
  {
    padding: `${config.space.S100} ${config.space.S300} ${config.space.S200} ${config.space.S300}`,
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
  },
]);

export const UrlPreviewImg = style([
  DefaultReset,
  {
    width: '100%',
    maxHeight: toRem(600),
    objectFit: 'cover',
    objectPosition: 'center',
    cursor: 'pointer',
    display: 'block',
    borderRadius: `${config.radii.R300} ${config.radii.R300} 0 0`,
  },
]);

export const UrlPreviewImgInside = style([
  DefaultReset,
  {
    width: toRem(80),
    height: toRem(80),
    objectFit: 'cover',
    objectPosition: 'center',
    borderRadius: config.radii.R300,
    flexShrink: 0,
    cursor: 'pointer',
  },
]);

export const UrlPreviewDescription = style([
  DefaultReset,
  {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
]);

export const UrlPreviewVideo = style([
  DefaultReset,
  {
    width: '100%',
    height: 'auto',
    // Cap tall/portrait clips. With the 432px card width, 9:16 videos render
    // around 360×640.
    maxHeight: toRem(640),
    objectFit: 'contain',
    backgroundColor: 'black',
    borderRadius: `${config.radii.R300} ${config.radii.R300} 0 0`,
    display: 'block',
  },
]);

// Not `UrlPreviewVideo`: its `height: auto` — there so a video keeps its aspect
// ratio — collapses an `<audio controls>` to 0px in Chromium, leaving only the
// link text. Measured: 0px with it, 54px without. The player draws its own
// chrome at its intrinsic height, so it gets no height rule at all.
export const UrlPreviewAudio = style([
  DefaultReset,
  {
    width: '100%',
    display: 'block',
  },
]);
