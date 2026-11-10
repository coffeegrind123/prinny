import { useState } from 'react';
import { Box, Text, IconButton, Icon, Icons, Scroll } from 'folds';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useDeviceIds, useDeviceList, useSplitCurrentDevice } from '../../../hooks/useDeviceList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { LocalBackup } from './LocalBackup';
import { OnlyVerifiedDevicesTile } from './OnlyVerifiedDevices';
import { useOtherVerifiedDevices } from '../../../hooks/useOtherVerifiedDevices';
import { AskBeforeBackupRestoreTile } from './AskBeforeBackupRestore';
import { VerifyAfterSignInTile } from './VerifyAfterSignIn';
import { DeviceLogoutBtn, DeviceKeyDetails, DeviceTile, DeviceTilePlaceholder } from './DeviceTile';
import { OtherDevices } from './OtherDevices';
import {
  DeviceVerificationOptions,
  EnableVerification,
  VerificationStatusBadge,
  VerifyCurrentDeviceTile,
} from './Verification';
import {
  useDeviceVerificationStatus,
  useUnverifiedDeviceCount,
  VerificationStatus,
} from '../../../hooks/useDeviceVerificationStatus';
import {
  useSecretStorageDefaultKeyId,
  useSecretStorageKeyContent,
} from '../../../hooks/useSecretStorage';
import {
  CrossSigningStatus,
  useCrossSigningStatus,
  useRecoveryActive,
} from '../../../hooks/useCrossSigning';
import { recoveryTileState } from '../../../utils/recoveryTile';
import { SetupMode } from '../../../components/DeviceVerificationSetup';
import { BackupRestoreTile } from '../../../components/BackupRestore';
import type { IdentityState } from '../../device-verification-gate/verificationGate';

function DevicesPlaceholder() {
  return (
    <Box direction="Column" gap="100">
      <DeviceTilePlaceholder />
      <DeviceTilePlaceholder />
    </Box>
  );
}

const IDENTITY_BY_STATUS: Record<CrossSigningStatus, IdentityState> = {
  [CrossSigningStatus.Unknown]: 'unknown',
  [CrossSigningStatus.Active]: 'present',
  [CrossSigningStatus.Inactive]: 'absent',
};

type DevicesProps = {
  requestClose: () => void;
};
export function Devices({ requestClose }: DevicesProps) {
  const mx = useMatrixClient();
  const crypto = mx.getCrypto();
  const crossSigningStatus = useCrossSigningStatus();
  const crossSigningActive = crossSigningStatus === CrossSigningStatus.Active;
  const recoveryOn = useRecoveryActive();
  const recoveryTile = recoveryTileState(recoveryOn, IDENTITY_BY_STATUS[crossSigningStatus]);
  const [devices, refreshDeviceList] = useDeviceList();

  const [currentDevice, otherDevices] = useSplitCurrentDevice(devices);
  const verificationStatus = useDeviceVerificationStatus(
    crypto,
    mx.getSafeUserId(),
    currentDevice?.device_id,
  );

  const otherDevicesId = useDeviceIds(otherDevices);
  const otherVerifiedDevices = useOtherVerifiedDevices();

  // The verification dialog lives inside the tile, and the tile only shows while this device is
  // unverified. A verification that succeeded unmounted the dialog with it, so the reader never
  // saw "Your device is verified". Keep the tile while its dialog is open.
  const [verifying, setVerifying] = useState(false);
  const unverifiedDeviceCount = useUnverifiedDeviceCount(
    crypto,
    mx.getSafeUserId(),
    otherDevicesId,
  );

  const defaultSecretStorageKeyId = useSecretStorageDefaultKeyId();
  const defaultSecretStorageKeyContent = useSecretStorageKeyContent(
    defaultSecretStorageKeyId ?? '',
  );

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Devices
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              <Box direction="Column" gap="700">
                <Box direction="Column" gap="100">
                  <Text size="L400">Security</Text>
                  <SequenceCard
                    className={SequenceCardStyle}
                    variant="SurfaceVariant"
                    direction="Column"
                    gap="400"
                  >
                    <SettingTile
                      title="Device Verification"
                      description={
                        recoveryTile === 'turnOn'
                          ? 'Recovery is off. Devices can still be verified from another device you are signed in on. Turn recovery on to get a recovery key again.'
                          : 'To verify device identity and grant access to encrypted messages. Recovery keeps an encrypted copy of your cross-signing keys on your homeserver; the key to it stays on your devices.'
                      }
                      after={
                        // Both can show at once (recovery off, identity present), so space them.
                        <Box gap="200" alignItems="Center">
                          <EnableVerification
                            visible={recoveryTile !== 'manage'}
                            loading={recoveryTile === 'checking'}
                            mode={recoveryTile === 'turnOn' ? SetupMode.TurnOn : SetupMode.Create}
                          />
                          {crossSigningActive && (
                            <Box gap="200" alignItems="Center">
                              <VerificationStatusBadge
                                verificationStatus={verificationStatus}
                                otherUnverifiedCount={unverifiedDeviceCount}
                              />
                              <DeviceVerificationOptions recoveryOn={recoveryOn} />
                            </Box>
                          )}
                        </Box>
                      }
                    />
                    <OnlyVerifiedDevicesTile />
                    <AskBeforeBackupRestoreTile />
                    <VerifyAfterSignInTile />
                  </SequenceCard>
                </Box>
                <Box direction="Column" gap="100">
                  <Text size="L400">Current</Text>
                  {currentDevice ? (
                    <SequenceCard
                      className={SequenceCardStyle}
                      variant="SurfaceVariant"
                      direction="Column"
                      gap="400"
                    >
                      <DeviceTile
                        device={currentDevice}
                        refreshDeviceList={refreshDeviceList}
                        options={<DeviceLogoutBtn />}
                      >
                        {crypto && <DeviceKeyDetails crypto={crypto} />}
                      </DeviceTile>
                      {crossSigningActive &&
                        (verifying || verificationStatus === VerificationStatus.Unverified) && (
                          <VerifyCurrentDeviceTile
                            secretStorageKeyId={defaultSecretStorageKeyId}
                            secretStorageKeyContent={defaultSecretStorageKeyContent}
                            hasVerifiedOtherDevice={otherVerifiedDevices === 'available'}
                            onVerifyingChange={setVerifying}
                          />
                        )}
                      {crypto && verificationStatus === VerificationStatus.Verified && (
                        <BackupRestoreTile crypto={crypto} />
                      )}
                    </SequenceCard>
                  ) : (
                    <DeviceTilePlaceholder />
                  )}
                </Box>
                {devices === undefined && <DevicesPlaceholder />}
                {otherDevices && (
                  <OtherDevices
                    devices={otherDevices}
                    refreshDeviceList={refreshDeviceList}
                    showVerification={
                      crossSigningActive && verificationStatus === VerificationStatus.Verified
                    }
                  />
                )}
                <LocalBackup />
              </Box>
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
