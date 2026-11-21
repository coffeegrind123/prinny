import { globalStyle } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Line } from '../../../../vendor/folds/src/components/line/Line.css';
import { Scroll } from '../../../../vendor/folds/src/components/scroll/Scroll.css';
import * as page from '../../components/page/style.css';
import * as sidebar from '../../components/sidebar/Sidebar.css';
import * as nav from '../../components/nav/styles.css';
import { ResizeHandle } from '../../components/resize-handle/ResizeHandle.css';
import * as editor from '../../components/editor/Editor.css';
import * as layout from '../../components/message/layout/layout.css';
import { MembersDrawer, MembersDrawerHeader } from '../../features/room/MembersDrawer.css';
import { SequenceCard } from '../../components/sequence-card/style.css';
import * as auth from '../../pages/auth/styles.css';
import { LIQUID, MOBILE_MEDIA } from '../scope';
import { design } from './LiquidTokens.css';
import { regularGlass, thickGlass } from './materials';
import { base, sel } from './selector';

/*
 * The shell under Liquid. Same columns in the same places; what changes is
 * how they are drawn:
 *
 *   ┌───────────────────────── backdrop (ambient gradient) ─────────────────────────┐
 *   │ ╭────╮ ╭──────────────╮ ╭─────────────────────────────╮ ╭──────────────╮       │
 *   │ │rail│ │ room list    │ │ header (no rule)            │ │ members      │       │
 *   │ │    │ │ (glass)      │ │ timeline (opaque content)   │ │ (glass)      │       │
 *   │ │    │ │              │ │ ╭─ composer (glass pill) ─╮ │ │              │       │
 *   │ ╰────╯ ╰──────────────╯ ╰─────────────────────────────╯ ╰──────────────╯       │
 *   └────────── gutters are the resize handles, so every divider still drags ───────┘
 */

const gutter = design.Space.Gutter;

globalStyle(LIQUID, {
  background: design.Backdrop.Page,
  backgroundAttachment: 'fixed',
});

/* ── Space rail ───────────────────────────────────────────────────────────── */

globalStyle(`${LIQUID} ${sel(sidebar.Sidebar)}`, {
  ...regularGlass,
  margin: `${gutter} 0 ${gutter} ${gutter}`,
  borderRadius: design.Radius.Panel,
  // Not clipped: the unread badges sit on the items' top-left corners and
  // would be cut off at the rail's edge.
});

// Rail items are squircle-ish tiles; the unread/selected pill on the left edge
// stays as it is, it is how the rail says where you are.
globalStyle(`${LIQUID} ${base(sidebar.SidebarAvatar)}`, {
  borderRadius: toRem(14),
});

/* ── Columns: the root lays out panels with gutters between them ──────────── */

globalStyle(`${LIQUID} ${sel(page.PageRoot)}`, {
  backgroundColor: 'transparent',
  padding: gutter,
});

// The fixed divider of a non-resizable page becomes a gutter.
globalStyle(`${LIQUID} ${sel(page.PageRoot)} > ${base(Line)}`, {
  borderColor: 'transparent',
  width: gutter,
  borderLeftWidth: 0,
});

// Resize handles become the gutter between panels and keep dragging. The
// line they drew shows only as a grab pill under the pointer.
globalStyle(`${LIQUID} ${sel(ResizeHandle)}`, {
  width: gutter,
  backgroundColor: 'transparent',
});

globalStyle(`${LIQUID} ${sel(ResizeHandle)}::before`, {
  content: '""',
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: toRem(4),
  height: toRem(36),
  transform: 'translate(-50%, -50%)',
  borderRadius: config.radii.Pill,
  backgroundColor: 'transparent',
  transition: 'background-color 150ms ease',
});

globalStyle(
  [
    `${LIQUID} ${sel(ResizeHandle)}:hover`,
    `${LIQUID} ${sel(ResizeHandle)}:focus-visible`,
    `${LIQUID} ${sel(ResizeHandle)}[data-dragging]`,
  ].join(', '),
  {
    backgroundColor: 'transparent',
    outline: 'none',
  },
);

globalStyle(
  [
    `${LIQUID} ${sel(ResizeHandle)}:hover::before`,
    `${LIQUID} ${sel(ResizeHandle)}:focus-visible::before`,
    `${LIQUID} ${sel(ResizeHandle)}[data-dragging]::before`,
  ].join(', '),
  {
    backgroundColor: color.Primary.Main,
  },
);

/* ── Room list and drawers: glass panels ──────────────────────────────────── */

const panels = [base(page.PageNav), sel(MembersDrawer)];

globalStyle(panels.map((p) => `${LIQUID} ${p}`).join(', '), {
  ...regularGlass,
  borderRadius: design.Radius.Panel,
  overflow: 'hidden',
});

// A panel's own header sits on the glass: no fill of its own, no rule under it.
globalStyle(
  [`${LIQUID} ${base(page.PageNavHeader)}`, `${LIQUID} ${sel(MembersDrawerHeader)}`].join(', '),
  {
    backgroundColor: 'transparent',
    borderBottomColor: 'transparent',
  },
);

/* ── The page: an opaque content card ─────────────────────────────────────── */

// A page is one card. A room draws its header outside its `Page` (Room.tsx
// stacks RoomViewHeader, banners and the page in one column), so there the
// column is the card and the page inside it stays square.
const card = sel(page.Page);
const headedColumn = `div:has(> ${base(page.PageHeader)}):not(${card})`;
const cards = [`${LIQUID} ${card}`, `${LIQUID} ${headedColumn}`];

globalStyle(cards.join(', '), {
  borderRadius: design.Radius.Panel,
  overflow: 'hidden',
  backgroundColor: color.Surface.Container,
  boxShadow: `0 0 0 0.5px ${color.Surface.ContainerLine}, ${design.Glass.Shadow}`,
});

globalStyle(`${LIQUID} ${headedColumn} ${card}`, {
  borderRadius: 0,
  boxShadow: 'none',
});

// Headers lose the rule under them for an inset hairline, the iOS separator.
globalStyle(`${LIQUID} ${base(page.PageHeader)}`, {
  borderBottomColor: 'transparent',
  boxShadow: `inset 0 -0.5px 0 ${design.Separator.Line}`,
});

/* ── Navigation rows: rounded, with a tinted selection lens ───────────────── */

globalStyle(`${LIQUID} ${base(nav.NavItem)}`, {
  borderRadius: design.Radius.Row,
  transition: 'background-color 150ms ease',
});

// Rows are see-through until hovered or selected: on glass, a resting fill
// reads as a stack of cards rather than a list.
globalStyle(
  `${LIQUID} ${base(nav.NavItem)}:not(:hover):not(:focus-within):not([data-hover=true]):not([aria-selected=true])`,
  {
    backgroundColor: 'transparent',
  },
);

globalStyle(`${LIQUID} ${base(nav.NavItem)}[aria-selected=true]`, {
  backgroundColor: design.Glass.Lens,
  color: design.Glass.OnLens,
});

/* ── Composer: a floating glass capsule ───────────────────────────────────── */

globalStyle(`${LIQUID} ${sel(editor.Editor)}`, {
  ...regularGlass,
  backgroundColor: color.SurfaceVariant.Container,
  borderRadius: toRem(24),
});

globalStyle(`${LIQUID} ${sel(editor.Editor)}:focus-within`, {
  boxShadow: `${design.Glass.Edge}, 0 0 0 ${toRem(3)} ${color.Other.FocusRing}, ${design.Glass.Shadow}`,
});

/* ── Messages ─────────────────────────────────────────────────────────────── */

globalStyle(`${LIQUID} ${base(layout.MessageBase)}`, {
  borderRadius: design.Radius.Row,
});

// Bubble layout: rounder bubbles, the corner arrow gives way to a tighter
// corner, and your own messages are tinted in the accent.
globalStyle(`${LIQUID} ${sel(layout.BubbleContent)}`, {
  // One step darker than the row highlight, so a hovered bubble stays visible.
  backgroundColor: color.SurfaceVariant.ContainerHover,
  borderRadius: design.Radius.Bubble,
  padding: `${toRem(7)} ${toRem(12)}`,
});

globalStyle(`${LIQUID} ${sel(layout.BubbleContentArrowLeft)}`, {
  borderTopLeftRadius: toRem(6),
});

globalStyle(`${LIQUID} ${sel(layout.BubbleLeftArrow)}`, {
  display: 'none',
});

globalStyle(`${LIQUID} [data-own] ${sel(layout.BubbleContent)}`, {
  backgroundColor: color.Primary.Main,
  color: color.Primary.OnMain,
});

globalStyle(`${LIQUID} [data-own] ${sel(layout.BubbleContent)} a`, {
  color: 'inherit',
  textDecoration: 'underline',
});

/* ── Settings and other grouped lists: inset grouped ──────────────────────── */

globalStyle(`${LIQUID} ${base(SequenceCard)}`, {
  borderColor: design.Separator.Line,
});

/* ── Sign-in ──────────────────────────────────────────────────────────────── */

globalStyle(`${LIQUID} ${sel(auth.AuthLayout)}`, {
  backgroundColor: 'transparent',
});

// AuthLayout paints its scroller #1a1a1a inline; the backdrop replaces it.
globalStyle(`${LIQUID} ${base(Scroll)}:has(> ${sel(auth.AuthLayout)})`, {
  backgroundColor: 'transparent !important',
});

globalStyle(`${LIQUID} ${sel(auth.AuthCard)}`, {
  ...thickGlass,
  borderRadius: design.Radius.Sheet,
});

globalStyle(`${LIQUID} ${sel(auth.AuthHeader)}`, {
  borderBottomColor: 'transparent',
});

/* ── Phones: the nav is the whole screen, so panels go edge to edge ───────── */

globalStyle(`${LIQUID} ${sel(page.PageRoot)}`, {
  '@media': {
    [MOBILE_MEDIA]: {
      padding: 0,
    },
  },
});

globalStyle([...cards, ...panels.map((p) => `${LIQUID} ${p}`)].join(', '), {
  '@media': {
    [MOBILE_MEDIA]: {
      borderRadius: 0,
      boxShadow: 'none',
    },
  },
});

// On a phone the room page stays mounted behind the full-screen nav, for the
// swipe-back transition (MobileFriendlyPageNav), so glass there would blur the
// conversation into the list. The rail and panels go opaque instead.
globalStyle(
  [`${LIQUID} ${sel(sidebar.Sidebar)}`, ...panels.map((p) => `${LIQUID} ${p}`)].join(', '),
  {
    '@media': {
      [MOBILE_MEDIA]: {
        backgroundColor: color.Surface.Container,
        backdropFilter: 'none',
      },
    },
  },
);
