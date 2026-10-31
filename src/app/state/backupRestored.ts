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
