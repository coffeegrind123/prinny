import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const SummaryRow = style({
  position: 'relative',
});

export const AvatarStack = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
});

// Each avatar tucks under the one before it, as in Element's summary, so five
// members take the width of about three. The ring in the surface colour keeps
// the overlapping edges legible on any avatar. The size itself is set inline:
// folds' Avatar sizes itself through a private CSS variable, and a class
// competing with it would win or lose on stylesheet order.
export const StackedAvatar = style({
  boxShadow: `0 0 0 ${toRem(2)} ${color.Surface.Container}`,
  selectors: {
    '& + &': {
      marginLeft: toRem(-6),
    },
  },
});

export const SummaryText = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const ToggleChip = style({
  flexShrink: 0,
});

export const Receipts = style({
  display: 'inline-flex',
  alignItems: 'center',
  marginLeft: config.space.S100,
  cursor: 'pointer',
  userSelect: 'none',
});
