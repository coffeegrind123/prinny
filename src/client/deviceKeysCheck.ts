import { useSyncExternalStore } from 'react';
import { ClientEvent, MatrixClient, Method, SyncState } from 'matrix-js-sdk';

/**
 * Does the homeserver hold this session's encryption keys?
 *
 * A session can lose its crypto store and keep its login: the rust crypto store gone while the
 * access token and device ID survive. The SDK then creates a new account, with new identity
 * keys, for a device ID the server already has keys for. What happens next depends on the
 * server, both measured:
 *
 * - Conduit keeps the old keys and ignores the upload. Everyone keeps encrypting to keys this
 *   session no longer has, so every new message fails to decrypt here, and an emoji
 *   verification fails at the MAC step with m.mismatched_sas after both sides pressed
 *   "They Match". This check catches that case.
 * - Synapse (1.164) overwrites them. The server then agrees with this session, but the other
 *   devices keep the keys they cached, so verification fails the same way. Only the other side
 *   can see that, which `otherDeviceKeysChanged` does.
 *
 * The SDK cannot report either: `getUserDeviceInfo` answers for our own device from the local
 * account, so the server has to be asked directly.
 */
export enum DeviceKeysState {
  Match = 'match',
  Mismatch = 'mismatch',
  NotUploaded = 'notUploaded',
}

export type IdentityKeys = { ed25519: string; curve25519: string };

export const compareDeviceKeys = (
  deviceId: string,
  local: IdentityKeys,
  serverKeys: Record<string, string> | undefined,
): DeviceKeysState => {
  const ed25519 = serverKeys?.[`ed25519:${deviceId}`];
  const curve25519 = serverKeys?.[`curve25519:${deviceId}`];
  if (!ed25519 && !curve25519) return DeviceKeysState.NotUploaded;
  return ed25519 === local.ed25519 && curve25519 === local.curve25519
    ? DeviceKeysState.Match
    : DeviceKeysState.Mismatch;
};

type KeysQueryResponse = {
  device_keys?: Record<string, Record<string, { keys?: Record<string, string> }>>;
};

/** The keys the homeserver serves for one device, straight from `/keys/query`. */
export const fetchServerDeviceKeys = async (
  mx: MatrixClient,
  userId: string,
  deviceId: string,
): Promise<Record<string, string> | undefined> => {
  const response = await mx.http.authedRequest<KeysQueryResponse>(
    Method.Post,
    '/keys/query',
    undefined,
    { device_keys: { [userId]: [deviceId] } },
  );
  return response.device_keys?.[userId]?.[deviceId]?.keys;
};

/**
 * Whether another device's keys on the server differ from the ones this device has cached for
 * it. `undefined` when either side is unknown.
 */
export const otherDeviceKeysChanged = async (
  mx: MatrixClient,
  userId: string,
  deviceId: string,
): Promise<boolean | undefined> => {
  const crypto = mx.getCrypto();
  if (!crypto) return undefined;
  try {
    const cached = (await crypto.getUserDeviceInfo([userId], false)).get(userId)?.get(deviceId);
    const ed25519 = cached?.getFingerprint();
    const curve25519 = cached?.getIdentityKey();
    if (!ed25519 || !curve25519) return undefined;

    const state = compareDeviceKeys(
      deviceId,
      { ed25519, curve25519 },
      await fetchServerDeviceKeys(mx, userId, deviceId),
    );
    if (state === DeviceKeysState.NotUploaded) return undefined;
    return state === DeviceKeysState.Mismatch;
  } catch (err) {
    console.warn('[crypto] could not compare cached and server keys', { userId, deviceId }, err);
    return undefined;
  }
};

// The first check can run before the new account's keys are uploaded; look again once.
const RECHECK_NOT_UPLOADED_MS = 60_000;

let mismatch = false;
const listeners = new Set<() => void>();

const setMismatch = (value: boolean) => {
  if (mismatch === value) return;
  mismatch = value;
  listeners.forEach((listener) => listener());
};

const checkNow = async (mx: MatrixClient): Promise<DeviceKeysState | undefined> => {
  const crypto = mx.getCrypto();
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!crypto || !userId || !deviceId) return undefined;

  const local = await crypto.getOwnDeviceKeys();
  const server = await fetchServerDeviceKeys(mx, userId, deviceId);
  const state = compareDeviceKeys(deviceId, local, server);
  if (state === DeviceKeysState.Mismatch) {
    console.error('[crypto] this session holds keys the homeserver does not have for it', {
      deviceId,
      local,
      server,
    });
  }
  setMismatch(state === DeviceKeysState.Mismatch);
  return state;
};

/** Check this session's keys against the server once the first sync is through. */
export const watchOwnDeviceKeys = (mx: MatrixClient): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  setMismatch(false);

  const run = () => {
    checkNow(mx)
      .then((state) => {
        if (state === DeviceKeysState.NotUploaded && !stopped && !timer) {
          timer = setTimeout(run, RECHECK_NOT_UPLOADED_MS);
        }
      })
      .catch((err) => console.warn('[crypto] own device key check failed', err));
  };

  const onSync = (state: SyncState) => {
    if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
    mx.removeListener(ClientEvent.Sync, onSync);
    run();
  };
  mx.on(ClientEvent.Sync, onSync);

  return () => {
    stopped = true;
    mx.removeListener(ClientEvent.Sync, onSync);
    if (timer) clearTimeout(timer);
  };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => mismatch;

export const useOwnDeviceKeysMismatch = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
