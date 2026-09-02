import { useEffect, useRef } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { invoke } from '@tauri-apps/api/core';
import { isAndroid } from '../utils/platform';
import { isTauri } from '../utils/desktop-notifications';
import {
  registerUnifiedPush,
  getUnifiedPushEndpoint,
  isValidPushEndpoint,
  onEndpointReceived,
  onPushMessage,
  onRegistrationFailed,
  onUnregistered,
  startForegroundService,
  stopForegroundService,
} from '../utils/mobile-push';

const UP_APP_ID = 'in.prinny.app.unifiedpush';

/** The one path the Matrix Push Gateway API defines. */
const GATEWAY_PATH = '/_matrix/push/v1/notify';
/** Used when the distributor does not host a gateway of its own. */
const PUBLIC_GATEWAY = `https://matrix.gateway.unifiedpush.org${GATEWAY_PATH}`;

/**
 * Find a Matrix push gateway that will accept pushes for this endpoint.
 *
 * A distributor's endpoint is an arbitrary URL — `https://ntfy.sh/UPabc123` and
 * the like. A homeserver cannot POST Matrix pushes straight at it: the Push
 * Gateway API defines exactly one endpoint, `POST /_matrix/push/v1/notify`, and
 * Synapse enforces that path when the pusher is registered, rejecting anything
 * else outright. Handing it the raw endpoint — which is what this used to do —
 * means `/pushers/set` fails, no pusher is ever created, and the homeserver has
 * nowhere to send anything. That is why Android had no notifications at all
 * while other clients worked with the same distributor: they do this step.
 *
 * UnifiedPush's answer is discovery. A distributor that speaks Matrix answers
 * `GET <origin>/_matrix/push/v1/notify` with `{"unifiedpush":{"gateway":"matrix"}}`,
 * and that URL is then the gateway. ntfy and Sunup both do. Anything else goes
 * through the public gateway, which forwards to the endpoint carried in the
 * pushkey.
 */
async function resolveGateway(endpoint: string): Promise<string> {
  let origin: string;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    return PUBLIC_GATEWAY;
  }
  const candidate = `${origin}${GATEWAY_PATH}`;

  // Probe from Rust when there is a shell to do it, because the same request
  // made from here is subject to CORS and the answer we need is not served with
  // it. ntfy.sh returns the correct discovery body from nginx with no
  // `access-control-allow-origin` header at all — measured, and controlled
  // against `/v1/health` on the same host, which does send one. So `fetch`
  // rejects a response that arrived intact and said exactly the right thing,
  // the `catch` below reads that as "not a gateway", and every ntfy user is
  // quietly downgraded to the public gateway: an extra third party in the path
  // of notifications that carry sender and body for unencrypted rooms.
  //
  // Element X avoids this by probing with OkHttp rather than a browser.
  if (isTauri()) {
    try {
      const nativeGateway = await invoke<string | null>('probe_push_gateway', { endpoint });
      // `null` is a real answer — the host replied and is not a gateway — so it
      // ends the search rather than falling through to the fetch below.
      return nativeGateway ?? PUBLIC_GATEWAY;
    } catch (err) {
      // The probe itself failed (offline, DNS, blocked address). Fall through:
      // on desktop the webview `fetch` may still succeed, and the public
      // gateway is the backstop for both.
      console.warn('[UnifiedPush] Native gateway probe failed, falling back:', err);
    }
  }

  try {
    const res = await fetch(candidate, { method: 'GET' });
    if (res.ok) {
      const body = await res.json();
      if (body?.unifiedpush?.gateway === 'matrix') return candidate;
    }
  } catch {
    // Offline, blocked, or not a gateway — the public one still works.
  }
  return PUBLIC_GATEWAY;
}

/**
 * Delete our own pushers that point at an endpoint this device no longer has.
 *
 * A distributor may hand out a new endpoint whenever it likes, including while
 * the app is dead. The next launch registers a pusher for the new one — but the
 * old pusher is not replaced by that, because a pusher's identity is
 * (app_id, pushkey) and the pushkey is exactly the part that changed. `append:
 * false` does not help either: it only clears the same pair for OTHER users.
 *
 * So every rotation left another pusher behind, each aimed at a retired
 * endpoint, and the homeserver dutifully pushed to all of them forever. Element
 * X and FluffyChat both prune; FluffyChat goes further and deletes by a legacy
 * app_id as well, which we have no history of needing.
 *
 * Scoped to OUR app_id — other clients' pushers on the same account are not
 * ours to remove, and one of them is very likely the user's desktop.
 */
async function pruneStalePushers(mx: MatrixClient, currentEndpoint: string) {
  try {
    const { pushers } = await mx.getPushers();
    const stale = pushers.filter(
      (pusher) => pusher.app_id === UP_APP_ID && pusher.pushkey !== currentEndpoint,
    );
    await Promise.all(
      stale.map(async (pusher) => {
        try {
          await mx.removePusher(pusher.pushkey, pusher.app_id);
        } catch (err) {
          console.warn('[UnifiedPush] Could not remove a stale pusher:', pusher.pushkey, err);
        }
      }),
    );
    if (stale.length > 0) {
      console.info(`[UnifiedPush] Removed ${stale.length} pusher(s) for retired endpoints.`);
    }
  } catch (err) {
    // Never fatal: the pusher we just registered is already live, and a failure
    // to tidy up behind it changes nothing about whether push works now.
    console.warn('[UnifiedPush] Could not enumerate pushers to prune:', err);
  }
}

/**
 * Registers the UnifiedPush endpoint as a Matrix HTTP pusher.
 */
export type PusherRegistration =
  { ok: true; gateway: string } | { ok: false; gateway?: string; reason: string };

export async function registerMatrixPusher(
  mx: MatrixClient,
  endpoint: string,
): Promise<PusherRegistration> {
  // The endpoint is supplied by the installed UnifiedPush distributor, which is
  // just another app on the device. Refuse anything that is not an absolute
  // https URL rather than asking the homeserver to POST our push traffic to it
  // — see isValidPushEndpoint(). Checked here, at the single point of
  // registration, so neither the initial setup nor endpoint rotation can skip
  // it.
  if (!isValidPushEndpoint(endpoint)) {
    const reason = `The distributor issued "${endpoint}", which is not an absolute https URL. A self-hosted push server reachable only over http cannot be used: the homeserver would send every notification to it in the clear.`;
    console.warn('[UnifiedPush]', reason);
    return { ok: false, reason };
  }
  const gateway = await resolveGateway(endpoint);
  try {
    await mx.setPusher({
      kind: 'http',
      app_id: UP_APP_ID,
      // The endpoint identifies this device to the gateway, which forwards
      // there. It is the pushkey, never the gateway URL itself.
      pushkey: endpoint,
      app_display_name: 'Prinny',
      device_display_name: 'Prinny Android',
      lang: 'en',
      data: {
        url: gateway,
        // Deliberately NOT 'event_id_only'.
        //
        // With event_id_only the push carries just a room id and an event id,
        // so the only way to render a notification is to wake the WebView and
        // let JS sync — which Android suspends the moment the app leaves the
        // screen. That is why background notifications never appeared. Asking
        // the homeserver to include the event lets the Kotlin receiver post a
        // real notification with no running JS at all.
        //
        // The tradeoff, accepted deliberately: the homeserver now sends sender
        // and message body to the push gateway and on to the UnifiedPush
        // distributor app. For unencrypted rooms that content leaves the
        // device's trust boundary. Encrypted rooms are unaffected in substance
        // — the server cannot decrypt them, so the push carries no plaintext
        // and the receiver falls back to a generic message.
      },
      append: false,
    });
    await pruneStalePushers(mx, endpoint);
    return { ok: true, gateway };
  } catch (err) {
    // Loudly, and with the values that decide whether it works. This failing
    // quietly is half of why the Android side looked like it had no push
    // support rather than a broken pusher: the only trace was a warning inside
    // a WebView, with none of the inputs that would have identified the fault.
    console.error(
      '[UnifiedPush] Pusher registration REJECTED by the homeserver.',
      '\n  gateway :',
      gateway,
      '\n  pushkey :',
      endpoint,
      '\n  app_id  :',
      UP_APP_ID,
      '\n  error   :',
      err,
    );
    // Returned as well as logged. A console message inside a WebView on a phone
    // is not evidence anyone can reach; the diagnostics panel shows this.
    const detail =
      (err as { data?: { error?: string } })?.data?.error ??
      (err as { message?: string })?.message ??
      String(err);
    return { ok: false, gateway, reason: detail };
  }
}

/**
 * Sets up UnifiedPush for this Matrix client session.
 *
 * - Registers with a UP distributor (or reuses existing endpoint)
 * - Registers the endpoint as a Matrix HTTP pusher
 * - Listens for incoming push messages and triggers Matrix sync
 * - Listens for endpoint rotation and re-registers the pusher
 */
export function useUnifiedPush(mx: MatrixClient | undefined) {
  const setupDone = useRef(false);

  useEffect(() => {
    if (!mx || !mx.clientRunning || setupDone.current) return;

    let cancelled = false;
    let unsubMessage: (() => void) | undefined;
    let unsubEndpoint: (() => void) | undefined;
    let unsubUnregistered: (() => void) | undefined;
    let unsubRegistrationFailed: (() => void) | undefined;

    async function setup() {
      // Only run on Android — UnifiedPush + foreground service are Android-only.
      // Calling these plugin commands on Tauri desktop fails the ACL check.
      if (!(await isAndroid())) return;
      if (cancelled || !mx) return;
      setupDone.current = true;
      // 0. Start foreground service to keep Matrix WebSocket alive in background
      try {
        await startForegroundService();
        console.log('[UnifiedPush] Foreground service started');
      } catch (err) {
        console.warn('[UnifiedPush] Foreground service failed to start:', err);
      }

      // 1. Try existing endpoint first
      let endpoint = await getUnifiedPushEndpoint().catch(() => null);

      // 2. If no saved endpoint, register with UP distributor.
      //
      // Subscribe to the distributor's own failure event BEFORE registering:
      // `register` rejects for reasons this side can see (no distributor
      // installed, the command failing), but a distributor that accepts the
      // registration and then refuses it reports through
      // REGISTRATION_FAILED — which lands in the receiver, not in this
      // promise, and used to go nowhere at all because nothing listened.
      onRegistrationFailed((reason) => {
        console.error(
          '[UnifiedPush] The distributor refused to register this app:',
          reason,
          '\n  Push cannot work until this is resolved — check the distributor app (ntfy, Sunup, NextPush).',
        );
      }).then((unsub) => {
        unsubRegistrationFailed = unsub;
      });

      if (!endpoint) {
        try {
          endpoint = await registerUnifiedPush();
        } catch (err) {
          // The overwhelmingly common cause is no distributor app on the
          // device: without one there is no push at all, since this client has
          // no FCM path — tauri-plugin-mobile-push is registered but never
          // called. Said plainly here because it is the difference between
          // "the app is broken" and "install ntfy".
          console.warn(
            '[UnifiedPush] Could not register with a UnifiedPush distributor.',
            '\n  No notifications will arrive while the app is backgrounded.',
            '\n  Install a distributor (ntfy, Sunup, NextPush) and reopen Prinny.',
            '\n  error:',
            err,
          );
          return;
        }
      }

      if (endpoint) {
        await registerMatrixPusher(mx, endpoint);
      }

      // 3. Listen for new endpoints (rotation)
      onEndpointReceived(async (newEndpoint) => {
        await registerMatrixPusher(mx, newEndpoint);
      }).then((unsub) => {
        unsubEndpoint = unsub;
      });

      // 4. Listen for push messages — trigger sync
      onPushMessage(() => {
        mx.retryImmediately();
      }).then((unsub) => {
        unsubMessage = unsub;
      });

      // 5. Listen for unregistration
      onUnregistered(() => {
        console.log('[UnifiedPush] Unregistered from distributor');
      }).then((unsub) => {
        unsubUnregistered = unsub;
      });
    }

    setup();

    return () => {
      cancelled = true;
      unsubMessage?.();
      unsubEndpoint?.();
      unsubUnregistered?.();
      unsubRegistrationFailed?.();
      if (setupDone.current) {
        stopForegroundService().catch(() => {});
      }
    };
    // `mx` as well as its running flag: a re-login swaps the client instance,
    // and push setup belongs to whichever client is actually connected.
  }, [mx, mx?.clientRunning]);
}
