import { MouseEventHandler, forwardRef, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Icon, Icons, Menu, MenuItem, PopOut, RectCords, Text, config, toRem } from 'folds';
import { Room } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { FocusTrap } from 'focus-trap-react';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { getDirectRoomPath } from '../../pathUtils';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
  SidebarStack,
  SidebarStackSeparator,
} from '../../../components/sidebar';
import { RoomUnreadProvider } from '../../../components/RoomUnreadProvider';
import { RoomAvatar } from '../../../components/room-avatar';
import { UnreadBadge } from '../../../components/unread-badge';
import { useDirectRooms } from '../direct/useDirectRooms';
import { markAsRead } from '../../../utils/notifications';
import { stopPropagation } from '../../../utils/keyboard';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { getDirectRoomAvatarUrl } from '../../../utils/room';
import { nameInitials } from '../../../utils/common';
import { factoryRoomIdByActivity } from '../../../utils/sort';

type DirectRoomMenuProps = {
  room: Room;
  requestClose: () => void;
};
const DirectRoomMenu = forwardRef<HTMLDivElement, DirectRoomMenuProps>(
  ({ room, requestClose }, ref) => {
    const [hideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');
    const mx = useMatrixClient();

    const handleMarkAsRead = () => {
      markAsRead(mx, room.roomId, hideReadReceipts);
      requestClose();
    };

    return (
      <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MenuItem
            onClick={handleMarkAsRead}
            size="300"
            after={<Icon size="100" src={Icons.CheckTwice} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              Mark as Read
            </Text>
          </MenuItem>
        </Box>
      </Menu>
    );
  },
);

type DirectRailButtonProps = {
  room: Room;
  selected: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
};
function DirectRailButton({ room, selected, onClick }: DirectRailButtonProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleContextMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    evt.preventDefault();
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <RoomUnreadProvider roomId={room.roomId}>
      {(unread) => (
        <SidebarItem active={selected}>
          <SidebarItemTooltip tooltip={room.name}>
            {(triggerRef) => (
              <SidebarAvatar
                as="button"
                data-room-id={room.roomId}
                ref={triggerRef}
                onClick={onClick}
                onContextMenu={handleContextMenu}
              >
                <RoomAvatar
                  roomId={room.roomId}
                  src={getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)}
                  alt={room.name}
                  renderFallback={() => <Text size="H4">{nameInitials(room.name, 2)}</Text>}
                />
              </SidebarAvatar>
            )}
          </SidebarItemTooltip>
          {unread && (
            <SidebarItemBadge hasCount={unread.total > 0}>
              <UnreadBadge highlight={unread.highlight > 0} count={unread.total} />
            </SidebarItemBadge>
          )}
          {menuAnchor && (
            <PopOut
              anchor={menuAnchor}
              position="Right"
              align="Start"
              content={
                <FocusTrap
                  focusTrapOptions={{
                    initialFocus: false,
                    returnFocusOnDeactivate: false,
                    onDeactivate: () => setMenuAnchor(undefined),
                    clickOutsideDeactivates: true,
                    isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                    isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                    escapeDeactivates: stopPropagation,
                  }}
                >
                  <DirectRoomMenu room={room} requestClose={() => setMenuAnchor(undefined)} />
                </FocusTrap>
              }
            />
          )}
        </SidebarItem>
      )}
    </RoomUnreadProvider>
  );
}

/**
 * Unread direct messages as avatar buttons in the client rail, under
 * `dmRailButtons`.
 *
 * The open chat stays in the list even once it has been read. The fork drops
 * it, which means the button vanishes from under the cursor that just clicked
 * it and the rail reshuffles on every visit; keeping it costs one entry and
 * makes the rail hold still.
 */
export function DirectRailButtons() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const directs = useDirectRooms();
  const selectedRoomId = useSelectedRoom();
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  const sortedDirects = useMemo(
    () =>
      Array.from(directs)
        .filter((rId) => roomToUnread.has(rId) || rId === selectedRoomId)
        .sort(factoryRoomIdByActivity(mx)),
    [mx, directs, roomToUnread, selectedRoomId],
  );

  const handleClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const targetRoomId = evt.currentTarget.getAttribute('data-room-id');
    if (!targetRoomId) return;

    navigate(getDirectRoomPath(getCanonicalAliasOrRoomId(mx, targetRoomId)));
  };

  if (sortedDirects.length === 0) return null;

  return (
    <>
      <SidebarStackSeparator />
      <SidebarStack>
        {sortedDirects.map((roomId) => {
          const room = mx.getRoom(roomId);
          if (!room) return null;
          return (
            <DirectRailButton
              key={roomId}
              room={room}
              selected={selectedRoomId === roomId}
              onClick={handleClick}
            />
          );
        })}
      </SidebarStack>
    </>
  );
}
