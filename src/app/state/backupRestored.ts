import { useSyncExternalStore } from 'react';
import { createPersistentFlags } from '../utils/persistentFlags';

const flags = createPersistentFlags();

// A restore is per device and per backup version: a new backup has different keys to restore.
const restoredKey = (userId: string, deviceId: string, version: string): string =>
  `key_backup_restored:${userId}:${deviceId}:${version}`;

export const isBackupRestored = (userId: string, deviceId: string, version: string): boolean =>
  flags.has(restoredKey(userId, deviceId, version));

export const markBackupRestored = (userId: string, deviceId: string, version: string): void =>
  flags.set(restoredKey(userId, deviceId, version));

export const useBackupRestored = (
  userId: string,
  deviceId: string | undefined,
  version: string | undefined,
): boolean =>
  useSyncExternalStore(flags.subscribe, () =>
    deviceId && version ? isBackupRestored(userId, deviceId, version) : false,
  );

const declinedKey = (userId: string, deviceId: string, version: string): string =>
  `key_backup_restore_declined:${userId}:${deviceId}:${version}`;

/** The user chose "Not now" when asked to restore this backup, so the question is not repeated. */
export const declineBackupRestore = (userId: string, deviceId: string, version: string): void =>
  flags.set(declinedKey(userId, deviceId, version));

export const useBackupRestoreDeclined = (
  userId: string,
  deviceId: string | undefined,
  version: string | undefined,
): boolean =>
  useSyncExternalStore(flags.subscribe, () =>
    deviceId && version ? flags.has(declinedKey(userId, deviceId, version)) : false,
  );

const baselineKey = (userId: string, deviceId: string): string =>
  `key_backup_restore_baseline:${userId}:${deviceId}`;

/** Whether this device has had its one-time baseline; nothing may be asked before that. */
export const useBackupBaselineSettled = (userId: string, deviceId: string | undefined): boolean =>
  useSyncExternalStore(flags.subscribe, () =>
    deviceId ? flags.has(baselineKey(userId, deviceId)) : false,
  );

/**
 * Called once the backup's state is known. The first time a device gets an answer, a backup it
 * can already open is treated as restored: without the question the app restores on its own as
 * soon as a device has the key, and restores from before that was recorded left no flag, so
 * asking such a device would only confuse. A device that is locked at that point is left alone,
 * so when its key arrives later it is asked. Done once per device.
 */
export const settleBackupBaseline = (
  userId: string,
  deviceId: string,
  kind: 'loading' | 'none' | 'locked' | 'restore' | 'ok',
  version: string | undefined,
): void => {
  if (kind === 'loading' || flags.has(baselineKey(userId, deviceId))) return;
  flags.set(baselineKey(userId, deviceId));
  if (kind === 'restore' && version) markBackupRestored(userId, deviceId, version);
};
