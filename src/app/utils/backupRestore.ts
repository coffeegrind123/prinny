import {
  CryptoApi,
  ImportRoomKeyProgressData,
  KeyBackupRestoreResult,
} from 'matrix-js-sdk/lib/crypto-api';
import { markBackupRestored } from '../state/backupRestored';

/**
 * Restores the key backup and remembers that this device has done it for that backup version,
 * so the settings page stops asking for it. Used by the automatic restore after verifying and
 * by the manual button, so both count.
 */
export const restoreKeyBackupAndRecord = async (
  crypto: CryptoApi,
  userId: string,
  deviceId: string | undefined,
  onProgress?: (progress: ImportRoomKeyProgressData) => void,
): Promise<KeyBackupRestoreResult> => {
  const result = await crypto.restoreKeyBackup({ progressCallback: onProgress });

  const version =
    (await crypto.getActiveSessionBackupVersion()) ?? (await crypto.getKeyBackupInfo())?.version;
  if (version && deviceId) markBackupRestored(userId, deviceId, version);

  return result;
};
