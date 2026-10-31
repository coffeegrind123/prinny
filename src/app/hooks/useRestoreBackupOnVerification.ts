import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { backupRestoreProgressAtom } from '../state/backupRestore';
import { useMatrixClient } from './useMatrixClient';
import { useKeyBackupDecryptionKeyCached } from './useKeyBackup';
import { restoreKeyBackupAndRecord } from '../utils/backupRestore';

export const useRestoreBackupOnVerification = () => {
  const setRestoreProgress = useSetAtom(backupRestoreProgressAtom);

  const mx = useMatrixClient();

  useKeyBackupDecryptionKeyCached(
    useCallback(() => {
      const crypto = mx.getCrypto();
      if (!crypto) return;

      restoreKeyBackupAndRecord(
        crypto,
        mx.getSafeUserId(),
        mx.getDeviceId() ?? undefined,
        setRestoreProgress,
      ).catch((err) => console.error('[backup] automatic restore failed', err));
    }, [mx, setRestoreProgress]),
  );
};
