import { useCallback, useState } from 'react';
import { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from './useMatrixClient';
import { AsyncState, AsyncStatus, useAsync } from './useAsyncCallback';
import { verificationClockWarning } from '../utils/clockSkew';

/**
 * Asks our other signed-in devices to verify this one. The clock is checked first because the
 * other side silently drops a request stamped too far from its own time, which looks like a
 * hang. Shared by the settings tile and the post-login verification step.
 */
export const useRequestOwnVerification = () => {
  const mx = useMatrixClient();
  const [requestState, setRequestState] = useState<AsyncState<VerificationRequest, Error>>({
    status: AsyncStatus.Idle,
  });

  const request = useAsync<VerificationRequest, Error, []>(
    useCallback(async () => {
      const crypto = mx.getCrypto();
      if (!crypto) throw new Error('Unexpected Error! Crypto object not found.');
      const clockWarning = await verificationClockWarning(mx);
      if (clockWarning) throw new Error(clockWarning);
      return crypto.requestOwnUserVerification();
    }, [mx]),
    setRequestState,
  );

  const reset = useCallback(() => {
    setRequestState({ status: AsyncStatus.Idle });
  }, []);

  return { requestState, request, reset };
};
