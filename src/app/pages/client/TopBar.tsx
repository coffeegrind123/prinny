import {
  Box,
  Header,
  Icon,
  IconButton,
  Icons,
  Text,
  Tooltip,
  TooltipProvider,
  config,
  toRem,
} from 'folds';
import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { getInboxPath } from '../pathUtils';
import { useDefaultInboxPath, useInboxSelected } from '../../hooks/router/useInbox';
import { UnreadBadge } from '../../components/unread-badge';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { TopBarProfile } from './TopBarProfile';

function InboxButton() {
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const defaultInboxPath = useDefaultInboxPath();
  const inboxSelected = useInboxSelected();
  const allInvites = useAtomValue(allInvitesAtom);
  const inviteCount = allInvites.length;

  const handleInboxClick = () => {
    if (screenSize === ScreenSize.Mobile) {
      navigate(getInboxPath());
      return;
    }
    // Same resolver as the sidebar button and the /inbox/ index route.
    // Three ways in; one answer, or the setting means nothing from
    // whichever one you happen to use.
    navigate(defaultInboxPath);
  };

  return (
    <Box shrink="No" style={{ position: 'relative' }}>
      <TooltipProvider
        position="Bottom"
        offset={4}
        tooltip={
          <Tooltip>
            <Text size="H5">Inbox</Text>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            variant="Background"
            fill="None"
            size="300"
            onClick={handleInboxClick}
            aria-label="Inbox"
            aria-pressed={inboxSelected}
          >
            <Icon size="200" src={Icons.Inbox} filled={inboxSelected} />
          </IconButton>
        )}
      </TooltipProvider>
      {inviteCount > 0 && (
        <Box
          shrink="No"
          alignItems="Center"
          justifyContent="Center"
          style={{
            position: 'absolute',
            top: toRem(2),
            right: toRem(2),
            pointerEvents: 'none',
            lineHeight: 0,
            minWidth: toRem(16),
          }}
        >
          <UnreadBadge highlight count={inviteCount} />
        </Box>
      )}
    </Box>
  );
}

type TopBarProps = {
  /** Whether the profile controls belong in the bar rather than the sidebar. */
  profile: boolean;
};

/**
 * The full-width bar above the sidebar, under `topBar`.
 *
 * The fork also parks its message-search field here; that field belongs to the
 * room-search drawer, which is not part of this client, so the bar carries the
 * inbox and — when `topBarProfile` is on — the profile.
 */
export function TopBar({ profile }: TopBarProps) {
  return (
    <Header
      variant="Background"
      size="400"
      className={ContainerColor({ variant: 'Background' })}
      style={{
        borderBottomWidth: config.borderWidth.B300,
        padding: `0 ${config.space.S200}`,
      }}
    >
      <Box alignItems="Center" grow="Yes" gap="200">
        {profile && <TopBarProfile />}
        <Box alignItems="Center" justifyContent="End" grow="Yes" gap="200">
          <InboxButton />
        </Box>
      </Box>
    </Header>
  );
}
