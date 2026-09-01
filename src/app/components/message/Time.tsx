import { ComponentProps, ReactNode } from 'react';
import { Text, as } from 'folds';
import { timeDayMonYear, timeHourMinute, today, yesterday } from '../../utils/time';

export type TimeProps = {
  compact?: boolean;
  ts: number;
  hour24Clock: boolean;
  dateFormatString: string;
  /**
   * Shown instead of the computed timestamp while set.
   *
   * Exists so `SenderTime` can swap in the sender's local time on hover without
   * a second component that styles a timestamp its own way — the wrapper stays
   * the single place a `<time>` is dressed, and only the text differs.
   */
  overrideText?: string;
  /**
   * Rendered inside the `<time>` immediately after the text, with no gap — a
   * mark ON the timestamp rather than a thing beside it.
   *
   * Exists for `SenderTime`'s day-shift marker, which qualifies the time it
   * follows ("03:40, but that is tomorrow for them") and so has to travel with
   * it: same element, same `user-select: none`, same slot measurement. A
   * sibling of `Time` would be none of those.
   */
  overrideSuffix?: ReactNode;
};

/**
 * Renders a formatted timestamp, supporting compact and full display modes.
 *
 * Displays the time in hour:minute format if the message is from today, yesterday, or if `compact` is true.
 * For older messages, it shows the date and time.
 *
 * @param {number} ts - The timestamp to display.
 * @param {boolean} [compact=false] - If true, always show only the time.
 * @param {boolean} hour24Clock - Whether to use 24-hour time format.
 * @param {string} dateFormatString - Format string for the date part.
 * @returns {React.ReactElement} A <Text as="time"> element with the formatted date/time.
 */
export const Time = as<'span', TimeProps & ComponentProps<typeof Text>>(
  ({ compact, hour24Clock, dateFormatString, ts, overrideText, overrideSuffix, ...props }, ref) => {
    const formattedTime = timeHourMinute(ts, hour24Clock);

    let time = '';
    if (overrideText) {
      time = overrideText;
    } else if (compact) {
      time = formattedTime;
    } else if (today(ts)) {
      time = formattedTime;
    } else if (yesterday(ts)) {
      time = `Yesterday ${formattedTime}`;
    } else {
      time = `${timeDayMonYear(ts, dateFormatString)} ${formattedTime}`;
    }

    return (
      // userSelect: none — a timestamp is chrome, and including it in a
      // selection is never what someone dragging across a message wanted.
      <Text
        as="time"
        style={{ flexShrink: 0, userSelect: 'none' }}
        size="T200"
        priority="300"
        {...props}
        ref={ref}
      >
        {time}
        {overrideSuffix}
      </Text>
    );
  }
);
