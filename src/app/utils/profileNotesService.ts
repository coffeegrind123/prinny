import { AccountDataEvents, ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type { SecretStorageKey } from 'matrix-js-sdk/lib/secret-storage';
import { cryptoCallbacks, storePrivateKey } from '../../client/secretStorageKeys';
import {
  ADK_SECRET_NAMES,
  ANNOTATIONS_MAX_BYTES,
  AnnotationsDecryptError,
  EncryptedPayload,
  InvalidAdkError,
  PROFILE_ANNOTATIONS_TYPES,
  ProfileAnnotations,
  decryptAnnotations,
  encryptAnnotations,
  generateAdk,
  getEncryptedPayload,
  serialisedSize,
  withNote,
} from './profileNotes';

/*
 * Owns the notes of one MatrixClient: reading and decrypting the annotations
 * account data, getting hold of the account data key (ADK), and writing.
 *
 * ADK lifecycle:
 *
 *   localStorage cache ──hit, still matches the secret in 4S──▶ use it
 *        │ miss / stale
 *        ▼
 *   ADK in secret storage? ──yes──▶ 4S key in memory? ──yes──▶ read, cache, use
 *        │ no                          │ no
 *        ▼                             ▼
 *   (writing only) make one,       "locked": ask for the recovery key
 *   store it under both names
 *   (needs the 4S key too)
 *
 * The 4S key is only in memory once the user has typed the recovery key this
 * session (verification, backup restore, or the prompt on the note itself),
 * the same rule every other secret in this client follows. The ADK is cached
 * per device so notes stay readable after a reload; logout clears localStorage
 * and with it the cache. The rust crypto store beside it holds the cross-signing
 * private keys unencrypted, so this does not widen what a device compromise gets.
 *
 * Never overwrite what we cannot read: a write first decrypts the current
 * content, and refuses if that fails. Losing every note because one profile was
 * edited on a device without the key is the failure MSC4441 warns about.
 */

const ADK_CACHE_PREFIX = 'prinny.msc4483.adk:';

const LOG = '[profile-notes]';

export enum LostReason {
  /** Encrypted, but no ADK exists in secret storage (another client kept it device-local). */
  NoAdk = 'no-adk',
  /** The ADK in secret storage is encrypted under a recovery key that was since replaced. */
  StaleRecoveryKey = 'stale-recovery-key',
  /** The ADK in secret storage does not open the notes. */
  WrongAdk = 'wrong-adk',
  /** Encrypted, but this account has no secret storage at all. */
  NoSecretStorage = 'no-secret-storage',
  /** Decrypts, but is not a JSON object. */
  Corrupt = 'corrupt',
}

export type NotesState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      annotations: ProfileAnnotations;
      /** Whether new writes will be encrypted (secret storage is set up). */
      encrypted: boolean;
    }
  | { kind: 'locked' }
  | { kind: 'lost'; reason: LostReason }
  | { kind: 'error'; message: string };

/** The note cannot be read or saved until the recovery key is entered. */
export class NeedsRecoveryKeyError extends Error {
  constructor() {
    super('Enter your recovery key to unlock your notes.');
    this.name = 'NeedsRecoveryKeyError';
  }
}

export class NotesLostError extends Error {
  constructor(readonly reason: LostReason) {
    super(`Your existing notes cannot be decrypted (${reason}).`);
    this.name = 'NotesLostError';
  }
}

export class NotesTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `Your notes together are too large to save (${Math.ceil(bytes / 1024)} KiB, limit ${
        ANNOTATIONS_MAX_BYTES / 1024
      } KiB). Shorten or remove some notes.`,
    );
    this.name = 'NotesTooLargeError';
  }
}

type CachedAdk = {
  adk: string;
  /** The ciphertext of the 4S secret it came from; a change means another client rotated it. */
  source?: string;
};

type AdkResult =
  | { kind: 'adk'; adk: string }
  | { kind: 'no-secret-storage' }
  | { kind: 'needs-key' }
  | { kind: 'absent' }
  | { kind: 'lost'; reason: LostReason };

type StoredAnnotations =
  | { kind: 'none' }
  | { kind: 'plain'; annotations: ProfileAnnotations }
  | { kind: 'encrypted'; type: string; payload: EncryptedPayload };

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class ProfileNotesService {
  private state: NotesState = { kind: 'loading' };

  private readonly listeners = new Set<() => void>();

  /** Bumped by every state change so a slow refresh cannot land over a newer one. */
  private generation = 0;

  /** Serialises writes: each one reads, merges and writes the whole map. */
  private writeChain: Promise<unknown> = Promise.resolve();

  private started = false;

  constructor(private readonly mx: MatrixClient) {}

  getState = (): NotesState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
    };
  };

  private start() {
    if (this.started) {
      return;
    }
    this.started = true;
    this.mx.on(ClientEvent.AccountData, this.onAccountData);
    this.refresh();
  }

  private onAccountData = (event: MatrixEvent) => {
    const type = event.getType();
    const relevant =
      (PROFILE_ANNOTATIONS_TYPES as readonly string[]).includes(type) ||
      (ADK_SECRET_NAMES as readonly string[]).includes(type) ||
      type === 'm.secret_storage.default_key' ||
      type.startsWith('m.secret_storage.key.');
    if (relevant) {
      this.refresh();
    }
  };

  private setState(state: NotesState) {
    this.generation += 1;
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  private getAccountDataContent(type: string): unknown {
    return this.mx.getAccountData(type as keyof AccountDataEvents)?.getContent();
  }

  /** Stable type first, as MSC4441 asks; an empty `{}` (a cleared entry) counts as present. */
  private readStored(): StoredAnnotations {
    const found = PROFILE_ANNOTATIONS_TYPES.map((type) => ({
      type,
      content: this.getAccountDataContent(type),
    })).find(({ content }) => content !== undefined);

    if (!found || typeof found.content !== 'object' || found.content === null) {
      return { kind: 'none' };
    }

    const payload = getEncryptedPayload(found.content);
    if (payload) {
      return { kind: 'encrypted', type: found.type, payload };
    }
    return { kind: 'plain', annotations: found.content as ProfileAnnotations };
  }

  private cacheKey(): string {
    return `${ADK_CACHE_PREFIX}${this.mx.getSafeUserId()}`;
  }

  private readCache(): CachedAdk | undefined {
    try {
      const raw = localStorage.getItem(this.cacheKey());
      if (!raw) {
        return undefined;
      }
      const parsed = JSON.parse(raw) as Partial<CachedAdk>;
      return typeof parsed.adk === 'string'
        ? { adk: parsed.adk, source: parsed.source }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache(cached: CachedAdk | undefined) {
    try {
      if (cached) {
        localStorage.setItem(this.cacheKey(), JSON.stringify(cached));
      } else {
        localStorage.removeItem(this.cacheKey());
      }
    } catch (e) {
      console.warn(LOG, 'could not persist the account data key; it will be asked for again', e);
    }
  }

  private storedAdkName(): string | undefined {
    return ADK_SECRET_NAMES.find((name) => this.getAccountDataContent(name) !== undefined);
  }

  /** The ciphertext of the stored ADK under `keyId`: the fingerprint the cache is checked against. */
  private storedAdkSource(name: string, keyId: string): string | undefined {
    const content = this.getAccountDataContent(name) as
      { encrypted?: Record<string, { ciphertext?: unknown }> } | undefined;
    const ciphertext = content?.encrypted?.[keyId]?.ciphertext;
    return typeof ciphertext === 'string' ? ciphertext : undefined;
  }

  private async hasSecretStorageKeyInMemory(keyId: string): Promise<boolean> {
    const found = await cryptoCallbacks.getSecretStorageKey({ keys: { [keyId]: {} } });
    return Array.isArray(found);
  }

  /**
   * Finds the ADK without asking the user anything. With `create`, makes one
   * when none exists anywhere — which needs the 4S key in memory.
   */
  private async resolveAdk(create: boolean): Promise<AdkResult> {
    const defaultKeyId = await this.mx.secretStorage.getDefaultKeyId();
    const name = this.storedAdkName();
    const cached = this.readCache();

    if (!defaultKeyId) {
      // Without secret storage an ADK can only be device-local, which would
      // make the notes unreadable everywhere else. Use one we already have
      // (to read), never make one.
      return cached ? { kind: 'adk', adk: cached.adk } : { kind: 'no-secret-storage' };
    }

    if (name) {
      const source = this.storedAdkSource(name, defaultKeyId);
      if (cached && cached.source !== undefined && cached.source === source) {
        return { kind: 'adk', adk: cached.adk };
      }

      const keys = await this.mx.secretStorage.isStored(name as SecretStorageKey);
      if (!keys || !(defaultKeyId in keys)) {
        // Stored, but only under a recovery key that has been replaced since.
        return cached
          ? { kind: 'adk', adk: cached.adk }
          : { kind: 'lost', reason: LostReason.StaleRecoveryKey };
      }

      if (!(await this.hasSecretStorageKeyInMemory(defaultKeyId))) {
        return { kind: 'needs-key' };
      }

      const adk = await this.mx.secretStorage.get(name as SecretStorageKey);
      if (!adk) {
        return { kind: 'lost', reason: LostReason.NoAdk };
      }
      this.writeCache({ adk, source });
      return { kind: 'adk', adk };
    }

    if (cached) {
      // No ADK in 4S yet, but this device has one (we wrote with it before the
      // secret reached the server, or 4S was reset). Publish it so other
      // devices can read what it encrypted.
      if (await this.hasSecretStorageKeyInMemory(defaultKeyId)) {
        await this.storeAdk(cached.adk, defaultKeyId);
      }
      return { kind: 'adk', adk: cached.adk };
    }

    if (!create) {
      return { kind: 'absent' };
    }
    if (!(await this.hasSecretStorageKeyInMemory(defaultKeyId))) {
      return { kind: 'needs-key' };
    }

    const adk = generateAdk();
    await this.storeAdk(adk, defaultKeyId);
    console.info(LOG, 'created a new account data key and stored it in secret storage');
    return { kind: 'adk', adk };
  }

  private async storeAdk(adk: string, keyId: string) {
    await Promise.all(
      ADK_SECRET_NAMES.map((secretName) =>
        this.mx.secretStorage.store(secretName as SecretStorageKey, adk, [keyId]),
      ),
    );
    this.writeCache({ adk, source: this.storedAdkSource(ADK_SECRET_NAMES[0], keyId) });
  }

  /**
   * Decrypts with the ADK, retrying once from secret storage when the cached
   * key is wrong (another device rotated it).
   */
  private async decryptStored(
    stored: Extract<StoredAnnotations, { kind: 'encrypted' }>,
  ): Promise<
    | { kind: 'ok'; annotations: ProfileAnnotations }
    | { kind: 'needs-key' }
    | { kind: 'lost'; reason: LostReason }
  > {
    const attempt = async (): Promise<
      | { kind: 'ok'; annotations: ProfileAnnotations }
      | { kind: 'needs-key' }
      | { kind: 'lost'; reason: LostReason }
      | { kind: 'mac' }
    > => {
      const result = await this.resolveAdk(false);
      if (result.kind === 'needs-key') {
        return result;
      }
      if (result.kind === 'lost') {
        return result;
      }
      if (result.kind === 'no-secret-storage') {
        return { kind: 'lost', reason: LostReason.NoSecretStorage };
      }
      if (result.kind === 'absent') {
        return { kind: 'lost', reason: LostReason.NoAdk };
      }
      try {
        return {
          kind: 'ok',
          annotations: await decryptAnnotations(stored.type, stored.payload, result.adk),
        };
      } catch (e) {
        if (e instanceof AnnotationsDecryptError && e.reason === 'json') {
          return { kind: 'lost', reason: LostReason.Corrupt };
        }
        if (e instanceof AnnotationsDecryptError || e instanceof InvalidAdkError) {
          return { kind: 'mac' };
        }
        throw e;
      }
    };

    const first = await attempt();
    if (first.kind !== 'mac') {
      return first;
    }

    const hadCache = this.readCache() !== undefined;
    this.writeCache(undefined);
    if (!hadCache) {
      return { kind: 'lost', reason: LostReason.WrongAdk };
    }
    console.warn(
      LOG,
      'cached account data key no longer opens the notes; re-reading it from secret storage',
    );
    const second = await attempt();
    return second.kind === 'mac' ? { kind: 'lost', reason: LostReason.WrongAdk } : second;
  }

  refresh = async (): Promise<void> => {
    const generation = this.generation;
    let next: NotesState;

    try {
      const stored = this.readStored();
      const encrypted = (await this.mx.secretStorage.getDefaultKeyId()) !== null;

      if (stored.kind === 'none') {
        next = { kind: 'ready', annotations: {}, encrypted };
      } else if (stored.kind === 'plain') {
        next = { kind: 'ready', annotations: stored.annotations, encrypted };
      } else {
        const result = await this.decryptStored(stored);
        if (result.kind === 'ok') {
          next = { kind: 'ready', annotations: result.annotations, encrypted: true };
        } else if (result.kind === 'needs-key') {
          next = { kind: 'locked' };
        } else {
          console.warn(LOG, 'notes cannot be decrypted:', result.reason);
          next = { kind: 'lost', reason: result.reason };
        }
      }
    } catch (e) {
      console.error(LOG, 'failed to load notes', e);
      next = { kind: 'error', message: errorText(e) };
    }

    if (generation === this.generation) {
      this.setState(next);
    }
  };

  /** Makes the 4S key available for this session, then retries whatever was locked. */
  unlock = async (recoveryKey: Uint8Array): Promise<void> => {
    const keyId = await this.mx.secretStorage.getDefaultKeyId();
    if (!keyId) {
      throw new Error('Secret storage is not set up on this account.');
    }
    storePrivateKey(keyId, recoveryKey);
    await this.refresh();
  };

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private async currentAnnotations(): Promise<ProfileAnnotations> {
    const stored = this.readStored();
    if (stored.kind === 'none') {
      return {};
    }
    if (stored.kind === 'plain') {
      return stored.annotations;
    }
    const result = await this.decryptStored(stored);
    if (result.kind === 'needs-key') {
      throw new NeedsRecoveryKeyError();
    }
    if (result.kind === 'lost') {
      throw new NotesLostError(result.reason);
    }
    return result.annotations;
  }

  /** The key new content is written with, or undefined to write plaintext (no secret storage). */
  private async writeKey(): Promise<string | undefined> {
    const result = await this.resolveAdk(true);
    switch (result.kind) {
      case 'adk':
        return result.adk;
      case 'no-secret-storage':
        return undefined;
      case 'needs-key':
        throw new NeedsRecoveryKeyError();
      case 'lost':
        throw new NotesLostError(result.reason);
      default:
        throw new NeedsRecoveryKeyError();
    }
  }

  private async writeAll(annotations: ProfileAnnotations, adk: string | undefined) {
    const contents = await Promise.all(
      PROFILE_ANNOTATIONS_TYPES.map(async (type) => ({
        type,
        content: adk ? await encryptAnnotations(type, annotations, adk) : annotations,
      })),
    );

    contents.forEach(({ content }) => {
      const bytes = serialisedSize(content);
      if (bytes > ANNOTATIONS_MAX_BYTES) {
        throw new NotesTooLargeError(bytes);
      }
    });

    this.setState({ kind: 'ready', annotations, encrypted: adk !== undefined });

    // Sequential, stable first: if the second write fails, readers that
    // prefer the stable type already see the new content.
    for (const { type, content } of contents) {
      await this.mx.setAccountData(type as never, content as never);
    }
  }

  /** Sets (or with an empty `plain`, removes) the note on `userId`. */
  saveNote = (userId: string, plain: string, html: string | undefined): Promise<void> =>
    this.enqueue(async () => {
      try {
        const current = await this.currentAnnotations();
        const adk = await this.writeKey();
        const text = plain.trim();
        const next = withNote(current, userId, text ? { plain: text, html } : undefined);
        await this.writeAll(next, adk);
      } catch (e) {
        await this.refresh();
        throw e;
      }
    });

  /**
   * Replaces notes that can no longer be decrypted with an empty set under a
   * working key. Destroys every existing note; the UI confirms first.
   */
  startOver = (): Promise<void> =>
    this.enqueue(async () => {
      try {
        const defaultKeyId = await this.mx.secretStorage.getDefaultKeyId();
        if (!defaultKeyId) {
          await this.writeAll({}, undefined);
          return;
        }
        if (!(await this.hasSecretStorageKeyInMemory(defaultKeyId))) {
          throw new NeedsRecoveryKeyError();
        }

        // Keep a working ADK from secret storage; replace a stale or missing one.
        let adk: string | undefined;
        const name = this.storedAdkName();
        const keys = name ? await this.mx.secretStorage.isStored(name as SecretStorageKey) : null;
        if (name && keys && defaultKeyId in keys) {
          adk = await this.mx.secretStorage.get(name as SecretStorageKey);
        }
        if (adk) {
          this.writeCache({ adk, source: this.storedAdkSource(name as string, defaultKeyId) });
        } else {
          adk = generateAdk();
          await this.storeAdk(adk, defaultKeyId);
        }
        console.warn(LOG, 'starting over: replacing undecryptable notes with an empty set');
        await this.writeAll({}, adk);
      } catch (e) {
        await this.refresh();
        throw e;
      }
    });
}

const services = new WeakMap<MatrixClient, ProfileNotesService>();

export const getProfileNotesService = (mx: MatrixClient): ProfileNotesService => {
  let service = services.get(mx);
  if (!service) {
    service = new ProfileNotesService(mx);
    services.set(mx, service);
  }
  return service;
};
