import { useCallback } from 'react';
import { Box, Button, Switch, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { SequenceCardStyle } from '../styles.css';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  appPresenceServerStatusAtom,
  richPresenceBridgeStatusAtom,
} from '../../../state/richPresenceBridge';
import { useTauriDesktop } from '../../../hooks/useTauriDesktop';
import { isAppAllowed } from '../../../utils/appPresence';

/**
 * MSC4544's per-app control: every app that has connected, with a switch of
 * its own, and the default for apps nobody has decided on (deny, as the MSC
 * requires, unless the user changes it).
 */
function AppPresenceApps() {
  const [policy, setPolicy] = useSetting(settingsAtom, 'appPresencePolicy');
  const [apps, setApps] = useSetting(settingsAtom, 'appPresenceApps');
  const server = useAtomValue(appPresenceServerStatusAtom);

  const entries = Object.entries(apps).sort(([, a], [, b]) => b.lastSeen - a.lastSeen);

  let where: string | undefined;
  if (server?.state === 'running') {
    where = [
      server.port !== undefined ? `ws://localhost:${server.port}/presence` : undefined,
      server.socket,
    ]
      .filter(Boolean)
      .join(' and ');
  }

  return (
    <>
      <SettingTile
        title="Apps can add to your activity"
        description={
          <Box direction="Column" gap="100">
            <Text size="T200" priority="300">
              Games and media players that support MSC4544 can send what you are doing to this app.
              Only apps you allow are published.
            </Text>
            {where && (
              <Text size="T200" priority="300" style={{ wordBreak: 'break-all' }}>
                Listening on {where}
              </Text>
            )}
            {server?.state === 'error' && (
              <Text size="T200" priority="300">
                Failed: {server.error}
              </Text>
            )}
          </Box>
        }
      />
      <SettingTile
        title="Allow new apps"
        description="Publish activity from apps you have not decided on yet. Off means each app waits until you allow it below."
        after={
          <Switch
            variant="Primary"
            value={policy === 'allow'}
            onChange={(value: boolean) => setPolicy(value ? 'allow' : 'deny')}
          />
        }
      />
      {entries.map(([appId, app]) => (
        <SettingTile
          key={appId}
          title={app.name}
          description={`Last heard from ${new Date(app.lastSeen).toLocaleString()}${
            app.allowed === undefined ? ' · not decided yet' : ''
          }`}
          after={
            <Box gap="200" alignItems="Center">
              <Button
                size="300"
                variant="Secondary"
                fill="Soft"
                radii="300"
                onClick={() =>
                  setApps((current) => {
                    const next = { ...current };
                    delete next[appId];
                    return next;
                  })
                }
              >
                <Text size="B300">Forget</Text>
              </Button>
              <Switch
                variant="Primary"
                aria-label={`Allow ${app.name}`}
                value={isAppAllowed(apps, policy, appId)}
                onChange={(value: boolean) =>
                  setApps((current) => ({
                    ...current,
                    [appId]: { ...current[appId], allowed: value },
                  }))
                }
              />
            </Box>
          }
        />
      ))}
    </>
  );
}

export function RichPresencePublish() {
  const [enabled, setEnabled] = useSetting(settingsAtom, 'publishRichPresence');
  const status = useAtomValue(richPresenceBridgeStatusAtom);
  const desktop = useTauriDesktop();

  const handleChange = useCallback((value: boolean) => setEnabled(value), [setEnabled]);

  let statusText: string | undefined;
  if (desktop && enabled && status) {
    if (status.state === 'starting') {
      statusText = 'Starting…';
    } else if (status.state === 'running') {
      statusText =
        status.index === 0
          ? `Listening on ${status.path}`
          : `Listening on ${status.path}, but another RPC server owns a lower slot — close Discord or arRPC to receive activity`;
    } else if (status.state === 'error') {
      statusText = `Failed: ${status.error}`;
    }
  }

  return (
    <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
      <SettingTile
        title="Publish rich presence"
        description={
          <Box direction="Column" gap="100">
            <Text size="T200" priority="300">
              {desktop
                ? "Impersonate Discord's local RPC server so media players and games broadcast their activity as your Matrix rich presence (MSC4320). Off by default for privacy; needs MSC4133 extended profiles on your homeserver."
                : 'Desktop only. A browser cannot listen on the Discord RPC pipe.'}
            </Text>
            {statusText && (
              <Text size="T200" priority="300">
                {statusText}
              </Text>
            )}
          </Box>
        }
        after={
          <Switch variant="Primary" value={enabled} onChange={handleChange} disabled={!desktop} />
        }
      />
      {desktop && enabled && <AppPresenceApps />}
    </SequenceCard>
  );
}
