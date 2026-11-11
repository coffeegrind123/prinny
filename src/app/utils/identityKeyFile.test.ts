import { beforeAll, describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';

type Module = typeof import('./identityKeyFile');
let m: Module;

// The key-file format code reads `window.crypto` at load; Node's WebCrypto is the same API.
beforeAll(async () => {
  (globalThis as { window?: unknown }).window = {
    crypto: globalThis.crypto,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
  };
  m = await import('./identityKeyFile');
}, 30_000);

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/=+$/, '');
const seed = (n: number) => b64(new Uint8Array(32).fill(n));

const bundleFor = (n: number) => ({
  cross_signing: {
    master_key: seed(n),
    self_signing_key: seed(n + 1),
    user_signing_key: seed(n + 2),
  },
});

/** A client whose server publishes the identity whose private keys are seeds n, n+1, n+2. */
const fakeClient = async (published: number, deviceId = 'DEV') => {
  const pub = async (n: number) => m.ed25519PublicKey(seed(n));
  const key = async (n: number) => {
    const k = await pub(n);
    return { keys: { [`ed25519:${k}`]: k } };
  };
  const calls: string[] = [];
  const mx = {
    getSafeUserId: () => '@me:hs',
    getDeviceId: () => deviceId,
    http: {
      authedRequest: async () => ({
        master_keys: { '@me:hs': await key(published) },
        self_signing_keys: { '@me:hs': await key(published + 1) },
        user_signing_keys: { '@me:hs': await key(published + 2) },
      }),
    },
  } as unknown as MatrixClient;
  const crypto = {
    calls,
    exportSecretsBundle: async () => bundleFor(published),
    importSecretsBundle: async () => {
      calls.push('import');
    },
    crossSignDevice: async (id: string) => {
      calls.push(`sign:${id}`);
    },
    getCrossSigningStatus: async () => ({
      privateKeysCachedLocally: { masterKey: true, selfSigningKey: true, userSigningKey: true },
    }),
  } as unknown as CryptoApi & { calls: string[] };
  return { mx, crypto };
};

const PASSWORD = 'correct horse';
const fileFrom = async (bundle: unknown, userId = '@me:hs') =>
  (await import('../../util/cryptE2ERoomKeys')).encryptMegolmKeyFile(
    JSON.stringify({ type: m.IDENTITY_FILE_TYPE, version: 1, user_id: userId, bundle }),
    PASSWORD,
    { kdf_rounds: 1000 },
  );

describe('ed25519PublicKey', () => {
  it('derives the public key from a seed (RFC 8032 test 1)', async () => {
    const s = Buffer.from(
      '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
      'hex',
    );
    const pub = await m.ed25519PublicKey(b64(s));
    expect(Buffer.from(pub, 'base64').toString('hex')).toBe(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    );
  });
});

describe('identity key file', () => {
  it('round-trips: export, then import signs this device', async () => {
    const { mx, crypto } = await fakeClient(10);
    const file = await m.exportIdentityKeyFile(mx, crypto, PASSWORD, { kdfRounds: 1000 });
    await m.importIdentityKeyFile(mx, crypto, file, PASSWORD);
    expect(crypto.calls).toEqual(['import', 'sign:DEV']);
  });

  it("refuses another account's or a replaced identity before importing anything", async () => {
    const { mx, crypto } = await fakeClient(10);
    await expect(
      m.importIdentityKeyFile(mx, crypto, await fileFrom(bundleFor(50)), PASSWORD),
    ).rejects.toThrow(/do not match/);
    expect(crypto.calls).toEqual([]);
  });

  it('refuses a file made for a different user', async () => {
    const { mx, crypto } = await fakeClient(10);
    await expect(
      m.importIdentityKeyFile(mx, crypto, await fileFrom(bundleFor(10), '@other:hs'), PASSWORD),
    ).rejects.toThrow(/@other:hs/);
    expect(crypto.calls).toEqual([]);
  });

  it('refuses a message key file and a wrong password', async () => {
    const { mx, crypto } = await fakeClient(10);
    const { encryptMegolmKeyFile } = await import('../../util/cryptE2ERoomKeys');
    const messageKeys = await encryptMegolmKeyFile('[{"session_id":"x"}]', PASSWORD, {
      kdf_rounds: 1000,
    });
    await expect(m.importIdentityKeyFile(mx, crypto, messageKeys, PASSWORD)).rejects.toThrow(
      /message key file/,
    );
    await expect(
      m.importIdentityKeyFile(mx, crypto, await fileFrom(bundleFor(10)), 'nope'),
    ).rejects.toThrow();
    expect(crypto.calls).toEqual([]);
  });

  it('will not export keys this device holds that are not the published identity', async () => {
    const { mx } = await fakeClient(10);
    const { crypto } = await fakeClient(50);
    await expect(
      m.exportIdentityKeyFile(mx, crypto, PASSWORD, { kdfRounds: 1000 }),
    ).rejects.toThrow(/do not match/);
  });
});
