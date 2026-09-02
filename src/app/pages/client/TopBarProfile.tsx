import { useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, Text, Tooltip, TooltipProvider } from 'folds';
import { UserAvatar } from '../../components/user-avatar';
import { Modal500 } from '../../components/Modal500';
import { Settings } from '../../features/settings';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useUserPresence } from '../../hooks/useUserPresence';
import { useUserProfile } from '../../hooks/useUserProfile';
import { nameInitials } from '../../utils/common';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import * as css from './TopBar.css';

/**
 * Your own avatar, name, status line and the settings button, in the top bar.
 * This is where `SettingsTab` goes when `topBarProfile` is on — the sidebar
 * drops its copy so there is only ever one way in.
 */
export function TopBarProfile() {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = mx.getSafeUserId();
  const profile = useUserProfile(userId);
  const presence = useUserPresence(userId);
  const [settings, setSettings] = useState(false);

  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const status = presence?.status?.trim();
  const avatarUrl = profile.avatarUrl
    ? (mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 64, 64, 'crop') ?? undefined)
    : undefined;

  const openSettings = () => setSettings(true);
  const closeSettings = () => setSettings(false);

  return (
    <>
      <Box className={css.Profile} alignItems="Center" gap="200" shrink="Yes">
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
          {status && (
            <Text size="T200" priority="300" truncate>
              {status}
            </Text>
          )}
        </Box>
        <TooltipProvider
          position="Bottom"
          offset={4}
          tooltip={
            <Tooltip>
              <Text size="H5">User Settings</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              variant="Background"
              fill="None"
              size="300"
              onClick={openSettings}
              aria-label="User Settings"
              aria-pressed={settings}
            >
              <Icon size="200" src={Icons.Setting} filled={settings} />
            </IconButton>
          )}
        </TooltipProvider>
      </Box>
      {settings && (
        <Modal500 requestClose={closeSettings}>
          <Settings requestClose={closeSettings} />
        </Modal500>
      )}
    </>
  );
}
