import { VerificationStatus } from '../../hooks/useDeviceVerificationStatus';
import { createPersistentFlags } from '../../utils/persistentFlags';

/**
 * `verify`: the account has an encryption identity and this device is not trusted by it yet.
 * `setup`: the account has no encryption identity at all, so there is nothing to verify against.
 */
export type GateKind = 'verify' | 'setup';

/** Whether the account has an encryption identity (cross-signing keys), once that is known. */
export type IdentityState = 'present' | 'absent' | 'unknown';

export type GateState = {
  identity: IdentityState;
  status: VerificationStatus;
  /** Which kinds of prompt the person chose to skip on this device. */
  dismissed: Record<GateKind, boolean>;
  /** The gate was showing and verification just completed, so show the confirmation. */
  finished: boolean;
};

/**
 * What the gate should ask for, if anything. It only ever offers setup when the identity is
 * known to be absent, so setup can never replace an identity the account already has. A kind
 * that was dismissed stays out of the way and the banner takes over, so it does not return on
 * every launch.
 */
export const gateKind = ({
  identity,
  status,
  dismissed,
}: Omit<GateState, 'finished'>): GateKind | null => {
  if (status !== VerificationStatus.Unverified) return null;
  if (identity === 'present') return dismissed.verify ? null : 'verify';
  if (identity === 'absent') return dismissed.setup ? null : 'setup';
  return null;
};

/** Like `gateKind`, but ignoring dismissal: what the banner reminds about after a skip. */
export const pendingKind = (state: Omit<GateState, 'finished' | 'dismissed'>): GateKind | null =>
  gateKind({ ...state, dismissed: { verify: false, setup: false } });

export const shouldShowGate = (state: GateState): boolean =>
  state.finished || gateKind(state) !== null;

/** True when the gate was asking for verification and the device has now become verified. */
export const justVerified = (wasVerifying: boolean, state: Omit<GateState, 'finished'>): boolean =>
  wasVerifying && !state.dismissed.verify && state.status === VerificationStatus.Verified;

const dismissalKey = (kind: GateKind, userId: string, deviceId: string): string =>
  `verification_gate_dismissed:${kind}:${userId}:${deviceId}`;

// The gate and the banner both read this, so it lives outside React.
const dismissals = createPersistentFlags();

export const subscribeGateDismissal = dismissals.subscribe;

export const isGateDismissed = (kind: GateKind, userId: string, deviceId: string): boolean =>
  dismissals.has(dismissalKey(kind, userId, deviceId));

export const dismissGate = (kind: GateKind, userId: string, deviceId: string): void =>
  dismissals.set(dismissalKey(kind, userId, deviceId));

/** Brings the gate back, for the banner's action. */
export const reopenGate = (kind: GateKind, userId: string, deviceId: string): void =>
  dismissals.clear(dismissalKey(kind, userId, deviceId));
