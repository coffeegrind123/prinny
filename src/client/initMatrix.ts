import {
  createClient,
  MatrixClient,
  IndexedDBStore,
  IndexedDBCryptoStore,
  MemoryStore,
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
import {
  reportClientStorageError,
  reportSyncCacheUnavailable,
  resetClientStorageError,
} from './storageStatus';
import { isTauri } from '../app/utils/desktop-notifications';
import { USER_PROFILE_FIELDS } from '../types/matrix/profile';
import { isPrivateHost } from '../app/utils/safeUrl';
import { trackClockSkew } from '../app/utils/clockSkew';
import { watchOwnDeviceKeys } from './deviceKeysCheck';
import { compactServerAcls } from './compactServerAcl';
import { disposeSyncStorePersistence, installSyncStorePersistence } from './syncStorePersistence';
import { ensureCallNotificationRule } from '../app/utils/callNotificationRule';

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

const SYNC_STORE_NAME = 'web-sync-store';
// IndexedDBStore prefixes the name it is given; this is the database it actually opens.
const SYNC_STORE_DB_NAME = `matrix-js-sdk:${SYNC_STORE_NAME}`;

const createSyncStore = (): IndexedDBStore =>
  new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: SYNC_STORE_NAME,
  });

/**
 * Delete the sync cache database and nothing else. It only holds what the server sends again on
 * the next sync; the crypto stores beside it hold this device's keys and are never touched.
 * When another tab keeps the database open, this rejects, or with `onBlocked` reports it and
 * keeps waiting for that tab to close.
 */
const deleteSyncStoreDatabase = (onBlocked?: () => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = global.indexedDB.deleteDatabase(SYNC_STORE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`Could not delete ${SYNC_STORE_DB_NAME}`));
    req.onblocked = () => {
      if (onBlocked) onBlocked();
      else reject(new Error(`${SYNC_STORE_DB_NAME} is open in another tab`));
    };
  });

/**
 * Open the sync cache. `startup()` reads the cached sync without the SDK's degrade-to-memory
 * fallback, so an unreadable row ("selectQuery failed for sync", or a row that reads back as
 * null) used to fail every launch, and the only way out was Logout, which deletes the keys.
 * Rebuild the cache once; if that fails too, run on memory and say so.
 */
const startSyncStore = async (mx: MatrixClient, store: IndexedDBStore): Promise<void> => {
  try {
    await store.startup();
    return;
  } catch (err) {
    console.error('[storage] sync cache is unreadable; rebuilding it from the server', err);
  }

  let current = store;
  try {
    // Our own connection would block the delete.
    await current.destroy();
    await deleteSyncStoreDatabase();
    current = createSyncStore();
    current.on('degraded', reportClientStorageError);
    mx.store = current;
    await current.startup();
  } catch (err) {
    console.error('[storage] sync cache still unusable; running without it', err);
    await current.destroy().catch(() => undefined);
    mx.store = new MemoryStore({ localStorage: global.localStorage });
    reportSyncCacheUnavailable(err instanceof Error ? err : new Error(String(err)));
  }
};

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
  const indexedDBStore = createSyncStore();

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

  await startSyncStore(mx, indexedDBStore);
  try {
    await mx.initRustCrypto({ cryptoDatabasePrefix });
  } catch (err) {
    if (isStoreAccountMismatch(err)) {
      disposeSyncStorePersistence(mx);
      mx.stopClient();
      await mx.store.deleteAllData();
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

// Push rules arrive with the first sync; see callNotificationRule for why this rule exists.
const installCallNotificationRuleAfterInitialSync = (mx: MatrixClient): void => {
  const onSync = (state: SyncState) => {
    if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
    mx.removeListener(ClientEvent.Sync, onSync);
    ensureCallNotificationRule(mx).catch((err) => {
      console.warn('[push] could not install the call notification rule:', err);
    });
  };
  mx.on(ClientEvent.Sync, onSync);
};

export const startClient = async (mx: MatrixClient) => {
  recheckKeyBackupAfterInitialSync(mx);
  installCallNotificationRuleAfterInitialSync(mx);
  trackClockSkew(mx);
  watchOwnDeviceKeys(mx);
  compactServerAcls(mx);
  await mx.startClient({
    lazyLoadMembers: true,
    // MSC4133 extended profile fields, delivered through /sync per MSC4429.
    // Pronouns, banner, biography and rich presence all ride this one list —
    // asking for them costs a field name each, and a homeserver that supports
    // neither MSC simply never sends them, so the UI renders nothing rather
    // than erroring.
    unstableMSC4429SyncUserProfileFields: USER_PROFILE_FIELDS,
  });
  installSyncStorePersistence(mx);
};

// A MemoryStore's deleteAllData() never reaches IndexedDB, so the database it stood in for is
// deleted directly; otherwise the next load would open the same cache again.
const deleteSyncStoreOnMemoryFallback = async (mx: MatrixClient): Promise<void> => {
  if (mx.store instanceof IndexedDBStore) return;
  await deleteSyncStoreDatabase().catch((err) => {
    console.warn('[storage] could not delete the sync cache database', err);
  });
};

const CLEAR_CACHE_BLOCKED_AFTER_MS = 5000;

export const CLEAR_CACHE_BLOCKED_MESSAGE =
  'Another Prinny tab or window still has the cache open. Close it and the cache clears and ' +
  'reloads; reloading this one first waits for it too.';

/**
 * `onBlocked` runs when another tab or window keeps the cache open. The delete stays queued
 * until that one closes, and the reload follows it then. The SDK only logs a blocked delete and
 * its promise never settles, so without this the button did nothing, silently, for as long as
 * the other tab stayed open.
 */
export const clearCacheAndReload = async (mx: MatrixClient, onBlocked?: () => void) => {
  disposeSyncStorePersistence(mx);
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());

  let reported = false;
  const reportBlocked = () => {
    if (reported) return;
    reported = true;
    onBlocked?.();
  };
  const blockedTimer = window.setTimeout(reportBlocked, CLEAR_CACHE_BLOCKED_AFTER_MS);
  try {
    await mx.store.deleteAllData();
    if (!(mx.store instanceof IndexedDBStore)) {
      await deleteSyncStoreDatabase(reportBlocked).catch((err) => {
        console.warn('[storage] could not delete the sync cache database', err);
      });
    }
  } finally {
    window.clearTimeout(blockedTimer);
  }
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
  disposeSyncStorePersistence(mx);
  const cryptoDatabasePrefix = cryptoPrefixByClient.get(mx);
  await mx.clearStores({ cryptoDatabasePrefix });
  await deleteSyncStoreOnMemoryFallback(mx);
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
