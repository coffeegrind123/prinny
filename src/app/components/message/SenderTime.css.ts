import { style } from '@vanilla-extract/css';
import { config } from 'folds';

/**
 * A timestamp slot wide enough for BOTH the timestamp and the sender's local
 * time, so swapping between them moves nothing.
 *
 * This is the fix for the hover flickering, and the cause is worth stating
 * because it is not obvious from the symptom. Where the two strings are
 * different widths, swapping them resized the element under the pointer; if
 * that resize moved its edge past the pointer, the hover ended, which restored
 * the short string, which put the element back under the pointer, which
 * started the hover again — several times a second, for as long as you held
 * still. Nothing was wrong with the hover tracking; the element was moving out
 * from under it.
 *
 * Since the city was dropped from the sender-local string the two are usually
 * the SAME width, and then this slot reserves nothing extra — which is the
 * point: the invisible copy used to hold a city's width open on every message,
 * visibly shoving the right-aligned gutter timestamp leftwards. It still earns
 * its place on the day-rollover case, where the string picks up a date and the
 * widths diverge again.
 *
 * A grid with both strings in the SAME cell sizes that cell to the wider of the
 * two, and the visible one then changes inside a box that never moves. The
 * alternative — measuring and pinning a width in JavaScript — reintroduces the
 * same race on every font, zoom level and locale.
 */
export const SenderTimeSlot = style({
  display: 'inline-grid',
  // One cell. Both children are placed into it below.
  gridTemplateAreas: '"time"',
  // Baseline, not stretch: this sits in a row aligned to the text baseline, and
  // a stretched grid item would drag the timestamp off the line the name is on.
  alignItems: 'baseline',
  justifyItems: 'start',
  /**
   * One line, always — a date and a time, never the date with the time dropped
   * underneath it.
   *
   * On the day-rollover case the swap still widens the timestamp, and in a
   * header row narrow enough to matter (a phone) the flex layout answered that
   * by wrapping the tail onto its own line, which reads as a second timestamp
   * rather than as part of the first. The header row wraps as a whole instead
   * (`wrap="Wrap"` in Message.tsx), so the full string moves to the next line
   * intact when it does not fit beside the name.
   *
   * `flex-shrink: 0` is the other half: a wrapping flex line still shrinks its
   * items to fit, and a shrunk nowrap box just overflows its neighbours.
   */
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

const cell = {
  gridArea: 'time',
  /**
   * A row, not a bare cell: the timestamp can be followed by a status icon (a
   * sending clock), and that icon has to hug the time text rather than the far
   * edge of a slot that is sized for a string it cannot see.
   */
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: config.space.S100,
} as const;

export const SenderTimeVisible = style(cell);

/**
 * The measuring copy: it holds the layout open and is never seen or read.
 *
 * `visibility: hidden` rather than `display: none`, because a display-none
 * element has no size and so reserves nothing — which is the entire job here.
 * Hidden from the accessibility tree too, since it is the same timestamp twice
 * and a screen reader announcing both would be a bug of its own.
 */
export const SenderTimeSizer = style([
  cell,
  {
    visibility: 'hidden',
    pointerEvents: 'none',
    userSelect: 'none',
  },
]);

/**
 * The `+1` / `−1` after a sender-local time whose day differs from ours.
 *
 * Sized and positioned as a superscript because that is what it is: a mark on
 * the timestamp, not a second value beside it. Small enough that the whole
 * string still fits the narrowest slot it can appear in — the avatar-gutter
 * timestamp, which has 58px (the row's left padding, the 36px avatar column and
 * half the layout gap) and spends 47px of it on a 12-hour `hh:mm A`.
 *
 * Raised with `position: relative` rather than `vertical-align: super`. A
 * superscript-aligned box is still in the line box and raising it grows that
 * box, which would push the group header's baseline down on exactly the
 * messages that carry a marker; a relative offset moves the glyphs and nothing
 * else. `line-height: 0` keeps the smaller font from having any say in the line
 * box either.
 */
export const SenderTimeDayShift = style({
  fontSize: '0.7em',
  lineHeight: 0,
  position: 'relative',
  top: '-0.35em',
  marginInlineStart: '0.15em',
});
