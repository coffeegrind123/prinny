import { MouseEventHandler, forwardRef, useMemo, useRef, useState } from 'react';
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
import { getDirectCreatePath, getExplorePath, getHomeCreatePath } from '../../pathUtils';
import { useHomeRooms } from './useHomeRooms';
import { useDirectRooms } from '../direct/useDirectRooms';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { PageNav, PageNavHeader, PageNavContent } from '../../../components/page';
import { stopPropagation } from '../../../utils/keyboard';
import { useShellLayout } from '../../../hooks/useShellLayout';
import {
  DirectsNavActions,
  DirectsNavList,
  MarkAsReadMenuItem,
  RoomsNavActions,
  RoomsNavList,
  UnreadOnlyMenuItem,
} from '../nav';

type HomeMenuProps = {
  rooms: string[];
  showRooms: boolean;
  showDirects: boolean;
  requestClose: () => void;
};
const HomeMenu = forwardRef<HTMLDivElement, HomeMenuProps>(
  ({ rooms, showRooms, showDirects, requestClose }, ref) => (
    <Menu ref={ref} style={{ maxWidth: toRem(220), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        {/*
          The unread filter used to be the category's collapse chevron, which
          hid nothing and filtered instead. It is a filter, so it lives with the
          other filters. A merged nav carries one per list, each naming its own.
        */}
        {showRooms && (
          <UnreadOnlyMenuItem setting="unreadRoomsOnly">
            {showDirects ? 'Show unread rooms only' : 'Show unread only'}
          </UnreadOnlyMenuItem>
        )}
        {showDirects && (
          <UnreadOnlyMenuItem setting="unreadDirectsOnly">
            {showRooms ? 'Show unread chats only' : 'Show unread only'}
          </UnreadOnlyMenuItem>
        )}
        <MarkAsReadMenuItem rooms={rooms} requestClose={requestClose} />
      </Box>
    </Menu>
  ),
);

type HomeHeaderProps = Omit<HomeMenuProps, 'requestClose'>;
function HomeHeader({ rooms, showRooms, showDirects }: HomeHeaderProps) {
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
              Home
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
            <HomeMenu
              rooms={rooms}
              showRooms={showRooms}
              showDirects={showDirects}
              requestClose={() => setMenuAnchor(undefined)}
            />
          </FocusTrap>
        }
      />
    </>
  );
}

function HomeEmpty({ showRooms }: { showRooms: boolean }) {
  const navigate = useNavigate();

  if (!showRooms) {
    return (
      <NavEmptyCenter>
        <NavEmptyLayout
          icon={<Icon size="600" src={Icons.Mention} />}
          title={
            <Text size="H5" align="Center">
              No Direct Messages
            </Text>
          }
          content={
            <Text size="T300" align="Center">
              You do not have any direct messages yet.
            </Text>
          }
          options={
            <Button variant="Secondary" size="300" onClick={() => navigate(getDirectCreatePath())}>
              <Text size="B300" truncate>
                Direct Message
              </Text>
            </Button>
          }
        />
      </NavEmptyCenter>
    );
  }

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
            <Button onClick={() => navigate(getHomeCreatePath())} variant="Secondary" size="300">
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
 * The Home nav. Which lists it carries is a settings question rather than a
 * fixed one — see `useShellLayout`. `/direct` renders this same component while
 * the two are merged, which is why the DM entries keep their own paths.
 */
export function Home() {
  useNavToActivePathMapper('home');
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = useShellLayout();

  const orphanRooms = useHomeRooms();
  const directs = useDirectRooms();

  const listedRooms = useMemo(() => {
    const items: string[] = [];
    if (layout.roomsInHome) items.push(...orphanRooms);
    if (layout.directsInHome) items.push(...directs);
    return items;
  }, [layout.roomsInHome, layout.directsInHome, orphanRooms, directs]);

  const noRoomToDisplay = listedRooms.length === 0;

  return (
    <PageNav resizable>
      <HomeHeader
        rooms={listedRooms}
        showRooms={layout.roomsInHome}
        showDirects={layout.directsInHome}
      />
      {noRoomToDisplay ? (
        <HomeEmpty showRooms={layout.roomsInHome} />
      ) : (
        <PageNavContent scrollRef={scrollRef}>
          <Box direction="Column" gap="300">
            <NavCategory>
              {layout.roomsInHome && <RoomsNavActions base="home" />}
              {layout.directsInHome && <DirectsNavActions />}
            </NavCategory>
            {layout.roomsInHome && <RoomsNavList base="home" scrollRef={scrollRef} />}
            {layout.directsInHome && <DirectsNavList scrollRef={scrollRef} />}
          </Box>
        </PageNavContent>
      )}
    </PageNav>
  );
}
