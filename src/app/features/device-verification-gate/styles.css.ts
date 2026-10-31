import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Below this width the explanation stacks under the step instead of sitting beside it.
const WIDE = 'screen and (min-width: 960px)';

// Covers the app until this device is verified or the user continues without. Below
// config.zIndex.Max, which folds overlays use, so the verification dialog opens on top.
export const Gate = style({
  position: 'fixed',
  inset: 0,
  zIndex: config.zIndex.Z400,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
});

export const GateLayout = style({
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  '@media': {
    [WIDE]: {
      flexDirection: 'row',
    },
  },
});

export const GateMain = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  padding: `${config.space.S500} ${config.space.S400}`,
  '@media': {
    [WIDE]: {
      flexGrow: 0,
      flexShrink: 0,
      width: toRem(560),
      padding: `${config.space.S600} ${config.space.S700}`,
    },
  },
});

export const GateContent = style({
  width: '100%',
  maxWidth: toRem(400),
  margin: '0 auto',
  paddingTop: config.space.S600,
  paddingBottom: config.space.S600,
  gap: config.space.S600,
  '@media': {
    [WIDE]: {
      marginTop: 'auto',
      marginBottom: 'auto',
    },
  },
});

export const GateAside = style({
  display: 'flex',
  flexGrow: 1,
  alignItems: 'center',
  padding: `${config.space.S600} ${config.space.S400}`,
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
  borderTop: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
  '@media': {
    [WIDE]: {
      borderTop: 'none',
      borderLeft: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
      padding: config.space.S700,
    },
  },
});

export const GateAsideContent = style({
  maxWidth: toRem(440),
  margin: '0 auto',
  gap: config.space.S300,
});
