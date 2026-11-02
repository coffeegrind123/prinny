import { decodeBase64, encodeUnpaddedBase64 } from 'matrix-js-sdk/lib/base64';
import encryptAESSecretStorageItem from 'matrix-js-sdk/lib/utils/encryptAESSecretStorageItem';
import decryptAESSecretStorageItem from 'matrix-js-sdk/lib/utils/decryptAESSecretStorageItem';

/*
 * Private per-user notes ("Discord notes"), as MSC4441 User Profile Annotations,
 * encrypted with MSC4483 Encrypted Account Data. Both MSCs are open, so we read
 * the stable type first and write both, the same as Voyage, the one other
 * client that ships them.
 *
 *   account data m.profile_annotations (and the unstable copy):
 *     plaintext  { "@bob:hs": { "m.text": [ {mimetype:"text/html", body}, {body} ], ...unknown } }
 *     encrypted  { "encrypted": { iv, ciphertext, mac } }
 *                  = m.secret_storage.v1.aes-hmac-sha2 over the JSON of the plaintext,
 *                    HKDF info = the account data type, key = the ADK
 *
 *   secret storage m.account_data.key (and the unstable name):
 *     the ADK, 32 random bytes, base64 — itself encrypted with the recovery key
 *
 * Every field this client does not understand, at the top level and on each
 * user, is carried through a write untouched (MSC4441: "ignore and preserve").
 */

export const PROFILE_ANNOTATIONS_TYPE = 'm.profile_annotations';
export const PROFILE_ANNOTATIONS_TYPE_UNSTABLE = 'dev.zirco.msc4441.profile_annotations';
/** Read order: stable first. Writes go to every entry. */
export const PROFILE_ANNOTATIONS_TYPES = [
  PROFILE_ANNOTATIONS_TYPE,
  PROFILE_ANNOTATIONS_TYPE_UNSTABLE,
] as const;

export const ADK_SECRET_NAME = 'm.account_data.key';
export const ADK_SECRET_NAME_UNSTABLE = 'dev.zirco.msc4483.account_data.key';
export const ADK_SECRET_NAMES = [ADK_SECRET_NAME, ADK_SECRET_NAME_UNSTABLE] as const;

/** MSC1767 text representation key inside one user's annotation. */
export const TEXT_KEY = 'm.text';
export const MIME_HTML = 'text/html';
export const MIME_PLAIN = 'text/plain';

/** Discord allows 256; a Matrix note is markdown, so give it more room. */
export const NOTE_MAX_LENGTH = 1024;

/**
 * Every note lives in ONE account data entry, which every device downloads on
 * initial sync. Keep it under the 64 KiB a room event may be, which servers and
 * clients treat as the practical ceiling for a single JSON blob. Checked on the
 * final (encrypted, ~4/3 larger) content, so the user gets a clear message
 * instead of a server error.
 */
export const ANNOTATIONS_MAX_BYTES = 60 * 1024;

const ADK_BYTES = 32;

export type EncryptedPayload = {
  iv: string;
  ciphertext: string;
  mac: string;
};

export type ProfileAnnotations = Record<string, unknown>;

export type NoteText = {
  /** The text as typed: what the editor shows. */
  plain?: string;
  /** Formatted rendering, when the writer supplied one. Untrusted — sanitise before use. */
  html?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An MSC4483 payload has the cipher fields directly under `encrypted`. An SSSS
 * secret also lives under `encrypted` but is keyed by key id, so checking the
 * field types tells the two apart.
 */
export const getEncryptedPayload = (content: unknown): EncryptedPayload | undefined => {
  if (!isRecord(content)) {
    return undefined;
  }
  const encrypted = content.encrypted;
  if (!isRecord(encrypted)) {
    return undefined;
  }
  const { iv, ciphertext, mac } = encrypted;
  if (typeof iv !== 'string' || typeof ciphertext !== 'string' || typeof mac !== 'string') {
    return undefined;
  }
  return { iv, ciphertext, mac };
};

export const generateAdk = (): string => {
  const bytes = new Uint8Array(ADK_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return encodeUnpaddedBase64(bytes);
};

export class InvalidAdkError extends Error {
  constructor(detail: string) {
    super(`Invalid account data key: ${detail}`);
    this.name = 'InvalidAdkError';
  }
}

export const decodeAdk = (adk: string): Uint8Array<ArrayBuffer> => {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64(adk);
  } catch {
    throw new InvalidAdkError('not base64');
  }
  if (bytes.length !== ADK_BYTES) {
    throw new InvalidAdkError(`${bytes.length} bytes, expected ${ADK_BYTES}`);
  }
  return bytes;
};

export const encryptAnnotations = async (
  type: string,
  annotations: ProfileAnnotations,
  adk: string,
): Promise<{ encrypted: EncryptedPayload }> => {
  const encrypted = await encryptAESSecretStorageItem(
    JSON.stringify(annotations),
    decodeAdk(adk),
    type,
  );
  return { encrypted };
};

export class AnnotationsDecryptError extends Error {
  constructor(
    readonly reason: 'mac' | 'json',
    detail: string,
  ) {
    super(detail);
    this.name = 'AnnotationsDecryptError';
  }
}

/** Throws AnnotationsDecryptError('mac') when the key is the wrong one. */
export const decryptAnnotations = async (
  type: string,
  payload: EncryptedPayload,
  adk: string,
): Promise<ProfileAnnotations> => {
  let json: string;
  try {
    json = await decryptAESSecretStorageItem(payload, decodeAdk(adk), type);
  } catch (e) {
    if (e instanceof InvalidAdkError) {
      throw e;
    }
    throw new AnnotationsDecryptError('mac', e instanceof Error ? e.message : String(e));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new AnnotationsDecryptError('json', `decrypted payload is not JSON (${String(e)})`);
  }
  if (!isRecord(parsed)) {
    throw new AnnotationsDecryptError('json', 'decrypted payload is not a JSON object');
  }
  return parsed;
};

/** Picks the first representation of each kind, in the writer's order (MSC1767). */
export const readNote = (annotations: ProfileAnnotations, userId: string): NoteText | undefined => {
  const entry = annotations[userId];
  if (!isRecord(entry)) {
    return undefined;
  }
  const texts = entry[TEXT_KEY];
  if (!Array.isArray(texts)) {
    return undefined;
  }

  const note: NoteText = {};
  texts.forEach((representation) => {
    if (!isRecord(representation) || typeof representation.body !== 'string') {
      return;
    }
    const mimetype =
      typeof representation.mimetype === 'string' ? representation.mimetype : MIME_PLAIN;
    if (mimetype === MIME_HTML && note.html === undefined) {
      note.html = representation.body;
    }
    if (mimetype === MIME_PLAIN && note.plain === undefined) {
      note.plain = representation.body;
    }
  });

  if (!note.plain?.trim() && !note.html?.trim()) {
    return undefined;
  }
  return note;
};

/**
 * Representations for a note: HTML first when it carries formatting (MSC1767
 * order is preference order), the typed text always.
 */
export const noteRepresentations = (
  plain: string,
  html: string | undefined,
): Array<{ body: string; mimetype?: string }> => {
  const out: Array<{ body: string; mimetype?: string }> = [];
  if (html !== undefined) {
    out.push({ body: html, mimetype: MIME_HTML });
  }
  out.push({ body: plain });
  return out;
};

/**
 * Returns a new annotations object with `userId`'s note set, or removed when
 * `note` is undefined. Other users, and other fields on this user, are kept.
 * A user left with no fields at all is dropped so the map does not collect
 * empty entries.
 */
export const withNote = (
  annotations: ProfileAnnotations,
  userId: string,
  note: { plain: string; html?: string } | undefined,
): ProfileAnnotations => {
  const next: ProfileAnnotations = { ...annotations };
  const existing = isRecord(annotations[userId]) ? annotations[userId] : {};
  const entry: Record<string, unknown> = { ...existing };

  if (note) {
    entry[TEXT_KEY] = noteRepresentations(note.plain, note.html);
  } else {
    delete entry[TEXT_KEY];
  }

  if (Object.keys(entry).length === 0) {
    delete next[userId];
  } else {
    next[userId] = entry;
  }
  return next;
};

export const serialisedSize = (content: unknown): number =>
  new TextEncoder().encode(JSON.stringify(content)).length;
