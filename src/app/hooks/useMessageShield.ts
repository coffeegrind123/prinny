import { useEffect, useState, useSyncExternalStore } from 'react';
import { MatrixClient, MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from './useMatrixClient';
import { MessageShield, messageShield } from '../utils/messageShield';

type TrustStore = {
  getVersion: () => number;
  subscribe: (listener: () => void) => () => void;
};

/**
 * A message's shield depends on who is trusted and which devices exist, and a room can show
 * hundreds of messages. They share one listener per client that bumps a version number, rather
 * than each message listening on the client itself.
 */
const trustStores = new WeakMap<MatrixClient, TrustStore>();

const trustStoreFor = (mx: MatrixClient): TrustStore => {
  const existing = trustStores.get(mx);
  if (existing) return existing;

  let version = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };

  const store: TrustStore = {
    getVersion: () => version,
    subscribe: (listener) => {
      if (listeners.size === 0) {
        mx.on(CryptoEvent.DevicesUpdated, bump);
        mx.on(CryptoEvent.UserTrustStatusChanged, bump);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          mx.removeListener(CryptoEvent.DevicesUpdated, bump);
          mx.removeListener(CryptoEvent.UserTrustStatusChanged, bump);
        }
      };
    },
  };
  trustStores.set(mx, store);
  return store;
};

/**
 * The warning to show next to an encrypted message whose sender could not be fully checked,
 * or null. It is looked up again when the message finishes decrypting and whenever trust or the
 * device list changes, since either can change the answer.
 */
export const useMessageShield = (mEvent: MatrixEvent): MessageShield | null => {
  const mx = useMatrixClient();
  const trust = trustStoreFor(mx);
  const trustVersion = useSyncExternalStore(trust.subscribe, trust.getVersion);

  const [decryptions, setDecryptions] = useState(0);
  const [shield, setShield] = useState<MessageShield | null>(null);

  useEffect(() => {
    const onDecrypted = () => setDecryptions((count) => count + 1);
    mEvent.on(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      mEvent.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [mEvent]);

  useEffect(() => {
    let alive = true;
    const crypto = mx.getCrypto();
    if (!crypto || !mEvent.isEncrypted() || mEvent.isDecryptionFailure()) {
      setShield(null);
      return undefined;
    }

    crypto
      .getEncryptionInfoForEvent(mEvent)
      .then((info) => alive && setShield(messageShield(info)))
      .catch(() => alive && setShield(null));
    return () => {
      alive = false;
    };
  }, [mx, mEvent, trustVersion, decryptions]);

  return shield;
};
