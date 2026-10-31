import { useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { FocusTrap } from 'focus-trap-react';
import { CryptoApi, KeyBackupRestoreResult } from 'matrix-js-sdk/lib/crypto-api';
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
import { useBackupAdvice } from '../hooks/useBackupAdvice';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { backupRestoreProgressAtom } from '../state/backupRestore';
import {
  declineBackupRestore,
  settleBackupBaseline,
  useBackupBaselineSettled,
  useBackupRestoreDeclined,
} from '../state/backupRestored';
import { restoreKeyBackupAndRecord } from '../utils/backupRestore';

function Prompt({ crypto }: { crypto: CryptoApi }) {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const deviceId = mx.getDeviceId() ?? undefined;

  const { info, advice } = useBackupAdvice(crypto);
  const declined = useBackupRestoreDeclined(userId, deviceId, info?.version);
  const settled = useBackupBaselineSettled(userId, deviceId);
  const setRestoreProgress = useSetAtom(backupRestoreProgressAtom);

  const [restoreState, restore] = useAsyncCallback<KeyBackupRestoreResult, Error, []>(
    useCallback(
      () => restoreKeyBackupAndRecord(crypto, userId, deviceId, setRestoreProgress),
      [crypto, userId, deviceId, setRestoreProgress],
    ),
  );

  // An existing device that already has the key is not asked; see settleBackupBaseline.
  useEffect(() => {
    if (deviceId) settleBackupBaseline(userId, deviceId, advice.kind, info?.version);
  }, [userId, deviceId, advice.kind, info?.version]);

  // Once restored the advice becomes 'ok', so the question closes itself.
  // Nothing is asked before the baseline is settled, so an existing device never sees a flash.
  if (!settled || advice.kind !== 'restore' || declined || !info || !deviceId) return null;

  const busy = restoreState.status === AsyncStatus.Loading;

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
                <Text size="H4">Restore older messages?</Text>
              </Box>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Box direction="Column" gap="200">
                <Text size="T300">
                  Your homeserver holds an encrypted backup of the keys for your older messages.
                  Restoring imports all of them now, so older messages open on this device.
                </Text>
                <Text size="T300">
                  Keys from the backup cannot be traced back to the sender&apos;s device, so
                  messages they open show a grey shield.
                </Text>
                <Text size="T300" priority="300">
                  Not now only skips this bulk import. While the backup is on, this device still
                  fetches the key for a message from it when that message needs one. To stop using
                  backup keys altogether, turn the backup off under Settings, Devices.
                </Text>
              </Box>
              {restoreState.status === AsyncStatus.Error && (
                <Text size="T300" style={{ color: color.Critical.Main }}>
                  <b>{restoreState.error.message}</b>
                </Text>
              )}
              <Box direction="Column" gap="200">
                <Button
                  variant="Primary"
                  disabled={busy}
                  before={busy && <Spinner size="200" variant="Primary" fill="Solid" />}
                  onClick={() => {
                    // The failure is shown above, so the rethrown rejection would only add noise.
                    restore().catch(() => undefined);
                  }}
                >
                  <Text as="span" size="B400">
                    Restore from backup
                  </Text>
                </Button>
                <Button
                  variant="Secondary"
                  fill="Soft"
                  disabled={busy}
                  onClick={() => declineBackupRestore(userId, deviceId, info.version)}
                >
                  <Text as="span" size="B400">
                    Not now
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

/**
 * Asks whether to import the whole server backup once this device can open it, instead of the
 * automatic restore. "Not now" is remembered per device and backup, and the restore row in
 * Settings stays available. It does not stop the SDK fetching single keys from a trusted backup
 * on demand (PerSessionKeyBackupDownloader); only turning the backup off does that.
 */
export function RestoreBackupPrompt() {
  const crypto = useMatrixClient().getCrypto();
  return crypto ? <Prompt crypto={crypto} /> : null;
}
