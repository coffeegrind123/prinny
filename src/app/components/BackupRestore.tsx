import { MouseEventHandler, useCallback, useState } from 'react';
import { useAtom } from 'jotai';
import { CryptoApi, KeyBackupInfo, KeyBackupRestoreResult } from 'matrix-js-sdk/lib/crypto-api';
import {
  Badge,
  Box,
  Button,
  Chip,
  color,
  config,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  percent,
  PopOut,
  ProgressBar,
  RectCords,
  Spinner,
  Text,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { BackupProgressStatus, backupRestoreProgressAtom } from '../state/backupRestore';
import { InfoCard } from './info-card';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import {
  notifyKeyBackupInfoChanged,
  useKeyBackupInfo,
  useKeyBackupStatus,
  useKeyBackupSync,
  useKeyBackupTrust,
} from '../hooks/useKeyBackup';
import { stopPropagation } from '../utils/keyboard';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useBackupRestored } from '../state/backupRestored';
import { restoreKeyBackupAndRecord } from '../utils/backupRestore';
import { backupAdvice } from '../utils/backupAdvice';
import { deleteAllKeyBackups, recordKeyBackupChoice } from '../utils/keyBackupPreference';
import { ManualVerificationTile } from './ManualVerification';
import {
  useSecretStorageDefaultKeyId,
  useSecretStorageKeyContent,
} from '../hooks/useSecretStorage';
import { useRestoreBackupOnVerification } from '../hooks/useRestoreBackupOnVerification';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { RestoreBackupPrompt } from './RestoreBackupPrompt';
import { errorMessage } from '../utils/errorMessage';

type BackupStatusProps = {
  enabled: boolean;
};
function BackupStatus({ enabled }: BackupStatusProps) {
  return (
    <Box as="span" gap="100" alignItems="Center">
      <Badge variant={enabled ? 'Success' : 'Critical'} fill="Solid" size="200" radii="Pill" />
      <Text
        as="span"
        size="L400"
        style={{ color: enabled ? color.Success.Main : color.Critical.Main }}
      >
        {enabled ? 'Backing up' : 'Not backing up'}
      </Text>
    </Box>
  );
}
type BackupSyncingProps = {
  count: number;
};
function BackupSyncing({ count }: BackupSyncingProps) {
  return (
    <Box as="span" gap="100" alignItems="Center">
      <Spinner size="50" variant="Primary" fill="Soft" />
      <Text as="span" size="L400" style={{ color: color.Primary.Main }}>
        Syncing ({count})
      </Text>
    </Box>
  );
}

function BackupProgressFetching() {
  return (
    <Box grow="Yes" gap="200" alignItems="Center">
      <Badge variant="Secondary" fill="Solid" radii="300">
        <Text size="L400">Restoring: 0%</Text>
      </Badge>
      <Box grow="Yes" direction="Column">
        <ProgressBar variant="Secondary" size="300" min={0} max={1} value={0} />
      </Box>
      <Spinner size="50" variant="Secondary" fill="Soft" />
    </Box>
  );
}

type BackupProgressProps = {
  total: number;
  downloaded: number;
};
function BackupProgress({ total, downloaded }: BackupProgressProps) {
  return (
    <Box grow="Yes" gap="200" alignItems="Center">
      <Badge variant="Secondary" fill="Solid" radii="300">
        <Text size="L400">Restoring: {`${Math.round(percent(0, total, downloaded))}%`}</Text>
      </Badge>
      <Box grow="Yes" direction="Column">
        <ProgressBar variant="Secondary" size="300" min={0} max={total} value={downloaded} />
      </Box>
      <Badge variant="Secondary" fill="Soft" radii="Pill">
        <Text size="L400">
          {downloaded} / {total}
        </Text>
      </Badge>
    </Box>
  );
}

/** Offers the recovery key when this device cannot open the backup and so cannot restore it. */
function UnlockBackup() {
  const keyId = useSecretStorageDefaultKeyId();
  const keyContent = useSecretStorageKeyContent(keyId ?? '');
  const [open, setOpen] = useState(false);

  if (!keyId || !keyContent) {
    return (
      <Text size="T200">
        Verify this device from another device that is signed in to receive the key.
      </Text>
    );
  }

  if (!open) {
    return (
      <Box>
        <Button
          size="300"
          variant="Secondary"
          fill="Soft"
          radii="300"
          onClick={() => setOpen(true)}
        >
          <Text as="span" size="B300">
            Enter recovery key
          </Text>
        </Button>
      </Box>
    );
  }

  return (
    <ManualVerificationTile
      secretStorageKeyId={keyId}
      secretStorageKeyContent={keyContent}
      title="Unlock backup"
      description="Enter your recovery key or passphrase."
      successMessage="Backup unlocked. Older messages will restore in the background."
      options={
        <Chip
          type="button"
          variant="Secondary"
          fill="Soft"
          radii="Pill"
          onClick={() => setOpen(false)}
        >
          <Icon size="100" src={Icons.Cross} />
        </Chip>
      }
    />
  );
}

type BackupAdviceSectionProps = {
  crypto: CryptoApi;
  backupInfo: KeyBackupInfo;
  busy: boolean;
  onRestore: () => void;
};
/**
 * Says what the backup needs, and shows the Restore button only when pressing it would help:
 * the device can open the backup and has not restored it yet.
 */
function BackupAdviceSection({ crypto, backupInfo, busy, onRestore }: BackupAdviceSectionProps) {
  const mx = useMatrixClient();
  const trust = useKeyBackupTrust(crypto, backupInfo);
  const restored = useBackupRestored(
    mx.getSafeUserId(),
    mx.getDeviceId() ?? undefined,
    backupInfo.version,
  );
  const advice = backupAdvice(backupInfo, trust, restored);

  if (advice.kind === 'locked') {
    return (
      <Box direction="Column" gap="200">
        <Text size="T200">
          This device cannot open your backup yet, so it cannot restore older messages. It needs
          your recovery key.
        </Text>
        <UnlockBackup />
      </Box>
    );
  }

  if (advice.kind === 'restore') {
    return (
      <Box alignItems="Center" gap="300">
        <Box grow="Yes">
          <Text size="T200">
            Your backup has {advice.keys} message {advice.keys === 1 ? 'key' : 'keys'} this device
            has not restored. Restore them to read older messages here.
          </Text>
        </Box>
        <Box shrink="No">
          <Button
            size="300"
            variant="Success"
            radii="300"
            aria-disabled={busy}
            onClick={busy ? undefined : onRestore}
            before={<Icon size="100" src={Icons.Download} />}
          >
            <Text size="B300">Restore older messages</Text>
          </Button>
        </Box>
      </Box>
    );
  }

  return null;
}

/** Confirms deleting the server backup, since it is account-wide and cannot be undone. */
function TurnOffBackupDialog({ crypto, onClose }: { crypto: CryptoApi; onClose: () => void }) {
  const mx = useMatrixClient();
  const [state, turnOff] = useAsyncCallback<void, Error, []>(
    useCallback(async () => {
      await deleteAllKeyBackups(crypto);
      await recordKeyBackupChoice(mx, false);
      notifyKeyBackupInfoChanged();
      onClose();
    }, [mx, crypto, onClose]),
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
                <Text size="H4">Turn off server backup?</Text>
              </Box>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Box direction="Column" gap="200">
                <Text size="T300">
                  This deletes your key backup from your homeserver, for all your devices. They stop
                  backing up, and the backed up keys cannot be brought back.
                </Text>
                <Text size="T300">
                  Messages whose keys are only on a device you sign out of or lose become
                  unreadable. Your recovery key and verified devices are not affected.
                </Text>
                <Text size="T300" priority="300">
                  Export message keys first if you want a copy you keep yourself. You can turn the
                  backup on again later; it will hold the keys on the device you do it from.
                </Text>
              </Box>
              {state.status === AsyncStatus.Error && (
                <Text size="T300" style={{ color: color.Critical.Main }}>
                  <b>{errorMessage(state.error)}</b>
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
                    Turn off backup
                  </Text>
                </Button>
                <Button variant="Secondary" fill="Soft" disabled={busy} onClick={onClose}>
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

/** Creates a new backup and uploads this device's keys to it. */
function TurnOnBackup({ crypto }: { crypto: CryptoApi }) {
  const mx = useMatrixClient();
  const [state, turnOn] = useAsyncCallback<void, Error, []>(
    useCallback(async () => {
      await crypto.resetKeyBackup();
      await recordKeyBackupChoice(mx, true);
      notifyKeyBackupInfoChanged();
    }, [mx, crypto]),
  );
  const busy = state.status === AsyncStatus.Loading;

  return (
    <Box direction="Column" gap="200">
      <Text size="T200">
        A backup lets you read older messages after signing in on a new device. It is encrypted, so
        your homeserver cannot read it.
      </Text>
      <Box>
        <Button
          size="300"
          variant="Secondary"
          fill="Soft"
          radii="300"
          disabled={busy}
          before={busy && <Spinner size="100" variant="Secondary" fill="Soft" />}
          onClick={() => {
            turnOn().catch(() => undefined);
          }}
        >
          <Text as="span" size="B300">
            Turn on backup
          </Text>
        </Button>
      </Box>
      {state.status === AsyncStatus.Error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          <b>{errorMessage(state.error)}</b>
        </Text>
      )}
    </Box>
  );
}

const restoreSummary = ({ imported }: KeyBackupRestoreResult): string =>
  imported === 0
    ? 'Nothing new to restore: this device already had every key in the backup.'
    : `Restored ${imported} message ${imported === 1 ? 'key' : 'keys'}. Older messages will now open.`;

type BackupRestoreTileProps = {
  crypto: CryptoApi;
};
export function BackupRestoreTile({ crypto }: BackupRestoreTileProps) {
  const mx = useMatrixClient();
  const [restoreProgress, setRestoreProgress] = useAtom(backupRestoreProgressAtom);
  const restoring =
    restoreProgress.status === BackupProgressStatus.Fetching ||
    restoreProgress.status === BackupProgressStatus.Loading;

  const backupEnabled = useKeyBackupStatus(crypto);
  const backupInfo = useKeyBackupInfo(crypto);
  const [remainingSession, syncFailure] = useKeyBackupSync();

  const [menuCords, setMenuCords] = useState<RectCords>();
  const [turnOffOpen, setTurnOffOpen] = useState(false);

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const [restoreState, restoreBackup] = useAsyncCallback<KeyBackupRestoreResult, Error, []>(
    useCallback(
      () =>
        restoreKeyBackupAndRecord(
          crypto,
          mx.getSafeUserId(),
          mx.getDeviceId() ?? undefined,
          setRestoreProgress,
        ),
      [crypto, mx, setRestoreProgress],
    ),
  );
  const busy = restoreState.status === AsyncStatus.Loading || restoring;

  return (
    <InfoCard
      variant="Surface"
      title="Encryption Backup"
      after={
        <Box alignItems="Center" gap="200">
          {remainingSession === 0 ? (
            <BackupStatus enabled={backupEnabled} />
          ) : (
            <BackupSyncing count={remainingSession} />
          )}
          <IconButton
            aria-pressed={!!menuCords}
            size="300"
            variant="Surface"
            radii="300"
            onClick={handleMenu}
          >
            <Icon size="100" src={Icons.VerticalDots} />
          </IconButton>
          <PopOut
            anchor={menuCords}
            offset={5}
            position="Bottom"
            align="End"
            content={
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  // The menu only shows details, so nothing in it can take focus. Without a
                  // fallback the trap throws as soon as it opens.
                  fallbackFocus: '[data-backup-details-menu]',
                  onDeactivate: () => setMenuCords(undefined),
                  clickOutsideDeactivates: true,
                  isKeyForward: (evt: KeyboardEvent) =>
                    evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
                  isKeyBackward: (evt: KeyboardEvent) =>
                    evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Menu
                  data-backup-details-menu
                  tabIndex={-1}
                  style={{
                    padding: config.space.S100,
                  }}
                >
                  <Box direction="Column" gap="100">
                    <InfoCard
                      variant="SurfaceVariant"
                      title="Backup Details"
                      description={
                        <>
                          <span>Version: {backupInfo?.version ?? '-'}</span>
                          <br />
                          <span>Keys: {backupInfo?.count ?? '-'}</span>
                        </>
                      }
                    />
                    {backupInfo && (
                      <MenuItem
                        variant="Critical"
                        size="300"
                        radii="300"
                        fill="None"
                        onClick={() => {
                          setMenuCords(undefined);
                          setTurnOffOpen(true);
                        }}
                      >
                        <Text as="span" size="T300" truncate>
                          Turn off backup...
                        </Text>
                      </MenuItem>
                    )}
                  </Box>
                </Menu>
              </FocusTrap>
            }
          />
        </Box>
      }
    >
      {syncFailure && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          <b>{syncFailure}</b>
        </Text>
      )}
      {backupInfo === null && (
        <>
          <Text size="T200">
            There is no backup on the server, so your messages are only on your devices.
          </Text>
          <TurnOnBackup crypto={crypto} />
        </>
      )}
      {turnOffOpen && backupInfo && (
        <TurnOffBackupDialog crypto={crypto} onClose={() => setTurnOffOpen(false)} />
      )}
      {backupInfo && (
        <BackupAdviceSection
          crypto={crypto}
          backupInfo={backupInfo}
          busy={busy}
          // The failure is shown below, so the rethrown rejection would only add console noise.
          onRestore={() => {
            restoreBackup().catch(() => undefined);
          }}
        />
      )}
      {restoreState.status === AsyncStatus.Loading && !restoring && <BackupProgressFetching />}
      {restoreProgress.status === BackupProgressStatus.Fetching && <BackupProgressFetching />}
      {restoreProgress.status === BackupProgressStatus.Loading && (
        <BackupProgress
          total={restoreProgress.data.total}
          downloaded={restoreProgress.data.downloaded}
        />
      )}
      {restoreState.status === AsyncStatus.Success && (
        <Text size="T200" style={{ color: color.Success.Main }}>
          <b>{restoreSummary(restoreState.data)}</b>
        </Text>
      )}
      {restoreState.status === AsyncStatus.Error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          <b>{errorMessage(restoreState.error)}</b>
        </Text>
      )}
    </InfoCard>
  );
}

function AutoRestore() {
  useRestoreBackupOnVerification();

  return null;
}

export function AutoRestoreBackupOnVerification() {
  const [askBeforeRestore] = useSetting(settingsAtom, 'askBeforeBackupRestore');

  return askBeforeRestore ? <RestoreBackupPrompt /> : <AutoRestore />;
}
