import { BackupTrustInfo, KeyBackupInfo } from 'matrix-js-sdk/lib/crypto-api';

/**
 * What the person should be told about their key backup, so the Restore button shows only when
 * pressing it would help:
 * - `restore`: this device can open the backup and has not restored it yet.
 * - `locked`: a backup exists but this device lacks the key to open it, so Restore would fail.
 * - `none`: no backup on the server.
 * - `ok`: nothing to do: already restored, or the backup is empty.
 * - `loading`: not enough is known yet to say anything.
 */
export type BackupAdvice =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'locked' }
  | { kind: 'restore'; keys: number }
  | { kind: 'ok' };

export const backupAdvice = (
  info: KeyBackupInfo | null | undefined,
  trust: Pick<BackupTrustInfo, 'matchesDecryptionKey'> | undefined,
  restored: boolean,
): BackupAdvice => {
  if (info === undefined) return { kind: 'loading' };
  if (info === null) return { kind: 'none' };
  if (!trust) return { kind: 'loading' };
  if (!trust.matchesDecryptionKey) return { kind: 'locked' };
  if (restored || !info.count) return { kind: 'ok' };
  return { kind: 'restore', keys: info.count };
};
