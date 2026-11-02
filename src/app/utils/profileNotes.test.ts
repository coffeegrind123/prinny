import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AnnotationsDecryptError,
  InvalidAdkError,
  PROFILE_ANNOTATIONS_TYPE,
  PROFILE_ANNOTATIONS_TYPE_UNSTABLE,
  decodeAdk,
  decryptAnnotations,
  encryptAnnotations,
  generateAdk,
  getEncryptedPayload,
  readNote,
  withNote,
} from './profileNotes';

const sample = {
  '@bob:hs': {
    'm.text': [{ body: '<b>hi</b> ünï', mimetype: 'text/html' }, { body: '**hi** ünï' }],
    'x.unknown': 1,
  },
  'x.top': true,
};

/**
 * m.secret_storage.v1.aes-hmac-sha2 written from the spec text with node's
 * crypto, independent of matrix-js-sdk: HKDF-SHA-256 (salt 32 zero bytes,
 * info = name) → 32-byte AES-CTR key + 32-byte HMAC key. Unpadded base64 and
 * the IV bit cleared at byte 9, the way Voyage (Android) writes it.
 */
const encryptLikeVoyage = (adk: string, type: string, plaintext: string) => {
  const key = Buffer.from(adk, 'base64');
  const derived = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(32), type, 64));
  const iv = randomBytes(16);
  iv[9] &= 0x7f;
  const cipher = createCipheriv('aes-256-ctr', derived.subarray(0, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const mac = createHmac('sha256', derived.subarray(32)).update(ciphertext).digest();
  const unpadded = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return { iv: unpadded(iv), ciphertext: unpadded(ciphertext), mac: unpadded(mac) };
};

describe('MSC4483 encryption', () => {
  it('round-trips and rejects the wrong key', async () => {
    const adk = generateAdk();
    const { encrypted } = await encryptAnnotations(PROFILE_ANNOTATIONS_TYPE, sample, adk);
    expect(await decryptAnnotations(PROFILE_ANNOTATIONS_TYPE, encrypted, adk)).toEqual(sample);
    await expect(
      decryptAnnotations(PROFILE_ANNOTATIONS_TYPE, encrypted, generateAdk()),
    ).rejects.toBeInstanceOf(AnnotationsDecryptError);
  });

  it('binds the ciphertext to the account data type (HKDF info)', async () => {
    const adk = generateAdk();
    const { encrypted } = await encryptAnnotations(PROFILE_ANNOTATIONS_TYPE, sample, adk);
    await expect(
      decryptAnnotations(PROFILE_ANNOTATIONS_TYPE_UNSTABLE, encrypted, adk),
    ).rejects.toMatchObject({ reason: 'mac' });
  });

  it('decrypts what an independent implementation wrote', async () => {
    const adk = generateAdk();
    const payload = encryptLikeVoyage(adk, PROFILE_ANNOTATIONS_TYPE, JSON.stringify(sample));
    expect(await decryptAnnotations(PROFILE_ANNOTATIONS_TYPE, payload, adk)).toEqual(sample);
  });

  it('flags decrypted non-objects as corrupt', async () => {
    const adk = generateAdk();
    const payload = encryptLikeVoyage(adk, PROFILE_ANNOTATIONS_TYPE, '[1,2]');
    await expect(decryptAnnotations(PROFILE_ANNOTATIONS_TYPE, payload, adk)).rejects.toMatchObject({
      reason: 'json',
    });
  });

  it('validates the key', () => {
    expect(decodeAdk(generateAdk())).toHaveLength(32);
    expect(() => decodeAdk('AAAA')).toThrow(InvalidAdkError);
  });

  it('tells an MSC4483 payload from a 4S secret and from plaintext', () => {
    expect(getEncryptedPayload({ encrypted: { iv: 'a', ciphertext: 'b', mac: 'c' } })).toEqual({
      iv: 'a',
      ciphertext: 'b',
      mac: 'c',
    });
    expect(
      getEncryptedPayload({ encrypted: { key1: { iv: 'a', ciphertext: 'b', mac: 'c' } } }),
    ).toBeUndefined();
    expect(getEncryptedPayload(sample)).toBeUndefined();
  });
});

describe('readNote', () => {
  it('picks the first html and plain representations', () => {
    expect(readNote(sample, '@bob:hs')).toEqual({ html: '<b>hi</b> ünï', plain: '**hi** ünï' });
  });

  it('treats a missing mimetype as plain text and ignores unknown mimetypes', () => {
    const annotations = {
      '@a:hs': { 'm.text': [{ body: 'x', mimetype: 'text/markdown' }, { body: 'y' }] },
    };
    expect(readNote(annotations, '@a:hs')).toEqual({ plain: 'y' });
  });

  it.each([
    [{}, '@nobody:hs'],
    [{ '@a:hs': { 'm.text': [{ body: '   ' }] } }, '@a:hs'],
    [{ '@a:hs': 'garbage' }, '@a:hs'],
    [{ '@a:hs': { 'm.text': 'nope' } }, '@a:hs'],
  ])('returns undefined for %j', (annotations, userId) => {
    expect(readNote(annotations, userId)).toBeUndefined();
  });
});

describe('withNote', () => {
  it('keeps unknown fields and does not mutate its input', () => {
    const before = structuredClone(sample);
    expect(withNote(sample, '@bob:hs', { plain: 'new' })).toEqual({
      '@bob:hs': { 'm.text': [{ body: 'new' }], 'x.unknown': 1 },
      'x.top': true,
    });
    expect(sample).toEqual(before);
  });

  it('removes only the text, and drops a user left empty', () => {
    expect(withNote(sample, '@bob:hs', undefined)).toEqual({
      '@bob:hs': { 'x.unknown': 1 },
      'x.top': true,
    });
    expect(withNote({ '@c:hs': { 'm.text': [{ body: 'z' }] } }, '@c:hs', undefined)).toEqual({});
  });

  it('writes html first, then the typed text', () => {
    expect(withNote({}, '@d:hs', { plain: '**b**', html: '<strong>b</strong>' })).toEqual({
      '@d:hs': {
        'm.text': [{ body: '<strong>b</strong>', mimetype: 'text/html' }, { body: '**b**' }],
      },
    });
  });
});
