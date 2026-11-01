import { MatrixClient, SyncState } from 'matrix-js-sdk';
import { useCallback, useEffect, useState } from 'react';
import { Box, config, Line, Text } from 'folds';
import { useSyncState } from '../../hooks/useSyncState';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { errorMessage } from '../../utils/errorMessage';

type StateData = {
  current: SyncState | null;
  previous: SyncState | null | undefined;
  since: number;
};

const SYNC_STEP: Partial<Record<SyncState, string>> = {
  [SyncState.Prepared]: 'initial sync done, processing',
  [SyncState.Catchup]: 'catching up on missed events',
  [SyncState.Error]: 'waiting for the server',
};

/**
 * Step, rooms loaded, seconds in this state, last error. Mounted only inside a visible banner,
 * so the 1 s timer runs only while someone can see it.
 */
function SyncDetail({ mx, state, since }: { mx: MatrixClient; state: SyncState; since: number }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts: string[] = [];
  const step = SYNC_STEP[state];
  if (step) {
    parts.push(step);
  }
  parts.push(`${mx.getRooms().length} rooms`);
  parts.push(`${Math.max(0, Math.round((now - since) / 1000))}s`);
  const error = mx.getSyncStateData()?.error as (Error & { httpStatus?: number }) | undefined;
  if (error) {
    parts.push(`last error: ${error.httpStatus ?? ''} ${errorMessage(error, error.name)}`.trim());
  }

  return <Text size="T200">{parts.join(' · ')}</Text>;
}

type SyncStatusProps = {
  mx: MatrixClient;
};
export function SyncStatus({ mx }: SyncStatusProps) {
  const [stateData, setStateData] = useState<StateData>({
    current: null,
    previous: undefined,
    since: Date.now(),
  });

  useSyncState(
    mx,
    useCallback((current, previous) => {
      setStateData((s) => {
        if (s.current === current && s.previous === previous) {
          return s;
        }
        return { current, previous, since: Date.now() };
      });
    }, []),
  );

  if (
    // Syncing means connected. The SDK repeats it only after the next long-poll returns (up to
    // 30 s when idle), so counting the first one as "connecting" kept the banner up that long.
    (stateData.current === SyncState.Prepared || stateData.current === SyncState.Catchup) &&
    stateData.previous !== SyncState.Syncing
  ) {
    return (
      <Box direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Success' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
          direction="Column"
        >
          <Text size="L400">
            {mx.getDomain() ? `Connecting to ${mx.getDomain()}...` : 'Connecting...'}
          </Text>
          <SyncDetail mx={mx} state={stateData.current} since={stateData.since} />
        </Box>
        <Line variant="Success" size="300" />
      </Box>
    );
  }

  if (stateData.current === SyncState.Reconnecting) {
    return (
      <Box direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Warning' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
          direction="Column"
        >
          <Text size="L400">Connection Lost! Reconnecting...</Text>
          <SyncDetail mx={mx} state={stateData.current} since={stateData.since} />
        </Box>
        <Line variant="Warning" size="300" />
      </Box>
    );
  }

  if (stateData.current === SyncState.Error) {
    return (
      <Box direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Critical' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
          direction="Column"
        >
          <Text size="L400">Connection Lost!</Text>
          <SyncDetail mx={mx} state={stateData.current} since={stateData.since} />
        </Box>
        <Line variant="Critical" size="300" />
      </Box>
    );
  }

  return null;
}
