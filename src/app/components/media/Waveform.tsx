import { PointerEventHandler, useCallback, useRef } from 'react';
import classNames from 'classnames';
import * as css from './Waveform.css';

const MIN_BAR_HEIGHT = 10;
const MAX_BAR_HEIGHT = 100;

export type WaveformProps = {
  /** Bar heights, 0..1, oldest-first. */
  waveform: number[];
  /** 0..1 — bars up to here are drawn as played. */
  progress?: number;
  /** Called with 0..1 when the user clicks or drags across the bars. */
  onSeek?: (progress: number) => void;
  className?: string;
};

/**
 * The bar strip used for both live recording and voice-message playback.
 *
 * Bars never render at zero height: a silent moment should read as a quiet
 * clip, not as a gap in the control.
 */
export function Waveform({ waveform, progress, onSeek, className }: WaveformProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seeking = useRef(false);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el || !onSeek) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = (clientX - rect.left) / rect.width;
      onSeek(Math.min(1, Math.max(0, ratio)));
    },
    [onSeek],
  );

  const handlePointerDown: PointerEventHandler<HTMLDivElement> = useCallback(
    (evt) => {
      if (!onSeek) return;
      seeking.current = true;
      // Capture so a drag that leaves the strip keeps seeking, and so the
      // gesture never reaches the mobile swipe handlers underneath.
      evt.currentTarget.setPointerCapture(evt.pointerId);
      seekFromEvent(evt.clientX);
    },
    [onSeek, seekFromEvent],
  );

  const handlePointerMove: PointerEventHandler<HTMLDivElement> = useCallback(
    (evt) => {
      if (!seeking.current) return;
      seekFromEvent(evt.clientX);
    },
    [seekFromEvent],
  );

  const stopSeeking: PointerEventHandler<HTMLDivElement> = useCallback((evt) => {
    seeking.current = false;
    if (evt.currentTarget.hasPointerCapture(evt.pointerId)) {
      evt.currentTarget.releasePointerCapture(evt.pointerId);
    }
  }, []);

  const filledUpTo = progress === undefined ? -1 : Math.round(progress * waveform.length);

  return (
    <div
      ref={ref}
      className={classNames(css.Waveform, onSeek && css.WaveformSeekable, className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopSeeking}
      onPointerCancel={stopSeeking}
    >
      {waveform.map((value, index) => {
        const height =
          MIN_BAR_HEIGHT + Math.min(1, Math.max(0, value)) * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
        return (
          <div
            // Bars are a fixed-length positional strip; there is no identity to
            // key on beyond position.

            key={index}
            className={classNames(css.WaveformBar, index < filledUpTo && css.WaveformBarFilled)}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
