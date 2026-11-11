import { VerificationPhase } from 'matrix-js-sdk/lib/crypto-api';

// Cancellation codes from the spec's m.key.verification.cancel, plus m.accepted, which the
// SDKs send to the other devices once one of them has taken the request.
const REASONS: Record<string, string> = {
  'm.user': 'It was cancelled on one of the devices.',
  'm.timeout': 'It timed out. Both devices must finish within 10 minutes of the request.',
  'm.accepted': 'Another of your devices accepted the request.',
  // The rust SDK also sends this when the MAC check fails, with the emoji matching on both
  // screens: a device presented keys other than the ones the other device has on record for it.
  'm.mismatched_sas':
    'Either the emoji were reported as not matching, or one device presented encryption keys other than the ones the other device has on record for it. If both screens showed the same emoji, one of the two sessions has lost its keys: sign out of it and sign in again.',
  'm.key_mismatch':
    "A device's keys did not match the keys the server has for it. That session needs to sign out and sign in again before it can be verified.",
  'm.mismatched_commitment': 'The devices disagreed on the key agreement. Try again.',
  'm.unknown_method': 'The other device does not support this verification method.',
  'm.unexpected_message': 'A device received a verification message it did not expect.',
  'm.unknown_transaction': 'A device received a message for a verification it does not know.',
  'm.invalid_message': 'A device received a malformed verification message.',
  'm.user_mismatch': 'The verification was not between the expected accounts.',
};

const KEYS_CHANGED_REASON =
  'The other session lost its encryption keys: the keys the server now has for it differ from the ones this device verified before. Sign out of that session and sign in again, then verify the new one.';

const OWN_KEYS_LOST_REASON =
  'This device lost its encryption keys: it now has other keys than the ones your other devices and the server have on record for it, so it cannot be verified. Sign out of this device and sign in again, then verify the new session.';

export type CancelReasonContext = {
  /** The server's keys for the other device differ from the ones this device has cached. */
  otherDeviceKeysChanged?: boolean;
  /** This device's own keys differ from the server's, or from the ones it started with. */
  ownDeviceKeysLost?: boolean;
};

const isKeyMismatchCode = (code: string) =>
  code === 'm.mismatched_sas' || code === 'm.key_mismatch';

/** Why a verification was cancelled, in words, with the raw code kept for bug reports. */
export const verificationCancelReason = (
  code: string | null | undefined,
  context: CancelReasonContext = {},
): string | undefined => {
  if (!code) return undefined;
  if (context.ownDeviceKeysLost && isKeyMismatchCode(code)) {
    return `${OWN_KEYS_LOST_REASON} (${code})`;
  }
  if (context.otherDeviceKeysChanged && isKeyMismatchCode(code)) {
    return `${KEYS_CHANGED_REASON} (${code})`;
  }
  const reason = REASONS[code];
  return reason ? `${reason} (${code})` : `Reason code: ${code}`;
};

// matrix-js-sdk's rust verifier rejects `verify()` with
// "Verification cancelled by us with code m.mismatched_sas: The SAS did not match."
const CANCEL_CODE_IN_ERROR = /cancelled by (?:us|them) with code ([^\s:]+)/;

/** The cancellation code in a rejected `Verifier.verify()`, when the error carries one. */
export const cancelCodeFromError = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) return undefined;
  return CANCEL_CODE_IN_ERROR.exec(error.message)?.[1];
};

export enum VerificationOutcome {
  Pending = 'pending',
  Verified = 'verified',
  Canceled = 'canceled',
}

export type VerificationProgress = {
  phase: VerificationPhase;
  /** `Verifier.verify()` resolved. */
  verified: boolean;
  /** `Verifier.verify()` rejected. */
  failed: boolean;
};

/**
 * What the dialog should report.
 *
 * A rejected `verify()` wins over the request's phase. When the verifier cancels with
 * m.mismatched_sas, the rust SDK emits no Cancel event, and the request moves to Done with no
 * cancellation code. Reading Done as success showed "Your device is verified" on one screen while
 * the other said "Verification has been canceled", and nothing was verified.
 */
export const verificationOutcome = ({
  phase,
  verified,
  failed,
}: VerificationProgress): VerificationOutcome => {
  if (failed) return VerificationOutcome.Canceled;
  if (verified || phase === VerificationPhase.Done) return VerificationOutcome.Verified;
  if (phase === VerificationPhase.Cancelled) return VerificationOutcome.Canceled;
  return VerificationOutcome.Pending;
};
