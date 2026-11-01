import { ReactNode, useEffect, useRef, useState } from 'react';
import { Box, Button, Scroll, Spinner, Text, color } from 'folds';
import { VerificationPhase } from 'matrix-js-sdk/lib/crypto-api';
import * as css from './styles.css';
import {
  useSecretStorageDefaultKeyId,
  useSecretStorageKeyContent,
} from '../../hooks/useSecretStorage';
import { useVerifyWithRecoveryKey } from '../../hooks/useVerifyWithRecoveryKey';
import { useRequestOwnVerification } from '../../hooks/useRequestOwnVerification';
import { useOtherVerifiedDevices } from '../../hooks/useOtherVerifiedDevices';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { DeviceVerification } from '../../components/DeviceVerification';
import {
  DeviceVerificationResetOverlay,
  RecoveryKeyDisplay,
  SetupVerification,
} from '../../components/DeviceVerificationSetup';
import {
  ManualVerificationMethod,
  ManualVerificationMethodSwitcher,
} from '../../components/ManualVerification';
import {
  SecretStorageRecoveryKey,
  SecretStorageRecoveryPassphrase,
} from '../../components/SecretStorage';
import { SecretStorageKeyContent } from '../../../types/matrix/accountData';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { dismissGate, GateKind, gateKind, justVerified, shouldShowGate } from './verificationGate';
import { useVerificationGateState } from './useVerificationGateState';
import { errorMessage } from '../../utils/errorMessage';

type View = 'choose' | 'device' | 'key' | 'skip';

type AsideCopy = {
  heading: string;
  paragraphs: string[];
};

const ASIDE: Record<View | 'done' | 'setup' | 'skipSetup', AsideCopy> = {
  choose: {
    heading: 'Why this step matters',
    paragraphs: [
      'Your password signs you in, but it does not open your encrypted messages. Verifying shows this device is yours and gives it the keys to read your history.',
      'Someone who only has your password can sign in, but cannot verify, so your contacts see their device as unverified.',
    ],
  },
  device: {
    heading: 'Compare the emoji carefully',
    paragraphs: [
      'Both screens must show the same emoji in the same order. That confirms nothing sits between your two devices.',
      'If they differ, cancel and try again.',
    ],
  },
  key: {
    heading: 'What the recovery key is',
    paragraphs: [
      'A secret only you hold. Your homeserver stores an encrypted copy of your keys, not the key that opens it.',
      'A passphrase is the same key in a form you can remember. It is not your login password.',
    ],
  },
  skip: {
    heading: 'You can verify any time',
    paragraphs: [
      'A banner stays at the top of the app until this device is verified. Verifying later takes the same steps.',
    ],
  },
  setup: {
    heading: 'Why set up recovery',
    paragraphs: [
      'Your messages are end-to-end encrypted, so the keys that read them live on your devices. Without a recovery key, signing out or losing this device can lock them for good.',
      'Your homeserver cannot read your encrypted messages, so it cannot restore them for you.',
    ],
  },
  skipSetup: {
    heading: 'You can set this up later',
    paragraphs: [
      'A banner stays at the top of the app until recovery is set up. You can also do it under Settings, Devices.',
    ],
  },
  done: {
    heading: 'What changed',
    paragraphs: [
      'Your contacts and your other devices now see this device as verified, and you will not be asked again on it.',
    ],
  },
};

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Box direction="Column" gap="200">
      <Text size="H2" priority="400">
        {title}
      </Text>
      {children && (
        <Text size="T400" priority="300">
          {children}
        </Text>
      )}
    </Box>
  );
}

function ActionWithHint({
  label,
  hint,
  variant,
  onClick,
}: {
  label: string;
  hint: string;
  variant: 'Primary' | 'Secondary';
  onClick: () => void;
}) {
  return (
    <Box direction="Column" gap="100">
      <Button
        variant={variant}
        fill={variant === 'Primary' ? 'Solid' : 'Soft'}
        size="500"
        onClick={onClick}
      >
        <Text as="span" size="B500">
          {label}
        </Text>
      </Button>
      <Text size="T200" priority="300">
        {hint}
      </Text>
    </Box>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="Secondary" fill="None" size="400" onClick={onClick}>
      <Text as="span" size="B400">
        Back
      </Text>
    </Button>
  );
}

function ChooseView({
  canUseKey,
  onDevice,
  onKey,
  onSkip,
}: {
  canUseKey: boolean;
  onDevice: () => void;
  onKey: () => void;
  onSkip: () => void;
}) {
  const devices = useOtherVerifiedDevices();
  const [resetOpen, setResetOpen] = useState(false);
  // Nothing can approve this device and there is no key to unlock the account with.
  const stuck = devices === 'none' && !canUseKey;

  let methods: ReactNode;
  if (devices === 'checking') {
    methods = (
      <Box alignItems="Center" gap="200">
        <Spinner size="100" variant="Secondary" />
        <Text size="T300">Looking for your other devices...</Text>
      </Box>
    );
  } else if (stuck) {
    methods = (
      <Box direction="Column" gap="300">
        <Text size="T300">
          You can start over with a new encryption identity. Your older encrypted messages stay
          locked, and anyone who verified you will see a security warning.
        </Text>
        <Box>
          <Button variant="Secondary" fill="Soft" size="400" onClick={() => setResetOpen(true)}>
            <Text as="span" size="B400">
              Reset encryption identity
            </Text>
          </Button>
        </Box>
      </Box>
    );
  } else {
    methods = (
      <Box direction="Column" gap="400">
        {devices === 'available' && (
          <ActionWithHint
            label="Verify with another device"
            hint="Fastest. Approve on a device that is already signed in."
            variant="Primary"
            onClick={onDevice}
          />
        )}
        {canUseKey && (
          <ActionWithHint
            label="Use recovery key or passphrase"
            hint={
              devices === 'available'
                ? 'No other device? Use the key or passphrase you saved.'
                : 'None of your other devices can approve this one. Use the key or passphrase you saved.'
            }
            variant={devices === 'available' ? 'Secondary' : 'Primary'}
            onClick={onKey}
          />
        )}
      </Box>
    );
  }

  return (
    <Box direction="Column" gap="500">
      <Heading title="Verify this device">
        {stuck
          ? 'You are signed in, but nothing can verify this device: there is no other verified device and no recovery key on this account.'
          : 'You are signed in, but this device is not trusted yet. Verify it to read your encrypted messages and show others it is really you.'}
      </Heading>
      {methods}
      <Box>
        <Button variant="Secondary" fill="None" size="400" onClick={onSkip}>
          <Text as="span" size="B400">
            Continue without verifying
          </Text>
        </Button>
      </Box>
      {resetOpen && <DeviceVerificationResetOverlay onCancel={() => setResetOpen(false)} />}
    </Box>
  );
}

function DeviceView({
  canUseKey,
  onBack,
  onKey,
}: {
  canUseKey: boolean;
  onBack: () => void;
  onKey: () => void;
}) {
  const { requestState, request: requestVerification, reset } = useRequestOwnVerification();

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    requestVerification().catch(() => undefined);
  }, [requestVerification]);

  const request = requestState.status === AsyncStatus.Success ? requestState.data : undefined;

  const leave = (next: () => void) => {
    if (
      request &&
      request.phase !== VerificationPhase.Done &&
      request.phase !== VerificationPhase.Cancelled
    ) {
      request.cancel().catch(() => undefined);
    }
    reset();
    next();
  };

  return (
    <Box direction="Column" gap="500">
      <Heading title="Verify with another device">
        Open Prinny or another Matrix app on a device that is already signed in, then accept the
        request.
      </Heading>
      {requestState.status === AsyncStatus.Loading && (
        <Box alignItems="Center" gap="200">
          <Spinner size="100" variant="Secondary" />
          <Text size="T300">Contacting your other devices...</Text>
        </Box>
      )}
      {requestState.status === AsyncStatus.Error && (
        <Box direction="Column" gap="200">
          <Text size="T300" style={{ color: color.Critical.Main }}>
            Could not start verification: {errorMessage(requestState.error)}
          </Text>
          <Box>
            <Button
              variant="Secondary"
              fill="Soft"
              size="400"
              onClick={() => {
                requestVerification().catch(() => undefined);
              }}
            >
              <Text as="span" size="B400">
                Try again
              </Text>
            </Button>
          </Box>
        </Box>
      )}
      {request && <DeviceVerification request={request} onExit={() => leave(onBack)} />}
      <Box gap="200" wrap="Wrap">
        <BackButton onClick={() => leave(onBack)} />
        {canUseKey && (
          <Button variant="Secondary" fill="None" size="400" onClick={() => leave(onKey)}>
            <Text as="span" size="B400">
              No other device? Use recovery key
            </Text>
          </Button>
        )}
      </Box>
    </Box>
  );
}

function KeyView({
  keyId,
  keyContent,
  onBack,
}: {
  keyId: string;
  keyContent: SecretStorageKeyContent;
  onBack: () => void;
}) {
  const hasPassphrase = !!keyContent.passphrase;
  const [method, setMethod] = useState(
    hasPassphrase
      ? ManualVerificationMethod.RecoveryPassphrase
      : ManualVerificationMethod.RecoveryKey,
  );
  const { verifyState, verify, verifying } = useVerifyWithRecoveryKey(keyId);
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <Box direction="Column" gap="500">
      <Heading title="Enter your recovery key">
        This verifies this device and unlocks your encrypted backup.
      </Heading>
      {hasPassphrase && (
        <Box>
          <ManualVerificationMethodSwitcher value={method} onChange={setMethod} />
        </Box>
      )}
      {method === ManualVerificationMethod.RecoveryKey && (
        <SecretStorageRecoveryKey
          processing={verifying}
          keyContent={keyContent}
          onDecodedRecoveryKey={verify}
        />
      )}
      {method === ManualVerificationMethod.RecoveryPassphrase && keyContent.passphrase && (
        <SecretStorageRecoveryPassphrase
          processing={verifying}
          keyContent={keyContent}
          passphraseContent={keyContent.passphrase}
          onDecodedRecoveryKey={verify}
        />
      )}
      {verifyState.status === AsyncStatus.Error && (
        <Text size="T300" style={{ color: color.Critical.Main }}>
          <b>{errorMessage(verifyState.error)}</b>
        </Text>
      )}
      <Box gap="200" wrap="Wrap">
        <BackButton onClick={onBack} />
        <Button variant="Secondary" fill="None" size="400" onClick={() => setResetOpen(true)}>
          <Text as="span" size="B400">
            Lost your recovery key?
          </Text>
        </Button>
      </Box>
      {resetOpen && <DeviceVerificationResetOverlay onCancel={() => setResetOpen(false)} />}
    </Box>
  );
}

function SkipView({
  kind,
  onBack,
  onContinue,
}: {
  kind: GateKind;
  onBack: () => void;
  onContinue: () => void;
}) {
  const setup = kind === 'setup';
  return (
    <Box direction="Column" gap="500">
      <Heading title={setup ? 'Continue without recovery?' : 'Continue without verifying?'}>
        {setup
          ? 'You can still use Prinny, but without a recovery key:'
          : 'You can still use Prinny, but until you verify:'}
      </Heading>
      <Text as="div" size="T300">
        <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.5rem' }}>
          {setup ? (
            <>
              <li>
                If you sign out or lose this device, your encrypted messages cannot be restored.
              </li>
              <li>People you chat with see this device as unverified.</li>
            </>
          ) : (
            <>
              <li>Older encrypted messages stay unreadable on this device.</li>
              <li>People you chat with see this device as unverified.</li>
              <li>Others cannot tell this device apart from one someone else added.</li>
            </>
          )}
        </ul>
      </Text>
      <Box direction="Column" gap="200">
        <Button variant="Primary" size="500" onClick={onBack}>
          <Text as="span" size="B500">
            {setup ? 'Go back and set up' : 'Go back and verify'}
          </Text>
        </Button>
        <Button variant="Secondary" fill="Soft" size="500" onClick={onContinue}>
          <Text as="span" size="B500">
            {setup ? 'Continue without recovery' : 'Continue unverified'}
          </Text>
        </Button>
      </Box>
    </Box>
  );
}

function SetupView({
  recoveryKey,
  onCreated,
  onSaved,
  onSkip,
}: {
  recoveryKey: string | undefined;
  onCreated: (recoveryKey: string) => void;
  onSaved: () => void;
  onSkip: () => void;
}) {
  if (recoveryKey) {
    return (
      <Box direction="Column" gap="500">
        <Heading title="Save your recovery key" />
        <RecoveryKeyDisplay recoveryKey={recoveryKey} onDone={onSaved} />
      </Box>
    );
  }

  return (
    <Box direction="Column" gap="500">
      <Heading title="Secure your messages" />
      <SetupVerification onComplete={onCreated} />
      <Box>
        <Button variant="Secondary" fill="None" size="400" onClick={onSkip}>
          <Text as="span" size="B400">
            Continue without recovery
          </Text>
        </Button>
      </Box>
    </Box>
  );
}

function DoneView({ onContinue }: { onContinue: () => void }) {
  const [askBeforeRestore] = useSetting(settingsAtom, 'askBeforeBackupRestore');
  return (
    <Box direction="Column" gap="500">
      <Heading title="This device is verified">
        {askBeforeRestore
          ? 'If you have a key backup, you will be asked whether to restore your older messages.'
          : 'If you have a key backup, your older messages restore from it in the background.'}
      </Heading>
      <Button variant="Primary" size="500" onClick={onContinue}>
        <Text as="span" size="B500">
          Continue to Prinny
        </Text>
      </Button>
    </Box>
  );
}

function GateShell({ aside, children }: { aside: AsideCopy; children: ReactNode }) {
  return (
    <Box className={css.Gate} direction="Column">
      <Scroll variant="Background" visibility="Hover" size="300" hideTrack>
        <Box className={css.GateLayout}>
          <Box className={css.GateMain} direction="Column">
            <Box className={css.GateContent} direction="Column">
              {children}
            </Box>
          </Box>
          <Box as="aside" className={css.GateAside}>
            <Box className={css.GateAsideContent} direction="Column">
              <Text size="H3">{aside.heading}</Text>
              {aside.paragraphs.map((paragraph) => (
                <Text key={paragraph} size="T400" priority="300">
                  {paragraph}
                </Text>
              ))}
            </Box>
          </Box>
        </Box>
      </Scroll>
    </Box>
  );
}

/**
 * Asks a signed-in but unverified device to verify before the app opens, or, when the account
 * has no encryption identity yet, to set up recovery. Either can be skipped, and the choice is
 * remembered per device so it does not return on every launch.
 */
function Gate() {
  const { userId, deviceId, identity, status, dismissed } = useVerificationGateState();

  const keyId = useSecretStorageDefaultKeyId();
  const keyContent = useSecretStorageKeyContent(keyId ?? '');
  const canUseKey = !!keyId && !!keyContent;

  const [finished, setFinished] = useState(false);
  const [view, setView] = useState<View>('choose');
  // Creating the keys makes the account look verified, or briefly half-verified, long before the
  // user has saved the key. Once setup was asked it stays in charge until the key is saved or
  // skipped, so the screen cannot flip to verification part-way through.
  const [setupActive, setSetupActive] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string>();
  const wasVerifying = useRef(false);

  const asked = gateKind({ identity, status, dismissed });

  useEffect(() => {
    if (asked === 'setup') setSetupActive(true);
  }, [asked]);

  const settingUp = setupActive || recoveryKey !== undefined;

  useEffect(() => {
    if (settingUp) return;
    if (asked === 'verify') {
      wasVerifying.current = true;
    } else if (justVerified(wasVerifying.current, { identity, status, dismissed })) {
      wasVerifying.current = false;
      setFinished(true);
    }
  }, [settingUp, asked, identity, status, dismissed]);

  const kind: GateKind = settingUp ? 'setup' : (asked ?? 'verify');

  if (!settingUp && !shouldShowGate({ identity, status, dismissed, finished })) return null;

  const handleSkip = () => {
    setView('choose');
    setSetupActive(false);
    if (deviceId) dismissGate(kind, userId, deviceId);
  };

  const handleKeySaved = () => {
    setRecoveryKey(undefined);
    setSetupActive(false);
  };

  let content: ReactNode;
  let aside: AsideCopy;
  if (kind === 'setup') {
    const skipping = view === 'skip' && recoveryKey === undefined;
    content = skipping ? (
      <SkipView kind="setup" onBack={() => setView('choose')} onContinue={handleSkip} />
    ) : (
      <SetupView
        recoveryKey={recoveryKey}
        onCreated={setRecoveryKey}
        onSaved={handleKeySaved}
        onSkip={() => setView('skip')}
      />
    );
    aside = ASIDE[skipping ? 'skipSetup' : 'setup'];
  } else if (finished) {
    content = <DoneView onContinue={() => setFinished(false)} />;
    aside = ASIDE.done;
  } else {
    if (view === 'device') {
      content = (
        <DeviceView
          canUseKey={canUseKey}
          onBack={() => setView('choose')}
          onKey={() => setView('key')}
        />
      );
    } else if (view === 'key' && keyId && keyContent) {
      content = <KeyView keyId={keyId} keyContent={keyContent} onBack={() => setView('choose')} />;
    } else if (view === 'skip') {
      content = <SkipView kind="verify" onBack={() => setView('choose')} onContinue={handleSkip} />;
    } else {
      content = (
        <ChooseView
          canUseKey={canUseKey}
          onDevice={() => setView('device')}
          onKey={() => setView('key')}
          onSkip={() => setView('skip')}
        />
      );
    }
    aside = ASIDE[view === 'key' && !(keyId && keyContent) ? 'choose' : view];
  }

  return <GateShell aside={aside}>{content}</GateShell>;
}

/** Off unless "Verify After Sign-In" is on; then the client behaves as before. */
export function DeviceVerificationGate() {
  const [verifyAfterSignIn] = useSetting(settingsAtom, 'verifyAfterSignIn');
  return verifyAfterSignIn ? <Gate /> : null;
}
