import { MouseEventHandler, useEffect, useRef, useState } from 'react';
import { FocusTrap } from 'focus-trap-react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  config,
  Icon,
  IconButton,
  Icons,
  MainColor,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  Tooltip,
  TooltipProvider,
  toRem,
} from 'folds';
import { UserAvatar } from '../../components/user-avatar';
import { Modal500 } from '../../components/Modal500';
import { PresenceStatus } from '../../components/presence';
import { UserHero, UserHeroName } from '../../components/user-profile/UserHero';
import { UserBiography } from '../../components/user-profile/UserBiography';
import { UserRichPresence } from '../../components/user-profile/UserRichPresence';
import { Settings, SettingsPages } from '../../features/settings';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { Presence, useUserPresence } from '../../hooks/useUserPresence';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useUserRichPresence } from '../../hooks/useUserRichPresence';
import { nameInitials } from '../../utils/common';
import { copyToClipboard } from '../../utils/dom';
import { stopPropagation } from '../../utils/keyboard';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { saveChosenPresence, useChosenPresence, useOwnStatusLine } from '../../state/ownPresence';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import {
  getProfileBanner,
  getProfileBiography,
  getProfilePronouns,
} from '../../../types/matrix/profile';
import * as css from './TopBar.css';

const PRESENCE_OPTIONS: { presence: Presence; label: string; color: MainColor }[] = [
  { presence: Presence.Online, label: 'Online', color: 'Success' },
  { presence: Presence.Unavailable, label: 'Away', color: 'Warning' },
  // Offline is what everyone else sees; to the user it is being invisible.
  { presence: Presence.Offline, label: 'Invisible', color: 'Secondary' },
];

// The focus trap closes the menu on the same press that reaches the trigger,
// so a click on the trigger right after a close is that same press.
const REOPEN_GUARD_MS = 300;

type AccountMenuProps = {
  requestClose: () => void;
  openSettings: (page?: SettingsPages) => void;
};
function AccountMenu({ requestClose, openSettings }: AccountMenuProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = mx.getSafeUserId();
  const profile = useUserProfile(userId);
  const presence = useUserPresence(userId);
  const richPresence = useUserRichPresence(userId);
  const chosen = useChosenPresence();
  const status = useOwnStatusLine(userId);

  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? (mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication) ?? undefined)
    : undefined;
  const bannerMxc = getProfileBanner(profile.extended);
  const bannerUrl = bannerMxc
    ? (mxcUrlToHttp(mx, bannerMxc, useAuthentication) ?? undefined)
    : undefined;
  const biography = getProfileBiography(profile.extended);
  const pronouns = getProfilePronouns(profile.extended)
    .map((pronoun) => pronoun.summary)
    .join(', ');

  const choose = (next: Presence) => {
    saveChosenPresence(mx, next).catch(() => undefined);
    requestClose();
  };

  return (
    <Menu style={{ width: toRem(320) }}>
      <Box direction="Column">
        <UserHero
          userId={userId}
          avatarUrl={avatarUrl}
          bannerUrl={bannerUrl}
          profileLoaded={profile.loaded}
          presence={presence && presence.lastActiveTs !== 0 ? presence : undefined}
          status={status || undefined}
        />
        <Box direction="Column" gap="300" style={{ padding: config.space.S400 }}>
          <UserHeroName displayName={displayName} userId={userId} pronouns={pronouns} />
          {biography && <UserBiography biography={biography} />}
          {richPresence && <UserRichPresence presence={richPresence} />}
        </Box>
      </Box>
      <Box gap="100" style={{ padding: `${config.space.S200} ${config.space.S200} 0` }}>
        {PRESENCE_OPTIONS.map(({ presence: option, label, color }) => {
          const selected = chosen === option;
          return (
            <Button
              key={option}
              size="300"
              radii="300"
              variant={selected ? 'Primary' : 'Secondary'}
              fill={selected ? 'Soft' : 'None'}
              aria-pressed={selected}
              style={{ flexGrow: 1, minWidth: 0 }}
              before={
                <Badge
                  size="200"
                  variant={color}
                  fill={option === Presence.Offline ? 'Soft' : 'Solid'}
                  radii="Pill"
                />
              }
              onClick={() => choose(option)}
            >
              <Text size="B300" truncate>
                {label}
              </Text>
            </Button>
          );
        })}
      </Box>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MenuItem
          size="300"
          radii="300"
          before={<Icon size="100" src={Icons.Pencil} />}
          onClick={() => openSettings(SettingsPages.AccountPage)}
        >
          <Text size="B400">Edit Profile</Text>
        </MenuItem>
        <MenuItem
          size="300"
          radii="300"
          before={<Icon size="100" src={Icons.User} />}
          onClick={() => {
            copyToClipboard(userId);
            requestClose();
          }}
        >
          <Text size="B400">Copy User ID</Text>
        </MenuItem>
      </Box>
    </Menu>
  );
}

/**
 * Your own avatar, name, status line and the settings button, in the top bar.
 * This is where `SettingsTab` goes when `topBarProfile` is on — the sidebar
 * drops its copy so there is only ever one way in.
 *
 * With `presencePicker` on, the avatar and name open a profile menu, and the
 * status line also shows your own rich presence.
 */
export function TopBarProfile() {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = mx.getSafeUserId();
  const profile = useUserProfile(userId);
  const [presencePicker] = useSetting(settingsAtom, 'presencePicker');
  const richPresence = useUserRichPresence(userId);
  const [settings, setSettings] = useState<{ page?: SettingsPages }>();
  const [menuCords, setMenuCords] = useState<RectCords>();
  const closedAtRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const status = useOwnStatusLine(userId);
  const avatarUrl = profile.avatarUrl
    ? (mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 64, 64, 'crop') ?? undefined)
    : undefined;

  const closeMenu = () => {
    closedAtRef.current = Date.now();
    setMenuCords(undefined);
  };
  const openSettings = (page?: SettingsPages) => {
    setMenuCords(undefined);
    setSettings({ page });
  };
  const closeSettings = () => setSettings(undefined);

  // Close on any press outside the menu. The focus trap alone misses presses
  // on elements that swallow focus, such as the timeline's scroller.
  useEffect(() => {
    if (!menuCords) {
      return undefined;
    }
    const handlePress = (evt: PointerEvent) => {
      const target = evt.target as Node | null;
      if (target && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) {
        return;
      }
      closedAtRef.current = Date.now();
      setMenuCords(undefined);
    };
    document.addEventListener('pointerdown', handlePress, true);
    return () => document.removeEventListener('pointerdown', handlePress, true);
  }, [menuCords]);

  const handleOpenMenu: MouseEventHandler<HTMLElement> = (evt) => {
    if (menuCords) {
      closeMenu();
      return;
    }
    if (Date.now() - closedAtRef.current < REOPEN_GUARD_MS) {
      return;
    }
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const identity = (
    <>
      <Box shrink="No">
        <Avatar className={css.ProfileAvatar} size="300" radii="300">
          <UserAvatar
            userId={userId}
            src={avatarUrl}
            alt={displayName}
            renderFallback={() => <Text size="H5">{nameInitials(displayName)}</Text>}
          />
        </Avatar>
      </Box>
      <Box className={css.ProfileText} direction="Column" gap="0">
        <Text size="L400" truncate>
          {displayName}
        </Text>
        {presencePicker && (status || richPresence) && (
          <PresenceStatus status={status || undefined} richPresence={richPresence} />
        )}
        {!presencePicker && status && (
          <Text size="T200" priority="300" truncate>
            {status}
          </Text>
        )}
      </Box>
    </>
  );

  return (
    <>
      <Box className={css.Profile} alignItems="Center" gap="200" shrink="Yes">
        {presencePicker ? (
          <PopOut
            anchor={menuCords}
            position="Bottom"
            align="Start"
            offset={4}
            content={
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: closeMenu,
                  clickOutsideDeactivates: true,
                  returnFocusOnDeactivate: false,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <div ref={menuRef}>
                  <AccountMenu requestClose={closeMenu} openSettings={openSettings} />
                </div>
              </FocusTrap>
            }
          >
            <Box
              as="button"
              type="button"
              ref={triggerRef}
              className={css.ProfileButton}
              alignItems="Center"
              gap="200"
              grow="Yes"
              aria-haspopup="menu"
              aria-expanded={!!menuCords}
              onClick={handleOpenMenu}
            >
              {identity}
            </Box>
          </PopOut>
        ) : (
          identity
        )}
        <TooltipProvider
          position="Bottom"
          offset={4}
          tooltip={
            <Tooltip>
              <Text size="H5">User Settings</Text>
            </Tooltip>
          }
        >
          {(tooltipRef) => (
            <IconButton
              ref={tooltipRef}
              variant="Background"
              fill="None"
              size="300"
              onClick={() => openSettings()}
              aria-label="User Settings"
              aria-pressed={!!settings}
            >
              <Icon size="200" src={Icons.Setting} filled={!!settings} />
            </IconButton>
          )}
        </TooltipProvider>
      </Box>
      {settings && (
        <Modal500 requestClose={closeSettings}>
          <Settings initialPage={settings.page} requestClose={closeSettings} />
        </Modal500>
      )}
    </>
  );
}
