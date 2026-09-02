import { useEffect, useRef } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { isTauri } from '../utils/desktop-notifications';
import { registerWebPushPusher } from '../utils/web-push';
import { useClientConfig } from './useClientConfig';

/**
 * Web equivalent of useUnifiedPush — sets up background notifications
 * for the webapp. No-op in Tauri (the desktop/Android clients have their
 * own push paths) or when config.json doesn't define a push gateway +
 * VAPID public key.
 */
export function useWebPush(mx: MatrixClient | undefined) {
  const { pushGateway, pushVapidPublicKey } = useClientConfig();
  const setupDone = useRef(false);

  useEffect(() => {
    if (isTauri()) return;
    if (!mx || !mx.clientRunning || setupDone.current) return;
    if (!pushGateway || !pushVapidPublicKey) return;

    setupDone.current = true;
    registerWebPushPusher(mx, {
      pushGateway,
      vapidPublicKey: pushVapidPublicKey,
    }).then((ok) => {
      if (!ok) setupDone.current = false; // allow retry next render
    });
    // `mx` itself, not just `mx?.clientRunning`: the effect closes over the
    // client it registers the pusher against. It comes from a context provider
    // so its identity is stable in practice, and the `setupDone` guard makes a
    // re-run idempotent regardless.
  }, [mx, mx?.clientRunning, pushGateway, pushVapidPublicKey]);
}
