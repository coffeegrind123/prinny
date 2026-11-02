import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Spinner, Switch, Text, color } from 'folds';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { isTauri } from '../../../utils/desktop-notifications';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useAccountDataCallback } from '../../../hooks/useAccountDataCallback';
import {
  INVITE_CONFIG_MSC4155,
  INVITE_CONFIG_STABLE,
  INVITE_CONFIG_UNSTABLE,
  blocksAllInvites,
  inviteBlockingWrites,
} from '../../../utils/inviteBlocking';

// Invites the server rejects on your behalf: MSC4380 (merged) plus the older
// MSC4155 form, see utils/inviteBlocking.ts. Only "block everything" is
// offered; MSC4155's per-user and per-server lists need a management UI of
// their own, and entries made in another client are kept untouched.
const INVITE_CONFIG_TYPES = [INVITE_CONFIG_STABLE, INVITE_CONFIG_UNSTABLE, INVITE_CONFIG_MSC4155];

// MSC4278: whether the client should load media and avatars from rooms you
// have not joined. Off means a stranger cannot make your client fetch anything
// simply by inviting you.
const MEDIA_PREVIEW_TYPE = 'io.element.msc4278.media_preview_config';

type MediaPreviewValue = 'on' | 'private' | 'off';

export function PrivacySettings() {
  const mx = useMatrixClient();
  const [contentProtection, setContentProtection] = useSetting(settingsAtom, 'contentProtection');

  const [blockInvites, setBlockInvites] = useState(false);
  const [mediaPreviews, setMediaPreviews] = useState<MediaPreviewValue>('on');
  const [inviteAvatars, setInviteAvatars] = useState<'on' | 'off'>('on');

  // Read once on mount, then again whenever the server pushes a change — these
  // settings follow the account, so another client changing them must not leave
  // this one showing something else.
  const readSettings = useCallback(() => {
    setBlockInvites(
      blocksAllInvites(
        Object.fromEntries(
          INVITE_CONFIG_TYPES.map((type) => [type, mx.getAccountData(type as never)?.getContent()]),
        ),
      ),
    );

    const media = mx.getAccountData(MEDIA_PREVIEW_TYPE as never)?.getContent<{
      media_previews?: MediaPreviewValue;
      invite_avatars?: 'on' | 'off';
    }>();
    setMediaPreviews(media?.media_previews ?? 'on');
    setInviteAvatars(media?.invite_avatars ?? 'on');
  }, [mx]);

  useEffect(() => {
    readSettings();
  }, [readSettings]);

  useAccountDataCallback(
    mx,
    useCallback(
      (event) => {
        const type = event.getType();
        if (INVITE_CONFIG_TYPES.includes(type) || type === MEDIA_PREVIEW_TYPE) readSettings();
      },
      [readSettings],
    ),
  );

  const [saveState, save] = useAsyncCallback<void, Error, [Record<string, object>]>(
    useCallback(
      async (writes) => {
        // Stable first: a server that knows it decides by it.
        for (const [type, content] of Object.entries(writes)) {
          await mx.setAccountData(type as never, content as never);
        }
        readSettings();
      },
      [mx, readSettings],
    ),
  );

  const saving = saveState.status === AsyncStatus.Loading;

  const setMedia = (
    next: Partial<{ media_previews: MediaPreviewValue; invite_avatars: 'on' | 'off' }>,
  ) =>
    save({
      [MEDIA_PREVIEW_TYPE]: {
        media_previews: mediaPreviews,
        invite_avatars: inviteAvatars,
        ...next,
      },
    });

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Privacy</Text>

      {isTauri() && (
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <SettingTile
            title="Hide window from screen capture"
            description="Asks the system to leave this window out of screenshots and screen recordings. Works on Windows and macOS; most Linux desktops ignore it."
            after={
              <Switch variant="Primary" value={contentProtection} onChange={setContentProtection} />
            }
          />
        </SequenceCard>
      )}
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Block all incoming invites"
          description="Your server rejects every room invite before it reaches you, including from people you already share a room with. Requires server support (MSC4380, or the older MSC4155)."
          after={
            <Switch
              variant="Primary"
              value={blockInvites}
              disabled={saving}
              onChange={(value) =>
                save(
                  inviteBlockingWrites(
                    value,
                    mx.getAccountData(INVITE_CONFIG_MSC4155 as never)?.getContent(),
                  ),
                )
              }
            />
          }
        />
      </SequenceCard>

      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Show media previews"
          description="Loading a preview fetches it from the sender's server, which tells that server you have opened the message."
        >
          <Box gap="100" style={{ marginTop: '8px' }}>
            {(['on', 'private', 'off'] as MediaPreviewValue[]).map((value) => (
              <Button
                key={value}
                size="300"
                variant={mediaPreviews === value ? 'Primary' : 'Secondary'}
                fill={mediaPreviews === value ? 'Solid' : 'None'}
                radii="Pill"
                disabled={saving}
                onClick={() => setMedia({ media_previews: value })}
              >
                <Text size="T300">
                  {value === 'on' && 'Always'}
                  {value === 'private' && 'Private rooms only'}
                  {value === 'off' && 'Never'}
                </Text>
              </Button>
            ))}
          </Box>
        </SettingTile>

        <SettingTile
          title="Show avatars in invites"
          description="Turn off so a room you have been invited to by a stranger cannot make your client fetch its picture."
          after={
            <Switch
              variant="Primary"
              value={inviteAvatars === 'on'}
              disabled={saving}
              onChange={(value) => setMedia({ invite_avatars: value ? 'on' : 'off' })}
            />
          }
        />

        {saveState.status === AsyncStatus.Error && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            Could not save. Your server may not support this setting yet.
          </Text>
        )}
        {saving && <Spinner size="100" variant="Secondary" />}
      </SequenceCard>
    </Box>
  );
}
