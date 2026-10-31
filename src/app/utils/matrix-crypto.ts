import { MatrixClient } from 'matrix-js-sdk';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';

export const verifiedDevice = async (
  api: CryptoApi,
  userId: string,
  deviceId: string,
): Promise<boolean | null> => {
  const status = await api.getDeviceVerificationStatus(userId, deviceId);

  if (!status) return null;

  const verified = status.crossSigningVerified;
  return verified;
};

const CROSS_SIGNING_SECRETS = [
  'm.cross_signing.master',
  'm.cross_signing.self_signing',
  'm.cross_signing.user_signing',
] as const;

// `bootstrapCrossSigning({})` mints a new identity and writes it to secret storage, before
// uploading it, whenever any of the three private keys can't be read from 4S. Account data that
// hasn't synced yet, or a 4S written by a client that never stored one of the keys, reads as
// missing, so on the verify path that silently replaces the identity and clobbers 4S. Check
// first, and make any upload attempt fail so a reset can never get through here.
export const restoreCrossSigningFromSecretStorage = async (
  mx: MatrixClient,
  crypto: CryptoApi,
): Promise<void> => {
  const status = await crypto.getCrossSigningStatus();
  const cached = status.privateKeysCachedLocally;
  const cachedLocally = cached.masterKey && cached.selfSigningKey && cached.userSigningKey;

  if (!cachedLocally) {
    const storedKeys = await Promise.all(
      CROSS_SIGNING_SECRETS.map((secretName) => mx.secretStorage.get(secretName)),
    );

    if (storedKeys.some((key) => !key)) {
      throw new Error(
        'Could not read your cross-signing keys from secret storage. Wait for the sync to finish and try again.',
      );
    }
  }

  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async () => {
      throw new Error('Refusing to replace your cross-signing identity to verify this device.');
    },
  });
};
