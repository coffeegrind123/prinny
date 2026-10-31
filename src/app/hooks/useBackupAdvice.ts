import { CryptoApi, KeyBackupInfo } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from './useMatrixClient';
import { useKeyBackupInfo, useKeyBackupTrust } from './useKeyBackup';
import { useBackupRestored } from '../state/backupRestored';
import { BackupAdvice, backupAdvice } from '../utils/backupAdvice';

/** What this device's key backup needs, as the restore question sees it. */
export const useBackupAdvice = (
  crypto: CryptoApi,
): { info: KeyBackupInfo | null | undefined; advice: BackupAdvice } => {
  const mx = useMatrixClient();
  const info = useKeyBackupInfo(crypto);
  const trust = useKeyBackupTrust(crypto, info);
  const restored = useBackupRestored(
    mx.getSafeUserId(),
    mx.getDeviceId() ?? undefined,
    info?.version,
  );

  return { info, advice: backupAdvice(info, trust, restored) };
};
