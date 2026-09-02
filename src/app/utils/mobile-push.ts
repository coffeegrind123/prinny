/**
 * UnifiedPush integration for Android (GrapheneOS / de-Googled devices).
 *
 * Flow:
 *   1. registerWithDistributor() → picks a UP distributor, gets endpoint URL
 *   2. Register the endpoint as a Matrix pusher via POST /pushers/set
 *   3. When a push arrives, Matrix sync runs and fires normal notification handlers
 *
 * There is no FCM path. `tauri-plugin-mobile-push` is registered in `lib.rs`
 * but nothing in the frontend has ever called it, so a device with Play
 * Services is served by UnifiedPush exactly like a de-Googled one — which means
 * a distributor app (ntfy, Sunup, NextPush) is required on every Android
 * install, not only on GrapheneOS.
 */
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import { type UnlistenFn } from '@tauri-apps/api/event';
import { isWebUrl } from './safeUrl';

/**
 * Subscribe to an event emitted by a Tauri mobile plugin's Kotlin side.
 *
 * NOT `listen()` from `@tauri-apps/api/event`, which is the global event bus.
 * Kotlin's `Plugin.trigger(event, payload)` walks `listeners[event]` — a map
 * filled only by the plugin's own `registerListener` command, i.e. by
 * `addPluginListener` — and does nothing at all when that map is empty. So a
 * `listen('endpoint-received')` never fires no matter how many pushes arrive,
 * which is exactly how UnifiedPush endpoint rotation and the push-received sync
 * nudge came to be silently dead.
 *
 * Normalised back to an `UnlistenFn` because `addPluginListener` resolves to a
 * `PluginListener` whose teardown is `.unregister()`; calling the object itself
 * throws, and callers here store plain functions.
 */
async function listenToPlugin<T>(
  plugin: string,
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  const listener = await addPluginListener<T>(plugin, event, handler);
  return () => {
    listener.unregister();
  };
}

export interface UnifiedPushEndpoint {
  endpoint: string;
}

/**
 * True when `endpoint` is an absolute https URL.
 *
 * Why https specifically: this value comes from whichever UnifiedPush
 * distributor app happens to be installed on the device — an app we do not
 * control and did not vet — and it is handed straight to the homeserver as the
 * pusher `data.url`. The homeserver then POSTs a push notification to it for
 * every matching event, forever, without any further involvement from us. Over
 * plain http that traffic (room ids, event ids, sender, and unread counts —
 * and message content for non-`event_id_only` formats) crosses the network in
 * the clear to an attacker-observable endpoint. isWebUrl also rejects the
 * non-http(s) schemes a malicious distributor could otherwise return.
 */
export function isValidPushEndpoint(endpoint: unknown): endpoint is string {
  if (!isWebUrl(endpoint)) return false;
  try {
    return new URL(endpoint).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Register this device with a UnifiedPush distributor.
 * Returns the endpoint URL to send to the Matrix homeserver.
 */
export async function registerUnifiedPush(): Promise<string> {
  const result = await invoke<UnifiedPushEndpoint>('plugin:unifiedpush|register');
  return result.endpoint;
}

/**
 * Everything the device knows about its own push setup.
 *
 * `distributors` is every UnifiedPush app installed; `savedDistributor` is the
 * one chosen; `ackDistributor` is the one that has actually completed a
 * handshake. They differ in ways that matter: none installed is a different
 * fault, with a different fix, from one installed but never chosen, or one
 * chosen that never answered.
 */
export interface UnifiedPushStatus {
  distributors: string[];
  savedDistributor: string;
  ackDistributor: string;
  endpoint: string;
  notificationsPermitted: boolean;
}

/**
 * Read the device-side push state. Android only; resolves to null elsewhere.
 */
export async function getUnifiedPushStatus(): Promise<UnifiedPushStatus | null> {
  try {
    return await invoke<UnifiedPushStatus>('plugin:unifiedpush|get_status');
  } catch {
    // Not Android, or the plugin is unreachable — either way there is no
    // device-side push state to report.
    return null;
  }
}

/**
 * Get the currently saved endpoint (if already registered).
 */
export async function getUnifiedPushEndpoint(): Promise<string | null> {
  try {
    const result = await invoke<UnifiedPushEndpoint>('plugin:unifiedpush|get_endpoint');
    return result.endpoint;
  } catch {
    return null;
  }
}

/**
 * Listen for new UnifiedPush endpoints (arrives after registration).
 */
export function onEndpointReceived(callback: (endpoint: string) => void): Promise<UnlistenFn> {
  return listenToPlugin<{ endpoint: string }>('unifiedpush', 'endpoint-received', (payload) => {
    callback(payload.endpoint);
  });
}

/**
 * Listen for incoming UnifiedPush messages.
 * Callback receives the raw message body as a UTF-8 string.
 */
export function onPushMessage(callback: (body: string) => void): Promise<UnlistenFn> {
  return listenToPlugin<{ body: string }>('unifiedpush', 'message-received', (payload) => {
    callback(payload.body);
  });
}

/**
 * Listen for UnifiedPush unregistration events.
 */
export function onUnregistered(callback: () => void): Promise<UnlistenFn> {
  return listenToPlugin('unifiedpush', 'unregistered', callback);
}

/**
 * Listen for UnifiedPush registration failures.
 */
export function onRegistrationFailed(callback: (reason: string) => void): Promise<UnlistenFn> {
  return listenToPlugin<{ reason: string }>('unifiedpush', 'registration-failed', (payload) => {
    callback(payload.reason);
  });
}

/**
 * Foreground service — keeps the Matrix WebSocket alive in the background
 * on GrapheneOS and other de-Googled devices without FCM.
 */

/** Start the foreground service with a persistent notification. */
export async function startForegroundService(): Promise<void> {
  await invoke('plugin:foreground|start_foreground');
}

/** Stop the foreground service and remove the persistent notification. */
export async function stopForegroundService(): Promise<void> {
  await invoke('plugin:foreground|stop_foreground');
}

/** Check whether the foreground service is currently running. */
export async function isForegroundServiceRunning(): Promise<boolean> {
  const result = await invoke<{ running: boolean }>('plugin:foreground|is_foreground_running');
  return result.running;
}

/**
 * Toggle whether the foreground service advertises microphone usage.
 * Required on Android 14+ so the WebView can keep the mic open during
 * Element Call when the app is backgrounded — without it, the OS revokes
 * the mic the moment the activity loses focus and the call goes silent.
 * No-op on non-Android platforms.
 */
export async function setForegroundMicrophoneActive(active: boolean): Promise<void> {
  try {
    await invoke('plugin:foreground|set_microphone_active', { active });
  } catch {
    // Plugin is Android-only; ignore on desktop and other platforms.
  }
}
