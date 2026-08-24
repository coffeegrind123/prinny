import { useEffect, useRef, useState } from 'react';
import { Box, Icon, Icons, Spinner, Text, toRem } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { useLowAnimationMode } from '../../hooks/useLowAnimationMode';
import * as css from './SearchProgress.css';

/**
 * Indeterminate progress bar for a running search.
 *
 * Hidden entirely in low animation mode: the bar carries no information beyond
 * "this is still going", and a frozen bar says the opposite of what it is for.
 * The status line below it keeps saying it in words, which is why dropping the
 * bar loses nothing.
 */
export function SearchProgressBar() {
  const lowAnimation = useLowAnimationMode();
  if (lowAnimation) return null;

  return (
    <div className={css.ProgressTrack}>
      <div className={css.ProgressSweep} />
    </div>
  );
}

type SearchSkeletonProps = {
  count: number;
  /** Pulse the cards. Off once the search has settled and these are just filler. */
  animated?: boolean;
  minHeight?: number;
};
/** Placeholder cards standing in for results that have not arrived yet. */
export function SearchSkeleton({ count, animated = true, minHeight = 80 }: SearchSkeletonProps) {
  return (
    <Box direction="Column" gap="100">
      {[...Array(count).keys()].map((key) => (
        <SequenceCard
          variant="SurfaceVariant"
          key={key}
          className={animated ? css.SkeletonPulse : undefined}
          style={{
            minHeight: toRem(minHeight),
            // Staggered so the column reads as a wave rather than one block
            // blinking on and off.
            animationDelay: animated ? `${key * 120}ms` : undefined,
          }}
        />
      ))}
    </Box>
  );
}

type SearchStatusProps = {
  /** Work is in flight: spinner and live wording. Otherwise the settled state. */
  searching: boolean;
  message: string;
  /** Secondary text — counts, elapsed time, how far the scan reached. */
  detail?: string;
};
/**
 * One line saying whether a search is running and, when it is not, that it
 * finished. Deliberately rendered for both states: an indicator that only
 * exists while busy leaves the user unable to tell "done" from "never started".
 */
export function SearchStatus({ searching, message, detail }: SearchStatusProps) {
  return (
    <Box alignItems="Center" gap="200" aria-live="polite">
      <Box shrink="No" alignItems="Center">
        {searching ? (
          <Spinner size="100" variant="Secondary" />
        ) : (
          <Icon size="50" src={Icons.Check} />
        )}
      </Box>
      {/* Two lines, not one joined by a separator: this also renders in the
          members drawer, which is 266px wide, and a single line put the counts
          — the part worth reading — past the truncation. */}
      <Box direction="Column" style={{ minWidth: 0 }}>
        <Text size="T200" priority="400" truncate>
          {message}
        </Text>
        {detail && (
          <Text size="T200" priority="300" truncate>
            {detail}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Milliseconds a search has spent actually working, updated while it runs and
 * settled on the final total when it stops. Time between runs is not counted:
 * a search that finishes in three seconds and is extended a minute later by
 * "search older messages" reports the work, not the wait.
 *
 * `resetKey` restarts the clock — pass whatever identifies the search (term,
 * room, backend), so a new query does not inherit the previous one's time.
 */
export const useSearchTimer = (running: boolean, resetKey: string): number => {
  const [ms, setMs] = useState(0);
  const accumulatedRef = useRef(0);

  useEffect(() => {
    accumulatedRef.current = 0;
    setMs(0);
  }, [resetKey]);

  useEffect(() => {
    if (!running) return undefined;

    const start = Date.now();
    const base = accumulatedRef.current;
    setMs(base);
    const intervalId = window.setInterval(() => setMs(base + (Date.now() - start)), 250);

    return () => {
      window.clearInterval(intervalId);
      // Bank this run on the way out — including the fraction of a tick the
      // 250ms interval had not reported yet, which is what the reported total
      // would otherwise be short by.
      accumulatedRef.current = base + (Date.now() - start);
      setMs(accumulatedRef.current);
    };
  }, [running, resetKey]);

  return ms;
};

/** "0.4s", "12s", "1m 05s" — short enough to sit inside a status line. */
export const formatSearchDuration = (ms: number): string => {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${String(restSeconds).padStart(2, '0')}s`;
};

export const formatCount = (count: number): string => count.toLocaleString();
