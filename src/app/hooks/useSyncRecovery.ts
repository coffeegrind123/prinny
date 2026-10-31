import { useEffect } from 'react';
import { ClientEvent, MatrixClient, SyncState } from 'matrix-js-sdk';
import { abortSyncRequest } from '../../client/syncRecovery';
import { isTauri } from '../utils/desktop-notifications';

// The SDK long-polls /sync for 30 s, so a healthy client sees a Sync event at least that often.
const SYNC_STALL_MS = 45_000;
const STALL_CHECK_INTERVAL_MS = 15_000;
const STALLED = 'stalled';

/**
 * Get sync going again right after the laptop wakes or the Android app comes back, instead of
 * 1-2 minutes later when the dead long-poll times out. Also checks every 15 s while the app
 * runs, for a connection that died without a sleep (a Wi-Fi switch).
 */
export const useSyncRecovery = (mx: MatrixClient | undefined): void => {
  useEffect(() => {
    if (!mx) return undefined;

    let lastSyncAt = Date.now();
    // The Sync event whose following request was aborted; each stalled request is aborted once.
    let abortedAfter: number | undefined;

    const onSync = () => {
      lastSyncAt = Date.now();
    };

    const recover = (reason: string) => {
      if (!mx.clientRunning) return;

      const state = mx.getSyncState();
      const age = Date.now() - lastSyncAt;
      // Coming back to a lost connection is worth an immediate keepalive. The periodic check
      // leaves that to the SDK's own 5-10 s schedule.
      const retryDegraded =
        reason !== STALLED && (state === SyncState.Reconnecting || state === SyncState.Error);
      if (!retryDegraded && age < SYNC_STALL_MS) return;

      // In keepalive backoff after an error: skip the wait.
      if (mx.retryImmediately()) {
        console.info(`[sync] ${reason}: retried a backed-off sync`, { state, age });
        return;
      }

      // Before Syncing, or in Catchup, the request in flight may be a slow initial or catch-up
      // sync; aborting it only starts it again from the beginning.
      if (state !== SyncState.Syncing || age < SYNC_STALL_MS) return;
      if (abortedAfter === lastSyncAt) return;
      abortedAfter = lastSyncAt;
      console.info(`[sync] ${reason}: no sync for ${Math.round(age / 1000)}s, restarting it`);
      abortSyncRequest(mx);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') recover('visible');
    };
    const onFocus = () => recover('focus');
    const onOnline = () => recover('online');

    mx.on(ClientEvent.Sync, onSync);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    const stallCheck = window.setInterval(() => recover(STALLED), STALL_CHECK_INTERVAL_MS);

    let disposed = false;
    let unlistenResumed: (() => void) | undefined;
    if (isTauri()) {
      import('@tauri-apps/api/event')
        .then(({ listen, TauriEvent }) =>
          listen(TauriEvent.WINDOW_RESUMED, () => recover('resumed')),
        )
        .then((off) => {
          if (disposed) off();
          else unlistenResumed = off;
        })
        .catch((err) => console.warn('[sync] could not listen for app resume', err));
    }

    return () => {
      disposed = true;
      mx.removeListener(ClientEvent.Sync, onSync);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.clearInterval(stallCheck);
      unlistenResumed?.();
    };
  }, [mx]);
};
