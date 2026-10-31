import { useCallback } from 'react';
import { useMatrixClient } from './useMatrixClient';
import { AsyncStatus, useAsyncCallback } from './useAsyncCallback';
import { storePrivateKey } from '../../client/secretStorageKeys';
import { restoreCrossSigningFromSecretStorage } from '../utils/matrix-crypto';

/**
 * Verifies this device with a decoded recovery key and loads the backup key, so the settings
 * tile and the post-login verification step run the same, reset-free steps.
 */
export const useVerifyWithRecoveryKey = (secretStorageKeyId: string) => {
  const mx = useMatrixClient();

  const [verifyState, verify] = useAsyncCallback<void, Error, [Uint8Array]>(
    useCallback(
      async (recoveryKey: Uint8Array) => {
        const crypto = mx.getCrypto();
        if (!crypto) {
          throw new Error('Unexpected Error! Crypto object not found.');
        }

        storePrivateKey(secretStorageKeyId, recoveryKey);

        await restoreCrossSigningFromSecretStorage(mx, crypto);
        await crypto.bootstrapSecretStorage({});

        await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      },
      [mx, secretStorageKeyId],
    ),
  );

  return { verifyState, verify, verifying: verifyState.status === AsyncStatus.Loading };
};
