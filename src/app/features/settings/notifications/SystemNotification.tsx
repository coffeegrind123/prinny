import { MouseEventHandler, useCallback, useRef, useState } from 'react';
import {
  Box,
  Text,
  Switch,
  Button,
  color,
  config,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Spinner,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { IPusherRequest } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { getNotificationState, usePermissionState } from '../../../hooks/usePermission';
import { useEmailNotifications } from '../../../hooks/useEmailNotifications';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { requestNotificationPermission } from '../../../utils/desktop-notifications';
import { stopPropagation } from '../../../utils/keyboard';
import { DEFAULT_SOUND_PACK, SOUND_PACKS, getSoundUrl } from '../../../sound/soundPacks';

function SelectSoundPack({ disabled }: { disabled?: boolean }) {
  const [soundPack, setSoundPack] = useSetting(settingsAtom, 'soundPack');
  const [menuCords, setMenuCords] = useState<RectCords>();
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  // A pack that was removed reads as the default, which is what plays.
  const current =
    SOUND_PACKS.find((pack) => pack.id === soundPack) ??
    SOUND_PACKS.find((pack) => pack.id === DEFAULT_SOUND_PACK);

  const preview = (id: string) => {
    previewRef.current?.pause();
    const audio = new Audio(getSoundUrl(id, 'message'));
    previewRef.current = audio;
    audio.play().catch(() => undefined);
  };

  const handleSelect = (id: string) => {
    setSoundPack(id);
    setMenuCords(undefined);
    preview(id);
  };

  return (
    <Box gap="100" alignItems="Center">
      <IconButton
        size="300"
        radii="300"
        variant="Secondary"
        disabled={disabled}
        aria-label="Play the message sound"
        onClick={() => preview(current?.id ?? DEFAULT_SOUND_PACK)}
      >
        <Icon size="100" src={Icons.Play} />
      </IconButton>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        disabled={disabled}
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">{current?.label ?? 'Default'}</Text>
      </Button>
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
                {SOUND_PACKS.map((pack) => (
                  <MenuItem
                    key={pack.id}
                    size="300"
                    variant={current?.id === pack.id ? 'Primary' : 'Surface'}
                    radii="300"
                    onClick={() => handleSelect(pack.id)}
                  >
                    <Text size="T300">{pack.label}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </Box>
  );
}

function EmailNotification() {
  const mx = useMatrixClient();
  const [result, refreshResult] = useEmailNotifications();

  const [setState, setEnable] = useAsyncCallback(
    useCallback(
      async (email: string, enable: boolean) => {
        if (enable) {
          await mx.setPusher({
            kind: 'email',
            app_id: 'm.email',
            pushkey: email,
            app_display_name: 'Email Notifications',
            device_display_name: email,
            lang: 'en',
            data: {
              brand: 'Cinny',
            },
            append: true,
          });
          return;
        }
        await mx.setPusher({
          pushkey: email,
          app_id: 'm.email',
          kind: null,
        } as unknown as IPusherRequest);
      },
      [mx],
    ),
  );

  const handleChange = (value: boolean) => {
    if (result && result.email) {
      setEnable(result.email, value).then(() => {
        refreshResult();
      });
    }
  };

  return (
    <SettingTile
      title="Email Notification"
      description={
        <>
          {result && !result.email && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              Your account does not have any email attached.
            </Text>
          )}
          {result && result.email && <>Send notification to your email. {`("${result.email}")`}</>}
          {result === null && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              Unexpected Error!
            </Text>
          )}
          {result === undefined && 'Send notification to your email.'}
        </>
      }
      after={
        <>
          {setState.status !== AsyncStatus.Loading &&
            typeof result === 'object' &&
            result?.email && <Switch value={result.enabled} onChange={handleChange} />}
          {(setState.status === AsyncStatus.Loading || result === undefined) && (
            <Spinner variant="Secondary" />
          )}
        </>
      }
    />
  );
}

export function SystemNotification() {
  const notifPermission = usePermissionState('notifications', getNotificationState());
  const [showNotifications, setShowNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationContentMode, setNotificationContentMode] = useSetting(
    settingsAtom,
    'notificationContentMode',
  );
  const [isNotificationSounds, setIsNotificationSounds] = useSetting(
    settingsAtom,
    'isNotificationSounds',
  );

  const handleRequestPermission = () => {
    requestNotificationPermission();
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">System</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Notifications"
          description={
            notifPermission === 'denied' ? (
              <Text as="span" style={{ color: color.Critical.Main }} size="T200">
                {'Notification' in window
                  ? 'Notification permission is blocked. Please allow notification permission from browser address bar.'
                  : 'Notifications are not supported by the system.'}
              </Text>
            ) : (
              <span>Show notifications when messages arrive.</span>
            )
          }
          after={
            notifPermission === 'prompt' ? (
              <Button size="300" radii="300" onClick={handleRequestPermission}>
                <Text size="B300">Enable</Text>
              </Button>
            ) : (
              <Switch
                disabled={notifPermission !== 'granted'}
                value={showNotifications}
                onChange={setShowNotifications}
              />
            )
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
          title="Notification Sound"
          description="Play a sound when a new message arrives or someone calls you."
          after={<Switch value={isNotificationSounds} onChange={setIsNotificationSounds} />}
        />
        <SettingTile
          title="Sound Pack"
          description="Sounds for new messages, invites and incoming calls."
          after={<SelectSoundPack disabled={!isNotificationSounds} />}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Hide message content"
          description="Show only the sender's name in system notifications. Message text — including decrypted text from encrypted rooms — is otherwise handed to the operating system, which stores it in its notification history where other apps may be able to read it."
          after={
            <Switch
              value={notificationContentMode !== 'full'}
              onChange={(value) => setNotificationContentMode(value ? 'sender-only' : 'full')}
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
        <EmailNotification />
      </SequenceCard>
    </Box>
  );
}
