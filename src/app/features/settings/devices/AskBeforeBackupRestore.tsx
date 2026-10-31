import { Switch } from 'folds';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

export function AskBeforeBackupRestoreTile() {
  const [askBeforeRestore, setAskBeforeRestore] = useSetting(
    settingsAtom,
    'askBeforeBackupRestore',
  );

  return (
    <SettingTile
      title="Ask Before Restoring Backup"
      description="When this device gains access to your key backup, ask before importing all of it instead of restoring right away. Keys for single messages are still fetched from the backup when they are needed, as long as the backup is on."
      after={<Switch variant="Primary" value={askBeforeRestore} onChange={setAskBeforeRestore} />}
    />
  );
}
