import { useState, useEffect, useCallback, useRef } from 'react';
import {
  isTauri,
  sendDesktopNotification,
  onNotificationAction,
} from '../utils/desktop-notifications';
import { isMobile as isMobileTauri } from '../utils/platform';
import LogoSVG from '../../../public/res/svg/prinny.svg';

type UpdateStatus =
  'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error' | 'no-update';

interface UpdateInfo {
  version: string;
  body: string | undefined;
}

interface UpdateCheckState {
  status: UpdateStatus;
  update: UpdateInfo | null;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
}

type UpdateCheckOptions = {
  /**
   * Skip the automatic check on mount, the "update available" notification and
   * the toast-action listener — leaving only the state and the two actions.
   *
   * A second live instance of this hook would otherwise fire a second OS
   * notification for the same version (the seen-versions set is per instance)
   * and register a second toast-action listener. Anything that is a button
   * rather than the banner wants this.
   */
  manual?: boolean;
};

export function useUpdateCheck(options: UpdateCheckOptions = {}): UpdateCheckState {
  const manual = options.manual ?? false;
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep a ref to the Update object so we can call .downloadAndInstall() later
  const [updateObj, setUpdateObj] = useState<any>(null);
  // Track which versions we've already fired a notification for so a
  // banner that's dismissed and re-shown (or a repeat poll that returns
  // the same version) doesn't notify twice. Empty string is the web
  // sentinel — we only notify once per session for SW-detected updates
  // since we don't have a version to dedupe against.
  const notifiedVersions = useRef<Set<string>>(new Set());

  const checkForUpdate = useCallback(async () => {
    if (!isTauri()) {
      // Web: there is no updater plugin, but there is a service worker, and
      // asking it to re-fetch is the honest equivalent of "check for updates".
      // Without this the About button would be dead on the web build — the
      // only path to `status: 'available'` was the passive `updatefound` event.
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
      setStatus('checking');
      setError(null);
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
        // A new worker fires `cinny:web-update-available`, which sets
        // 'available'. Only fall back to 'no-update' if that has not already
        // happened — `update()` can resolve after the event.
        setStatus((current) => (current === 'checking' ? 'no-update' : current));
      } catch (err: any) {
        setError(err?.message ?? String(err));
        setStatus('error');
      }
      return;
    }
    // Mobile (Android/iOS) handles updates natively — Android via
    // `UpdateChecker.kt` from `MainActivity.onCreate`, which downloads
    // the new APK through DownloadManager and prompts the user to
    // install it. The desktop `tauri-plugin-updater` isn't compiled for
    // mobile targets (see src-tauri/Cargo.toml), so calling
    // `plugin:updater|check` on Android returns "not allowed by ACL".
    if (await isMobileTauri()) return;
    setStatus('checking');
    setError(null);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const result = await check();
      if (result) {
        setUpdate({ version: result.version, body: result.body });
        setUpdateObj(result);
        setStatus('available');
      } else {
        setStatus('no-update');
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setStatus('error');
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!isTauri()) {
      // Web: the SW already activated (skipWaiting + clients.claim on
      // install), so reloading is enough to load the new JS bundle the
      // new SW now serves. Server admin's `git pull` deploys the dist;
      // this just applies it client-side.
      setStatus('installing');
      window.location.reload();
      return;
    }
    if (!updateObj) return;
    setStatus('downloading');
    setError(null);
    try {
      await updateObj.downloadAndInstall();
      setStatus('installing');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setStatus('error');
    }
  }, [updateObj]);

  // Keep the latest downloadAndInstall reachable from the notification
  // listener (registered once) without re-subscribing on every state change.
  const downloadAndInstallRef = useRef(downloadAndInstall);
  downloadAndInstallRef.current = downloadAndInstall;

  // The desktop update toast carries `kind: 'update'`. Its "Open" action
  // (and a tap on the toast body) should do exactly what the banner's
  // "Update" button does — download and install. Other notification kinds
  // (message clicks → room navigation) are handled in ClientNonUIFeatures;
  // this listener only acts on the update kind.
  useEffect(() => {
    if (manual) return undefined;
    if (!isTauri()) return undefined;
    let unlisten: (() => void) | undefined;
    onNotificationAction((extra) => {
      if (extra?.kind === 'update') {
        downloadAndInstallRef.current();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [manual]);

  // Check for updates on mount, but only in Tauri
  useEffect(() => {
    if (manual) return undefined;
    if (!isTauri()) return undefined;
    // Delay to let the app finish loading
    const timer = setTimeout(() => {
      checkForUpdate();
    }, 5000);
    return () => clearTimeout(timer);
  }, [checkForUpdate, manual]);

  // Web: listen for SW update events dispatched from src/index.tsx
  useEffect(() => {
    if (isTauri()) return;
    if (typeof window === 'undefined') return;
    const handler = () => {
      // Version unknown for web (we only know "a new sw.js exists").
      setUpdate({ version: '', body: undefined });
      setError(null);
      setStatus('available');
    };
    window.addEventListener('cinny:web-update-available', handler);
    return () => window.removeEventListener('cinny:web-update-available', handler);
  }, []);

  // Fire a platform notification the first time we see each new version
  // become available. Tauri desktop: OS toast via plugin-notification.
  // Web: window.Notification (permission-gated). Android Tauri: skipped —
  // UpdateChecker.kt already shows the DownloadManager system notification
  // when it starts pulling the APK, so a second toast would be noise.
  useEffect(() => {
    if (manual) return;
    if (status !== 'available' || !update) return;
    const key = update.version || 'web-update';
    if (notifiedVersions.current.has(key)) return;
    notifiedVersions.current.add(key);

    (async () => {
      if (isTauri() && (await isMobileTauri())) return; // Android handles itself
      const title = update.version ? `Prinny ${update.version} available` : 'New version available';
      const body = update.version
        ? 'Click the banner to download and install.'
        : 'Click the banner to reload and load the new build.';
      try {
        await sendDesktopNotification(title, {
          icon: LogoSVG,
          body,
          // Tag the toast so its "Open" action routes to the update flow
          // (downloadAndInstall) instead of a room — see the listener below.
          kind: 'update',
        });
      } catch {
        // Notification permission may be denied — banner still shows.
      }
    })();
  }, [status, update, manual]);

  return { status, update, error, checkForUpdate, downloadAndInstall };
}
