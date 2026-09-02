/**
 * Notification wrapper.
 *
 * Tauri desktop: @tauri-apps/plugin-notification → notify-rust (Windows
 *   winrt-notification, macOS NSUserNotification, Linux libnotify). The
 *   `icon` field must be an absolute file path — data URIs silently fail
 *   on Windows because winrt-notification calls Path::new(icon) and that
 *   path doesn't exist.
 * Tauri Android: bypass plugin-notification (its icon resolver looks up
 *   bundled drawable resources only, no file paths) and use our custom
 *   MessageNotificationPlugin which calls Notification.Builder
 *   .setLargeIcon(BitmapFactory.decodeFile(path)).
 * Browser: window.Notification — data URIs work fine in icon field there.
 *
 * Avatar pipeline: JS receives an HTTP mxc-derived URL → invoke
 * cache_notification_icon (Rust) which writes the bytes to the app
 * cache dir → pass that absolute path to the platform notification.
 *
 * Windows: Toast notifications require the app to be "installed" via the
 * NSIS installer (Start Menu shortcut → AppUserModelID). A loose .exe
 * will silently skip showing toasts even if permission is granted.
 */

let tauriNotif: typeof import('@tauri-apps/plugin-notification') | null = null;
let tauriLoadAttempted = false;

async function getTauriNotif() {
  if (tauriLoadAttempted) return tauriNotif;
  tauriLoadAttempted = true;
  try {
    if (isTauri()) {
      tauriNotif = await import('@tauri-apps/plugin-notification');
    }
  } catch (err) {
    console.error('[notif] Failed to load @tauri-apps/plugin-notification:', err);
  }
  return tauriNotif;
}

export function isTauri(): boolean {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

// `tauri-plugin-notification`'s init-iife.js short-circuits the permission
// check on Windows (it bakes in `__TEMPLATE_windows__` and concludes
// `denied` without ever calling Rust). The npm-side `isPermissionGranted()`
// then also short-circuits whenever `window.Notification.permission !==
// 'default'`, so the polling in usePermissionState never recovers and the
// Settings → System → Enable button is shown on every fresh launch.
//
// On Tauri desktop the Rust `permission_state` and `request_permission`
// are hardcoded to `Granted` (see tauri-plugin-notification's desktop.rs
// — they always return PermissionState::Granted), so it's safe to flip
// the JS-side permission cache to `granted` ourselves at boot. macOS and
// Linux follow the same code path in plugin-notification, so we prime
// them all consistently. Android is intentionally skipped — it uses our
// custom MessageNotificationPlugin where permission is real.
let desktopPermissionPrimed = false;
export async function primeDesktopNotificationPermission(): Promise<void> {
  if (desktopPermissionPrimed) return;
  if (!isTauri()) return;
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  desktopPermissionPrimed = true;
  try {
    const { getTauriPlatform } = await import('./platform');
    const platform = await getTauriPlatform();
    if (platform !== 'windows' && platform !== 'macos' && platform !== 'linux') {
      // Android keeps the real permission state — don't override.
      return;
    }
    if (window.Notification.permission === 'granted') return;
    const mod = await getTauriNotif();
    if (!mod) return;
    await mod.requestPermission();
  } catch (err) {
    console.warn('[notif] primeDesktopNotificationPermission failed:', err);
    desktopPermissionPrimed = false; // let a later caller retry
  }
}

/**
 * Ask Android for POST_NOTIFICATIONS, once, on first run.
 *
 * Nothing did this. The only caller of `requestNotificationPermission` is the
 * Enable button in Settings → Notifications, so unless a user went looking for
 * it the app held no notification permission at all — and on Android 13+ that
 * makes every `notify()` a silent no-op: the in-app path, the push receiver's,
 * and the foreground service's persistent one alike. It reads exactly like
 * "notifications don't work", with nothing in any log to say otherwise, and
 * it is easy to conclude the permission is fine because *download* notifications
 * still arrive — those are posted by Android's DownloadManager under its own
 * identity, not ours.
 *
 * Asked once and recorded, because Android stops showing the dialog after two
 * dismissals and re-asking on every launch spends that budget for nothing. The
 * Settings button remains the way back for anyone who declined.
 */
const ANDROID_NOTIFICATION_PERMISSION_ASKED = 'androidNotifPermissionAsked';

export async function ensureAndroidNotificationPermission(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getTauriPlatform } = await import('./platform');
    if ((await getTauriPlatform()) !== 'android') return;

    // The OS is the authority — a granted permission needs no prompt, and this
    // also refreshes the dispatch gate on every launch.
    if (await refreshNotificationPermission()) return;

    try {
      if (localStorage.getItem(ANDROID_NOTIFICATION_PERMISSION_ASKED) === '1') return;
      localStorage.setItem(ANDROID_NOTIFICATION_PERMISSION_ASKED, '1');
    } catch {
      // No localStorage: prompting once per launch beats never prompting.
    }

    const result = await requestNotificationPermission();
    setLiveNotificationPermission(result === 'granted');
  } catch (err) {
    console.warn('[notif] ensureAndroidNotificationPermission failed:', err);
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (isTauri()) {
    const mod = await getTauriNotif();
    if (mod) {
      try {
        const permission = await mod.requestPermission();
        return permission;
      } catch (err) {
        console.error('[notif] requestPermission failed:', err);
      }
    }
  }

  // Browser fallback
  if (!('Notification' in window)) return 'denied';
  try {
    const result = window.Notification.requestPermission();
    if (result instanceof Promise) return await result;
    return result;
  } catch {
    return 'denied';
  }
}

export async function isNotificationPermissionGranted(): Promise<boolean> {
  if (isTauri()) {
    const mod = await getTauriNotif();
    if (mod) {
      try {
        return await mod.isPermissionGranted();
      } catch {
        // fall through
      }
    }
  }

  if ('Notification' in window) {
    return window.Notification.permission === 'granted';
  }
  return false;
}

// The platform's own answer for this session. `undefined` means we have not
// managed to ask it yet.
//
// Why this exists: the localStorage flag (`notifPermissionGranted`) written by
// usePermission.ts is a *rendering hint* — it exists so the Settings UI does
// not flash an "Enable" button while the async platform check is in flight. It
// must never be the authoritative answer, because it survives the user
// revoking the permission in OS settings (or a hostile page writing it), and
// anything downstream that trusts it would then dispatch notification content
// the platform has been told not to show. Once the real query lands, it wins.
let livePermissionGranted: boolean | undefined;

/**
 * Ask the platform itself, bypassing the npm helper.
 *
 * `isNotificationPermissionGranted()` above goes through the plugin's
 * `isPermissionGranted()`, which short-circuits on
 * `window.Notification.permission !== 'default'` and never reaches Rust. That
 * is wrong on both of our Tauri targets: Windows WebView2 reports 'denied' by
 * default, and the Android WebView never reports 'granted' even after
 * POST_NOTIFICATIONS is granted. Invoking the plugin command directly gets the
 * OS's real answer.
 *
 * Returns `undefined` when the platform could not be asked — the caller must
 * then leave the persisted hint in play rather than assume "denied".
 */
async function queryPlatformNotificationPermission(): Promise<boolean | undefined> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const granted = await invoke<boolean | null>('plugin:notification|is_permission_granted');
      return typeof granted === 'boolean' ? granted : undefined;
    } catch (err) {
      console.warn('[notif] is_permission_granted query failed:', err);
      return undefined;
    }
  }

  // Browser: `Notification.permission` IS the platform answer, read live.
  if ('Notification' in window) {
    return window.Notification.permission === 'granted';
  }
  return false;
}

/**
 * Re-query the platform and record its answer as the authoritative value for
 * the sync gate below. Call at load, and whenever the permission may have
 * changed.
 *
 * When the platform cannot be reached, the live value is deliberately left
 * unset so the persisted hint keeps working until a later query succeeds — a
 * failed query is not evidence of a revoked permission.
 */
export async function refreshNotificationPermission(): Promise<boolean> {
  const granted = await queryPlatformNotificationPermission();
  if (granted !== undefined) {
    livePermissionGranted = granted;
    return granted;
  }
  return isNotificationPermissionGrantedSync();
}

/** Record a platform answer obtained elsewhere (e.g. usePermissionState's poll). */
export function setLiveNotificationPermission(granted: boolean): void {
  livePermissionGranted = granted;
}

/** The platform answer if we have one this session, else `undefined`. */
export function getLiveNotificationPermission(): boolean | undefined {
  return livePermissionGranted;
}

let actionTypesRegistered = false;
async function ensureActionTypes() {
  if (actionTypesRegistered) return;
  actionTypesRegistered = true;
  const mod = await getTauriNotif();
  if (mod) {
    try {
      await mod.registerActionTypes([
        {
          id: 'message',
          actions: [
            {
              id: 'open',
              title: 'Open',
              foreground: true,
            },
          ],
        },
      ]);
    } catch (err) {
      console.error('[notif] Failed to register action types:', err);
    }
  }
}

/**
 * How much of a message may cross into the OS notification store.
 *
 * Why this exists: a decrypted E2EE body handed to `sendNotification` leaves
 * the client's control entirely. On Windows it is written to the Action Center
 * database, on Android to the system notification log — both readable by other
 * software on the device, backed up, and shown on the lock screen of a device
 * the user may not be holding. The end-to-end guarantee stops at that boundary,
 * so users need a way to keep the content on this side of it.
 *
 * - `full`        — title and body verbatim (current behaviour, the default).
 * - `sender-only` — keep the title (who/where) but replace the body.
 * - `hidden`      — reveal neither sender nor content.
 */
export type NotificationContentMode = 'full' | 'sender-only' | 'hidden';

export const DEFAULT_NOTIFICATION_CONTENT_MODE: NotificationContentMode = 'full';

const CONTENT_FREE_BODY = 'New message';
const CONTENT_FREE_TITLE = 'New message';

/**
 * Reduce a notification's title/body to what `mode` permits. Applied at the
 * single point where notifications are dispatched, so no platform branch can
 * bypass it.
 */
export function redactNotificationContent(
  title: string,
  body: string | undefined,
  mode: NotificationContentMode = DEFAULT_NOTIFICATION_CONTENT_MODE,
): { title: string; body: string } {
  if (mode === 'hidden') return { title: CONTENT_FREE_TITLE, body: '' };
  if (mode === 'sender-only') return { title, body: CONTENT_FREE_BODY };
  return { title, body: body ?? '' };
}

export interface NotificationExtra {
  roomId?: string;
  eventId?: string;
  // Distinguishes non-message notifications (e.g. the update toast) so the
  // click handler can route them somewhere other than a room. Empty/absent
  // for ordinary message notifications.
  kind?: string;
}

// In-memory cache: source URL → resolved icon (path on Tauri, data URI on web).
const iconCache = new Map<string, string>();

async function resolveBrowserIcon(url: string): Promise<string | undefined> {
  if (iconCache.has(url)) return iconCache.get(url);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return undefined;
    const blob = await resp.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    iconCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return undefined;
  }
}

/**
 * Cache an image for a notification, optionally under a stable `key`.
 *
 * A key makes the cached file findable by something that knows only WHO a
 * notification is from — namely the Android push receiver, which posts
 * background notifications from Kotlin with no JavaScript running and no way
 * to resolve an avatar URL. See `cacheAvatarsForNotifications`.
 */
export async function resolveTauriIconPath(
  url: string,
  authHeader?: string,
  homeserver?: string,
  key?: string,
): Promise<string | undefined> {
  // The in-memory map is keyed by URL, and a keyed call writes a DIFFERENT
  // file for the same URL, so it must not be answered from the URL's entry.
  if (!key && iconCache.has(url)) return iconCache.get(url);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string>('cache_notification_icon', {
      url,
      key: key ?? null,
      authHeader: authHeader ?? null,
      // The Rust side only forwards `authHeader` when `url` is under this
      // homeserver's `/_matrix/` media endpoint — prevents the access token
      // leaking to any non-homeserver URL.
      homeserver: homeserver ?? null,
    });
    if (typeof path === 'string' && path.length > 0) {
      if (!key) iconCache.set(url, path);
      return path;
    }
  } catch (err) {
    console.warn('[notif] cache_notification_icon failed:', err);
  }
  return undefined;
}

async function sendAndroidNotification(
  title: string,
  body: string,
  iconPath: string | undefined,
  roomId: string | undefined,
  eventId: string | undefined,
): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:message-notification|show', {
      title,
      body,
      iconPath,
      roomId,
      eventId,
    });
    return true;
  } catch (err) {
    console.warn('[notif] Android message-notification|show failed:', err);
    return false;
  }
}

export async function sendDesktopNotification(
  title: string,
  options?: {
    body?: string;
    icon?: string;
    iconAuthHeader?: string;
    iconHomeserver?: string;
    roomId?: string;
    eventId?: string;
    kind?: string;
    /**
     * Content-free notification mode. Omitted = `full` (unchanged behaviour).
     * Callers holding decrypted E2EE content should pass the user's configured
     * mode here — redaction happens before ANY platform call below, so the
     * plaintext never reaches the OS notification store when it is not `full`.
     */
    contentMode?: NotificationContentMode;
  },
): Promise<void> {
  const { title: outTitle, body: outBody } = redactNotificationContent(
    title,
    options?.body,
    options?.contentMode,
  );
  const srcIcon = options?.icon;
  const isHttpIcon =
    typeof srcIcon === 'string' &&
    (srcIcon.startsWith('http://') || srcIcon.startsWith('https://'));

  if (isTauri()) {
    // Resolve avatar URL → absolute file path on disk so both notify-rust
    // (desktop) and our Android plugin (Notification.Builder.setLargeIcon)
    // can read real bytes.
    let resolvedPath: string | undefined;
    if (isHttpIcon && srcIcon) {
      resolvedPath = await resolveTauriIconPath(
        srcIcon,
        options?.iconAuthHeader,
        options?.iconHomeserver,
      );
    } else if (srcIcon && !srcIcon.startsWith('data:')) {
      // Already a file path / bundled asset.
      resolvedPath = srcIcon;
    }

    // Android: custom plugin (plugin-notification ignores file paths there).
    const { getTauriPlatform } = await import('./platform');
    const platform = await getTauriPlatform();
    if (platform === 'android') {
      const ok = await sendAndroidNotification(
        outTitle,
        outBody,
        resolvedPath,
        options?.roomId,
        options?.eventId,
      );
      if (ok) return;
      // Fall through to plugin-notification (no avatar) on failure.
    }

    // Windows: bypass tauri-plugin-notification because notify-rust's
    // Windows backend silently drops the `icon` field — the toast comes
    // up with no avatar regardless of what we pass. Use our own Rust
    // command which calls tauri-winrt-notification directly to emit a
    // proper <image placement="appLogoOverride" hint-crop="circle"> in
    // the toast XML.
    if (platform === 'windows') {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('send_windows_message_toast', {
          title: outTitle,
          body: outBody,
          iconPath: resolvedPath ?? null,
          roomId: options?.roomId ?? '',
          eventId: options?.eventId ?? '',
          kind: options?.kind ?? '',
        });
        return;
      } catch (err) {
        console.warn('[notif] send_windows_message_toast failed, falling back:', err);
        // Fall through to plugin-notification (no avatar) on failure.
      }
    }

    const mod = await getTauriNotif();
    if (mod) {
      const granted = await mod.isPermissionGranted();
      if (granted) {
        await ensureActionTypes();
        mod.sendNotification({
          title: outTitle,
          body: outBody,
          icon: resolvedPath,
          actionTypeId: 'message',
          extra: {
            roomId: options?.roomId ?? '',
            eventId: options?.eventId ?? '',
            kind: options?.kind ?? '',
          },
        });
        return;
      }
    }
  }

  // Browser fallback: data URI is fine here (and required since browser
  // can't read local file:// paths).
  let browserIcon: string | undefined = srcIcon;
  if (isHttpIcon && srcIcon) {
    browserIcon = (await resolveBrowserIcon(srcIcon)) ?? srcIcon;
  }
  if ('Notification' in window && window.Notification.permission === 'granted') {
    new window.Notification(outTitle, {
      body: outBody,
      icon: browserIcon,
      silent: true,
    });
  }
}

/**
 * Listen for notification clicks (Tauri action events).
 * Returns an unlisten function for cleanup.
 *
 * We register both the plugin-notification `onAction` listener (covers macOS
 * and Linux, and Android via our custom plugin) AND a `notification://activated`
 * Tauri event listener (covers Windows, where we bypass plugin-notification
 * and emit toasts ourselves via tauri-winrt-notification).
 */
export async function onNotificationAction(
  callback: (extra: NotificationExtra) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};

  const unlisteners: Array<() => void> = [];

  const mod = await getTauriNotif();
  if (mod) {
    try {
      const listener = await mod.onAction((notification) => {
        const extra = notification.extra as NotificationExtra | undefined;
        if (extra?.roomId || extra?.kind) {
          callback(extra);
        }
      });
      // onAction() resolves to a PluginListener, whose teardown is
      // .unregister() — calling the object itself threw "listener is not a
      // function", so the listener was never actually removed.
      unlisteners.push(() => {
        listener.unregister();
      });
    } catch (err) {
      console.error('[notif] Failed to register onAction listener:', err);
    }
  }

  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<NotificationExtra>('notification://activated', (event) => {
      const payload = event.payload;
      if (payload?.roomId || payload?.kind) {
        callback(payload);
      }
    });
    unlisteners.push(unlisten);
  } catch (err) {
    console.error('[notif] Failed to register notification://activated listener:', err);
  }

  // Android dispatches notification clicks through our custom
  // MessageNotificationPlugin: MainActivity.onCreate / onNewIntent picks up
  // the PendingIntent extras and the plugin emits this event.
  //
  // Registered with addPluginListener, not listen(). Kotlin's
  // `Plugin.trigger()` delivers only to channels opened by the plugin's own
  // `registerListener` command — it does NOT emit on the global event bus, as
  // the comment that used to sit here claimed. Every tap on an Android
  // notification therefore went nowhere, and so did UnifiedPush's events,
  // which were written against the same wrong assumption.
  try {
    const { addPluginListener, invoke } = await import('@tauri-apps/api/core');
    const listener = await addPluginListener<NotificationExtra>(
      'message-notification',
      'message-notification-clicked',
      (payload) => {
        if (payload?.roomId) {
          callback(payload);
        }
      },
    );
    unlisteners.push(() => {
      listener.unregister();
    });

    // Signal the plugin that we're listening. On Android cold start the
    // PendingIntent extras arrive before React mounts; the plugin stashes
    // the click and replays it on this command. No-op on other platforms
    // (the command isn't registered there — invoke rejects silently).
    try {
      await invoke('plugin:message-notification|js_ready');
    } catch {
      // Plugin not present (desktop / non-Android) — ignore.
    }
  } catch (err) {
    console.error('[notif] Failed to register message-notification-clicked listener:', err);
  }

  return () => {
    unlisteners.forEach((fn) => {
      try {
        fn();
      } catch {
        // swallow
      }
    });
  };
}

export function isNotificationPermissionGrantedSync(): boolean {
  // The platform's own answer, once we have it, is the only authoritative
  // source — including when it says `false` after a cached `true`.
  if (livePermissionGranted !== undefined) return livePermissionGranted;

  // Only until the first re-query lands do we fall back to the persisted hint.
  //
  // On Tauri Android the WebView never marks window.Notification.permission
  // as 'granted' — tauri-plugin-notification doesn't override the WebView's
  // builtin Notification object on Android, so it stays at the WebView
  // default ('denied') even after the user grants POST_NOTIFICATIONS via
  // the OS dialog. usePermission.ts caches the last known granted state in
  // localStorage; use it as a hint so the JS dispatch gate doesn't suppress
  // foreground notifications during the startup window.
  if (isTauri()) {
    try {
      if (localStorage.getItem('notifPermissionGranted') === '1') return true;
    } catch {
      // localStorage unavailable — fall through to Notification check.
    }
  }
  if ('Notification' in window) {
    return window.Notification.permission === 'granted';
  }
  return false;
}
