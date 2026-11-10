import { describe, expect, it } from 'vitest';
import { VerificationPhase } from 'matrix-js-sdk/lib/crypto-api';
import {
  VerificationOutcome,
  cancelCodeFromError,
  verificationCancelReason,
  verificationOutcome,
} from './verificationCancel';

describe('verificationCancelReason', () => {
  it('names known codes and keeps the code for reports', () => {
    expect(verificationCancelReason('m.key_mismatch')).toMatch(
      /keys did not match.*\(m\.key_mismatch\)$/,
    );
    expect(verificationCancelReason('m.timeout')).toMatch(/timed out.*\(m\.timeout\)$/);
  });

  it('does not blame the emoji alone for m.mismatched_sas', () => {
    // The rust SDK sends m.mismatched_sas when the MAC check fails too, which is what happens
    // when a device's keys changed, with the emoji matching on both screens.
    expect(verificationCancelReason('m.mismatched_sas')).toMatch(/keys/);
  });

  it('says a device lost its keys when the server shows they changed', () => {
    expect(verificationCancelReason('m.mismatched_sas', { otherDeviceKeysChanged: true })).toMatch(
      /lost its encryption keys.*sign in again/i,
    );
  });

  it('shows an unknown code as it is, and nothing when there is no code', () => {
    expect(verificationCancelReason('org.example.weird')).toBe('Reason code: org.example.weird');
    expect(verificationCancelReason(null)).toBeUndefined();
    expect(verificationCancelReason('')).toBeUndefined();
  });
});

describe('cancelCodeFromError', () => {
  it('reads the code out of the rust SDK verifier error', () => {
    expect(
      cancelCodeFromError(
        new Error(
          'Verification cancelled by us with code m.mismatched_sas: The SAS did not match.',
        ),
      ),
    ).toBe('m.mismatched_sas');
    expect(
      cancelCodeFromError(new Error('Verification cancelled by them with code m.user: Cancelled.')),
    ).toBe('m.user');
  });

  it('returns undefined for anything else', () => {
    expect(cancelCodeFromError(new Error('network down'))).toBeUndefined();
    expect(cancelCodeFromError('nope')).toBeUndefined();
  });
});

describe('verificationOutcome', () => {
  it('is not verified when the verifier failed, even if the request reads Done', () => {
    // Measured: after the verifier rejects with m.mismatched_sas, the request moves to Done with
    // no cancellation code, and the dialog used to say "Your device is verified".
    expect(
      verificationOutcome({ phase: VerificationPhase.Done, verified: false, failed: true }),
    ).toBe(VerificationOutcome.Canceled);
  });

  it('is verified once the verifier succeeded or the request is Done without a failure', () => {
    expect(
      verificationOutcome({ phase: VerificationPhase.Started, verified: true, failed: false }),
    ).toBe(VerificationOutcome.Verified);
    expect(
      verificationOutcome({ phase: VerificationPhase.Done, verified: false, failed: false }),
    ).toBe(VerificationOutcome.Verified);
  });

  it('is canceled when the request was cancelled, and pending otherwise', () => {
    expect(
      verificationOutcome({ phase: VerificationPhase.Cancelled, verified: false, failed: false }),
    ).toBe(VerificationOutcome.Canceled);
    expect(
      verificationOutcome({ phase: VerificationPhase.Started, verified: false, failed: false }),
    ).toBe(VerificationOutcome.Pending);
  });
});
