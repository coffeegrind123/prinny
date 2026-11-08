import { style } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';

export const Editor = style([
  DefaultReset,
  {
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
    borderRadius: config.radii.R400,
    overflow: 'hidden',
  },
]);

export const EditorOptions = style([
  DefaultReset,
  {
    padding: config.space.S200,
  },
]);

/*
 * The composer row is [before buttons][text][after buttons], and the button
 * groups never shrink. With a plain `width: 100%` the text area absorbed the
 * whole squeeze: on a 360px phone (rem is 115% there) five after-buttons left
 * it ~20px, so a link wrapped two characters per line.
 *
 * Now the text area has a floor and the row wraps: when the buttons cannot fit
 * beside a usable text area, the after group drops to its own line (pushed
 * right by `EditorOptionsAfter`). Wide screens keep the single row.
 */
export const EditorRow = style({
  flexWrap: 'wrap',
});

export const EditorTextareaScroll = style({
  flex: '1 1 0',
  minWidth: toRem(160),
});

export const EditorOptionsAfter = style({
  marginLeft: 'auto',
});

export const EditorTextarea = style([
  DefaultReset,
  {
    flexGrow: 1,
    height: '100%',
    padding: `${toRem(13)} ${toRem(1)}`,
    selectors: {
      [`${EditorTextareaScroll}:first-child &`]: {
        paddingLeft: toRem(13),
      },
      [`${EditorTextareaScroll}:last-child &`]: {
        paddingRight: toRem(13),
      },
      '&:focus': {
        outline: 'none',
      },
    },
  },
]);

export const EditorPlaceholderContainer = style([
  DefaultReset,
  {
    opacity: config.opacity.Placeholder,
    pointerEvents: 'none',
    userSelect: 'none',
  },
]);

export const EditorPlaceholderTextVisual = style([
  DefaultReset,
  {
    display: 'block',
    paddingTop: toRem(13),
    paddingLeft: toRem(1),
  },
]);

export const EditorToolbarBase = style({
  padding: `0 ${config.borderWidth.B300}`,
});

export const EditorToolbar = style({
  padding: config.space.S100,
});

export const MarkdownBtnBox = style({
  paddingRight: config.space.S100,
});
