import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const UserHeader = style({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 1,
  padding: config.space.S200,
});

export const UserHero = style({
  position: 'relative',
});

export const UserHeroCoverContainer = style({
  position: 'relative',
  aspectRatio: '3 / 1',
  overflow: 'hidden',
});
export const UserHeroCover = style({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  filter: 'blur(16px)',
  transform: 'scale(2)',
  display: 'block',
});
export const UserHeroBanner = style({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
});

/**
 * The avatar is pulled up by half its height so it straddles the banner's
 * bottom edge, which means the strip below the banner only has to reserve the
 * half that hangs into it. Derived from the size rather than written as a
 * literal, because a literal is what let this drift out of step with the copy
 * of this layout that used to live in the settings preview.
 */
const HERO_AVATAR_SIZE = 58; // folds Avatar size="500"

export const UserHeroAvatarContainer = style({
  position: 'relative',
  height: toRem(HERO_AVATAR_SIZE / 2),
});

/**
 * A user's status message, in a thought bubble beside their avatar.
 *
 * Sits in the avatar's strip and is centred on the same line, so it reads as
 * belonging to the avatar rather than to the name block underneath. Anchored on
 * both edges so a long status runs out of room at the card's edge instead of
 * pushing it wider; `fit-content` keeps a short one wrapped tight.
 */
export const UserHeroStatus = style({
  position: 'absolute',
  top: 0,
  transform: 'translateY(-50%)',
  left: `calc(${config.space.S400} + ${toRem(HERO_AVATAR_SIZE)} + ${config.space.S500})`,
  right: config.space.S400,
  maxWidth: 'fit-content',
  padding: `${config.space.S100} ${config.space.S300}`,
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  // The two trailing dots that make it a thought bubble rather than a chip.
  // They step down towards the avatar, so the bubble reads as coming from the
  // person and not from the banner behind it.
  '::before': {
    content: '""',
    position: 'absolute',
    left: toRem(-13),
    bottom: toRem(-3),
    width: toRem(5),
    height: toRem(5),
    borderRadius: '50%',
    backgroundColor: color.SurfaceVariant.Container,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  },
  '::after': {
    content: '""',
    position: 'absolute',
    left: toRem(-8),
    bottom: toRem(3),
    width: toRem(8),
    height: toRem(8),
    borderRadius: '50%',
    backgroundColor: color.SurfaceVariant.Container,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  },
});

/** Shared by the profile card and the settings preview, which are one layout. */
export const Biography = style({
  overflowWrap: 'anywhere',
});
export const UserAvatarContainer = style({
  position: 'absolute',
  left: config.space.S400,
  top: 0,
  transform: 'translateY(-50%)',
  backgroundColor: color.Surface.Container,
});
export const UserHeroAvatar = style({
  outline: `${config.borderWidth.B600} solid ${color.Surface.Container}`,
  selectors: {
    'button&': {
      cursor: 'pointer',
    },
  },
});
export const UserHeroAvatarImg = style({
  selectors: {
    [`button${UserHeroAvatar}:hover &`]: {
      filter: 'brightness(0.5)',
    },
  },
});

export const RichPresenceArtwork = style({
  width: toRem(80),
  height: toRem(80),
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  borderRadius: config.radii.R300,
  color: color.SurfaceVariant.OnContainer,
  backgroundColor: color.SurfaceVariant.ContainerActive,
});

export const RichPresenceImage = style({
  width: '100%',
  height: '100%',
  objectFit: 'cover',
});
