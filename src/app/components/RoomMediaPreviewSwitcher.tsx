import { Box, config, Icon, Icons, IconSrc, Menu, MenuItem, PopOut, RectCords, Text } from 'folds';
import { MouseEventHandler, ReactNode, useCallback, useState } from 'react';
import { FocusTrap } from 'focus-trap-react';
import { Room } from 'matrix-js-sdk';
import { stopPropagation } from '../utils/keyboard';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useRoomMediaPreviewLevel } from '../hooks/useMediaPreview';
import { MediaPreviewValue, mediaPreviewWrites } from '../utils/mediaPreview';

/** "default" = no room-level key, so the account-wide setting applies. */
export type RoomMediaPreviewChoice = 'default' | MediaPreviewValue;

const CHOICES: RoomMediaPreviewChoice[] = ['default', 'on', 'private', 'off'];

export const ROOM_MEDIA_PREVIEW_LABEL: Record<RoomMediaPreviewChoice, string> = {
  default: 'Default',
  on: 'Always',
  private: 'If room is private',
  off: 'Never',
};

const CHOICE_ICON: Record<RoomMediaPreviewChoice, IconSrc> = {
  default: Icons.Setting,
  on: Icons.Photo,
  private: Icons.Lock,
  off: Icons.EyeBlind,
};

export const getRoomMediaPreviewIcon = (choice: RoomMediaPreviewChoice) => CHOICE_ICON[choice];

/** The room's MSC4278 override, as the room menu shows it. */
export const useRoomMediaPreviewChoice = (room: Room): RoomMediaPreviewChoice =>
  useRoomMediaPreviewLevel(room).media_previews ?? 'default';

type RoomMediaPreviewSwitcherProps = {
  room: Room;
  children: (
    handleOpen: MouseEventHandler<HTMLButtonElement>,
    opened: boolean,
    changing: boolean,
  ) => ReactNode;
};

/**
 * Per-room MSC4278 override, written as room account data (stable and
 * unstable). Room keys win over the account-wide ones, one key at a time, so
 * only `media_previews` is touched here; an `invite_avatars` key another
 * client put on the room is kept as it is.
 */
export function RoomMediaPreviewSwitcher({ room, children }: RoomMediaPreviewSwitcherProps) {
  const mx = useMatrixClient();
  const level = useRoomMediaPreviewLevel(room);
  const value: RoomMediaPreviewChoice = level.media_previews ?? 'default';

  const [changeState, change] = useAsyncCallback<void, Error, [RoomMediaPreviewChoice]>(
    useCallback(
      async (choice) => {
        const next = { ...level };
        if (choice === 'default') {
          delete next.media_previews;
        } else {
          next.media_previews = choice;
        }
        // Account data cannot be deleted on most servers; an object without
        // the key falls through to the account-wide setting, which is the same.
        for (const [type, content] of Object.entries(mediaPreviewWrites(next))) {
          await mx.setRoomAccountData(room.roomId, type as never, content as never);
        }
      },
      [mx, room, level],
    ),
  );
  const changing = changeState.status === AsyncStatus.Loading;

  const [menuCords, setMenuCords] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleClose = () => {
    setMenuCords(undefined);
  };

  const handleSelect = (choice: RoomMediaPreviewChoice) => {
    if (changing) return;
    if (choice !== value) change(choice).catch(() => undefined);
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
              {CHOICES.map((choice) => (
                <MenuItem
                  key={choice}
                  size="300"
                  variant="Surface"
                  aria-pressed={choice === value}
                  radii="300"
                  disabled={changing}
                  onClick={() => handleSelect(choice)}
                  before={<Icon size="100" src={CHOICE_ICON[choice]} filled={choice === value} />}
                >
                  <Text size="T300">
                    {choice === value ? (
                      <b>{ROOM_MEDIA_PREVIEW_LABEL[choice]}</b>
                    ) : (
                      ROOM_MEDIA_PREVIEW_LABEL[choice]
                    )}
                  </Text>
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
