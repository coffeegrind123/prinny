import { useCallback } from 'react';
import { Switch } from 'folds';
import {
  AllDevicesIsolationMode,
  OnlySignedDevicesIsolationMode,
} from 'matrix-js-sdk/lib/crypto-api';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

/**
 * Toggle the device-isolation mode that controls whether message encryption
 * keys are shared with all devices (the lenient default) or only with
 * cross-signed sessions (MSC4153 "Exclude insecure devices").
 *
 * The setting is persisted in localStorage and re-applied on every client init
 * (see `src/client/initMatrix.ts`). When toggled at runtime, we also push the
 * change to the live crypto instance immediately so the next outbound
 * encryption uses the new mode without a reload.
 */
export function OnlyVerifiedDevicesTile() {
  const mx = useMatrixClient();
  const [onlySignedDevices, setOnlySignedDevices] = useSetting(settingsAtom, 'onlySignedDevices');

  const handleChange = useCallback(
    (value: boolean) => {
      setOnlySignedDevices(value);
      const crypto = mx.getCrypto();
      if (crypto) {
        crypto.setDeviceIsolationMode(
          value ? new OnlySignedDevicesIsolationMode() : new AllDevicesIsolationMode(false),
        );
      }
    },
    [mx, setOnlySignedDevices],
  );

  return (
    <SettingTile
      title="Only Verified Sessions"
      description="Only share message encryption keys with cross-signed sessions. Messages from unverified sessions won't decrypt. Sending will fail if any participant has an unverified session."
      after={<Switch variant="Primary" value={onlySignedDevices} onChange={handleChange} />}
    />
  );
}
