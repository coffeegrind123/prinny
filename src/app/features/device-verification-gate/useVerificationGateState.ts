import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCrossSigningActive } from '../../hooks/useCrossSigning';
import { useDeviceVerificationStatus } from '../../hooks/useDeviceVerificationStatus';
import {
  GateKind,
  IdentityState,
  isGateDismissed,
  subscribeGateDismissal,
} from './verificationGate';

/**
 * Whether the account has an encryption identity. Account data answers it when the keys are in
 * secret storage; otherwise the server is asked, so an identity kept elsewhere is never
 * mistaken for none. A failed lookup stays unknown, so the gate asks for nothing it cannot
 * be sure about.
 */
const useIdentityState = (): IdentityState => {
  const mx = useMatrixClient();
  const inSecretStorage = useCrossSigningActive();
  const [onServer, setOnServer] = useState<boolean>();

  useEffect(() => {
    if (inSecretStorage) return undefined;
    let alive = true;
    const crypto = mx.getCrypto();
    if (!crypto) return undefined;
    crypto
      .userHasCrossSigningKeys(mx.getSafeUserId(), true)
      .then((has) => alive && setOnServer(has))
      .catch(() => alive && setOnServer(undefined));
    return () => {
      alive = false;
    };
  }, [mx, inSecretStorage]);

  if (inSecretStorage) return 'present';
  if (onServer === undefined) return 'unknown';
  return onServer ? 'present' : 'absent';
};

const useDismissed = (kind: GateKind, userId: string, deviceId: string | undefined): boolean =>
  useSyncExternalStore(
    subscribeGateDismissal,
    () => !deviceId || isGateDismissed(kind, userId, deviceId),
  );

/** What the gate and the banner both need to decide whether to show. */
export const useVerificationGateState = () => {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const deviceId = mx.getDeviceId() ?? undefined;

  const identity = useIdentityState();
  const status = useDeviceVerificationStatus(mx.getCrypto(), userId, deviceId);
  const dismissed = {
    verify: useDismissed('verify', userId, deviceId),
    setup: useDismissed('setup', userId, deviceId),
  };

  return { userId, deviceId, identity, status, dismissed };
};
