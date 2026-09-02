import { ComponentProps, ReactNode, useState } from 'react';
import { useHover } from 'react-aria';
import { Time, TimeProps } from './Time';
import { useUserTimezone } from '../../hooks/useUserTimezone';
import { instantInTimezone } from '../../../types/matrix/profile';
import * as css from './SenderTime.css';

type SenderTimeProps = TimeProps & {
  /** Whose clock to show. Their MSC4175 time zone is looked up on hover. */
  senderId: string;
  /**
   * Rendered immediately after the timestamp text — a sending clock, a status
   * dot, anything that reads as belonging TO the time rather than next to it.
   *
   * It belongs in here rather than as a sibling of `SenderTime` because the
   * slot is sized to the sender-local string, which is invisible and — on the
   * days that string carries a date — wider than the timestamp. A sibling
   * therefore sat at the far edge of a gap it could not see the cause of,
   * looking unrelated to the message it was reporting on.
   */
  trailing?: ReactNode;
};

/**
 * A message timestamp that turns into the sender's local time while hovered.
 *
 * Answers the question a timestamp raises in a room spread across time zones —
 * not "when was this sent" but "what time was it *for them*". Reading that a
 * reply came at 03:40 their time is the difference between someone being slow
 * and someone being awake at four in the morning.
 *
 * The same instant on their clock, not the current time there: this is still the
 * message's timestamp, only somewhere else. (What time it is for them *now*
 * already appears in their profile.) Just the time, with no city after it — the
 * zone's name lives in the `title` instead, so the swapped-in string is the same
 * width as the timestamp it replaces.
 *
 * When the zone shift moves the instant onto another day that has to be said,
 * and HOW it is said depends on the room the slot has:
 *
 * - Roomy (a group header line, which wraps): the date is written out in front
 *   of the time, as it is anywhere else a timestamp leaves today.
 * - Tight (`compact` — the avatar-gutter timestamp on a grouped message, and
 *   the fixed 170px header column of Compact layout): a `+1` / `−1` marker
 *   after the time, with the date moved into the `title`. A written-out date
 *   does not fit either of those and does not degrade gracefully: the gutter
 *   box is right-aligned and pinned to the row's left edge, so the overflow
 *   went left, off the row and — on a phone, where the row's left edge is the
 *   screen's — off the screen. The marker is the flight-schedule convention
 *   ("arrives 06:15 +1") and costs about a tenth of a date's width.
 *
 * Falls back to the ordinary timestamp whenever there is nothing better to
 * show: no zone set, a homeserver without extended profiles, or the lookup
 * still in flight. Nothing flickers and nothing is lost — the hover simply does
 * nothing, which is the correct behaviour for a user who has not published a
 * zone.
 */
export function SenderTime({
  senderId,
  trailing,
  ...timeProps
}: SenderTimeProps & ComponentProps<typeof Time>) {
  const [hovered, setHovered] = useState(false);
  // react-aria's useHover deliberately ignores touch, which is right here: this
  // is a pointer affordance, and on a touch screen it would either never fire
  // or fire on a tap meant for the message.
  const { hoverProps } = useHover({ onHoverChange: setHovered });

  const timezone = useUserTimezone(senderId, hovered);
  const local = timezone
    ? instantInTimezone(
        timezone,
        new Date(timeProps.ts),
        timeProps.hour24Clock,
        timeProps.dateFormatString,
      )
    : undefined;

  // `compact` is the timestamp's own "I am in a narrow slot" flag — the gutter
  // time passes it, and so does Compact layout, whose header column is capped
  // at 170px and shares that with the sender's name. Both are places a date
  // cannot go, so both get the marker instead.
  const tight = !!timeProps.compact;
  const senderLocal =
    local && (local.dayShift === 0 || tight ? local.time : `${local.date} ${local.time}`);
  const dayShiftJSX = local && tight && local.dayShift !== 0 && (
    // U+2212 MINUS, not a hyphen: it is the same width as the `+` it alternates
    // with, so the slot does not resize between a message that ran back a day
    // and one that ran forward.
    <span className={css.SenderTimeDayShift}>{local.dayShift > 0 ? '+1' : '\u22121'}</span>
  );
  // Names the zone in full — the visible string is now only a time, so this is
  // the one place that says WHERE that clock is. It also carries the date the
  // marker stands in for, so nothing the compact form drops is unreachable.
  const senderLocalTitle =
    local && timezone
      ? `Local time for ${senderId} (${timezone})${dayShiftJSX ? ` — ${local.date}` : ''}`
      : undefined;
  const showing = hovered && senderLocal !== undefined;

  // Hover belongs on the SLOT, not on the timestamp inside it. The slot is the
  // thing that holds still; tracking the inner element would put the pointer
  // back on a target that changes size under it, which is what made this
  // flicker in the first place.
  return (
    <span className={css.SenderTimeSlot} {...hoverProps}>
      <span className={css.SenderTimeVisible}>
        <Time
          {...timeProps}
          overrideText={showing ? senderLocal : undefined}
          overrideSuffix={showing ? dayShiftJSX : undefined}
          // Only while the swap is actually showing: the title describes the
          // sender's clock, and there is no sender's clock on screen otherwise.
          title={showing ? senderLocalTitle : undefined}
        />
        {trailing}
      </span>
      {senderLocal !== undefined && (
        // The measuring copy carries `trailing` — and the day-shift marker — for
        // the same reason: the swap must not change the slot's width, and it
        // would if either string were measured without something the other one
        // renders.
        <span className={css.SenderTimeSizer} aria-hidden>
          <Time {...timeProps} overrideText={senderLocal} overrideSuffix={dayShiftJSX} />
          {trailing}
        </span>
      )}
    </span>
  );
}
