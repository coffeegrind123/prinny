import { MouseEventHandler, forwardRef, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Menu,
  PopOut,
  RectCords,
  Text,
  config,
  toRem,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { NavCategory, NavEmptyCenter, NavEmptyLayout } from '../../../components/nav';
import { getExplorePath, getRoomsCreatePath } from '../../pathUtils';
import { useHomeRooms } from '../home/useHomeRooms';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { PageNav, PageNavHeader, PageNavContent } from '../../../components/page';
import { stopPropagation } from '../../../utils/keyboard';
import { MarkAsReadMenuItem, RoomsNavActions, RoomsNavList, UnreadOnlyMenuItem } from '../nav';

type RoomsMenuProps = {
  rooms: string[];
  requestClose: () => void;
};
const RoomsMenu = forwardRef<HTMLDivElement, RoomsMenuProps>(({ rooms, requestClose }, ref) => (
  <Menu ref={ref} style={{ maxWidth: toRem(200), width: '100vw' }}>
    <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
      <UnreadOnlyMenuItem setting="unreadRoomsOnly">Show unread only</UnreadOnlyMenuItem>
      <MarkAsReadMenuItem rooms={rooms} requestClose={requestClose} />
    </Box>
  </Menu>
));

function RoomsHeader({ rooms }: { rooms: string[] }) {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" truncate>
              Rooms
            </Text>
          </Box>
          <Box>
            <IconButton aria-pressed={!!menuAnchor} variant="Background" onClick={handleOpenMenu}>
              <Icon src={Icons.VerticalDots} size="200" />
            </IconButton>
          </Box>
        </Box>
      </PageNavHeader>
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
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
            <RoomsMenu rooms={rooms} requestClose={() => setMenuAnchor(undefined)} />
          </FocusTrap>
        }
      />
    </>
  );
}

function RoomsEmpty() {
  const navigate = useNavigate();

  return (
    <NavEmptyCenter>
      <NavEmptyLayout
        icon={<Icon size="600" src={Icons.Hash} />}
        title={
          <Text size="H5" align="Center">
            No Rooms
          </Text>
        }
        content={
          <Text size="T300" align="Center">
            You do not have any rooms yet.
          </Text>
        }
        options={
          <>
            <Button onClick={() => navigate(getRoomsCreatePath())} variant="Secondary" size="300">
              <Text size="B300" truncate>
                Create Room
              </Text>
            </Button>
            <Button
              onClick={() => navigate(getExplorePath())}
              variant="Secondary"
              fill="Soft"
              size="300"
            >
              <Text size="B300" truncate>
                Explore Community Rooms
              </Text>
            </Button>
          </>
        }
      />
    </NavEmptyCenter>
  );
}

/**
 * Spaceless rooms as their own space-like nav, reached from the rail rather
 * than from inside Home. The same rooms and the same list — see
 * `RoomsNavList` — under `/rooms` links instead of `/home` ones, so that
 * opening one keeps you in the nav you clicked from.
 */
export function Rooms() {
  useNavToActivePathMapper('rooms');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rooms = useHomeRooms();
  const noRoomToDisplay = rooms.length === 0;

  return (
    <PageNav resizable>
      <RoomsHeader rooms={rooms} />
      {noRoomToDisplay ? (
        <RoomsEmpty />
      ) : (
        <PageNavContent scrollRef={scrollRef}>
          <Box direction="Column" gap="300">
            <NavCategory>
              <RoomsNavActions base="rooms" />
            </NavCategory>
            <RoomsNavList base="rooms" scrollRef={scrollRef} />
          </Box>
        </PageNavContent>
      )}
    </PageNav>
  );
}
