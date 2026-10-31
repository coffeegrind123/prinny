import {
  createClient,
  MatrixClient,
  IndexedDBStore,
  IndexedDBCryptoStore,
  ClientEvent,
  SyncState,
} from 'matrix-js-sdk';
import {
  AllDevicesIsolationMode,
  OnlySignedDevicesIsolationMode,
} from 'matrix-js-sdk/lib/crypto-api';

import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { getSettings } from '../app/state/settings';
import { pushSessionToSW } from '../sw-session';
import { reportClientStorageError, resetClientStorageError } from './storageStatus';
import { isTauri } from '../app/utils/desktop-notifications';
import { USER_PROFILE_FIELDS } from '../types/matrix/profile';
import { isPrivateHost } from '../app/utils/safeUrl';

type Session = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
};

/**
 * Whether a libolm crypto store is present, without touching it.
 *
 * `indexedDB.databases()` only enumerates; it never opens, creates or deletes,
 * which is the whole point -- see the note in `initClient`. It is absent in
 * older Firefox, and there the honest answer is "cannot tell", so we say yes
 * and leave the SDK to behave exactly as it did before.
 */
const legacyCryptoStoreExists = async (): Promise<boolean> => {
  const databases = await global.indexedDB?.databases?.();
  if (!databases) return true;
  return databases.some((db) => db.name === 'crypto-store');
};

const DEFAULT_CRYPTO_DB_PREFIX = 'matrix-js-sdk';
const RUST_CRYPTO_DB_SUFFIXES = ['::matrix-sdk-crypto', '::matrix-sdk-crypto-meta'];
const CRYPTO_PREFIX_STORAGE_KEY = 'app.prinny.cryptoDatabasePrefix';

const deviceCryptoPrefix = (deviceId: string) => `${DEFAULT_CRYPTO_DB_PREFIX}:${deviceId}`;

// The wasm OlmMachine refuses to open a store created for another device with this message.
const isStoreAccountMismatch = (err: unknown): boolean =>
  String(err instanceof Error ? err.message : err).includes(
    "the account in the store doesn't match the account in the constructor",
  );

const cryptoPrefixByClient = new WeakMap<MatrixClient, string>();

/**
 * Which rust crypto database a session uses.
 *
 * Normally the SDK default. A store left behind by an earlier login (a logout or the splash
 * "Logout" whose database delete was blocked by another open tab, or never awaited before the
 * reload) holds a different device's account, and the OlmMachine refuses it. Then this session
 * moves to a device-scoped database and remembers that, so later loads open it directly.
 */
const sessionCryptoPrefix = (session: Session): string | undefined => {
  const stored = localStorage.getItem(CRYPTO_PREFIX_STORAGE_KEY);
  return stored === deviceCryptoPrefix(session.deviceId) ? stored : undefined;
};

export const initClient = async (session: Session): Promise<MatrixClient> => {
  const cryptoDatabasePrefix = sessionCryptoPrefix(session);
  try {
    return await createClientWithCrypto(session, cryptoDatabasePrefix);
  } catch (err) {
    if (cryptoDatabasePrefix || !isStoreAccountMismatch(err)) throw err;

    // Nothing is deleted from the stale crypto store: its keys belong to the other device and
    // stay recoverable. Its sync cache does go, since it may be another account's rooms.
    console.warn('[crypto] crypto store belongs to another device; using a device-scoped one', err);
    const prefix = deviceCryptoPrefix(session.deviceId);
    localStorage.setItem(CRYPTO_PREFIX_STORAGE_KEY, prefix);
    return createClientWithCrypto(session, prefix);
  }
};

const createClientWithCrypto = async (
  session: Session,
  cryptoDatabasePrefix: string | undefined,
): Promise<MatrixClient> => {
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: 'web-sync-store',
  });

  /**
   * The libolm crypto store, handed to the SDK ONLY when one actually exists.
   *
   * Passing it unconditionally is what produced "Cannot read properties of
   * undefined (reading 'getMigrationState')" on load, reliably whenever another
   * tab of this app was already open, and reliably fixed by a retry. The SDK
   * has two code paths that call `legacyStore.getMigrationState()` without
   * calling `startup()` first -- `rust-crypto/index.js` after creating the
   * OlmMachine, and `migrateRoomSettingsFromLegacyCrypto` -- and `startup()` is
   * the only thing that assigns the store's `backend`. Both rely on
   * `migrateFromLegacyCrypto` having called it earlier, which it does not when
   * it takes its `containsData()` early return.
   *
   * That early return is reached, and then contradicted, because the SDK's
   * existence check opens the database WITHOUT a version: when the database is
   * absent that CREATES it, resolves false, and fires `deleteDatabase` without
   * awaiting it. A second tab holding a connection blocks that delete, so the
   * next `containsData()` -- moments later, from the call site above -- finds
   * the database still present and answers true. Early return, so no `startup()`
   * and no `backend`; then a call straight into `backend.getMigrationState()`.
   * On retry the delete has landed, both checks agree, and nothing breaks.
   *
   * So: decide for ourselves, with an enumeration that has no side effect, and
   * hand over nothing when there is nothing to migrate. Neither unguarded call
   * site can then run at all.
   *
   * NOT fixed by calling `startup()` ourselves, which was the obvious move: it
   * would create the legacy database for accounts that never had one, and the
   * first of those call sites reads `migrationState < INITIAL_OWN_KEY_QUERY_DONE`
   * as "just migrated" and runs a retry-until-success key query. Every launch,
   * for everyone, to paper over a store with nothing in it.
   */
  const LEGACY_CRYPTO_DB_NAME = 'crypto-store';
  // A device-scoped store means the default one held another device's account; the legacy
  // libolm store predates both and is migrated only into the default one.
  const legacyCryptoStore =
    !cryptoDatabasePrefix && (await legacyCryptoStoreExists())
      ? new IndexedDBCryptoStore(global.indexedDB, LEGACY_CRYPTO_DB_NAME)
      : undefined;

  const mx = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    cryptoCallbacks: cryptoCallbacks as any,
    verificationMethods: ['m.sas.v1'],
  });

  // Hand the token to the service worker as soon as we have a client for it.
  // Boot-time pushes happen before login, so on a fresh sign-in the worker would
  // otherwise hold nothing until a media fetch made it ask — and the answer to
  // that question races the login it is waiting on.
  pushSessionToSW(session.baseUrl, session.accessToken);

  // IndexedDB failing is not fatal — the SDK falls back to memory — but it is
  // invisible: the client works and then loses everything on reload. Record the
  // degradation so the UI can say so.
  resetClientStorageError();
  indexedDBStore.on('degraded', reportClientStorageError);

  await indexedDBStore.startup();
  try {
    await mx.initRustCrypto({ cryptoDatabasePrefix });
  } catch (err) {
    if (isStoreAccountMismatch(err)) {
      mx.stopClient();
      await indexedDBStore.deleteAllData();
    }
    throw err;
  }
  if (cryptoDatabasePrefix) cryptoPrefixByClient.set(mx, cryptoDatabasePrefix);

  // Apply the user's device-isolation preference. The crypto store holds this
  // only in memory, so we re-apply it on every client init from localStorage.
  const crypto = mx.getCrypto();
  if (crypto) {
    crypto.setDeviceIsolationMode(
      getSettings().onlySignedDevices
        ? new OnlySignedDevicesIsolationMode()
        : new AllDevicesIsolationMode(false),
    );
  }

  mx.setMaxListeners(50);

  // Tell the native shell which homeserver origin this session is actually
  // connected to. `cache_notification_icon` needs to know whether it may relax
  // its private-address guard — a homeserver may legitimately sit on a LAN
  // address — and it must not take that answer from the arguments of the call
  // being guarded, because those come from the page. Registering the origin once
  // here, from the session the client was constructed with, is what makes the
  // check meaningful. If this never runs the native side simply applies the
  // guard, so a web build (or a failed invoke) stays safe.
  await registerHomeserverOriginWithShell(session.baseUrl);

  return mx;
};

const registerHomeserverOriginWithShell = async (baseUrl: string): Promise<void> => {
  if (!isTauri()) return;
  // The native side uses this origin, and nothing else, to decide when it may
  // relax its private-address guard. It arrives from `.well-known` discovery,
  // which is remote-supplied, so it is validated HERE - at the boundary where it
  // gains native authority - rather than trusted because the discovery layer
  // already looked at it.
  let origin: string;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:') {
      console.warn('[shell] refusing non-https homeserver origin:', parsed.protocol);
      return;
    }
    if (parsed.username || parsed.password) {
      console.warn('[shell] refusing homeserver origin carrying credentials');
      return;
    }
    if (isPrivateHost(parsed.hostname)) {
      console.warn('[shell] refusing private/loopback homeserver origin:', parsed.hostname);
      return;
    }
    origin = parsed.origin;
  } catch {
    console.warn('[shell] refusing unparseable homeserver origin');
    return;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_homeserver_origin', { origin });
  } catch (err) {
    // Non-fatal: the native side falls back to enforcing the guard.
    console.warn('[shell] set_homeserver_origin failed:', err);
  }
};

// The SDK checks the server's key backup once, from the RustCrypto constructor, before the
// client starts. If that request fails (autostart at login, before the network is up) nothing
// retries it, so backup upload and restore stay off for the whole session. Check again once
// the first sync has gone through.
const recheckKeyBackupAfterInitialSync = (mx: MatrixClient): void => {
  const onSync = (state: SyncState) => {
    if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
    mx.removeListener(ClientEvent.Sync, onSync);
    mx.getCrypto()
      ?.checkKeyBackupAndEnable()
      .catch((err) => {
        console.warn('[crypto] key backup re-check after initial sync failed:', err);
      });
  };
  mx.on(ClientEvent.Sync, onSync);
};

export const startClient = async (mx: MatrixClient) => {
  recheckKeyBackupAfterInitialSync(mx);
  await mx.startClient({
    lazyLoadMembers: true,
    // MSC4133 extended profile fields, delivered through /sync per MSC4429.
    // Pronouns, banner, biography and rich presence all ride this one list —
    // asking for them costs a field name each, and a homeserver that supports
    // neither MSC simply never sends them, so the UI renders nothing rather
    // than erroring.
    unstableMSC4429SyncUserProfileFields: USER_PROFILE_FIELDS,
  });
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve) => {
    const req = window.indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    // A connection still open in this page (the store handle of the attempt that hit the
    // mismatch) blocks the delete until the reload that follows closes it; don't wait for that.
    req.onblocked = () => resolve();
  });

/**
 * Delete this client's sync and crypto stores, including a device-scoped crypto store and the
 * stale default one it was moved away from.
 */
export const clearClientStores = async (mx: MatrixClient): Promise<void> => {
  const cryptoDatabasePrefix = cryptoPrefixByClient.get(mx);
  await mx.clearStores({ cryptoDatabasePrefix });
  if (cryptoDatabasePrefix) {
    await Promise.all(
      RUST_CRYPTO_DB_SUFFIXES.map((suffix) => deleteDatabase(DEFAULT_CRYPTO_DB_PREFIX + suffix)),
    );
  }
};

export const logoutClient = async (mx: MatrixClient) => {
  pushSessionToSW();
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await clearClientStores(mx);
  window.localStorage.clear();
  window.location.reload();
};

export const clearLoginData = async () => {
  const dbs = await window.indexedDB.databases();

  dbs.forEach((idbInfo) => {
    const { name } = idbInfo;
    if (name) {
      window.indexedDB.deleteDatabase(name);
    }
  });

  window.localStorage.clear();
  window.location.reload();
};
