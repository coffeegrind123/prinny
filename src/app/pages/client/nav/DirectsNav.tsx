import { RefObject, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValue } from 'jotai';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavItem,
  NavItemContent,
} from '../../../components/nav';
import { getDirectCreatePath, getDirectRoomPath } from '../../pathUtils';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useDirectCreateSelected } from '../../../hooks/router/useDirectSelected';
import { useDirectRooms } from '../direct/useDirectRooms';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomNavCategoryLabel, RoomNavItem } from '../../../features/room-nav';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useRoomFavourites } from '../../../hooks/useRoomFavourites';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { factoryRoomIdByActivity, factoryRoomIdByPinned } from '../../../utils/sort';
import { useScrollElement } from '../../../hooks/useScrollElement';
import { useScrollMargin } from '../../../hooks/useScrollMargin';
import { useRegisterNavRoomOrder } from '../../../state/hooks/navRoomOrder';

/**
 * Create Chat. Direct messages keep their own `/direct` route tree whichever
 * nav lists them, so there is no base to parameterise here — under
 * `unifiedHomeSidebar` it is the Home nav that `/direct` renders.
 */
export function DirectsNavActions() {
  const navigate = useNavigate();
  const createDirectSelected = useDirectCreateSelected();

  return (
    <NavItem variant="Background" radii="400" aria-selected={createDirectSelected}>
      <NavButton onClick={() => navigate(getDirectCreatePath())}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <Avatar size="200" radii="400">
              <Icon src={Icons.Plus} size="100" />
            </Avatar>
            <Box as="span" grow="Yes">
              <Text as="span" size="Inherit" truncate>
                Create Chat
              </Text>
            </Box>
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );
}

type DirectsNavListProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
};

/** The "Chats" category: every direct message room. */
export function DirectsNavList({ scrollRef }: DirectsNavListProps) {
  const mx = useMatrixClient();
  const directs = useDirectRooms();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const selectedRoomId = useSelectedRoom();
  const [unreadOnly] = useSetting(settingsAtom, 'unreadDirectsOnly');
  const pinned = useRoomFavourites();

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollElement = useScrollElement(scrollRef);
  const scrollMargin = useScrollMargin(scrollRef, containerRef);

  const sortedDirects = useMemo(() => {
    const items = Array.from(directs).sort(
      factoryRoomIdByPinned(pinned, factoryRoomIdByActivity(mx)),
    );
    if (unreadOnly) {
      // A pin survives the filter by design: the point of pinning someone is to
      // keep them reachable, which a filter that hides read chats would
      // otherwise undo for exactly the chats you care most about.
      return items.filter(
        (rId) => pinned.has(rId) || roomToUnread.has(rId) || rId === selectedRoomId,
      );
    }
    return items;
  }, [mx, directs, pinned, roomToUnread, selectedRoomId, unreadOnly]);

  // Publish the rendered order so keyboard navigation moves through this list
  // rather than an internal one. Chats sit below rooms wherever both are shown.
  useRegisterNavRoomOrder(20, sortedDirects);

  const virtualizer = useVirtualizer({
    count: sortedDirects.length,
    // Resolved through state rather than read off the ref directly: the
    // scroll container is an ANCESTOR of this list, so its ref is still
    // null while this component's layout effects run. See useScrollElement.
    getScrollElement: () => scrollElement,
    estimateSize: () => 38,
    overscan: 10,
    scrollMargin,
  });

  return (
    <NavCategory>
      <NavCategoryHeader>
        {/*
          No collapse chevron here. "Collapsing" this category did not hide
          anything — it filtered the list down to unread chats, which is
          precisely what "Show unread only" in the header menu does. Two
          controls, one behaviour, independent states, and nothing to say which
          was in charge. The menu item is now the only unread filter.
        */}
        <RoomNavCategoryLabel>Chats</RoomNavCategoryLabel>
      </NavCategoryHeader>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          height: virtualizer.getTotalSize(),
        }}
      >
        {virtualizer.getVirtualItems().map((vItem) => {
          const roomId = sortedDirects[vItem.index];
          const room = mx.getRoom(roomId);
          if (!room) return null;
          const selected = selectedRoomId === roomId;

          return (
            <VirtualTile
              virtualItem={vItem}
              scrollMargin={scrollMargin}
              key={vItem.index}
              ref={virtualizer.measureElement}
            >
              <RoomNavItem
                room={room}
                selected={selected}
                showAvatar
                direct
                pinnable
                linkPath={getDirectRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
              />
            </VirtualTile>
          );
        })}
      </div>
    </NavCategory>
  );
}
