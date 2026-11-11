import {
  createVar,
  globalStyle,
  keyframes,
  style,
  styleVariants,
  type GlobalStyleRule,
} from '@vanilla-extract/css';
import { recipe, RecipeVariants } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

export const StickySection = style({
  position: 'sticky',
  top: config.space.S100,
});

const SpacingVar = createVar();
const SpacingVariant = styleVariants({
  '0': {
    vars: {
      [SpacingVar]: config.space.S0,
    },
  },
  '100': {
    vars: {
      [SpacingVar]: config.space.S100,
    },
  },
  '200': {
    vars: {
      [SpacingVar]: config.space.S200,
    },
  },
  '300': {
    vars: {
      [SpacingVar]: config.space.S300,
    },
  },
  '400': {
    vars: {
      [SpacingVar]: config.space.S400,
    },
  },
  '500': {
    vars: {
      [SpacingVar]: config.space.S500,
    },
  },
});

const highlightAnime = keyframes({
  '0%': {
    backgroundColor: color.Primary.Container,
  },
  '25%': {
    backgroundColor: color.Primary.ContainerActive,
  },
  '50%': {
    backgroundColor: color.Primary.Container,
  },
  '75%': {
    backgroundColor: color.Primary.ContainerActive,
  },
  '100%': {
    backgroundColor: color.Primary.Container,
  },
});
const HighlightVariant = styleVariants({
  true: {
    animation: `${highlightAnime} 2000ms ease-in-out`,
    animationIterationCount: 'infinite',
  },
});

// "Selected" fires when a popover/context-menu is open against the
// message (right-click menu, emoji-board anchor, reaction picker). It
// previously used `Surface.ContainerActive` which is the same intensity
// the theme reserves for held/pressed states — too loud for a passive
// "I'm pointing at this message" tint. `ContainerHover` is the lighter
// sibling and matches the user's request for a more subtle effect.
const SelectedVariant = styleVariants({
  true: {
    backgroundColor: color.Surface.ContainerHover,
  },
});

// Plain hover wasn't styled at all upstream — only the options bar
// appearing above the message signaled hover. Add a faint tint so the
// pointer target is obvious without competing with reply highlights or
// jump-highlight animations. Uses the SAME tone as the (now-lighter)
// selected state, so hover→right-click transitions feel continuous.
const MessageHover = style({
  selectors: {
    '&:hover': {
      backgroundColor: color.Surface.ContainerHover,
    },
  },
});

const AutoCollapse = style({
  selectors: {
    [`&+&`]: {
      marginTop: 0,
    },
  },
});

/**
 * No width is reserved at the right of a message for the hover toolbar.
 *
 * There used to be 154px of it, added to stop the toolbar covering text. Two
 * rounds of that — first as margin, then as padding — cost real width on every
 * message and never fixed what they were aimed at: the toolbar was not covering
 * text, it was RECEIVING THE PRESS, and a press on a `<button>` cannot anchor a
 * selection, so a drag begun there started from the beginning of the message.
 * That is fixed at the source now (`preventSelectionAnchor` in Message.tsx),
 * which leaves the strip doing nothing but taking space.
 *
 * It was also charged to phones, which never show the toolbar at all: the query
 * was `any-hover`, and Android WebViews commonly report hover, so the allowance
 * for a pointer nobody had was eating the narrowest screens.
 *
 * The toolbar now floats over the end of the message, as it does in Discord.
 * A press on it starts no selection rather than the wrong one.
 */

export const MessageBase = recipe({
  base: [
    DefaultReset,
    MessageHover,
    {
      marginTop: SpacingVar,
      padding: `${config.space.S100} ${config.space.S200} ${config.space.S100} ${config.space.S400}`,
      borderRadius: `0 ${config.radii.R400} ${config.radii.R400} 0`,
    },
  ],
  variants: {
    space: SpacingVariant,
    collapse: {
      true: {
        marginTop: 0,
      },
    },
    autoCollapse: {
      true: AutoCollapse,
    },
    highlight: HighlightVariant,
    selected: SelectedVariant,
  },
  defaultVariants: {
    space: '400',
  },
});

export type MessageBaseVariants = RecipeVariants<typeof MessageBase>;

export const CompactHeader = style([
  DefaultReset,
  StickySection,
  {
    maxWidth: toRem(170),
    width: '100%',
  },
]);

export const AvatarBase = style({
  paddingTop: toRem(4),
  transition: 'transform 200ms cubic-bezier(0, 0.8, 0.67, 0.97)',
  display: 'flex',
  alignSelf: 'start',

  selectors: {
    '&:hover': {
      transform: `translateY(${toRem(-2)})`,
    },
  },
});

// `position: relative` is what lets the hover timestamp on a collapsed message
// (MessageGutterTime) sit in this slot without being able to widen it. The slot
// is a min-width, not a width, so an in-flow child would push the whole message
// body right — and only on the rows that happen to be hovered.
export const ModernBefore = style({
  minWidth: toRem(36),
  position: 'relative',
});

export const BubbleBefore = style({
  minWidth: toRem(36),
  position: 'relative',
});

export const BubbleContent = style({
  maxWidth: toRem(800),
  padding: config.space.S200,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  borderRadius: config.radii.R500,
  position: 'relative',
});

export const BubbleContentArrowLeft = style({
  borderTopLeftRadius: 0,
});

export const BubbleLeftArrow = style({
  width: toRem(9),
  height: toRem(8),

  position: 'absolute',
  top: 0,
  left: toRem(-8),
  zIndex: 1,
});

/**
 * The sender's name, shown in full — never ellipsised.
 *
 * It used to be `overflow: hidden; white-space: nowrap; text-overflow:
 * ellipsis`, which cut names off the moment the header row ran short of width:
 * on a phone, and on a narrow desktop window. That is the wrong trade for the
 * one piece of text in the row that says WHO is talking — there is a whole
 * line below it doing nothing, and "Alexand…" identifies nobody.
 *
 * Wrapping instead of truncating is only safe because the header row wraps too
 * (`wrap="Wrap"` on the header Box in Message.tsx): without that the name would
 * push the timestamp out of the row rather than move it to the next line.
 * `overflow-wrap: anywhere` is the backstop for a single unbroken name longer
 * than the row — it breaks mid-word rather than overflowing the message.
 */
export const Username = style({
  userSelect: 'none',
  overflowWrap: 'anywhere',
  selectors: {
    'button&': {
      cursor: 'pointer',
    },
    'button&:hover, button&:focus-visible': {
      textDecoration: 'underline',
    },
  },
});

export const UsernameBold = style({
  fontWeight: 550,
});

/**
 * A username button inside a sentence ("alice invited bob"). `Username` is sized for a message
 * header; here the name is part of running text, so it takes the text's font and colour and
 * wraps with it however long it is, instead of running out of the row.
 */
export const UsernameInline = style({
  overflow: 'visible',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  maxWidth: '100%',
  verticalAlign: 'baseline',
  textAlign: 'start',
  font: 'inherit',
  color: 'inherit',
  margin: 0,
  padding: 0,
  background: 'none',
  border: 0,
});

/**
 * Stops a link inside a message from being a drag source.
 *
 * An anchor is natively draggable, and that beats text selection: a
 * pointer-down that lands on a link starts a *link drag* rather than a
 * selection, so dragging leftwards out of a link selected nothing and the
 * browser anchored the selection at the previous caret position instead —
 * which is why copying a message that ends in a link appeared to "start from
 * the left".
 *
 * Same class of bug as the timestamp and mxid one — both carry their own
 * `user-select: none` — but caused by the drag source rather than by a mutating
 * DOM, so it needs its own fix. This covers every engine the app ships on (WebView2, WebKitGTK,
 * Android WebView, Chrome, Safari); the `draggable="false"` attribute set by
 * the linkifier and the HTML sanitizer covers Gecko, which implements neither.
 *
 * Losing the link-drag gesture is not a real cost: the link stays clickable,
 * copyable from the context menu, and selectable as text — which is what
 * someone dragging across a message wanted in the first place.
 *
 * Written through `globalStyle` with a cast because `-webkit-user-drag` is not
 * a standard property and so has no entry in csstype, which is where
 * vanilla-extract's property types come from.
 */
const LinkNoDrag = style({});
globalStyle(`${LinkNoDrag} a`, {
  WebkitUserDrag: 'none',
} as GlobalStyleRule);

export const MessageTextBody = recipe({
  base: [
    LinkNoDrag,
    {
      wordBreak: 'break-word',
    },
  ],
  variants: {
    preWrap: {
      true: {
        whiteSpace: 'pre-wrap',
      },
    },
    jumboEmoji: {
      true: {
        fontSize: '1.504em',
        lineHeight: '1.4962em',
      },
    },
    emote: {
      true: {
        color: color.Success.Main,
        fontStyle: 'italic',
      },
    },
  },
});

export type MessageTextBodyVariants = RecipeVariants<typeof MessageTextBody>;
