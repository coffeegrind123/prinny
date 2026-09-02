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

// MSC4155: invites the server should reject on your behalf. Element only
// implements the "block everything" case and so does this — the per-user and
// per-server lists need a management UI of their own to be any use, and a
// half-built one that silently drops entries is worse than none.
const INVITE_RULES_TYPE = 'org.matrix.msc4155.invite_permission_config';

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
    const invite = mx.getAccountData(INVITE_RULES_TYPE as never)?.getContent<{
      blocked_users?: string[];
    }>();
    setBlockInvites(Array.isArray(invite?.blocked_users) && invite.blocked_users.includes('*'));

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

  const [saveState, save] = useAsyncCallback<void, Error, [string, object]>(
    useCallback(
      async (type, content) => {
        await mx.setAccountData(type as never, content as never);
        readSettings();
      },
      [mx, readSettings],
    ),
  );

  const saving = saveState.status === AsyncStatus.Loading;

  const setMedia = (
    next: Partial<{ media_previews: MediaPreviewValue; invite_avatars: 'on' | 'off' }>,
  ) =>
    save(MEDIA_PREVIEW_TYPE, {
      media_previews: mediaPreviews,
      invite_avatars: inviteAvatars,
      ...next,
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
          description="Your server rejects room invites before they reach you. People who already share a room with you are unaffected. Requires server support (MSC4155)."
          after={
            <Switch
              variant="Primary"
              value={blockInvites}
              disabled={saving}
              onChange={(value) =>
                save(INVITE_RULES_TYPE, value ? { blocked_users: ['*'] } : { blocked_users: [] })
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
