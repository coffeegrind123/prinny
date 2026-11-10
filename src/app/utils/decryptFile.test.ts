import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptAttachment, EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import {
  AttachmentTamperedError,
  AttachmentUnreadableError,
  decryptFile,
  isFinalAttachmentError,
} from './matrix';

// The library reads `window.crypto`; Node's WebCrypto is the same API, so these run the real
// encryption, hash check and key import, and pin the library's hash-mismatch message.
const previousWindow = (globalThis as { window?: unknown }).window;
beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    crypto: globalThis.crypto,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
  };
});
afterAll(() => {
  (globalThis as { window?: unknown }).window = previousWindow;
});

const plaintext = new TextEncoder().encode('hello attachment');
const encryptSample = () => encryptAttachment(plaintext.slice().buffer);

describe('decryptFile', () => {
  it('decrypts an attachment encrypted by the library', async () => {
    const { data, info } = await encryptSample();
    const blob = await decryptFile(data, 'text/plain', info);
    expect(await blob.text()).toBe('hello attachment');
  });

  it('still accepts a padded hash (normalised, so not mistaken for tampering)', async () => {
    const { data, info } = await encryptSample();
    const padded = { ...info, hashes: { sha256: `${info.hashes.sha256}=` } };
    expect(await (await decryptFile(data, 'text/plain', padded)).text()).toBe('hello attachment');
  });

  it('reports altered ciphertext as tampered', async () => {
    const { data, info } = await encryptSample();
    const altered = new Uint8Array(data.slice(0));
    altered[0] ^= 0xff;
    await expect(decryptFile(altered.buffer, 'text/plain', info)).rejects.toBeInstanceOf(
      AttachmentTamperedError,
    );
  });

  it('reports missing file info or a malformed key as unreadable', async () => {
    const { data, info } = await encryptSample();
    await expect(
      decryptFile(data, 'text/plain', undefined as unknown as EncryptedAttachmentInfo),
    ).rejects.toBeInstanceOf(AttachmentUnreadableError);
    await expect(
      decryptFile(data, 'text/plain', { ...info, key: { ...info.key, k: 'short' } }),
    ).rejects.toBeInstanceOf(AttachmentUnreadableError);
  });
});

describe('isFinalAttachmentError', () => {
  it('is true only for failures retrying cannot fix', () => {
    expect(isFinalAttachmentError(new AttachmentTamperedError())).toBe(true);
    expect(isFinalAttachmentError(new AttachmentUnreadableError())).toBe(true);
    expect(isFinalAttachmentError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isFinalAttachmentError(undefined)).toBe(false);
  });
});
