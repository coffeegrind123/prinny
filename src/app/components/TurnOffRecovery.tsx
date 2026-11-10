import { useCallback } from 'react';
import { FocusTrap } from 'focus-trap-react';
import {
  Box,
  Button,
  Dialog,
  Header,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { notifyKeyBackupInfoChanged } from '../hooks/useKeyBackup';
import { clearSecretStorageKeys } from '../../client/secretStorageKeys';
import { deleteAllKeyBackups, recordKeyBackupChoice } from '../utils/keyBackupPreference';
import { errorMessage } from '../utils/errorMessage';

/**
 * Confirms removing recovery from the homeserver: the stored copy of the
 * cross-signing keys, the backup key, the recovery key's description, every
 * message key backup, and a dehydrated device if there is one. Devices that
 * are verified stay verified, and the identity itself is untouched, so it can
 * be turned on again later from a device that holds the identity keys.
 *
 * The backup opt-out is recorded as well (MSC4287, as Element does), or
 * Element would see the missing backup as broken and offer to recreate it.
 */
export function TurnOffRecoveryOverlay({ onCancel }: { onCancel: () => void }) {
  const mx = useMatrixClient();

  const [state, turnOff] = useAsyncCallback<void, Error, []>(
    useCallback(async () => {
      const crypto = mx.getCrypto();
      if (!crypto) throw new Error('Encryption is not available on this device.');
      // disableKeyStorage deletes only the current backup version; there can be more.
      await deleteAllKeyBackups(crypto);
      await crypto.disableKeyStorage();
      clearSecretStorageKeys();
      await recordKeyBackupChoice(mx, false);
      notifyKeyBackupInfoChanged();
      onCancel();
    }, [mx, onCancel]),
  );
  const busy = state.status === AsyncStatus.Loading;

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
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">Turn off recovery?</Text>
              </Box>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Box direction="Column" gap="200">
                <Text size="T300">
                  This deletes the copy of your cross-signing keys stored on your homeserver, your
                  message key backup, and an offline device if one was set up, for all your devices.
                  Your recovery key stops working.
                </Text>
                <Text size="T300">
                  Devices that are verified stay verified. A new device can then only be verified
                  from another device you are signed in on. If you lose all of them, you lose your
                  identity and your message history.
                </Text>
                <Text size="T300" priority="300">
                  Export your message keys first if you want a copy you keep yourself. You can turn
                  recovery on again later from a verified device.
                </Text>
              </Box>
              {state.status === AsyncStatus.Error && (
                <Text size="T300" style={{ color: color.Critical.Main }}>
                  <b>{errorMessage(state.error, 'Could not turn off recovery.')}</b>
                </Text>
              )}
              <Box direction="Column" gap="200">
                <Button
                  variant="Critical"
                  disabled={busy}
                  before={busy && <Spinner size="200" variant="Critical" fill="Solid" />}
                  onClick={() => {
                    // The failure is shown above, so the rethrown rejection would only add noise.
                    turnOff().catch(() => undefined);
                  }}
                >
                  <Text as="span" size="B400">
                    Turn off recovery
                  </Text>
                </Button>
                <Button variant="Secondary" fill="Soft" disabled={busy} onClick={onCancel}>
                  <Text as="span" size="B400">
                    Cancel
                  </Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
