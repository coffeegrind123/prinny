import { style } from '@vanilla-extract/css';
import { toRem, color, config, DefaultReset, FocusOutline } from 'folds';

/**
 * Layout
 */

export const Base = style({
  maxWidth: toRem(498),
  width: `calc(100vw - 2 * ${config.space.S400})`,
  height: toRem(440),
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R400,
  boxShadow: config.shadow.E200,
  overflow: 'hidden',
});

export const Header = style({
  padding: config.space.S300,
  paddingBottom: 0,
});

/**
 * Sidebar
 */

export const Sidebar = style({
  width: toRem(54),
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  position: 'relative',
});

export const SidebarContent = style({
  padding: `${config.space.S200} 0`,
});

export const SidebarStack = style({
  width: '100%',
  backgroundColor: color.Surface.Container,
});

export const SidebarDivider = style({
  width: toRem(18),
});

export const SidebarBtnImg = style({
  width: toRem(24),
  height: toRem(24),
  objectFit: 'contain',
});

/**
 * Preview
 */

export const Preview = style({
  padding: config.space.S200,
  margin: config.space.S300,
  marginTop: 0,
  minHeight: toRem(40),

  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const PreviewEmoji = style([
  DefaultReset,
  {
    width: toRem(32),
    height: toRem(32),
    fontSize: toRem(32),
    lineHeight: toRem(32),
  },
]);
export const PreviewImg = style([
  DefaultReset,
  {
    width: toRem(32),
    height: toRem(32),
    objectFit: 'contain',
  },
]);

/**
 * Group
 */

export const EmojiGroup = style({
  position: 'relative',
  padding: `${config.space.S300} 0`,
});

export const EmojiGroupLabel = style({
  position: 'sticky',
  top: config.space.S200,
  zIndex: 1,

  margin: 'auto',
  padding: `${config.space.S100} ${config.space.S200}`,
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const EmojiGroupContent = style([
  DefaultReset,
  {
    padding: `0 ${config.space.S200}`,
  },
]);

/**
 * Item
 */

export const EmojiItem = style([
  DefaultReset,
  FocusOutline,
  {
    width: toRem(48),
    height: toRem(48),
    fontSize: toRem(32),
    lineHeight: toRem(32),
    borderRadius: config.radii.R400,
    cursor: 'pointer',

    ':hover': {
      backgroundColor: color.Surface.ContainerHover,
    },
  },
]);

export const StickerItem = style([
  EmojiItem,
  {
    width: toRem(112),
    height: toRem(112),
  },
]);

export const CustomEmojiImg = style([
  DefaultReset,
  {
    width: toRem(32),
    height: toRem(32),
    objectFit: 'contain',
  },
]);

export const StickerImg = style([
  DefaultReset,
  {
    width: toRem(96),
    height: toRem(96),
    objectFit: 'contain',
  },
]);

/**
 * GIF Picker
 */

export const GifPicker = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  // Allow the picker to shrink below its content so the inner scroll area can
  // scroll instead of overflowing the fixed-height board.
  minHeight: 0,
});

export const GifSearch = style({
  padding: `${config.space.S200} ${config.space.S300} ${config.space.S200}`,
});

export const GifScrollWrap = style({
  minHeight: 0,
});

// Masonry-style grid using CSS columns. Two columns with 12px gaps match
// Discord's GIF picker layout within the 498px picker width.
export const GifGrid = style({
  columnCount: 2,
  columnGap: config.space.S300,
  padding: `0 ${config.space.S300} ${config.space.S100}`,
  width: '100%',
});

export const GifTile = style([
  DefaultReset,
  FocusOutline,
  {
    // Anchor the absolutely-positioned favourite star to each tile.
    position: 'relative',
    // Avoid a tile being split across columns.
    breakInside: 'avoid',
    display: 'block',
    width: '100%',
    marginBottom: config.space.S100,
    padding: 0,
    border: 'none',
    background: 'transparent',
    borderRadius: config.radii.R300,
    overflow: 'hidden',
    cursor: 'pointer',

    ':hover': {
      backgroundColor: color.Surface.ContainerHover,
    },
  },
]);

export const GifTileImg = style([
  DefaultReset,
  {
    display: 'block',
    width: '100%',
    height: 'auto',
    objectFit: 'contain',
  },
]);

export const GifStatus = style({
  padding: `${config.space.S500} ${config.space.S400}`,
});

/**
 * GIF Categories
 */

export const GifCategories = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  padding: `0 ${config.space.S300} ${config.space.S200}`,
  flexShrink: 0,
  overflowX: 'auto',
  scrollbarWidth: 'none',
  '::-webkit-scrollbar': {
    display: 'none',
  },
});

export const GifCategoryTab = style([
  DefaultReset,
  FocusOutline,
  {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S100,
    padding: `${config.space.S100} ${config.space.S200}`,
    borderRadius: config.radii.Pill,
    border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    cursor: 'pointer',
    fontSize: toRem(13),
    whiteSpace: 'nowrap',

    ':hover': {
      backgroundColor: color.Surface.ContainerHover,
    },
  },
]);

export const GifCategoryTabActive = style({
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  borderColor: color.Primary.ContainerLine,
});

/**
 * GIF Favorite button
 */

export const GifFavBtn = style([
  DefaultReset,
  FocusOutline,
  {
    position: 'absolute',
    top: config.space.S100,
    left: config.space.S100,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: toRem(24),
    height: toRem(24),
    padding: 0,
    border: 'none',
    borderRadius: config.radii.Pill,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    color: color.Secondary.OnContainer,
    cursor: 'pointer',
    opacity: 0,
    transition: 'opacity 150ms ease',

    selectors: {
      '&:hover': {
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
      },
    },
  },
]);

export const GifFavBtnVisible = style({
  opacity: 1,
});

export const GifFavBtnActive = style({
  opacity: 1,
  color: color.Primary.OnContainer,
  backgroundColor: 'rgba(0, 0, 0, 0.55)',
});

/**
 * Mashup Picker
 */

export const MashupPicker = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  // Same reason as the GIF picker: let the inner scroll area own the overflow
  // instead of pushing past the board's fixed height.
  minHeight: 0,
});

export const MashupToolbar = style({
  padding: `${config.space.S200} ${config.space.S300} 0`,
});

// The chooser is one row that scrolls sideways rather than a wrapping grid.
// 619 emoji wrapped would bury the results entirely, and the results are the
// point of the tab.
export const MashupChoiceStrip = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  padding: `${config.space.S200} ${config.space.S300}`,
  flexShrink: 0,
  overflowX: 'auto',
  scrollbarWidth: 'none',
  '::-webkit-scrollbar': {
    display: 'none',
  },
});

export const MashupChoiceBtn = style([
  DefaultReset,
  FocusOutline,
  {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: toRem(36),
    height: toRem(36),
    fontSize: toRem(24),
    lineHeight: toRem(24),
    padding: 0,
    border: `${config.borderWidth.B300} solid transparent`,
    borderRadius: config.radii.R300,
    backgroundColor: 'transparent',
    cursor: 'pointer',

    ':hover': {
      backgroundColor: color.Surface.ContainerHover,
    },
  },
]);

export const MashupChoiceBtnActive = style({
  backgroundColor: color.Primary.Container,
  borderColor: color.Primary.ContainerLine,
});

export const MashupScrollWrap = style({
  minHeight: 0,
});

export const MashupItem = style([
  EmojiItem,
  {
    position: 'relative',
  },
]);

export const MashupImg = style([
  DefaultReset,
  {
    width: toRem(32),
    height: toRem(32),
    objectFit: 'contain',
  },
]);

// A mashup is only uploaded when it is picked, so the wait is real the first
// time and invisible after. Dimming the tile in place says which one is
// working without moving anything.
export const MashupItemBusy = style({
  opacity: 0.4,
  cursor: 'progress',
});

export const MashupPinBtn = style([
  DefaultReset,
  FocusOutline,
  {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: toRem(18),
    height: toRem(18),
    padding: 0,
    border: 'none',
    borderRadius: config.radii.Pill,
    backgroundColor: color.Surface.Container,
    color: color.Surface.OnContainer,
    cursor: 'pointer',
    opacity: 0,

    selectors: {
      [`${MashupItem}:hover &, &:focus-visible`]: {
        opacity: 1,
      },
    },
  },
]);

export const MashupPinBtnActive = style({
  opacity: 1,
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
});

export const MashupStatus = style({
  padding: `${config.space.S500} ${config.space.S400}`,
});
