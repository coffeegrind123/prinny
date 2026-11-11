import { MatrixClient, Method } from 'matrix-js-sdk';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { decryptMegolmKeyFile, encryptMegolmKeyFile } from '../../util/cryptE2ERoomKeys';

/**
 * A self-held copy of the account's identity: the three cross-signing private keys (and the
 * message backup key when this device has it), from the SDK's secrets bundle. Kept in the same
 * password-protected format as an exported message key file, wrapped so the two cannot be mixed
 * up and so the file says whose identity it is.
 *
 * The SDK checks nothing on import. Measured against Conduit: importing another account's bundle
 * into a session made that session's local identity the other account's, silently, while the
 * server still published its own. So both directions check the keys against the identity the
 * server publishes for this account first.
 */
export const IDENTITY_FILE_TYPE = 'app.prinny.identity_keys';

type CrossSigningSeeds = { master_key: string; self_signing_key: string; user_signing_key: string };
type SecretsBundle = { cross_signing: CrossSigningSeeds; backup?: unknown };

type IdentityFile = {
  type: typeof IDENTITY_FILE_TYPE;
  version: 1;
  user_id: string;
  bundle: SecretsBundle;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBundle = (value: unknown): value is SecretsBundle => {
  if (!isRecord(value) || !isRecord(value.cross_signing)) return false;
  const keys = value.cross_signing;
  return (
    typeof keys.master_key === 'string' &&
    typeof keys.self_signing_key === 'string' &&
    typeof keys.user_signing_key === 'string'
  );
};

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const fromBase64 = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const toUnpaddedBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/=+$/, '');

/**
 * The public key (unpadded base64, as Matrix key IDs are) of an Ed25519 private key given as its
 * 32-byte seed. Uses WebCrypto: the seed is wrapped as PKCS#8 and read back as a JWK, whose `x` is
 * the public key.
 */
export const ed25519PublicKey = async (seedB64: string): Promise<string> => {
  const seed = fromBase64(seedB64);
  if (seed.length !== 32) throw new Error('An identity key in this file is malformed.');
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  if (!jwk.x) throw new Error('Could not read an identity key.');
  return toUnpaddedBase64(fromBase64(jwk.x));
};

type PublishedKeys = { master?: string; selfSigning?: string; userSigning?: string };

const firstKey = (entry: unknown): string | undefined => {
  if (!isRecord(entry) || !isRecord(entry.keys)) return undefined;
  const value = Object.values(entry.keys)[0];
  return typeof value === 'string' ? value : undefined;
};

/** The cross-signing public keys the server publishes for this account, fetched fresh. */
const publishedCrossSigningKeys = async (mx: MatrixClient): Promise<PublishedKeys> => {
  const userId = mx.getSafeUserId();
  const res = await mx.http.authedRequest<Record<string, Record<string, unknown> | undefined>>(
    Method.Post,
    '/keys/query',
    undefined,
    { device_keys: { [userId]: [] } },
  );
  return {
    master: firstKey(res.master_keys?.[userId]),
    selfSigning: firstKey(res.self_signing_keys?.[userId]),
    userSigning: firstKey(res.user_signing_keys?.[userId]),
  };
};

const MISMATCH =
  'These identity keys do not match the identity your account publishes. They belong to another account, or to an identity that has since been reset.';

/** Throws unless all three keys are the ones the server publishes for this account. */
const assertPublishedIdentity = async (mx: MatrixClient, keys: CrossSigningSeeds) => {
  const published = await publishedCrossSigningKeys(mx);
  if (!published.master) {
    throw new Error('Your account has no published identity to match these keys against.');
  }
  const [master, selfSigning, userSigning] = await Promise.all([
    ed25519PublicKey(keys.master_key),
    ed25519PublicKey(keys.self_signing_key),
    ed25519PublicKey(keys.user_signing_key),
  ]);
  if (
    master !== published.master ||
    selfSigning !== published.selfSigning ||
    userSigning !== published.userSigning
  ) {
    throw new Error(MISMATCH);
  }
};

type ExportOptions = {
  /** PBKDF2 rounds for the file key; only tests lower it. */
  kdfRounds?: number;
};

/** The identity as a password-protected file. Anyone with the file and its password is the account. */
export const exportIdentityKeyFile = async (
  mx: MatrixClient,
  crypto: CryptoApi,
  password: string,
  options: ExportOptions = {},
): Promise<ArrayBuffer> => {
  const { privateKeysCachedLocally: held } = await crypto.getCrossSigningStatus();
  if (!(held.masterKey && held.selfSigningKey && held.userSigningKey)) {
    throw new Error('This device does not hold your identity keys, so it cannot export them.');
  }
  const bundle = (await crypto.exportSecretsBundle?.()) as unknown;
  if (!isBundle(bundle)) {
    throw new Error('This version of the encryption library cannot export identity keys.');
  }
  await assertPublishedIdentity(mx, bundle.cross_signing);

  const file: IdentityFile = {
    type: IDENTITY_FILE_TYPE,
    version: 1,
    user_id: mx.getSafeUserId(),
    bundle,
  };
  return encryptMegolmKeyFile(
    JSON.stringify(file),
    password,
    options.kdfRounds ? { kdf_rounds: options.kdfRounds } : undefined,
  );
};

/**
 * Imports a file made by `exportIdentityKeyFile` after checking it is this account's current
 * identity, then signs this device with it so it becomes verified. Nothing is changed when any
 * check fails.
 */
export const importIdentityKeyFile = async (
  mx: MatrixClient,
  crypto: CryptoApi,
  data: ArrayBuffer,
  password: string,
): Promise<void> => {
  const deviceId = mx.getDeviceId();
  if (!deviceId) throw new Error('This session has no device ID.');
  if (!crypto.importSecretsBundle) {
    throw new Error('This version of the encryption library cannot import identity keys.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await decryptMegolmKeyFile(data, password));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error('This file is not an identity key file.', { cause: err });
    }
    throw err;
  }
  if (Array.isArray(parsed)) {
    throw new Error('This is a message key file. Import it under Import Messages Data.');
  }
  // Files from the fork this feature came from hold the bare bundle.
  const file = isRecord(parsed) && parsed.type === IDENTITY_FILE_TYPE ? parsed : undefined;
  const bundle = file ? file.bundle : parsed;
  if (!isBundle(bundle)) throw new Error('This file does not contain identity keys.');
  if (file && file.user_id !== mx.getSafeUserId()) {
    throw new Error(`This file holds the identity of ${String(file.user_id)}, not this account.`);
  }

  await assertPublishedIdentity(mx, bundle.cross_signing);
  await crypto.importSecretsBundle(bundle as never);
  // The bundle installs the identity but does not sign this device.
  await crypto.crossSignDevice(deviceId);
};
