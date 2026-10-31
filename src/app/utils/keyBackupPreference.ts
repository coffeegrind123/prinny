import { MatrixClient } from 'matrix-js-sdk';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { AccountDataEvent } from '../../types/matrix/accountData';

/**
 * Records whether the user wants a server key backup, the way Element does (MSC4287, stable and
 * unstable keys). Without it Element and Element X see a missing backup as broken and offer to
 * create one again, undoing a deliberate opt-out.
 */
export const recordKeyBackupChoice = async (mx: MatrixClient, enabled: boolean): Promise<void> => {
  await mx.setAccountData(AccountDataEvent.KeyBackup, { enabled });
  await mx.setAccountData(AccountDataEvent.KeyBackupDisabledUnstable, { disabled: !enabled });
};

/** False only when the account has recorded an opt-out, so the default stays "back up". */
export const keyBackupWanted = (mx: MatrixClient): boolean => {
  const stable = mx.getAccountData(AccountDataEvent.KeyBackup)?.getContent<{ enabled?: boolean }>();
  if (stable && typeof stable.enabled === 'boolean') return stable.enabled;

  const unstable = mx
    .getAccountData(AccountDataEvent.KeyBackupDisabledUnstable)
    ?.getContent<{ disabled?: boolean }>();
  return unstable?.disabled !== true;
};

/** Deletes every server backup version; there can be more than one, and the next would take over. */
export const deleteAllKeyBackups = async (crypto: CryptoApi): Promise<void> => {
  let current = (await crypto.getKeyBackupInfo())?.version;
  while (current) {
    await crypto.deleteKeyBackupVersion(current);
    const next = (await crypto.getKeyBackupInfo())?.version;
    if (next === current) {
      throw new Error('The server still reports the deleted backup.');
    }
    current = next;
  }
};
