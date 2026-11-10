import type { IdentityState } from '../features/device-verification-gate/verificationGate';

/**
 * Whether a secret-storage account data entry (`m.cross_signing.master` and
 * the like) actually holds a secret. Turning recovery off makes the SDK store
 * `null`, which it writes as `{}` because account data cannot be deleted, so
 * the entry existing says nothing.
 */
export const hasStoredSecret = (content: unknown): boolean => {
  if (typeof content !== 'object' || content === null) return false;
  const { encrypted } = content as { encrypted?: unknown };
  return (
    typeof encrypted === 'object' &&
    encrypted !== null &&
    !Array.isArray(encrypted) &&
    Object.keys(encrypted).length > 0
  );
};

/**
 * What the recovery tile in Settings offers:
 * - `setup`: the account has no encryption identity, so a full setup is right.
 * - `turnOn`: an identity exists but recovery is off. It is turned back on
 *   around that identity; creating a new one would unverify every device.
 * - `manage`: recovery is on.
 * - `checking`: not known yet, so nothing that could replace an identity.
 */
export type RecoveryTileState = 'checking' | 'setup' | 'turnOn' | 'manage';

export const recoveryTileState = (
  recoveryOn: boolean,
  identity: IdentityState,
): RecoveryTileState => {
  if (recoveryOn) return 'manage';
  if (identity === 'unknown') return 'checking';
  return identity === 'absent' ? 'setup' : 'turnOn';
};
