import { globalStyle, style } from '@vanilla-extract/css';
import { recipe, RecipeVariants } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

export const MessageBase = style({
  position: 'relative',
  transition: 'opacity 200ms ease-out',
});

// Applied while the local echo is in flight. Fading back in on delivery is the
// feedback: on a fast connection it is a flicker, and on a slow one it is the
// difference between "sending" and "sent" without reading anything.
export const MessageSending = style({
  opacity: config.opacity.Disabled,
});

/**
 * The amber a row is washed with when it replies to you.
 *
 * Named because two things paint it: the row itself, and the sender-mxid label
 * that sits on top of the row with an opaque ground of its own and has to
 * arrive at the same colour (see `MessageSenderMxId`). It is translucent, so
 * "the same colour" means compositing the same tint over the same surface —
 * not a second, hand-matched constant that drifts the first time the theme
 * moves.
 */
const REPLY_HIGHLIGHT_TINT = 'hsla(39, 100%, 46%, 0.08)';

export const MessageReplyHighlight = style({
  background: REPLY_HIGHLIGHT_TINT,
  borderLeft: '2px solid hsl(39, 100%, 46%)',
});

export const MessageBaseBubbleCollapsed = style({
  paddingTop: 0,
});

/**
 * The hover toolbar's own vertical geometry, as numbers.
 *
 * The sender-mxid label is positioned directly under the bar, so "where does
 * the bar end" has to be a value both can be derived from rather than a number
 * copied into two places. It has already drifted once: the comment on
 * `MessageSenderMxId` said the bar reached +6px while the measurement two
 * paragraphs later said +10px, and the label was placed off the wrong one.
 *
 * Height is a 2rem (32px) IconButton plus the Menu's S100 padding above and
 * below it. Top is a deliberate negative — the bar floats over the end of the
 * PREVIOUS message, Discord-style, so it costs this row almost nothing.
 */
const MESSAGE_OPTIONS_TOP = -30;
const MESSAGE_OPTIONS_HEIGHT = 40;
/** Where the bar's bottom edge lands, measured from this row's top. */
const MESSAGE_OPTIONS_BOTTOM = MESSAGE_OPTIONS_TOP + MESSAGE_OPTIONS_HEIGHT;

export const MessageOptionsBase = style([
  DefaultReset,
  {
    position: 'absolute',
    top: toRem(MESSAGE_OPTIONS_TOP),
    // Floats over the end of the message, Discord-style. The row no longer
    // reserves a strip for it — that cost width on every message, and on phones
    // that never show a toolbar, to solve a problem it turned out not to be
    // solving. Overlapping text is safe now only because a press here starts no
    // selection at all: see `preventSelectionAnchor` in Message.tsx, without
    // which this overlap would bring back the drag-from-the-right bug in a
    // worse form.
    //
    // Deliberately NOT pulled out with a negative `right`: that puts the bar
    // outside the row, and since it only renders while the row is hovered, the
    // pointer had to cross dead margin to reach it and it unmounted on the way.
    right: 0,
    zIndex: 1,
  },
]);
export const MessageOptionsBar = style([
  DefaultReset,
  {
    padding: config.space.S100,
  },
]);

/**
 * How much of a row's right edge the hover toolbar occupies, plus a gap.
 *
 * Defined ONCE and consumed by everything that has to keep out of its way,
 * which is now the group header line alone: it reserves this much on its right
 * so a long display name is truncated before it reaches the bar, or the
 * sender-mxid label sitting under it, rather than running beneath either.
 *
 * The label itself no longer spends it — it stacks UNDER the bar at `right: 0`
 * (see `MessageSenderMxId`) instead of standing beside it.
 *
 * 148px is the bar at its widest: four 2rem IconButtons, three S100 gaps
 * between them, and S100 of Menu padding either side. Fewer buttons render
 * when the event does not permit them, which only leaves consumers further
 * from the bar than they need to be.
 */
export const MESSAGE_OPTIONS_WIDTH = 148;
const messageOptionsClearance = `calc(${toRem(MESSAGE_OPTIONS_WIDTH)} + ${config.space.S100})`;

/**
 * The time of a collapsed message, shown in the avatar slot while the row is
 * hovered.
 *
 * A grouped message hides its own timestamp: the one in the group header
 * belongs to the FIRST message of the group, so every message after it has no
 * time on screen at all. The avatar gutter is already empty on exactly those
 * rows, which makes it the natural place to put it.
 *
 * Absolutely positioned, and right-aligned against the gutter's inner edge so
 * it reads as a column with the header times above it. In flow it would widen
 * the slot — `hh:mm A` is wider than the 36px the avatar reserves — and the
 * message body would jog sideways as the pointer moved down the timeline.
 * Overflow goes left into the row's own padding, which is blank.
 */
export const MessageGutterTime = style({
  position: 'absolute',
  top: 0,
  /**
   * Right-aligned, hanging half the layout gap into the space before the text.
   *
   * Both ModernLayout and BubbleLayout separate the avatar slot from the body
   * with `gap="300"`, so half of it is the one offset that reads as "closer to
   * the message than to the avatar column" without being a number someone
   * picked. Overflow from a wide `hh:mm A` runs left into the row's own
   * padding, which is empty, rather than right into the text.
   */
  right: `calc(-1 * ${config.space.S300} / 2)`,
  /**
   * The left edge is pinned to the row's own left edge, which is what keeps
   * this inside the window.
   *
   * With only `right` set, an absolutely positioned box is shrink-to-fit and
   * grows leftwards without limit — fine on desktop, where the timeline has
   * padding of its own to spill into, and wrong on a phone, where the row's
   * left edge IS the screen's and the overhang was simply off-screen. The app
   * bumps the root font size on mobile, so the same `hh:mm A` is wider there
   * exactly where there is least room for it.
   *
   * Giving it both `left` and `right` makes it a box of a known width — the
   * row's left padding, plus the avatar slot, plus the half-gap hang — and
   * `text-align: right` keeps the timestamp against the message rather than
   * floating in the middle of it. Nothing is clipped: the box is wider than
   * the string at every size the app renders.
   */
  left: `calc(-1 * ${config.space.S400})`,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  /**
   * Sits on the message's own first line rather than at the top of the row.
   *
   * `line-height: inherit` is what does it, inherited from the same place the
   * message body inherits from — nothing between here and the root sets one.
   * That gives this box a strut exactly as tall as the body's first line, and
   * the timestamp, being smaller text, aligns inside it. So the two share a
   * line without either knowing the other's size, where a fixed nudge would be
   * guessing at the difference between two line-heights and would go wrong as
   * soon as either changed — the font-size bump this app applies on mobile
   * changes both.
   */
  lineHeight: 'inherit',
});

/**
 * Two pixels below the smallest type token, and its line box forced back onto
 * the body's.
 *
 * `Time` renders `<Text as="time" size="T200">`, and T200 — 0.75rem — is the
 * bottom of folds' scale, so there is no smaller size to pass; this is a
 * gutter timestamp, not body copy, and it reads better a step under it. The
 * size therefore has to be written here, and it has to be written at the
 * `time` rather than on the wrapper, because the size token folds sets is a
 * class on that element and a font-size on its parent cannot outrank it. A
 * descendant selector can: one class plus one type beats one class.
 *
 * `line-height: inherit` travels with it, and is the part that keeps the
 * timestamp centred. The wrapper already inherits the body's line-height so it
 * gets a strut as tall as the message's first line; giving the `time` the same
 * makes its own line box exactly that tall too, so the smaller glyphs centre
 * inside it instead of hanging off a shared baseline. That holds at any body
 * size — including the font-size bump this app applies on mobile — where a
 * fixed nudge would have to be re-guessed each time.
 *
 * Not passed as a `style` prop on `Time`: that component sets its own inline
 * style, and props spread after it, so an incoming `style` would replace it
 * wholesale and silently drop the `user-select: none` that keeps timestamps
 * out of a dragged selection.
 */
globalStyle(`${MessageGutterTime} time`, {
  fontSize: toRem(10),
  lineHeight: 'inherit',
});

/**
 * Read receipts riding in the message's own inline flow.
 *
 * `inline-flex` rather than `flex`: the whole point is to be an inline-level box
 * so it follows the last character of the last line and wraps with it, while the
 * avatars inside still lay out in a row. `vertical-align: middle` is what centres
 * it on that line's text instead of hanging it off the baseline, where 16px
 * circles sit visibly low.
 *
 * `user-select: none` is not optional here. Beside the block these avatars were
 * outside any selection you could drag across the text; inside it they are not,
 * and without this the `+2` overflow label and the initial inside a fallback
 * avatar would come along in the copied text. Same reasoning as the timestamp
 * and the sender name — chrome is not content.
 */
export const MessageInlineReceipts = style({
  display: 'inline-flex',
  verticalAlign: 'middle',
  marginLeft: config.space.S200,
  cursor: 'pointer',
  userSelect: 'none',
});

/**
 * The sender's mxid, parked at the right-hand end of a group's FIRST message.
 *
 * It appears whenever the pointer is anywhere in the group, not only on the row
 * it is drawn on — see `state/hoveredMessageGroup`. Hovering a collapsed message
 * three lines down still puts the id up here, because here is where the sender
 * is identified; repeating it on each collapsed row labels the same sender over
 * and over.
 *
 * Absolutely positioned for the same reason `MessageGutterTime` is: in flow it
 * would sit after the message body and drag the row's width around as the
 * pointer moved down the timeline.
 *
 * `pointer-events: none` because it is a label, not a target: the toolbar
 * overlaps its box slightly and must stay clickable, and a press here should
 * behave exactly as a press on the blank row does. `user-select: none` for the
 * same reason the timestamp and username have it — chrome is not content, and
 * it must not end up in a dragged selection.
 *
 * It needs an opaque ground because it overlays the end of the message text on
 * a long line, and WHICH ground depends on the row it is drawn on — `ground`
 * names the three a row can actually paint. Getting this wrong is not subtle:
 * the label is a solid rectangle, so any mismatch reads as a grey box floating
 * in the message.
 *
 * - `hover` — the pointer is on THIS row, which `MessageHover` tints
 *   `Surface.ContainerHover`.
 * - `plain` — the pointer is elsewhere in the group (hovering a collapsed
 *   message three rows down still shows the label up here), so the row paints
 *   nothing and the page's own `Surface.Container` is what is behind it.
 * - `reply` — as `plain`, but the row replies to you and so carries
 *   `MessageReplyHighlight`'s amber over that surface. The label composites the
 *   same tint over the same colour rather than naming a third one.
 *
 * `reply` has no hovered counterpart on purpose. `MessageHover` is
 * `.class:hover` and `MessageReplyHighlight` is a bare `.class`, so on a row
 * the pointer is actually on, the hover background out-specifies the tint and
 * the amber is not painted at all — `hover` is the whole truth there. If that
 * ever changes, this needs a fourth ground, not a tweak.
 *
 * A recipe rather than separate classes with one overriding the other: those
 * would all be single-class selectors, so the winner would be decided by the
 * order vanilla-extract happened to emit them in, which is not something to
 * hang a visible background on.
 */
export const MessageSenderMxId = recipe({
  base: {
    position: 'absolute',
    /**
     * Under the hover toolbar, not beside it.
     *
     * The two share this corner and both appear on hover, so they cannot share
     * the space. Stacking them is what makes the label's width its own problem
     * instead of the bar's: it used to be held 152px clear of the right edge so
     * it could sit BESIDE the bar, which spent the whole right end of the
     * header line on a gap and put the label where nothing else was.
     *
     * `MESSAGE_OPTIONS_BOTTOM` rather than a literal, because the number that
     * matters here is where the bar ends, and that is a function of the bar.
     * The one time it was copied by hand it was copied wrong (+6px against a
     * real +10px) and the label sat under an opaque toolbar with the tops of
     * its glyphs clipped.
     */
    top: toRem(MESSAGE_OPTIONS_BOTTOM),
    right: 0,
    maxWidth: '40%',
    /**
     * The band between the bar's bottom edge and the end of the header line —
     * 16px of the row's first line, and all the height this label may take.
     *
     * Fixed rather than inherited: the row's own line-height is the body's, so
     * an inherited line box would start under the bar and finish INSIDE the
     * first line of message text, painting its opaque ground over the tops of
     * those glyphs. Centring the 18px T200 line box in 16px trims leading, not
     * letters — a 12px face leaves ~3px of half-leading either side.
     */
    height: toRem(16),
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    paddingLeft: config.space.S200,
    userSelect: 'none',
    pointerEvents: 'none',
    '@media': {
      /**
       * Phones do not get it at all.
       *
       * Not a size tweak — there is nothing to show. The label is hover chrome,
       * and a touch screen has no hover, so on a phone this can only ever
       * appear as a stray box after a long-press. Cut in CSS rather than by
       * reading the screen size in `Message`, which renders once per event and
       * should not take a context subscription to answer a question a media
       * query already answers for free.
       *
       * 750px is `MOBILE_BREAKPOINT` from `hooks/useScreenSize` — kept as a
       * literal because that module pulls in React, and a `.css.ts` is
       * evaluated at build time.
       */
      'screen and (max-width: 750px)': {
        display: 'none',
      },
    },
  },
  variants: {
    ground: {
      hover: {
        backgroundColor: color.Surface.ContainerHover,
      },
      // The page itself is `ContainerColor({ variant: 'Surface' })` (see
      // `components/page/Page.tsx`) and a message row paints no background of
      // its own, so this is what is actually behind the label when the row is
      // not hovered.
      plain: {
        backgroundColor: color.Surface.Container,
      },
      reply: {
        backgroundColor: color.Surface.Container,
        // The tint as a background *image* over that colour, which is exactly
        // how the row arrives at its own amber: a translucent layer on the
        // surface behind it. Painting a pre-mixed opaque colour instead would
        // mean re-deriving it by hand for every theme.
        backgroundImage: `linear-gradient(${REPLY_HIGHLIGHT_TINT}, ${REPLY_HIGHLIGHT_TINT})`,
      },
    },
  },
  defaultVariants: {
    ground: 'hover',
  },
});

export type MessageSenderMxIdVariants = RecipeVariants<typeof MessageSenderMxId>;

export const BubbleAvatarBase = style({
  paddingTop: 0,
});

export const MessageAvatar = style({
  cursor: 'pointer',
});

export const MessageQuickReaction = style({
  minWidth: toRem(32),
});

export const MessageMenuGroup = style({
  padding: config.space.S100,
});

export const MessageMenuItemText = style({
  flexGrow: 1,
});

export const ReactionsContainer = style({
  selectors: {
    '&:empty': {
      display: 'none',
    },
  },
});

export const ReactionsTooltipText = style({
  wordBreak: 'break-word',
});

// Dims the message while its local echo is still in flight, so a slow or
// stalled send is visible as it happens rather than only once it fails.
export const MessageStatusSending = style({
  opacity: 0.5,
  /**
   * The header row is `alignItems: baseline`, which an icon cannot honour: an
   * SVG has no text baseline, so CSS falls back to its bottom margin edge and
   * sits the whole glyph ON the baseline. Next to a timestamp — whose
   * descenders drop below that line — the clock ends up visibly high.
   *
   * Centring opts this one item out of baseline alignment, which is what an
   * icon among text wants anyway. Done here rather than as a nudge on `top`,
   * because the offset that would look right is a function of the icon size and
   * the font's descender depth, and neither is fixed.
   */
  alignSelf: 'center',
});

export const MessageFailedBar = style([
  DefaultReset,
  {
    padding: `${config.space.S100} ${config.space.S200}`,
    cursor: 'default',
  },
]);

/**
 * Keeps the group header's own content clear of the hover toolbar.
 *
 * The sender mxid used to be a flex child of this row, so flexbox held the
 * display name and the label apart and the name truncated against it. The
 * label is now positioned against the message row instead — one mechanism for
 * both the first message and the ones after it — which takes it out of this
 * row's flow, so the name needs the reservation made explicitly or a long one
 * runs underneath an opaque label.
 *
 * Applied unconditionally rather than on hover: making it conditional would
 * re-truncate the display name at the moment the pointer arrives, which is a
 * visible jump on exactly the row being pointed at. This costs width only on
 * the name-and-time line of a group's first message — the message body still
 * uses the full row, which is the thing the removed 154px strip was taking and
 * the reason it was removed.
 */
export const MessageHeaderOptionsSpace = style({
  paddingRight: messageOptionsClearance,
});
