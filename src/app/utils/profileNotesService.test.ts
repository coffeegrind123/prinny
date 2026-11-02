import { EventEmitter } from 'node:events';
import { MatrixClient } from 'matrix-js-sdk';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSecretStorageKeys, cryptoCallbacks } from '../../client/secretStorageKeys';
import {
  LostReason,
  NeedsRecoveryKeyError,
  NotesLostError,
  ProfileNotesService,
} from './profileNotesService';
import {
  ADK_SECRET_NAME,
  ADK_SECRET_NAMES,
  ADK_SECRET_NAME_UNSTABLE,
  PROFILE_ANNOTATIONS_TYPE,
  PROFILE_ANNOTATIONS_TYPES,
  PROFILE_ANNOTATIONS_TYPE_UNSTABLE,
  decryptAnnotations,
  encryptAnnotations,
  generateAdk,
  getEncryptedPayload,
  readNote,
} from './profileNotes';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
});
vi.spyOn(console, 'info').mockImplementation(() => undefined);
vi.spyOn(console, 'warn').mockImplementation(() => undefined);
afterAll(() => vi.unstubAllGlobals());

const RECOVERY_KEY = new Uint8Array(32).fill(7);

type Content = Record<string, any>;

/** The parts of a homeserver the service touches: account data and 4S. */
class FakeServer {
  data = new Map<string, Content>();

  defaultKey: string | null = null;

  private emitters: EventEmitter[] = [];

  private seq = 0;

  client(): MatrixClient {
    const emitter = new EventEmitter();
    this.emitters.push(emitter);
    const event = (type: string, content: Content) => ({
      getType: () => type,
      getContent: () => content,
    });
    const mx = {
      getSafeUserId: () => '@me:hs',
      on: (name: string, fn: (...args: unknown[]) => void) => emitter.on(name, fn),
      removeListener: (name: string, fn: (...args: unknown[]) => void) =>
        emitter.removeListener(name, fn),
      getAccountData: (type: string) =>
        this.data.has(type) ? event(type, this.data.get(type) as Content) : undefined,
      setAccountData: async (type: string, content: Content) => {
        this.data.set(type, content);
        this.emitters.forEach((e) => e.emit('accountData', event(type, content)));
      },
      secretStorage: {
        getDefaultKeyId: async () => this.defaultKey,
        isStored: async (name: string) => {
          const content = this.data.get(name);
          return content
            ? Object.fromEntries(Object.keys(content.encrypted).map((k) => [k, {}]))
            : null;
        },
        get: async (name: string) => {
          const content = this.data.get(name) as Content;
          const keyId = Object.keys(content.encrypted)[0];
          const key = await cryptoCallbacks.getSecretStorageKey({ keys: { [keyId]: {} } });
          if (!key) {
            throw new Error('getSecretStorageKey callback returned falsey');
          }
          return content.encrypted[keyId].secret;
        },
        store: async (name: string, secret: string, keys: string[]) => {
          this.seq += 1;
          await mx.setAccountData(name, {
            encrypted: Object.fromEntries(
              keys.map((k) => [k, { ciphertext: `ct${this.seq}`, secret }]),
            ),
          });
        },
      },
    };
    return mx as unknown as MatrixClient;
  }
}

const loaded = async (service: ProfileNotesService) => {
  await service.refresh();
  return service.getState();
};

beforeEach(() => {
  storage.clear();
  clearSecretStorageKeys();
});

describe('without secret storage', () => {
  it('writes plaintext to both types', async () => {
    const server = new FakeServer();
    const service = new ProfileNotesService(server.client());
    expect(await loaded(service)).toEqual({ kind: 'ready', annotations: {}, encrypted: false });

    await service.saveNote('@bob:hs', 'hello', undefined);
    const expected = { '@bob:hs': { 'm.text': [{ body: 'hello' }] } };
    expect(server.data.get(PROFILE_ANNOTATIONS_TYPE)).toEqual(expected);
    expect(server.data.get(PROFILE_ANNOTATIONS_TYPE_UNSTABLE)).toEqual(expected);
  });

  it('reports notes another client encrypted as lost', async () => {
    const server = new FakeServer();
    server.data.set(
      PROFILE_ANNOTATIONS_TYPE_UNSTABLE,
      await encryptAnnotations(PROFILE_ANNOTATIONS_TYPE_UNSTABLE, {}, generateAdk()),
    );
    const service = new ProfileNotesService(server.client());
    expect(await loaded(service)).toEqual({
      kind: 'lost',
      reason: LostReason.NoSecretStorage,
    });
  });
});

describe('with secret storage', () => {
  it('asks for the recovery key, then creates the key and encrypts, keeping unknown fields', async () => {
    const server = new FakeServer();
    server.defaultKey = 'K1';
    server.data.set(PROFILE_ANNOTATIONS_TYPE, {
      '@old:hs': { 'm.text': [{ body: 'plain old' }], 'x.keep': 1 },
      'x.top': 2,
    });
    const service = new ProfileNotesService(server.client());
    expect((await loaded(service)).kind).toBe('ready');

    await expect(service.saveNote('@bob:hs', 'secret', undefined)).rejects.toBeInstanceOf(
      NeedsRecoveryKeyError,
    );
    expect(server.data.has(ADK_SECRET_NAME)).toBe(false);

    await service.unlock(RECOVERY_KEY);
    await service.saveNote('@bob:hs', 'secret', undefined);

    expect(server.data.has(ADK_SECRET_NAME)).toBe(true);
    expect(server.data.has(ADK_SECRET_NAME_UNSTABLE)).toBe(true);
    const adk = server.data.get(ADK_SECRET_NAME)?.encrypted.K1.secret;
    const expected = {
      '@old:hs': { 'm.text': [{ body: 'plain old' }], 'x.keep': 1 },
      'x.top': 2,
      '@bob:hs': { 'm.text': [{ body: 'secret' }] },
    };
    await Promise.all(
      PROFILE_ANNOTATIONS_TYPES.map(async (type) => {
        const payload = getEncryptedPayload(server.data.get(type));
        expect(payload).toBeDefined();
        expect(await decryptAnnotations(type, payload!, adk)).toEqual(expected);
      }),
    );
  });

  it('reads with the cached key after a reload, and is locked on a new device', async () => {
    const server = new FakeServer();
    server.defaultKey = 'K1';
    const first = new ProfileNotesService(server.client());
    await first.unlock(RECOVERY_KEY);
    await first.saveNote('@bob:hs', 'secret', undefined);

    clearSecretStorageKeys();
    const reloaded = await loaded(new ProfileNotesService(server.client()));
    expect(reloaded.kind).toBe('ready');
    expect(readNote((reloaded as { annotations: Content }).annotations, '@bob:hs')).toEqual({
      plain: 'secret',
    });

    storage.clear();
    const otherDevice = new ProfileNotesService(server.client());
    expect((await loaded(otherDevice)).kind).toBe('locked');
    await expect(otherDevice.saveNote('@bob:hs', 'clobber', undefined)).rejects.toBeInstanceOf(
      NeedsRecoveryKeyError,
    );
    await otherDevice.unlock(RECOVERY_KEY);
    expect(otherDevice.getState().kind).toBe('ready');
  });

  it('notices a key rotated by another client', async () => {
    const server = new FakeServer();
    server.defaultKey = 'K1';
    const first = new ProfileNotesService(server.client());
    await first.unlock(RECOVERY_KEY);
    await first.saveNote('@bob:hs', 'old', undefined);
    clearSecretStorageKeys();

    const rotated = generateAdk();
    ADK_SECRET_NAMES.forEach((name) =>
      server.data.set(name, { encrypted: { K1: { ciphertext: `rot-${name}`, secret: rotated } } }),
    );
    await Promise.all(
      PROFILE_ANNOTATIONS_TYPES.map(async (type) =>
        server.data.set(
          type,
          await encryptAnnotations(type, { '@z:hs': { 'm.text': [{ body: 'new' }] } }, rotated),
        ),
      ),
    );

    const service = new ProfileNotesService(server.client());
    expect((await loaded(service)).kind).toBe('locked');
    await service.unlock(RECOVERY_KEY);
    const state = service.getState() as { annotations: Content };
    expect(readNote(state.annotations, '@z:hs')).toEqual({ plain: 'new' });
  });

  it('never overwrites notes it cannot decrypt, and starts over only on request', async () => {
    const server = new FakeServer();
    server.defaultKey = 'K1';
    const blob = await encryptAnnotations(PROFILE_ANNOTATIONS_TYPE, { x: 1 }, generateAdk());
    server.data.set(PROFILE_ANNOTATIONS_TYPE, blob);

    const service = new ProfileNotesService(server.client());
    expect(await loaded(service)).toEqual({ kind: 'lost', reason: LostReason.NoAdk });
    await expect(service.saveNote('@bob:hs', 'x', undefined)).rejects.toBeInstanceOf(
      NotesLostError,
    );
    expect(server.data.get(PROFILE_ANNOTATIONS_TYPE)).toEqual(blob);

    await expect(service.startOver()).rejects.toBeInstanceOf(NeedsRecoveryKeyError);
    await service.unlock(RECOVERY_KEY);
    await service.startOver();
    expect(service.getState()).toEqual({ kind: 'ready', annotations: {}, encrypted: true });
  });

  it('reports a key stored under a replaced recovery key', async () => {
    const server = new FakeServer();
    server.defaultKey = 'K2';
    const old = generateAdk();
    server.data.set(ADK_SECRET_NAME, { encrypted: { K1: { ciphertext: 'o', secret: old } } });
    server.data.set(
      PROFILE_ANNOTATIONS_TYPE,
      await encryptAnnotations(PROFILE_ANNOTATIONS_TYPE, {}, old),
    );
    expect(await loaded(new ProfileNotesService(server.client()))).toEqual({
      kind: 'lost',
      reason: LostReason.StaleRecoveryKey,
    });
  });
});

describe('writes', () => {
  it('are serialised, so concurrent saves do not lose each other', async () => {
    const server = new FakeServer();
    const service = new ProfileNotesService(server.client());
    await Promise.all([
      service.saveNote('@a:hs', 'A', undefined),
      service.saveNote('@b:hs', 'B', undefined),
      service.saveNote('@a:hs', '', undefined),
    ]);
    expect(server.data.get(PROFILE_ANNOTATIONS_TYPE)).toEqual({
      '@b:hs': { 'm.text': [{ body: 'B' }] },
    });
  });

  it('refuses a map too large to store', async () => {
    const server = new FakeServer();
    const big: Content = {};
    for (let i = 0; i < 80; i += 1) {
      big[`@u${i}:hs`] = { 'm.text': [{ body: 'x'.repeat(1000) }] };
    }
    server.data.set(PROFILE_ANNOTATIONS_TYPE, big);
    const service = new ProfileNotesService(server.client());
    await expect(service.saveNote('@new:hs', 'y', undefined)).rejects.toThrow(/too large/);
    expect(server.data.get(PROFILE_ANNOTATIONS_TYPE)?.['@new:hs']).toBeUndefined();
  });
});
