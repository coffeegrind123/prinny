import { MatrixClient } from 'matrix-js-sdk';
import type { IPusher } from 'matrix-js-sdk';

/**
 * Web Push subscription + Matrix pusher registration.
 *
 * Architecture:
 *   browser PushManager  ─┐
 *                         ├──→ Matrix homeserver ──→ push gateway ──→ browser
 *   Matrix pusher record ─┘
 *
 * The browser generates an endpoint URL and per-subscription encryption
 * keys (auth + p256dh). We tell the homeserver to push notifications for
 * us to a push gateway (Sygnal or a Sygnal-compatible service), and the
 * gateway uses the endpoint + keys + VAPID private key to send encrypted
 * Web Push messages back to the browser.
 *
 * Configure via config.json:
 *   {
 *     "pushGateway": "https://sygnal.your-domain.example/_matrix/push/v1/notify",
 *     "pushVapidPublicKey": "BASE64URL_VAPID_PUBLIC_KEY"
 *   }
 *
 * Without either field, registration is a no-op (foreground-only
 * notifications still work via the existing window.Notification path).
 *
 * The matching VAPID private key lives on the push gateway and never
 * touches the client.
 */

const APP_ID = 'in.cinny.app.web';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface WebPushConfig {
  pushGateway: string;
  vapidPublicKey: string;
}

/**
 * Get an active PushSubscription (creating one if necessary).
 * Returns null when Push API isn't available or the user denied permission.
 */
async function ensureSubscription(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined') return null;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  if (Notification.permission !== 'granted') return null;

  const reg = await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // Sanity check — if the user rotated VAPID public keys on the
    // gateway side, the cached subscription is dead and needs to be
    // recreated against the new key.
    const cachedKey = arrayBufferToBase64Url(existing.options.applicationServerKey ?? null);
    if (cachedKey === vapidPublicKey) return existing;
    await existing.unsubscribe();
  }

  try {
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  } catch (err) {
    console.warn('[web-push] pushManager.subscribe failed:', err);
    return null;
  }
}

/**
 * Subscribe to Web Push and register the endpoint as a Matrix pusher.
 * Idempotent — safe to call repeatedly; the homeserver replaces an
 * existing pusher with the same app_id + pushkey instead of duplicating.
 *
 * Returns true if registration succeeded, false if skipped or errored.
 */
export async function registerWebPushPusher(
  mx: MatrixClient,
  config: WebPushConfig,
): Promise<boolean> {
  if (!config.pushGateway || !config.vapidPublicKey) return false;

  const sub = await ensureSubscription(config.vapidPublicKey);
  if (!sub) return false;

  const endpoint = sub.endpoint;
  const auth = arrayBufferToBase64Url(sub.getKey('auth'));
  const p256dh = arrayBufferToBase64Url(sub.getKey('p256dh'));

  try {
    await mx.setPusher({
      kind: 'http',
      app_id: APP_ID,
      pushkey: endpoint,
      app_display_name: 'Prinny Web',
      device_display_name: navigator.userAgent.includes('Firefox')
        ? 'Firefox'
        : navigator.userAgent.includes('Chrome')
          ? 'Chrome'
          : 'Browser',
      lang: navigator.language || 'en',
      // IPusher['data'] is typed as just { format?, url?, brand? }, but the Matrix
      // spec lets pusher data carry implementation-specific keys, and Sygnal's
      // webpush pushkin requires endpoint/auth/p256dh to encrypt the payload
      // against the browser's keys.
      data: {
        // Standard Matrix pusher data — `url` tells the homeserver where
        // to forward; `format: event_id_only` keeps message bodies off
        // the gateway for privacy.
        url: config.pushGateway,
        format: 'event_id_only',
        // Web Push extras — Sygnal's webpush pushkin reads these from
        // `data` to encrypt the payload against the browser's keys.
        endpoint,
        auth,
        p256dh,
        default_payload: {
          // The gateway includes this when sending; lets the SW show a
          // sensible fallback notification if the room/event lookup fails.
          aps: { mutable_content: 1 },
        },
      } as IPusher['data'],
      append: false,
    });
    return true;
  } catch (err) {
    console.warn('[web-push] Matrix setPusher failed:', err);
    return false;
  }
}

/**
 * Cancel the Web Push subscription and tear down the Matrix pusher.
 * Call on logout so the homeserver doesn't keep pushing to dead endpoints.
 */
export async function unregisterWebPushPusher(mx: MatrixClient): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      try {
        await mx.setPusher({
          kind: null,
          app_id: APP_ID,
          pushkey: sub.endpoint,
          app_display_name: '',
          device_display_name: '',
          lang: 'en',
          data: { url: '' },
          append: false,
        } as any);
      } catch {
        // Already gone, fine.
      }
    }
  } catch (err) {
    console.warn('[web-push] unregister failed:', err);
  }
}
