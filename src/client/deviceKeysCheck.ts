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

export type DeviceKeysChange = { at: number; from: string; to: string };

/**
 * The identity keys this device ID has started with, kept in localStorage beside the login.
 *
 * A device's keys never change while its crypto store survives, so a change under the same device
 * ID means the store was lost and the SDK made a new account. Recorded locally because no server
 * reports it: Conduit keeps the old keys (which `compareDeviceKeys` catches) but Synapse
 * overwrites them, and then only this record shows it happened, and when.
 */
export type DeviceKeysHistory = IdentityKeys & { since: number; changes: DeviceKeysChange[] };

export const MAX_DEVICE_KEY_CHANGES = 10;

export const recordDeviceKeys = (
  history: DeviceKeysHistory | undefined,
  keys: IdentityKeys,
  now: number,
): DeviceKeysHistory => {
  if (!history) return { ...keys, since: now, changes: [] };
  if (history.ed25519 === keys.ed25519 && history.curve25519 === keys.curve25519) return history;

  const change = { at: now, from: history.ed25519, to: keys.ed25519 };
  return {
    ...keys,
    since: now,
    changes: [...history.changes, change].slice(-MAX_DEVICE_KEY_CHANGES),
  };
};

const isString = (value: unknown): value is string => typeof value === 'string';

const isChange = (value: unknown): value is DeviceKeysChange => {
  const change = value as Partial<DeviceKeysChange> | null;
  return (
    typeof change === 'object' &&
    change !== null &&
    typeof change.at === 'number' &&
    isString(change.from) &&
    isString(change.to)
  );
};

export const parseDeviceKeysHistory = (raw: string | null): DeviceKeysHistory | undefined => {
  if (!raw) return undefined;
  let value: Partial<DeviceKeysHistory>;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    !value ||
    !isString(value.ed25519) ||
    !isString(value.curve25519) ||
    typeof value.since !== 'number' ||
    !Array.isArray(value.changes) ||
    !value.changes.every(isChange)
  ) {
    return undefined;
  }
  return {
    ed25519: value.ed25519,
    curve25519: value.curve25519,
    since: value.since,
    changes: value.changes,
  };
};

const historyStorageKey = (userId: string, deviceId: string) =>
  `app.prinny.deviceKeysHistory:${userId}:${deviceId}`;

const readHistory = (key: string): DeviceKeysHistory | undefined => {
  try {
    return parseDeviceKeysHistory(localStorage.getItem(key));
  } catch {
    return undefined;
  }
};

const writeHistory = (key: string, history: DeviceKeysHistory) => {
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch (err) {
    console.warn('[crypto] could not store the device key history', err);
  }
};

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

/** What is known about this session's own keys, for the banner, the gate and Diagnostics. */
export type OwnDeviceKeysReport = {
  /** The server's answer, once asked. */
  state?: DeviceKeysState;
  checkedAt?: number;
  local?: IdentityKeys;
  /** The identity keys the server serves for this device, when it has any. */
  server?: Partial<IdentityKeys>;
  history?: DeviceKeysHistory;
};

let report: OwnDeviceKeysReport = {};
const listeners = new Set<() => void>();

const updateReport = (next: OwnDeviceKeysReport) => {
  report = next;
  listeners.forEach((listener) => listener());
};

/**
 * Whether this session's keys are known to differ from the ones its device ID had before:
 * the server holds others, or this device started with others since it was first seen here.
 */
export const ownDeviceKeysLost = (current: OwnDeviceKeysReport): boolean =>
  current.state === DeviceKeysState.Mismatch || (current.history?.changes.length ?? 0) > 0;

const recordOwnKeys = async (mx: MatrixClient) => {
  const crypto = mx.getCrypto();
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!crypto || !userId || !deviceId) return;

  const local = await crypto.getOwnDeviceKeys();
  const key = historyStorageKey(userId, deviceId);
  const before = readHistory(key);
  const history = recordDeviceKeys(before, local, Date.now());
  if (history !== before) writeHistory(key, history);
  if (before && history !== before) {
    console.error('[crypto] this device started with other identity keys than before', {
      deviceId,
      before: { ed25519: before.ed25519, curve25519: before.curve25519 },
      now: local,
    });
  }
  updateReport({ ...report, local, history });
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
  updateReport({
    ...report,
    state,
    checkedAt: Date.now(),
    local,
    server: server && {
      ed25519: server[`ed25519:${deviceId}`],
      curve25519: server[`curve25519:${deviceId}`],
    },
  });
  return state;
};

/** Check this session's keys against the server once the first sync is through. */
export const watchOwnDeviceKeys = (mx: MatrixClient): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  updateReport({});
  recordOwnKeys(mx).catch((err) => console.warn('[crypto] could not record own device keys', err));

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
const getSnapshot = () => report;

export const useOwnDeviceKeysReport = (): OwnDeviceKeysReport =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const getOwnDeviceKeysReport = (): OwnDeviceKeysReport => report;

export const useOwnDeviceKeysMismatch = (): boolean =>
  useOwnDeviceKeysReport().state === DeviceKeysState.Mismatch;
