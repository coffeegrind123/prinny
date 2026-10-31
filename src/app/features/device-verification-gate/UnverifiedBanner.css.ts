import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const UnverifiedBanner = style({
  flexShrink: 0,
  alignItems: 'center',
  gap: config.space.S300,
  padding: `${config.space.S200} ${config.space.S400}`,
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  borderBottom: `${config.borderWidth.B300} solid ${color.Warning.ContainerLine}`,
});
