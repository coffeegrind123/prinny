import { ComplexStyleRule, createVar, globalStyle, style } from '@vanilla-extract/css';
import { RecipeVariants, recipe } from '@vanilla-extract/recipes';
import { ContainerColor, DefaultReset, Disabled, RadiiVariant, color, config, toRem } from 'folds';

export const NavCategory = style([
  DefaultReset,
  {
    position: 'relative',
  },
]);

export const NavCategoryHeader = style({
  gap: config.space.S100,

  selectors: {
    // A category label ("Chats", "Rooms") is one word too many for a 64px
    // rail — the rows below it are already the whole answer.
    '[data-nav-collapsed] &': {
      display: 'none',
    },
  },
});

export const NavLink = style({
  color: 'inherit',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  flexGrow: 1,
  ':hover': {
    textDecoration: 'unset',
  },
  ':focus': {
    outline: 'none',
  },
});

const Container = createVar();
const ContainerHover = createVar();
const ContainerActive = createVar();
const ContainerLine = createVar();
const OnContainer = createVar();

const getVariant = (variant: ContainerColor): ComplexStyleRule => ({
  vars: {
    [Container]: color[variant].Container,
    [ContainerHover]: color[variant].ContainerHover,
    [ContainerActive]: color[variant].ContainerActive,
    [ContainerLine]: color[variant].ContainerLine,
    [OnContainer]: color[variant].OnContainer,
  },
});

const NavItemBase = style({
  width: '100%',
  display: 'flex',
  justifyContent: 'start',
  cursor: 'pointer',
  backgroundColor: Container,
  color: OnContainer,
  outline: 'none',
  minHeight: toRem(36),

  selectors: {
    '&:hover, &:focus-visible': {
      backgroundColor: ContainerHover,
    },
    '&[data-hover=true]': {
      backgroundColor: ContainerHover,
    },
    [`&:has(.${NavLink}:active)`]: {
      backgroundColor: ContainerActive,
    },
    '&[aria-selected=true]': {
      backgroundColor: ContainerActive,
    },
    [`&:has(.${NavLink}:focus-visible)`]: {
      outline: `${config.borderWidth.B600} solid ${ContainerLine}`,
      outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
    },
  },
  '@supports': {
    [`not selector(:has(.${NavLink}:focus-visible))`]: {
      ':focus-within': {
        outline: `${config.borderWidth.B600} solid ${ContainerLine}`,
        outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
      },
    },
  },
});
export const NavItem = recipe({
  base: [DefaultReset, NavItemBase, Disabled],
  variants: {
    variant: {
      Background: getVariant('Background'),
      Surface: getVariant('Surface'),
      SurfaceVariant: getVariant('SurfaceVariant'),
      Primary: getVariant('Primary'),
      Secondary: getVariant('Secondary'),
      Success: getVariant('Success'),
      Warning: getVariant('Warning'),
      Critical: getVariant('Critical'),
    },
    radii: RadiiVariant,
  },
  defaultVariants: {
    variant: 'Surface',
    radii: '400',
  },
});

export type RoomSelectorVariants = RecipeVariants<typeof NavItem>;
export const NavItemContent = style({
  paddingLeft: config.space.S200,
  paddingRight: config.space.S300,
  height: 'inherit',
  minWidth: 0,
  flexGrow: 1,
  display: 'flex',
  alignItems: 'center',
  fontWeight: config.fontWeight.W500,

  selectors: {
    '&:hover': {
      textDecoration: 'unset',
    },
    [`.${NavItemBase}[data-highlight=true] &`]: {
      fontWeight: config.fontWeight.W600,
    },
    '[data-nav-collapsed] &': {
      paddingLeft: config.space.S100,
      paddingRight: config.space.S100,
      justifyContent: 'center',
    },
  },
});

/**
 * Collapsed rail: the row keeps its leading avatar or icon and drops everything
 * after it — the label, the trailing badges, the chevron.
 *
 * Rows that need more than a label removed (a room, which also carries
 * presence, a status line and hover options) branch in their own component
 * instead; this covers the plain icon-and-label rows, of which there are
 * several across the three navs and none of which is worth its own branch.
 *
 * `globalStyle` rather than a `selectors` entry because vanilla-extract only
 * allows `&` as the *target* of a selector, and these two need to reach the
 * row's children.
 */
globalStyle(`[data-nav-collapsed] .${NavItemContent} > span > :not(:first-child)`, {
  display: 'none',
});
globalStyle(`[data-nav-collapsed] .${NavItemContent} > span`, {
  flexGrow: 0,
  justifyContent: 'center',
});

export const NavItemOptions = style({
  paddingRight: config.space.S200,
});
