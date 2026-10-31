import { Switch } from 'folds';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

export function VerifyAfterSignInTile() {
  const [verifyAfterSignIn, setVerifyAfterSignIn] = useSetting(settingsAtom, 'verifyAfterSignIn');

  return (
    <SettingTile
      title="Verify After Sign-In"
      description="On a device that is not verified yet, show a full-page step before the app: verify with another device or your recovery key, or set up recovery if the account has none. It can be skipped; a banner then stays at the top until this device is verified."
      after={<Switch variant="Primary" value={verifyAfterSignIn} onChange={setVerifyAfterSignIn} />}
    />
  );
}
