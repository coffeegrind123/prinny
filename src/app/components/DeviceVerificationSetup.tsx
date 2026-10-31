import { FormEventHandler, KeyboardEvent, forwardRef, useCallback, useState } from 'react';
import {
  Dialog,
  Header,
  Box,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  IconButton,
  Icon,
  Icons,
  config,
  Button,
  Checkbox,
  Chip,
  color,
  Spinner,
} from 'folds';
import FileSaver from '../utils/save-file';
import { FocusTrap } from 'focus-trap-react';
import to from '../utils/await-to';
import { AuthDict, IAuthData, MatrixError, UIAuthCallback } from 'matrix-js-sdk';
import { PasswordInput } from './password-input';
import { ContainerColor } from '../styles/ContainerColor.css';
import { copyToClipboard } from '../utils/dom';
import { recoveryKeyFilename } from '../utils/recoveryKeyFile';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { clearSecretStorageKeys } from '../../client/secretStorageKeys';
import { ActionUIA, ActionUIAFlowsLoader } from './ActionUIA';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useAlive } from '../hooks/useAlive';
import { UseStateProvider } from './UseStateProvider';

type UIACallback<T> = (
  authDict: AuthDict | null,
) => Promise<[IAuthData, undefined] | [undefined, T]>;

type PerformAction<T> = (authDict: AuthDict | null) => Promise<T>;

type UIAAction<T> = {
  authData: IAuthData;
  callback: UIACallback<T>;
  cancelCallback: () => void;
};

function makeUIAAction<T>(
  authData: IAuthData,
  performAction: PerformAction<T>,
  resolve: (data: T) => void,
  reject: (error?: any) => void,
): UIAAction<T> {
  const action: UIAAction<T> = {
    authData,
    callback: async (authDict) => {
      const [error, data] = await to<T, MatrixError | Error>(performAction(authDict));

      if (error instanceof MatrixError && error.httpStatus === 401) {
        return [error.data as IAuthData, undefined];
      }

      if (error) {
        reject(error);
        throw error;
      }

      resolve(data);
      return [undefined, data];
    },
    cancelCallback: reject,
  };

  return action;
}

type SetupVerificationProps = {
  onComplete: (recoveryKey: string) => void;
  reset?: boolean;
};
function SetupVerification({ onComplete, reset }: SetupVerificationProps) {
  const mx = useMatrixClient();
  const alive = useAlive();

  const [uiaAction, setUIAAction] = useState<UIAAction<void>>();
  const [nextAuthData, setNextAuthData] = useState<IAuthData | null>(); // null means no next action.

  const handleAction = useCallback(
    async (authDict: AuthDict) => {
      if (!uiaAction) {
        throw new Error('Unexpected Error! UIA action is perform without data.');
      }
      if (alive()) {
        setNextAuthData(null);
      }
      const [authData] = await uiaAction.callback(authDict);

      if (alive() && authData) {
        setNextAuthData(authData);
      }
    },
    [uiaAction, alive],
  );

  const resetUIA = useCallback(() => {
    if (!alive()) return;
    setUIAAction(undefined);
    setNextAuthData(undefined);
  }, [alive]);

  const authUploadDeviceSigningKeys: UIAuthCallback<void> = useCallback(
    (makeRequest) =>
      new Promise<void>((resolve, reject) => {
        makeRequest(null)
          .then(() => {
            resolve();
            resetUIA();
          })
          .catch((error) => {
            if (error instanceof MatrixError && error.httpStatus === 401) {
              const authData = error.data as IAuthData;
              const action = makeUIAAction(
                authData,
                makeRequest as PerformAction<void>,
                resolve,
                (err) => {
                  resetUIA();
                  reject(err);
                },
              );
              if (alive()) {
                setUIAAction(action);
              } else {
                reject(new Error('Authentication failed! Failed to setup device verification.'));
              }
              return;
            }
            reject(error);
          });
      }),
    [alive, resetUIA],
  );

  const [setupState, setup] = useAsyncCallback<void, Error, [string | undefined]>(
    useCallback(
      async (passphrase) => {
        const crypto = mx.getCrypto();
        if (!crypto) throw new Error('Unexpected Error! Crypto module not found!');

        // "Enable" is offered whenever the master key account data isn't in the local store,
        // which is also true before it has synced. Setting up again would replace a working
        // identity and its secret storage, so only the explicit reset path may do that.
        if (!reset && (await crypto.userHasCrossSigningKeys(mx.getSafeUserId(), true))) {
          throw new Error(
            'This account already has device verification set up. Verify with your recovery key or another device instead.',
          );
        }

        const recoveryKeyData = await crypto.createRecoveryKeyFromPassphrase(passphrase);
        if (!recoveryKeyData.encodedPrivateKey) {
          throw new Error('Unexpected Error! Failed to create recovery key.');
        }
        clearSecretStorageKeys();

        await crypto.bootstrapSecretStorage({
          createSecretStorageKey: async () => recoveryKeyData,
          setupNewSecretStorage: true,
        });

        await crypto.bootstrapCrossSigning({
          authUploadDeviceSigningKeys,
          setupNewCrossSigning: true,
        });

        await crypto.resetKeyBackup();

        onComplete(recoveryKeyData.encodedPrivateKey);
      },
      [mx, onComplete, authUploadDeviceSigningKeys, reset],
    ),
  );

  const loading = setupState.status === AsyncStatus.Loading;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (loading) return;

    const target = evt.target as HTMLFormElement | undefined;
    const passphraseInput = target?.passphraseInput as HTMLInputElement | undefined;
    let passphrase: string | undefined;
    if (passphraseInput && passphraseInput.value.length > 0) {
      passphrase = passphraseInput.value;
    }

    setup(passphrase);
  };

  return (
    <Box as="form" onSubmit={handleSubmit} direction="Column" gap="400">
      <Text size="T300">
        A <b>recovery key</b> lets you verify this account when no other device is signed in. It is
        the only way back into your encrypted messages if you lose every device.
      </Text>
      <Box direction="Column" gap="100">
        <Text size="L400">Passphrase (optional)</Text>
        <PasswordInput name="passphraseInput" size="400" readOnly={loading} />
        <Text size="T200" priority="300">
          A passphrase is a memorable way to produce the same key. It is not your login password.
        </Text>
      </Box>
      <Button
        type="submit"
        disabled={loading}
        before={loading && <Spinner size="200" variant="Primary" fill="Solid" />}
      >
        <Text size="B400">Create recovery key</Text>
      </Button>
      {setupState.status === AsyncStatus.Error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          <b>{setupState.error ? setupState.error.message : 'Unexpected Error!'}</b>
        </Text>
      )}
      {nextAuthData !== null && uiaAction && (
        <ActionUIAFlowsLoader
          authData={nextAuthData ?? uiaAction.authData}
          unsupported={() => (
            <Text size="T200">
              Authentication steps to perform this action are not supported by client.
            </Text>
          )}
        >
          {(ongoingFlow) => (
            <ActionUIA
              authData={nextAuthData ?? uiaAction.authData}
              ongoingFlow={ongoingFlow}
              action={handleAction}
              onCancel={uiaAction.cancelCallback}
            />
          )}
        </ActionUIAFlowsLoader>
      )}
    </Box>
  );
}

type RecoveryKeyDisplayProps = {
  recoveryKey: string;
  onDone: () => void;
};
export function RecoveryKeyDisplay({ recoveryKey, onDone }: RecoveryKeyDisplayProps) {
  const mx = useMatrixClient();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = () => {
    copyToClipboard(recoveryKey);
    setCopied(true);
  };

  const handleDownload = () => {
    const blob = new Blob([recoveryKey], {
      type: 'text/plain;charset=us-ascii',
    });
    FileSaver.saveAs(blob, recoveryKeyFilename(mx.getSafeUserId()));
  };

  const safeToDisplayKey = show ? recoveryKey : recoveryKey.replace(/[^\s]/g, '*');

  return (
    <Box direction="Column" gap="400">
      <Text size="T300">
        Save this key before you continue. It is shown once, and neither Prinny nor your homeserver
        can recover it. If you lose it and every signed-in device, your encrypted messages stay
        locked.
      </Text>
      <Box direction="Column" gap="100">
        <Text size="L400">Recovery key</Text>
        <Box
          className={ContainerColor({ variant: 'SurfaceVariant' })}
          style={{
            padding: config.space.S300,
            borderRadius: config.radii.R400,
          }}
          alignItems="Center"
          justifyContent="Center"
          gap="400"
        >
          <Text style={{ fontFamily: 'monospace' }} size="T200" priority="300">
            {safeToDisplayKey}
          </Text>
          <Chip onClick={() => setShow(!show)} variant="Secondary" radii="Pill">
            <Text size="B300">{show ? 'Hide' : 'Show'}</Text>
          </Chip>
        </Box>
      </Box>
      <Box direction="Column" gap="200">
        <Button onClick={handleCopy}>
          <Text size="B400">{copied ? 'Copied' : 'Copy key'}</Text>
        </Button>
        <Button onClick={handleDownload} fill="Soft">
          <Text size="B400">Download as file</Text>
        </Button>
      </Box>
      <Box
        alignItems="Center"
        gap="200"
        role="checkbox"
        aria-checked={saved}
        tabIndex={0}
        style={{ cursor: 'pointer' }}
        onClick={() => setSaved((v) => !v)}
        onKeyDown={(evt: KeyboardEvent) => {
          if (evt.key === ' ') {
            evt.preventDefault();
            setSaved((v) => !v);
          }
        }}
      >
        <Checkbox size="300" variant="Primary" checked={saved} readOnly tabIndex={-1} />
        <Text size="T300">I have saved my recovery key somewhere safe.</Text>
      </Box>
      <Button variant="Primary" disabled={!saved} onClick={onDone}>
        <Text size="B400">Done</Text>
      </Button>
    </Box>
  );
}

type DeviceVerificationSetupProps = {
  onCancel: () => void;
};
export const DeviceVerificationSetup = forwardRef<HTMLDivElement, DeviceVerificationSetupProps>(
  ({ onCancel }, ref) => {
    const [recoveryKey, setRecoveryKey] = useState<string>();

    return (
      <Dialog ref={ref}>
        <Header
          style={{
            padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
            borderBottomWidth: config.borderWidth.B300,
          }}
          variant="Surface"
          size="500"
        >
          <Box grow="Yes">
            <Text size="H4">Set up recovery</Text>
          </Box>
          {/* Once a key exists it must be saved first, so only Done closes the dialog. */}
          {!recoveryKey && (
            <IconButton size="300" radii="300" onClick={onCancel}>
              <Icon src={Icons.Cross} />
            </IconButton>
          )}
        </Header>
        <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
          {recoveryKey ? (
            <RecoveryKeyDisplay recoveryKey={recoveryKey} onDone={onCancel} />
          ) : (
            <SetupVerification onComplete={setRecoveryKey} />
          )}
        </Box>
      </Dialog>
    );
  },
);
type DeviceVerificationResetProps = {
  onCancel: () => void;
};
export const DeviceVerificationReset = forwardRef<HTMLDivElement, DeviceVerificationResetProps>(
  ({ onCancel }, ref) => {
    const [reset, setReset] = useState(false);

    return (
      <Dialog ref={ref}>
        <Header
          style={{
            padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
            borderBottomWidth: config.borderWidth.B300,
          }}
          variant="Surface"
          size="500"
        >
          <Box grow="Yes">
            <Text size="H4">Reset encryption identity</Text>
          </Box>
          {!reset && (
            <IconButton size="300" radii="300" onClick={onCancel}>
              <Icon src={Icons.Cross} />
            </IconButton>
          )}
        </Header>
        {reset ? (
          <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
            <UseStateProvider initial={undefined}>
              {(recoveryKey: string | undefined, setRecoveryKey) =>
                recoveryKey ? (
                  <RecoveryKeyDisplay recoveryKey={recoveryKey} onDone={onCancel} />
                ) : (
                  <SetupVerification onComplete={setRecoveryKey} reset />
                )
              }
            </UseStateProvider>
          </Box>
        ) : (
          <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
            <Box direction="Column" gap="300">
              <Text size="T300">
                This creates a new encryption identity and a new recovery key. It cannot be undone.
                Only do it if you have lost your recovery key and have no signed-in device to verify
                from.
              </Text>
              <Text as="div" size="T300">
                <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.5rem' }}>
                  <li>
                    Your current key backup is deleted, so messages that only exist there stay
                    locked.
                  </li>
                  <li>
                    Everyone who verified you sees a security warning, which is how they can tell
                    your identity changed.
                  </li>
                </ul>
              </Text>
            </Box>
            <Button variant="Critical" onClick={() => setReset(true)}>
              <Text size="B400">Reset encryption identity</Text>
            </Button>
          </Box>
        )}
      </Dialog>
    );
  },
);

/** The reset dialog on its own layer; only its buttons close it, never a stray click or Escape. */
export function DeviceVerificationResetOverlay({ onCancel }: DeviceVerificationResetProps) {
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: false,
            escapeDeactivates: false,
          }}
        >
          <DeviceVerificationReset onCancel={onCancel} />
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
