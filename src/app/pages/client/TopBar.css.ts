import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

export const Profile = style({
  minWidth: 0,
  maxWidth: toRem(240),
  marginInlineStart: config.space.S100,
  marginInlineEnd: config.space.S200,
});

export const ProfileAvatar = style({
  width: toRem(30),
  height: toRem(30),
});

export const ProfileText = style({
  minWidth: 0,
  flexGrow: 1,
});

export const ProfileButton = style({
  minWidth: 0,
  padding: config.space.S100,
  background: 'none',
  border: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: config.radii.R300,
  selectors: {
    '&:hover, &[aria-expanded=true]': {
      backgroundColor: 'rgba(128, 128, 128, 0.15)',
    },
  },
});
