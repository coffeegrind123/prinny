import { useQuery } from '@tanstack/react-query';
import { AccountDataEvent, SecretAccountData } from '../../types/matrix/accountData';
import { useAccountData } from './useAccountData';
import { useMatrixClient } from './useMatrixClient';

export enum CrossSigningStatus {
  Unknown,
  Active,
  Inactive,
}

// The master key account data comes from the local store, so an account that hasn't synced it
// yet looks exactly like one that never set cross-signing up, and offering "Enable" there resets
// a working identity. Ask the server before calling it inactive.
export const useCrossSigningStatus = (): CrossSigningStatus => {
  const mx = useMatrixClient();
  const masterEvent = useAccountData(AccountDataEvent.CrossSigningMaster);
  const storedLocally = !!masterEvent?.getContent<SecretAccountData>();

  const { data } = useQuery({
    queryKey: ['cross-signing-keys', mx.getSafeUserId()],
    queryFn: async () => {
      const crypto = mx.getCrypto();
      if (!crypto) return null;
      // Our own user may not be tracked yet; without downloading, that reads as "no keys".
      return crypto.userHasCrossSigningKeys(mx.getSafeUserId(), true);
    },
    enabled: !storedLocally,
    staleTime: 60000,
  });

  if (storedLocally) return CrossSigningStatus.Active;
  if (typeof data !== 'boolean') return CrossSigningStatus.Unknown;
  return data ? CrossSigningStatus.Active : CrossSigningStatus.Inactive;
};

export const useCrossSigningActive = (): boolean =>
  useCrossSigningStatus() === CrossSigningStatus.Active;
