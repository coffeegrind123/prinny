import { MouseEventHandler, forwardRef, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
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
import { useNavigate } from 'react-router-dom';
import {
  NavCategory,
  NavEmptyCenter,
  NavEmptyLayout,
  useNavCollapsed,
} from '../../../components/nav';
import { getDirectCreatePath } from '../../pathUtils';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { useDirectRooms } from './useDirectRooms';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { stopPropagation } from '../../../utils/keyboard';
import { useShellLayout } from '../../../hooks/useShellLayout';
import {
  DirectsNavActions,
  DirectsNavList,
  MarkAsReadMenuItem,
  UnreadOnlyMenuItem,
} from '../nav';
import { Home } from '../home/Home';

type DirectMenuProps = {
  rooms: string[];
  requestClose: () => void;
};
const DirectMenu = forwardRef<HTMLDivElement, DirectMenuProps>(({ rooms, requestClose }, ref) => (
  <Menu ref={ref} style={{ maxWidth: toRem(200), width: '100vw' }}>
    <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
      <UnreadOnlyMenuItem setting="unreadDirectsOnly">Show unread only</UnreadOnlyMenuItem>
      <MarkAsReadMenuItem rooms={rooms} requestClose={requestClose} />
    </Box>
  </Menu>
));

function DirectHeader({ rooms }: { rooms: string[] }) {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const collapsed = useNavCollapsed();

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
        {collapsed ? (
          /* The rail is 64px wide: a title and a separate overflow button do
             not both fit, and hiding the title outright left a column of faces
             with nothing to say which list it is. So the title IS the button —
             "DM", centred, opening the same menu. A `span` rather than folds'
             default `<p>`, so the rule that hides full-width nav titles on the
             rail leaves this one alone. */
          <Box alignItems="Center" justifyContent="Center" grow="Yes">
            <Chip
              variant="Background"
              radii="400"
              aria-pressed={!!menuAnchor}
              onClick={handleOpenMenu}
              title="Direct Messages"
              aria-label="Direct Messages options"
            >
              <Text as="span" size="L400">
                DM
              </Text>
            </Chip>
          </Box>
        ) : (
          <Box alignItems="Center" grow="Yes" gap="300">
            <Box grow="Yes">
              <Text size="H4" truncate>
                Direct Messages
              </Text>
            </Box>
            <Box>
              <IconButton aria-pressed={!!menuAnchor} variant="Background" onClick={handleOpenMenu}>
                <Icon src={Icons.VerticalDots} size="200" />
              </IconButton>
            </Box>
          </Box>
        )}
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
            <DirectMenu rooms={rooms} requestClose={() => setMenuAnchor(undefined)} />
          </FocusTrap>
        }
      />
    </>
  );
}

function DirectEmpty() {
  const navigate = useNavigate();

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

function DirectNav() {
  useNavToActivePathMapper('direct');
  const scrollRef = useRef<HTMLDivElement>(null);
  const directs = useDirectRooms();
  const noRoomToDisplay = directs.length === 0;

  return (
    <PageNav resizable collapsible>
      <DirectHeader rooms={directs} />
      {noRoomToDisplay ? (
        <DirectEmpty />
      ) : (
        <PageNavContent scrollRef={scrollRef}>
          <Box direction="Column" gap="300">
            <NavCategory>
              <DirectsNavActions />
            </NavCategory>
            <DirectsNavList scrollRef={scrollRef} />
          </Box>
        </PageNavContent>
      )}
    </PageNav>
  );
}

/**
 * `/direct` keeps its routes whichever way the shell is configured — deep
 * links, `lastOpenedRoom` and the mobile swipe branching all address it — so
 * merging the two navs is a question of what this route renders, not of
 * removing it. Under `unifiedHomeSidebar` that is the Home nav, which lists
 * these same chats.
 */
export function Direct() {
  const layout = useShellLayout();

  if (layout.directsInHome) return <Home />;
  return <DirectNav />;
}
