import { useEffect } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { setReceiptsPaused } from '../state/idle';
import { applyOwnPresence } from '../state/ownPresence';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { useMatrixClient } from './useMatrixClient';
import { Presence } from './useUserPresence';

export const IDLE_AFTER_MS = 5 * 60 * 1000;

// Activity is sampled, not handled per event: mousemove fires constantly.
const ACTIVITY_THROTTLE_MS = 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;

// Away is only set over a presence that is plainly "online". An `unavailable`
// or a server-confirmed `offline` is something the user (or another of their
// clients) chose, and idling must not overwrite it, or undo it on return.
const isPlainlyOnline = (mx: MatrixClient): boolean => {
  const user = mx.getUser(mx.getSafeUserId());
  if (!user) {
    return true;
  }
  if (user.presence === Presence.Unavailable) {
    return false;
  }
  return !(user.presence === Presence.Offline && user.events.presence);
};

/**
 * Tracks whether the user is idle from input in this window (there is no
 * system-wide idle source in any build), and reflects it as away presence
 * and/or paused read receipts, each behind its own setting.
 */
export function IdleDetector() {
  const mx = useMatrixClient();
  const [idleAway] = useSetting(settingsAtom, 'idleAway');
  const [pauseReceipts] = useSetting(settingsAtom, 'idlePausesReadReceipts');

  useEffect(() => {
    if (!idleAway && !pauseReceipts) {
      return undefined;
    }

    let idle = false;
    let ownedAway = false;
    let lastActivity = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const setIdle = (next: boolean) => {
      if (idle === next) {
        return;
      }
      idle = next;
      if (pauseReceipts) {
        setReceiptsPaused(next);
      }
      if (!idleAway) {
        return;
      }
      if (next && isPlainlyOnline(mx)) {
        ownedAway = true;
        applyOwnPresence(mx, Presence.Unavailable).catch(() => {
          ownedAway = false;
        });
      } else if (!next && ownedAway) {
        ownedAway = false;
        applyOwnPresence(mx, Presence.Online).catch(() => undefined);
      }
    };

    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    };

    const onActivity = () => {
      const now = Date.now();
      if (!idle && now - lastActivity < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastActivity = now;
      setIdle(false);
      arm();
    };

    // Coming back to the window counts as activity; leaving it does not, so a
    // hidden window goes idle once the timer runs out.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        onActivity();
      }
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    arm();

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      setReceiptsPaused(false);
      if (ownedAway) {
        applyOwnPresence(mx, Presence.Online).catch(() => undefined);
      }
    };
  }, [mx, idleAway, pauseReceipts]);

  return null;
}
