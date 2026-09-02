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
  NavLink,
} from '../../../components/nav';
import {
  encodeSearchParamValueArray,
  getHomeCreatePath,
  getHomeRoomPath,
  getHomeSearchPath,
  getRoomsCreatePath,
  getRoomsRoomPath,
  getRoomsSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  useHomeCreateSelected,
  useHomeSearchSelected,
} from '../../../hooks/router/useHomeSelected';
import {
  useRoomsCreateSelected,
  useRoomsSearchSelected,
} from '../../../hooks/router/useRoomsSelected';
import { useHomeRooms } from '../home/useHomeRooms';
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
import { UseStateProvider } from '../../../components/UseStateProvider';
import { JoinAddressPrompt } from '../../../components/join-address-prompt';
import { _RoomSearchParams } from '../../paths';
import {
  factoryRoomIdByActivity,
  factoryRoomIdByAtoZ,
  factoryRoomIdByPinned,
} from '../../../utils/sort';
import { useScrollElement } from '../../../hooks/useScrollElement';
import { useScrollMargin } from '../../../hooks/useScrollMargin';
import { useRegisterNavRoomOrder } from '../../../state/hooks/navRoomOrder';

/**
 * Which route tree the orphan-room list is being rendered under. The two are
 * the same list of rooms with the same behaviour; only the links differ, and
 * they have to differ or a click would navigate out of the nav you clicked in.
 */
export type RoomsNavBase = 'home' | 'rooms';

const roomsNavPaths = {
  home: {
    create: getHomeCreatePath,
    search: getHomeSearchPath,
    room: getHomeRoomPath,
  },
  rooms: {
    create: getRoomsCreatePath,
    search: getRoomsSearchPath,
    room: getRoomsRoomPath,
  },
} as const;

type RoomsNavProps = {
  base: RoomsNavBase;
};

/** Create Room, Join with Address and Message Search, linked into `base`. */
export function RoomsNavActions({ base }: RoomsNavProps) {
  const navigate = useNavigate();
  const paths = roomsNavPaths[base];

  const homeCreateSelected = useHomeCreateSelected();
  const homeSearchSelected = useHomeSearchSelected();
  const roomsCreateSelected = useRoomsCreateSelected();
  const roomsSearchSelected = useRoomsSearchSelected();

  const createSelected = base === 'home' ? homeCreateSelected : roomsCreateSelected;
  const searchSelected = base === 'home' ? homeSearchSelected : roomsSearchSelected;

  return (
    <>
      <NavItem variant="Background" radii="400" aria-selected={createSelected}>
        <NavButton onClick={() => navigate(paths.create())}>
          <NavItemContent>
            <Box as="span" grow="Yes" alignItems="Center" gap="200">
              <Avatar size="200" radii="400">
                <Icon src={Icons.Plus} size="100" />
              </Avatar>
              <Box as="span" grow="Yes">
                <Text as="span" size="Inherit" truncate>
                  Create Room
                </Text>
              </Box>
            </Box>
          </NavItemContent>
        </NavButton>
      </NavItem>
      <UseStateProvider initial={false}>
        {(open, setOpen) => (
          <>
            <NavItem variant="Background" radii="400">
              <NavButton onClick={() => setOpen(true)}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.Link} size="100" />
                    </Avatar>
                    <Box as="span" grow="Yes">
                      <Text as="span" size="Inherit" truncate>
                        Join with Address
                      </Text>
                    </Box>
                  </Box>
                </NavItemContent>
              </NavButton>
            </NavItem>
            {open && (
              <JoinAddressPrompt
                onCancel={() => setOpen(false)}
                onOpen={(roomIdOrAlias, viaServers, eventId) => {
                  setOpen(false);
                  const path = paths.room(roomIdOrAlias, eventId);
                  navigate(
                    viaServers
                      ? withSearchParam<_RoomSearchParams>(path, {
                          viaServers: encodeSearchParamValueArray(viaServers),
                        })
                      : path,
                  );
                }}
              />
            )}
          </>
        )}
      </UseStateProvider>
      <NavItem variant="Background" radii="400" aria-selected={searchSelected}>
        <NavLink to={paths.search()}>
          <NavItemContent>
            <Box as="span" grow="Yes" alignItems="Center" gap="200">
              <Avatar size="200" radii="400">
                <Icon src={Icons.Search} size="100" filled={searchSelected} />
              </Avatar>
              <Box as="span" grow="Yes">
                <Text as="span" size="Inherit" truncate>
                  Message Search
                </Text>
              </Box>
            </Box>
          </NavItemContent>
        </NavLink>
      </NavItem>
    </>
  );
}

type RoomsNavListProps = RoomsNavProps & {
  scrollRef: RefObject<HTMLDivElement | null>;
};

/** The "Rooms" category: every joined room with no space above it. */
export function RoomsNavList({ base, scrollRef }: RoomsNavListProps) {
  const mx = useMatrixClient();
  const rooms = useHomeRooms();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const selectedRoomId = useSelectedRoom();
  const [unreadOnly] = useSetting(settingsAtom, 'unreadRoomsOnly');
  const pinned = useRoomFavourites();
  const paths = roomsNavPaths[base];

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollElement = useScrollElement(scrollRef);
  const scrollMargin = useScrollMargin(scrollRef, containerRef);

  const sortedRooms = useMemo(() => {
    // Activity order while filtered, A-Z otherwise. Same pairing the collapsed
    // category used to have: a list showing only what has news reads better
    // newest-first, a full list reads better alphabetically.
    const items = Array.from(rooms).sort(
      factoryRoomIdByPinned(
        pinned,
        unreadOnly ? factoryRoomIdByActivity(mx) : factoryRoomIdByAtoZ(mx),
      ),
    );
    if (unreadOnly) {
      return items.filter(
        (rId) => pinned.has(rId) || roomToUnread.has(rId) || rId === selectedRoomId,
      );
    }
    return items;
  }, [mx, rooms, pinned, roomToUnread, selectedRoomId, unreadOnly]);

  // See DirectsNavList: keyboard navigation steps through what is rendered
  // here, sort order, pins, unread filter and all.
  useRegisterNavRoomOrder(10, sortedRooms);

  const virtualizer = useVirtualizer({
    count: sortedRooms.length,
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
          See the matching note in DirectsNavList: the chevron here filtered
          rather than collapsed. "Show unread only" in the header menu is now
          the sole filter.
        */}
        <RoomNavCategoryLabel>Rooms</RoomNavCategoryLabel>
      </NavCategoryHeader>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          height: virtualizer.getTotalSize(),
        }}
      >
        {virtualizer.getVirtualItems().map((vItem) => {
          const roomId = sortedRooms[vItem.index];
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
                pinnable
                linkPath={paths.room(getCanonicalAliasOrRoomId(mx, roomId))}
                notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
              />
            </VirtualTile>
          );
        })}
      </div>
    </NavCategory>
  );
}
