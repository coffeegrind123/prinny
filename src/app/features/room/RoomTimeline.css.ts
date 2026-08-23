import { style } from '@vanilla-extract/css';
import { RecipeVariants, recipe } from '@vanilla-extract/recipes';
import { DefaultReset, config } from 'folds';

export const TimelineFloat = recipe({
  base: [
    DefaultReset,
    {
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1,
      minWidth: 'max-content',
    },
  ],
  variants: {
    position: {
      Top: {
        top: config.space.S400,
      },
      Bottom: {
        bottom: config.space.S400,
      },
    },
  },
  defaultVariants: {
    position: 'Top',
  },
});

export type TimelineFloatVariants = RecipeVariants<typeof TimelineFloat>;

/**
 * The timeline scroller.
 *
 * `overflow-anchor: none` is load-bearing, not tidying. The list is
 * virtualised: rows are added and removed above the viewport as the rendered
 * range moves, and the scroll position is restored explicitly around every one
 * of those changes. The browser's own scroll anchoring tries to do the same job
 * at the same moment, picking its own anchor, so the two corrections stack and
 * the view lands somewhere neither intended. It also behaves differently on
 * each engine — Chromium implements it, WebKitGTK (the Linux shell) does not —
 * which is how the same build ends up scrolling differently per platform.
 *
 * Turning it off does not leave content jumping when a message grows after it
 * renders: `useScrollContentAnchor` covers that case explicitly, with an anchor
 * we choose.
 */
export const TimelineScroll = style({
  overflowAnchor: 'none',
});
