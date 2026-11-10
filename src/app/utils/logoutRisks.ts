import { VerificationStatus } from '../hooks/useDeviceVerificationStatus';

export type LogoutRisk = {
  id: 'noRecovery' | 'unverified' | 'notBackedUp' | 'backupInProgress' | 'onlyDevice';
  severity: 'Critical' | 'Warning';
  title: string;
  description: string;
};

export type LogoutRiskInput = {
  /** Recovery holds the identity keys, so they can be restored after this device is gone. */
  recoveryActive: boolean;
  verification: VerificationStatus;
  /** This device is uploading its keys to a backup it trusts; undefined until known. */
  backupActive: boolean | undefined;
  /** Keys still waiting to upload, as last reported by the upload loop (0 until it reports). */
  backupRemaining: number;
  /** Other signed-in devices on the account, or undefined until the device list has loaded. */
  otherDevices: number | undefined;
};

const pluralKeys = (count: number): string =>
  count === 1 ? '1 message key is' : `${count} message keys are`;

/**
 * What logging out would cost a person with encrypted rooms, most serious first. Message keys
 * live on this device, so they are only safe if a backup has them or another device does. The
 * only-device card is added last because it makes any other risk permanent.
 */
export const logoutRisks = ({
  recoveryActive,
  verification,
  backupActive,
  backupRemaining,
  otherDevices,
}: LogoutRiskInput): LogoutRisk[] => {
  const risks: LogoutRisk[] = [];

  if (!recoveryActive) {
    risks.push({
      id: 'noRecovery',
      severity: 'Critical',
      title: 'Recovery is not set up',
      description:
        'Set up recovery in Settings, or export your keys, before you log out. Otherwise messages only this device can read will be lost.',
    });
  } else if (verification === VerificationStatus.Unverified) {
    risks.push({
      id: 'unverified',
      severity: 'Critical',
      title: 'This device is unverified',
      description:
        'Verify it before you log out. An unverified device cannot back up its keys, so messages only it can read would be lost.',
    });
  } else if (backupActive === false) {
    risks.push({
      id: 'notBackedUp',
      severity: 'Critical',
      title: 'Your message keys are not backed up',
      description:
        'Messages only this device can read will be lost when you log out. Back up your keys or export them from Settings first.',
    });
  } else if (backupRemaining > 0) {
    risks.push({
      id: 'backupInProgress',
      severity: 'Warning',
      title: 'Backup is still running',
      description: `${pluralKeys(backupRemaining)} still being backed up. Wait for it to finish before you log out.`,
    });
  }

  if (otherDevices === 0) {
    const permanent = risks.length > 0;
    risks.push({
      id: 'onlyDevice',
      severity: permanent ? 'Critical' : 'Warning',
      title: 'This is your only signed-in device',
      description: permanent
        ? 'No other device can share your keys or approve a new sign-in, so what is lost here cannot be recovered from anywhere else.'
        : 'When you sign in again you will need your recovery key or passphrase to read your messages. Make sure you still have it.',
    });
  }

  return risks;
};
