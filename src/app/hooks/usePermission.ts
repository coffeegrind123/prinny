import { useEffect, useState } from 'react';
import {
  getLiveNotificationPermission,
  isTauri,
  primeDesktopNotificationPermission,
  refreshNotificationPermission,
  setLiveNotificationPermission,
} from '../utils/desktop-notifications';

const isTauriRuntime = () => isTauri();

// Persist the last known granted notification permission across app restarts.
// Tauri's WebView resets `window.Notification.permission` to 'denied'/'default'
// on every launch, so without a cache the Settings → Notifications UI flashes
// the "Enable" button until the async OS check completes — and if the
// async check fails silently the button persists, forcing the user to
// re-click Enable on every startup.
//
// SECURITY: this flag is a *rendering hint only*. It is plain localStorage —
// it survives the user revoking the permission in OS settings, and any script
// on the origin can write it. It must never stand in as the answer to "may we
// show notification content?"; that question is answered by re-querying the
// platform (see the module-load refresh below and
// desktop-notifications.isNotificationPermissionGrantedSync).
const NOTIF_PERM_CACHE_KEY = 'notifPermissionGranted';

const readCachedGranted = (): boolean => {
  try {
    return localStorage.getItem(NOTIF_PERM_CACHE_KEY) === '1';
  } catch {
    return false;
  }
};

const writeCachedGranted = (granted: boolean) => {
  try {
    // Only when it actually changes. Every caller here is a re-check rather
    // than an event, so the overwhelming majority of these calls write the
    // value that is already there — and a localStorage write is synchronous and
    // disk-backed, which is not what a periodic no-op should cost.
    if (granted === (localStorage.getItem(NOTIF_PERM_CACHE_KEY) === '1')) return;
    if (granted) {
      localStorage.setItem(NOTIF_PERM_CACHE_KEY, '1');
    } else {
      localStorage.removeItem(NOTIF_PERM_CACHE_KEY);
    }
  } catch {
    // localStorage unavailable (private mode etc.) — fall through.
  }
};

// Re-query the platform once at load so the persisted hint is superseded by a
// real answer as early as possible, rather than standing in for a whole
// session. The result is recorded in desktop-notifications' live value, which
// the notification dispatch gate consults first.
void refreshNotificationPermission()
  .then((granted) => {
    writeCachedGranted(granted);
  })
  .catch(() => {
    // Platform query unavailable — the hint stays in play until the poll
    // in usePermissionState lands one.
  });

export const getNotificationState = (): PermissionState => {
  if ('Notification' in window) {
    if (isTauriRuntime()) {
      // Authoritative platform answer wins whenever we already have it —
      // including when it contradicts a stale cached `granted`.
      const live = getLiveNotificationPermission();
      if (live !== undefined) return live ? 'granted' : 'prompt';

      if (window.Notification.permission === 'granted') return 'granted';
      // Hint only: shows the Switch immediately on startup. The load-time
      // refresh above and the poll below will correct it within a tick.
      if (readCachedGranted()) return 'granted';
      return 'prompt';
    }
    if (window.Notification.permission === 'default') {
      return 'prompt';
    }
    if (window.Notification.permission === 'granted') {
      writeCachedGranted(true);
    } else if (window.Notification.permission === 'denied') {
      writeCachedGranted(false);
    }
    return window.Notification.permission;
  }
  return 'denied';
};

/**
 * The platform has no "permission changed" event, so the answer has to be
 * re-asked for. These are the two reasons to ask.
 *
 * The warm-up covers the one thing that resolves in milliseconds: on a cold
 * start `plugin-notification` may not have loaded yet, and the check throws
 * until it has. It stops at the first answer.
 *
 * After that the value only changes when the user leaves for the OS settings
 * and comes back, which is what the focus and visibility listeners catch — the
 * slow interval is the backstop for a window that never loses focus. This used
 * to be a flat 500 ms poll for as long as the panel was mounted: two Tauri IPC
 * round trips and two localStorage writes every second, indefinitely, to watch
 * a value that changes about once a year.
 */
const WARMUP_INTERVAL_MS = 500;
const WARMUP_ATTEMPTS = 10;
const RECHECK_INTERVAL_MS = 30000;

export function usePermissionState(name: PermissionName, initialValue: PermissionState = 'prompt') {
  const [permissionState, setPermissionState] = useState<PermissionState>(initialValue);

  useEffect(() => {
    let permissionStatus: PermissionStatus;

    function handlePermissionChange(this: PermissionStatus) {
      setPermissionState(this.state);
    }

    navigator.permissions
      .query({ name })
      .then((permStatus: PermissionStatus) => {
        permissionStatus = permStatus;
        handlePermissionChange.apply(permStatus);
        permStatus.addEventListener('change', handlePermissionChange);
      })
      .catch(() => {
        // Silence error since FF doesn't support microphone permission
      });

    let cancelled = false;

    /** Resolves false when the platform could not answer, so it is worth retrying. */
    const checkTauriPermission = async (): Promise<boolean> => {
      if (name !== 'notifications' || !isTauriRuntime()) return true;
      try {
        // Flip the JS-side permission cache before checking — without
        // this, isPermissionGranted() short-circuits on the wrong value
        // baked in by the plugin's init-iife (Windows defaults to
        // 'denied' even though the Rust permission_state is hardcoded
        // to Granted). primeDesktopNotificationPermission() is
        // idempotent and a no-op on Android.
        await primeDesktopNotificationPermission();
        // Goes straight to the plugin command rather than the npm helper,
        // and records the result as the authoritative value for the
        // notification dispatch gate. The localStorage write is only the
        // render hint for the next cold start.
        const granted = await refreshNotificationPermission();
        if (cancelled) return true;
        writeCachedGranted(granted);
        setPermissionState((prev) => {
          const mapped: PermissionState = granted ? 'granted' : 'prompt';
          return prev !== mapped ? mapped : prev;
        });
        return true;
      } catch {
        // plugin-notification not loaded yet
        return false;
      }
    };

    const recheck = () => {
      if (cancelled) return;
      if (name === 'notifications' && isTauriRuntime()) {
        void checkTauriPermission();
        return;
      }
      if (name === 'notifications' && 'Notification' in window) {
        const current = window.Notification.permission as PermissionState;
        if (current === 'granted') {
          setLiveNotificationPermission(true);
          writeCachedGranted(true);
        } else if (current === 'denied') {
          setLiveNotificationPermission(false);
          writeCachedGranted(false);
        }
        setPermissionState((prev) => (prev !== current ? current : prev));
      }
    };

    // Check immediately on mount, retrying briefly while the plugin loads.
    let warmupTimer: number | undefined;
    let warmupAttempts = 0;
    const warmup = () => {
      if (cancelled) return;
      warmupAttempts += 1;
      void checkTauriPermission().then((answered) => {
        if (cancelled || answered || warmupAttempts >= WARMUP_ATTEMPTS) return;
        warmupTimer = window.setTimeout(warmup, WARMUP_INTERVAL_MS);
      });
    };
    if (name === 'notifications' && isTauriRuntime()) warmup();
    else recheck();

    const interval = window.setInterval(recheck, RECHECK_INTERVAL_MS);
    // Coming back to the window is the moment a trip to the OS settings ends,
    // and it is what makes the slow interval acceptable: the answer is fresh
    // when it is looked at, not merely within thirty seconds of being right.
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);

    return () => {
      cancelled = true;
      permissionStatus?.removeEventListener('change', handlePermissionChange);
      window.clearInterval(interval);
      if (warmupTimer !== undefined) window.clearTimeout(warmupTimer);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [name]);

  return permissionState;
}
