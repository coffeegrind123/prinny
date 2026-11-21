import { globalStyle, keyframes } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
// folds does not export its stylesheets, and its class names are only stable
// through the readable-CSS build, so the overrides import the modules directly
// and key off the very classes folds puts on its elements.
import { Badge } from '../../../../vendor/folds/src/components/badge/Badge.css';
import { Button } from '../../../../vendor/folds/src/components/button/Button.css';
import {
  Checkbox,
  CheckboxInput,
} from '../../../../vendor/folds/src/components/checkbox/Checkbox.css';
import { Chip } from '../../../../vendor/folds/src/components/chip/Chip.css';
import { Dialog } from '../../../../vendor/folds/src/components/dialog/Dialog.css';
import { IconButton } from '../../../../vendor/folds/src/components/icon-button/IconButton.css';
import { Input } from '../../../../vendor/folds/src/components/input/Input.css';
import { Menu } from '../../../../vendor/folds/src/components/menu/Menu.css';
import { MenuItem } from '../../../../vendor/folds/src/components/menu/MenuItem.css';
import { Modal } from '../../../../vendor/folds/src/components/modal/Modal.css';
import { OverlayBackdrop } from '../../../../vendor/folds/src/components/overlay/Overlay.css';
import { RadioButton } from '../../../../vendor/folds/src/components/radio-button/RadioButton.css';
import { Scroll } from '../../../../vendor/folds/src/components/scroll/Scroll.css';
import { Switch, SwitchThumb } from '../../../../vendor/folds/src/components/switch/Switch.css';
import { TextArea } from '../../../../vendor/folds/src/components/text-area/TextArea.css';
import { Tooltip } from '../../../../vendor/folds/src/components/tooltip/Tooltip.css';
import { RadiiVariant } from '../../../../vendor/folds/src/components/variant.css';
import { LIQUID } from '../scope';
import { design } from './LiquidTokens.css';
import { thickGlass } from './materials';
import { base, sel } from './selector';

/** Every rounded radii variant; `0` and `Inherit` are left as the caller asked. */
const ROUNDED = [RadiiVariant['300'], RadiiVariant['400'], RadiiVariant['500']];
const rounded = (cls: string): string => ROUNDED.map((r) => `${LIQUID} ${cls}${sel(r)}`).join(', ');

/* ── Press feedback ─────────────────────────────────────────────────────────
   Controls shrink a little under the pointer and spring back, the web
   stand-in for glass's press stretch. Transform only, so it composites. */

const pressable = [base(Button), base(IconButton), base(Chip)];

globalStyle(pressable.map((c) => `${LIQUID} ${c}`).join(', '), {
  transition: [
    `transform ${design.Motion.InteractiveDuration} ${design.Motion.Interactive}`,
    `background-color 150ms ease`,
    `box-shadow 150ms ease`,
  ].join(', '),
});

globalStyle(
  pressable
    .map((c) => `${LIQUID} ${c}:active:not([disabled]):not([aria-disabled=true])`)
    .join(', '),
  {
    transform: 'scale(0.96)',
  },
);

/* ── Buttons and chips: capsules ──────────────────────────────────────────── */

globalStyle(`${rounded(base(Button))}, ${rounded(base(Chip))}, ${rounded(base(IconButton))}`, {
  borderRadius: config.radii.Pill,
});

globalStyle(`${LIQUID} ${base(Button)}`, {
  fontWeight: config.fontWeight.W600,
});

// Outlines read as Prinny; Liquid draws controls as fills.
globalStyle(`${LIQUID} ${base(Button)}, ${LIQUID} ${base(Chip)}, ${LIQUID} ${base(IconButton)}`, {
  borderWidth: 0,
});

/* ── Text fields ──────────────────────────────────────────────────────────── */

globalStyle(`${rounded(base(Input))}, ${rounded(base(TextArea))}`, {
  borderRadius: design.Radius.Field,
});

globalStyle(`${LIQUID} ${base(Input)}, ${LIQUID} ${base(TextArea)}`, {
  boxShadow: 'none',
  transition: 'box-shadow 150ms ease',
});

// Chrome-coloured fields sit on glass, where the translucent chrome colour
// all but disappears; they take the iOS fill instead.
globalStyle(
  [
    `${LIQUID} ${sel(Input.classNames.variants.variant.Background)}`,
    `${LIQUID} ${sel(TextArea.classNames.variants.variant.Background)}`,
  ].join(', '),
  {
    backgroundColor: color.Background.ContainerHover,
  },
);

globalStyle(
  [
    `${LIQUID} ${base(Input)}:has(input:focus)`,
    `${LIQUID} ${base(Input)}:focus-within`,
    `${LIQUID} ${base(TextArea)}:focus`,
  ].join(', '),
  {
    boxShadow: `0 0 0 ${toRem(3)} ${color.Other.FocusRing}`,
  },
);

/* ── Switch: the iOS track and knob ───────────────────────────────────────── */

globalStyle(`${LIQUID} ${base(Switch)}`, {
  width: toRem(51),
  height: toRem(31),
  padding: toRem(2),
  boxShadow: 'none',
  backgroundColor: color.SurfaceVariant.ContainerActive,
  opacity: 1,
  transition: `background-color ${design.Motion.SmoothDuration} ${design.Motion.Smooth}`,
});

globalStyle(`${LIQUID} ${base(Switch)}[aria-checked=false]`, {
  opacity: 1,
});

globalStyle(`${LIQUID} ${base(Switch)}[aria-checked=true]`, {
  backgroundColor: design.Control.SwitchOn,
});

globalStyle(`${LIQUID} ${base(Switch)} ${sel(SwitchThumb)}`, {
  width: toRem(27),
  height: toRem(27),
  transform: 'translateX(0)',
  backgroundColor: '#FFFFFF',
  // folds draws a check icon in the knob, hidden in Prinny by matching the
  // knob's colour. The iOS knob is plain, so it is hidden outright.
  color: 'transparent',
  boxShadow: '0 3px 8px rgba(0, 0, 0, 0.15), 0 1px 1px rgba(0, 0, 0, 0.16)',
  transition: [
    `transform ${design.Motion.SnappyDuration} ${design.Motion.Snappy}`,
    `width ${design.Motion.InteractiveDuration} ${design.Motion.Interactive}`,
  ].join(', '),
});

globalStyle(`${LIQUID} ${base(Switch)}[aria-checked=true] ${sel(SwitchThumb)}`, {
  width: toRem(27),
  height: toRem(27),
  transform: `translateX(${toRem(20)})`,
  backgroundColor: '#FFFFFF',
  color: 'transparent',
});

// The knob stretches while pressed, as UISwitch's does (CT §2.1: 37 → 58 pt
// wide on a 63 pt track; scaled to this 51 px track).
globalStyle(`${LIQUID} ${base(Switch)}:active:not([disabled]) ${sel(SwitchThumb)}`, {
  width: toRem(33),
});

globalStyle(
  `${LIQUID} ${base(Switch)}[aria-checked=true]:active:not([disabled]) ${sel(SwitchThumb)}`,
  {
    transform: `translateX(${toRem(14)})`,
  },
);

/* ── Checkbox and radio: round, filled when on ────────────────────────────── */

globalStyle(`${LIQUID} ${sel(CheckboxInput)}`, {
  borderRadius: config.radii.Pill,
});

globalStyle(`${LIQUID} ${base(Checkbox)}, ${LIQUID} ${base(RadioButton)}`, {
  borderRadius: config.radii.Pill,
});

/* ── Badges ───────────────────────────────────────────────────────────────── */

globalStyle(rounded(base(Badge)), {
  borderRadius: config.radii.Pill,
});

/* ── Menus, tooltips, dialogs: thick glass ────────────────────────────────── */

const MenuIn = keyframes({
  from: { opacity: 0, transform: 'scale(0.92)' },
  to: { opacity: 1, transform: 'scale(1)' },
});

globalStyle(`${LIQUID} ${base(Menu)}`, {
  ...thickGlass,
  color: color.Surface.OnContainer,
  borderRadius: design.Radius.Menu,
  transformOrigin: 'top center',
  animation: `${MenuIn} ${design.Motion.MenuDuration} ${design.Motion.Menu}`,
});

globalStyle(`${LIQUID} ${base(MenuItem)}`, {
  borderRadius: design.Radius.Row,
});

// Rows rest see-through on glass. A row marked current (`aria-pressed`, e.g.
// the quick switcher's keyboard selection) keeps its fill, or the selection
// becomes invisible.
globalStyle(
  `${LIQUID} ${base(MenuItem)}:not(:hover):not(:focus-visible):not(:active):not([aria-pressed=true])`,
  {
    backgroundColor: 'transparent',
  },
);

globalStyle(`${LIQUID} ${base(MenuItem)}:hover, ${LIQUID} ${base(MenuItem)}:focus-visible`, {
  backgroundColor: color.Background.ContainerHover,
});

globalStyle(`${LIQUID} ${base(Tooltip)}`, {
  ...thickGlass,
  color: color.Surface.OnContainer,
  borderRadius: config.radii.Pill,
  padding: `${toRem(6)} ${config.space.S300}`,
});

globalStyle(`${LIQUID} ${base(Dialog)}`, {
  ...thickGlass,
  borderRadius: design.Radius.Sheet,
});

/* ── Modals: sheets ───────────────────────────────────────────────────────── */

const SheetIn = keyframes({
  from: { opacity: 0, transform: 'translateY(24px) scale(0.98)' },
  to: { opacity: 1, transform: 'none' },
});

globalStyle(`${LIQUID} ${base(Modal)}`, {
  // Settings and other two-column modals are drawn in the translucent chrome
  // colour; the blur keeps the page behind from showing through as text.
  backdropFilter: design.Glass.ThickFilter,
  borderRadius: design.Radius.Sheet,
  boxShadow: `${design.Glass.Edge}, ${config.shadow.E400}`,
  border: 'none',
  animation: `${SheetIn} ${design.Motion.SheetDuration} ${design.Motion.Sheet}`,
});

const BackdropIn = keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

globalStyle(`${LIQUID} ${sel(OverlayBackdrop)}`, {
  backdropFilter: 'blur(6px)',
  animation: `${BackdropIn} 200ms ease-out`,
});

/* ── Scrollbars: thin, rounded, overlay-coloured ──────────────────────────── */

globalStyle(`${LIQUID} ${base(Scroll)}::-webkit-scrollbar-thumb`, {
  borderRadius: config.radii.Pill,
  backgroundClip: 'padding-box',
});
