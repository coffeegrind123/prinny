import { Box, config, Icon, Menu, MenuItem, PopOut, RectCords, Text } from 'folds';
import { MouseEventHandler, ReactNode, useCallback, useState } from 'react';
import { FocusTrap } from 'focus-trap-react';
import { stopPropagation } from '../utils/keyboard';
import {
  getRoomNotificationMode,
  getRoomNotificationModeIcon,
  RoomNotificationMode,
  RoomsNotificationPreferences,
  setRoomNotificationPreference,
} from '../hooks/useRoomsNotificationPreferences';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';

const NOTIFICATION_MODES: RoomNotificationMode[] = [
  RoomNotificationMode.Unset,
  RoomNotificationMode.AllMessages,
  RoomNotificationMode.SpecialMessages,
  RoomNotificationMode.Mute,
];

const MODE_TO_STR: Record<RoomNotificationMode, string> = {
  [RoomNotificationMode.Unset]: 'Default',
  [RoomNotificationMode.AllMessages]: 'All Messages',
  [RoomNotificationMode.SpecialMessages]: 'Mention & Keywords',
  [RoomNotificationMode.Mute]: 'Mute',
};

type SpaceNotificationModeSwitcherProps = {
  roomIds: string[];
  preferences: RoomsNotificationPreferences;
  children: (
    handleOpen: MouseEventHandler<HTMLButtonElement>,
    opened: boolean,
    changing: boolean,
  ) => ReactNode;
};
export function SpaceNotificationModeSwitcher({
  roomIds,
  preferences,
  children,
}: SpaceNotificationModeSwitcherProps) {
  const mx = useMatrixClient();

  const [applyState, applyMode] = useAsyncCallback(
    useCallback(
      async (mode: RoomNotificationMode) => {
        // Apply sequentially: push rule updates share one account-data
        // event, so concurrent writes can clobber each other.
        for (const roomId of roomIds) {
          const previousMode = getRoomNotificationMode(preferences, roomId);
          try {
            await setRoomNotificationPreference(mx, roomId, mode, previousMode);
          } catch {
            // Keep going so one bad room doesn't block the rest.
          }
        }
      },
      [mx, roomIds, preferences],
    ),
  );
  const changing = applyState.status === AsyncStatus.Loading;

  const [menuCords, setMenuCords] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleClose = () => {
    setMenuCords(undefined);
  };

  const handleSelect = (mode: RoomNotificationMode) => {
    if (changing) return;
    applyMode(mode);
    handleClose();
  };

  return (
    <PopOut
      anchor={menuCords}
      offset={5}
      position="Right"
      align="Start"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: handleClose,
            clickOutsideDeactivates: true,
            isKeyForward: (evt: KeyboardEvent) =>
              evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
            isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu>
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              <Text size="T200" style={{ padding: config.space.S100 }}>
                {`Apply to all ${roomIds.length} room${roomIds.length === 1 ? '' : 's'}`}
              </Text>
              {NOTIFICATION_MODES.map((mode) => (
                <MenuItem
                  key={mode}
                  size="300"
                  variant="Surface"
                  radii="300"
                  disabled={changing || roomIds.length === 0}
                  onClick={() => handleSelect(mode)}
                  before={<Icon size="100" src={getRoomNotificationModeIcon(mode)} />}
                >
                  <Text size="T300">{MODE_TO_STR[mode]}</Text>
                </MenuItem>
              ))}
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      {children(handleOpenMenu, !!menuCords, changing)}
    </PopOut>
  );
}
