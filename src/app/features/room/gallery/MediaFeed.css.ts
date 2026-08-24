import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

/**
 * The feed is a black stage in every theme, so its chrome is written in
 * absolute colours rather than theme tokens — the same choice ImageViewer
 * makes. Everything readable sits on a scrim, so contrast does not depend on
 * what the attachment underneath happens to look like.
 *
 * **Every layer here states its `z-index`, and the media is one of them.**
 * A statically positioned element paints *below* an absolutely positioned
 * sibling whatever the source order says, so the media element — which is in
 * normal flow — was painted underneath `FeedBackdrop`: a copy of its own still,
 * blown up to cover the page and put through `blur(48px) brightness(0.4)`. That
 * is a black rectangle over the attachment. The image escaped it by accident,
 * because the zoom transform it always carries promotes it into the positioned
 * paint step; `<video>` carries no transform, so every video in the feed with a
 * poster — uploaded, Twitter, Bluesky alike — played correctly behind an opaque
 * dark smear. Nothing here may go back to relying on that accident:
 *
 *   0  FeedBackdrop, the blurhash placeholder — what is behind the attachment
 *   1  FeedMedia — the attachment
 *   2  FeedTapTarget (gestures), FeedScrimTop / FeedScrimBottom (legibility)
 *   3  FeedCenterBadge — spinner, failure, spoiler, play
 *   4  FeedTopBar, FeedInfo, FeedRail — the chrome
 *   5  FeedProgress — the transport bar, which must stay grabbable over all of it
 */
export const Feed = style([
  DefaultReset,
  {
    position: 'absolute',
    inset: 0,
    backgroundColor: '#000',
    color: 'white',
    overflowX: 'hidden',
    overflowY: 'auto',
    scrollSnapType: 'y mandatory',
    overscrollBehavior: 'contain',
    // The pages are snap targets; without this the scrollbar is a second, worse
    // way to land between two of them.
    scrollbarWidth: 'none',
    selectors: {
      '&::-webkit-scrollbar': {
        display: 'none',
      },
    },
  },
]);

export const FeedPage = style([
  DefaultReset,
  {
    position: 'relative',
    width: '100%',
    height: '100%',
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
]);

export const FeedMedia = style([
  DefaultReset,
  {
    // Positioned purely to give it a z-index — see the layer table above. The
    // attachment is the thing the reader opened; it does not get to be the one
    // element in here whose paint order is left to chance.
    position: 'relative',
    zIndex: 1,
    maxWidth: '100%',
    maxHeight: '100%',
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
    display: 'block',
    userSelect: 'none',
  },
]);

/** Fills the page behind the media so a portrait clip is not framed in flat black. */
export const FeedBackdrop = style([
  DefaultReset,
  {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    zIndex: 0,
    objectFit: 'cover',
    filter: 'blur(48px) brightness(0.4)',
    transform: 'scale(1.15)',
    pointerEvents: 'none',
  },
]);

export const FeedScrimTop = style([
  DefaultReset,
  {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: toRem(140),
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.65), rgba(0,0,0,0))',
    zIndex: 2,
    pointerEvents: 'none',
  },
]);

export const FeedScrimBottom = style([
  DefaultReset,
  {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: toRem(220),
    background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))',
    zIndex: 2,
    pointerEvents: 'none',
  },
]);

export const FeedTopBar = style([
  DefaultReset,
  {
    // Fixed, not absolute: an absolutely positioned child of the scroller
    // scrolls away with the pages, and the way out of the feed has to stay put.
    position: 'fixed',
    top: `calc(${config.space.S200} + env(safe-area-inset-top))`,
    left: `calc(${config.space.S200} + env(safe-area-inset-left))`,
    right: `calc(${config.space.S200} + env(safe-area-inset-right))`,
    zIndex: 4,
  },
]);

export const FeedInfo = style([
  DefaultReset,
  {
    position: 'absolute',
    bottom: `calc(${config.space.S500} + env(safe-area-inset-bottom))`,
    left: `calc(${config.space.S400} + env(safe-area-inset-left))`,
    // Clear of the action rail on the right.
    right: toRem(76),
    zIndex: 4,
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
  },
]);

export const FeedCaption = style([
  DefaultReset,
  {
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    wordBreak: 'break-word',
  },
]);

export const FeedCaptionExpanded = style([
  DefaultReset,
  {
    maxHeight: '40vh',
    overflowY: 'auto',
    wordBreak: 'break-word',
  },
]);

export const FeedRail = style([
  DefaultReset,
  {
    position: 'absolute',
    right: `calc(${config.space.S300} + env(safe-area-inset-right))`,
    bottom: `calc(${config.space.S500} + env(safe-area-inset-bottom))`,
    zIndex: 4,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: config.space.S300,
  },
]);

export const FeedRailButton = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: toRem(2),
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'white',
    cursor: 'pointer',
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
    filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6))',

    selectors: {
      '&:hover': {
        opacity: 0.8,
      },
      '&:focus-visible': {
        outline: `${toRem(2)} solid white`,
        outlineOffset: toRem(2),
        borderRadius: config.radii.R400,
      },
      '&[aria-pressed="true"]': {
        color: '#ff2d55',
      },
      '&:disabled': {
        opacity: 0.5,
        cursor: 'default',
      },
    },
  },
]);

export const FeedBarGroup = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S200,
    padding: `${toRem(4)} ${config.space.S200}`,
    borderRadius: config.radii.R400,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    color: 'white',
    backdropFilter: 'blur(6px)',
  },
]);

export const FeedProgress = style([
  DefaultReset,
  {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: toRem(14),
    display: 'flex',
    alignItems: 'flex-end',
    zIndex: 5,
    cursor: 'pointer',
    touchAction: 'none',
  },
]);

export const FeedProgressTrack = style([
  DefaultReset,
  {
    width: '100%',
    height: toRem(3),
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    transition: 'height 120ms ease',

    selectors: {
      [`${FeedProgress}:hover &`]: {
        height: toRem(6),
      },
    },
  },
]);

export const FeedProgressFill = style([
  DefaultReset,
  {
    height: '100%',
    backgroundColor: 'white',
  },
]);

export const FeedCenterBadge = style([
  DefaultReset,
  {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 3,
  },
]);

export const FeedCenterBadgeInner = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: toRem(72),
    height: toRem(72),
    borderRadius: config.radii.Round,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    color: 'white',
  },
]);

export const FeedTapTarget = style([
  DefaultReset,
  {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    border: 'none',
    padding: 0,
    background: 'transparent',
    cursor: 'default',
  },
]);

export const FeedEnd = style([
  DefaultReset,
  {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: config.space.S300,
    scrollSnapAlign: 'start',
  },
]);
