import { MouseEventHandler, ReactNode, useState } from 'react';
import {
  Box,
  Text,
  Chip,
  Icon,
  Icons,
  RectCords,
  PopOut,
  Menu,
  config,
  MenuItem,
  color,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { stopPropagation } from '../utils/keyboard';
import { SettingTile } from './setting-tile';
import { SecretStorageKeyContent } from '../../types/matrix/accountData';
import { SecretStorageRecoveryKey, SecretStorageRecoveryPassphrase } from './SecretStorage';
import { AsyncStatus } from '../hooks/useAsyncCallback';
import { useVerifyWithRecoveryKey } from '../hooks/useVerifyWithRecoveryKey';
import { errorMessage } from '../utils/errorMessage';

export enum ManualVerificationMethod {
  RecoveryPassphrase = 'passphrase',
  RecoveryKey = 'key',
}
type ManualVerificationMethodSwitcherProps = {
  value: ManualVerificationMethod;
  onChange: (value: ManualVerificationMethod) => void;
};
export function ManualVerificationMethodSwitcher({
  value,
  onChange,
}: ManualVerificationMethodSwitcherProps) {
  const [menuCords, setMenuCords] = useState<RectCords>();

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (method: ManualVerificationMethod) => {
    setMenuCords(undefined);
    onChange(method);
  };

  return (
    <>
      <Chip
        type="button"
        variant="Secondary"
        fill="Soft"
        radii="Pill"
        before={<Icon size="100" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text as="span" size="B300">
          {value === ManualVerificationMethod.RecoveryPassphrase && 'Recovery passphrase'}
          {value === ManualVerificationMethod.RecoveryKey && 'Recovery key'}
        </Text>
      </Chip>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                <MenuItem
                  size="300"
                  variant="Surface"
                  aria-selected={value === ManualVerificationMethod.RecoveryPassphrase}
                  radii="300"
                  onClick={() => handleSelect(ManualVerificationMethod.RecoveryPassphrase)}
                >
                  <Box grow="Yes">
                    <Text size="T300">Recovery passphrase</Text>
                  </Box>
                </MenuItem>
                <MenuItem
                  size="300"
                  variant="Surface"
                  aria-selected={value === ManualVerificationMethod.RecoveryKey}
                  radii="300"
                  onClick={() => handleSelect(ManualVerificationMethod.RecoveryKey)}
                >
                  <Box grow="Yes">
                    <Text size="T300">Recovery key</Text>
                  </Box>
                </MenuItem>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

type ManualVerificationTileProps = {
  secretStorageKeyId: string;
  secretStorageKeyContent: SecretStorageKeyContent;
  options?: ReactNode;
  title?: string;
  description?: string;
  successMessage?: string;
};
export function ManualVerificationTile({
  secretStorageKeyId,
  secretStorageKeyContent,
  options,
  title = 'Verify Manually',
  description,
  successMessage = 'Device verified!',
}: ManualVerificationTileProps) {
  const hasPassphrase = !!secretStorageKeyContent.passphrase;
  const [method, setMethod] = useState(
    hasPassphrase
      ? ManualVerificationMethod.RecoveryPassphrase
      : ManualVerificationMethod.RecoveryKey,
  );

  const {
    verifyState,
    verify: handleDecodedRecoveryKey,
    verifying,
  } = useVerifyWithRecoveryKey(secretStorageKeyId);

  return (
    <Box direction="Column" gap="200">
      <SettingTile
        title={title}
        description={
          description ?? (hasPassphrase ? 'Select a verification method.' : 'Provide recovery key.')
        }
        after={
          <Box alignItems="Center" gap="200">
            {hasPassphrase && (
              <ManualVerificationMethodSwitcher value={method} onChange={setMethod} />
            )}
            {options}
          </Box>
        }
      />
      {verifyState.status === AsyncStatus.Success ? (
        <Text size="T200" style={{ color: color.Success.Main }}>
          <b>{successMessage}</b>
        </Text>
      ) : (
        <Box direction="Column" gap="100">
          {method === ManualVerificationMethod.RecoveryKey && (
            <SecretStorageRecoveryKey
              processing={verifying}
              keyContent={secretStorageKeyContent}
              onDecodedRecoveryKey={handleDecodedRecoveryKey}
            />
          )}
          {method === ManualVerificationMethod.RecoveryPassphrase &&
            secretStorageKeyContent.passphrase && (
              <SecretStorageRecoveryPassphrase
                processing={verifying}
                keyContent={secretStorageKeyContent}
                passphraseContent={secretStorageKeyContent.passphrase}
                onDecodedRecoveryKey={handleDecodedRecoveryKey}
              />
            )}
          {verifyState.status === AsyncStatus.Error && (
            <Text size="T200" style={{ color: color.Critical.Main }}>
              <b>{errorMessage(verifyState.error)}</b>
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
