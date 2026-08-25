import { style } from '@vanilla-extract/css';

// Stack URL preview cards vertically (Discord-style) on every viewport.
// The upstream layout was a horizontal scroller of fixed-width cards, with
// edge gradients and a pair of scroll buttons driven by an IntersectionObserver
// on a zero-size anchor at each end. None of that survives a column: the
// buttons had nowhere to scroll to and the left one ended up parked over the
// first card, so `UrlPreviewHolder` drops the chrome along with the axis.
export const UrlPreviewHolderRow = style({
  flexDirection: 'column',
  width: '100%',
  alignItems: 'stretch',
});
