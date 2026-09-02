import { MouseEventHandler, forwardRef, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { FocusTrap } from 'focus-trap-react';
import {
  Box,
  Avatar,
  Text,
  Overlay,
  OverlayCenter,
  OverlayBackdrop,
  IconButton,
  Icon,
  Icons,
  Tooltip,
  TooltipProvider,
  Menu,
  MenuItem,
  toRem,
  config,
  Line,
  PopOut,
  RectCords,
  Badge,
  Spinner,
} from 'folds';
import { useNavigate } from 'react-router-dom';
import { Room } from 'matrix-js-sdk';
import { PageHeader } from '../../components/page';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { UseStateProvider } from '../../components/UseStateProvider';
import { RoomTopicViewer } from '../../components/room-topic-viewer';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIsDirectRoom, useRoom } from '../../hooks/useRoom';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { getHomeSearchPath, getSpaceSearchPath, withSearchParam } from '../../pages/pathUtils';
import {
  getCanonicalAliasOrRoomId,
  guessDmRoomUserId,
  isRoomAlias,
  mxcUrlToHttp,
} from '../../utils/matrix';
import { useUserPresence } from '../../hooks/useUserPresence';
import { PresenceBadge } from '../../components/presence';
import { roomSearchFocusRequestAtom, roomSearchOpenAtom } from '../../state/roomSearch';
import { roomGalleryOpenAtom } from '../../state/roomGallery';
import { _SearchPathSearchParams } from '../../pages/paths';
import * as css from './RoomViewHeader.css';
import { useRoomUnread } from '../../state/hooks/unread';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { markAsRead } from '../../utils/notifications';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { copyToClipboard } from '../../utils/dom';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../../hooks/useRoomMeta';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { stopPropagation } from '../../utils/keyboard';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { BackRouteHandler } from '../../components/BackRouteHandler';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { RoomPinMenu } from './room-pin-menu';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { RoomNotificationModeSwitcher } from '../../components/RoomNotificationSwitcher';
import {
  getRoomNotificationMode,
  getRoomNotificationModeIcon,
  useRoomsNotificationPreferencesContext,
} from '../../hooks/useRoomsNotificationPreferences';
import { JumpToTime } from './jump-to-time';
import { PollHistoryPrompt } from './poll/PollHistoryPrompt';
import { RoomFilesPrompt } from './files/RoomFilesPrompt';
import { RoomWidgetsPrompt } from './widgets/RoomWidgetsPrompt';
import { ExportPrompt } from './export/ExportPrompt';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { RoomSettingsPage } from '../../state/roomSettings';
import { useCallEmbed, useCallStart } from '../../hooks/useCallEmbed';
import { useLivekitSupport } from '../../hooks/useLivekitSupport';
import { webRTCSupported } from '../../utils/rtc';

type RoomMenuProps = {
  room: Room;
  requestClose: () => void;
};
const RoomMenu = forwardRef<HTMLDivElement, RoomMenuProps>(({ room, requestClose }, ref) => {
  const mx = useMatrixClient();
  const [hideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canInvite = permissions.action('invite', mx.getSafeUserId());
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const notificationMode = getRoomNotificationMode(notificationPreferences, room.roomId);
  const { navigateRoom } = useRoomNavigate();

  const [invitePrompt, setInvitePrompt] = useState(false);
  const setGalleryOpen = useSetAtom(roomGalleryOpenAtom);

  const handleOpenGallery = () => {
    setGalleryOpen(true);
    requestClose();
  };

  const handleMarkAsRead = () => {
    markAsRead(mx, room.roomId, hideReadReceipts);
    requestClose();
  };

  const handleInvite = () => {
    setInvitePrompt(true);
  };

  const handleCopyLink = () => {
    const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, room.roomId);
    const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(room);
    copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
    requestClose();
  };

  const openSettings = useOpenRoomSettings();
  const parentSpace = useSpaceOptionally();
  const handleOpenSettings = () => {
    openSettings(room.roomId, parentSpace?.roomId);
    requestClose();
  };

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      {invitePrompt && (
        <InviteUserPrompt
          room={room}
          requestClose={() => {
            setInvitePrompt(false);
            requestClose();
          }}
        />
      )}
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MenuItem
          onClick={handleMarkAsRead}
          size="300"
          after={<Icon size="100" src={Icons.CheckTwice} />}
          radii="300"
          disabled={!unread}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Mark as Read
          </Text>
        </MenuItem>
        <RoomNotificationModeSwitcher roomId={room.roomId} value={notificationMode}>
          {(handleOpen, opened, changing) => (
            <MenuItem
              size="300"
              after={
                changing ? (
                  <Spinner size="100" variant="Secondary" />
                ) : (
                  <Icon size="100" src={getRoomNotificationModeIcon(notificationMode)} />
                )
              }
              radii="300"
              aria-pressed={opened}
              onClick={handleOpen}
            >
              <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                Notifications
              </Text>
            </MenuItem>
          )}
        </RoomNotificationModeSwitcher>
      </Box>
      <Line variant="Surface" size="300" />
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MenuItem
          onClick={handleInvite}
          variant="Primary"
          fill="None"
          size="300"
          after={<Icon size="100" src={Icons.UserPlus} />}
          radii="300"
          aria-pressed={invitePrompt}
          disabled={!canInvite}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Invite
          </Text>
        </MenuItem>
        <MenuItem
          onClick={handleCopyLink}
          size="300"
          after={<Icon size="100" src={Icons.Link} />}
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Copy Link
          </Text>
        </MenuItem>
        <MenuItem
          onClick={handleOpenSettings}
          size="300"
          after={<Icon size="100" src={Icons.Setting} />}
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Room Settings
          </Text>
        </MenuItem>
        <UseStateProvider initial={false}>
          {(promptWidgets, setPromptWidgets) => (
            <>
              <MenuItem
                onClick={() => setPromptWidgets(true)}
                size="300"
                after={<Icon size="100" src={Icons.Category} />}
                radii="300"
                aria-pressed={promptWidgets}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Widgets
                </Text>
              </MenuItem>
              {promptWidgets && (
                <RoomWidgetsPrompt
                  room={room}
                  requestClose={() => {
                    setPromptWidgets(false);
                    requestClose();
                  }}
                />
              )}
            </>
          )}
        </UseStateProvider>
        <MenuItem
          onClick={handleOpenGallery}
          size="300"
          after={<Icon size="100" src={Icons.Photo} />}
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Media Gallery
          </Text>
        </MenuItem>
        <UseStateProvider initial={false}>
          {(promptFiles, setPromptFiles) => (
            <>
              <MenuItem
                onClick={() => setPromptFiles(true)}
                size="300"
                after={<Icon size="100" src={Icons.File} />}
                radii="300"
                aria-pressed={promptFiles}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Files
                </Text>
              </MenuItem>
              {promptFiles && (
                <RoomFilesPrompt
                  room={room}
                  requestClose={() => {
                    setPromptFiles(false);
                    requestClose();
                  }}
                />
              )}
            </>
          )}
        </UseStateProvider>
        <UseStateProvider initial={false}>
          {(promptExport, setPromptExport) => (
            <>
              <MenuItem
                onClick={() => setPromptExport(true)}
                size="300"
                after={<Icon size="100" src={Icons.Download} />}
                radii="300"
                aria-pressed={promptExport}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Export Chat
                </Text>
              </MenuItem>
              {promptExport && (
                <ExportPrompt
                  room={room}
                  requestClose={() => {
                    setPromptExport(false);
                    requestClose();
                  }}
                />
              )}
            </>
          )}
        </UseStateProvider>
        <UseStateProvider initial={false}>
          {(promptPolls, setPromptPolls) => (
            <>
              <MenuItem
                onClick={() => setPromptPolls(true)}
                size="300"
                after={<Icon size="100" src={Icons.Bulb} />}
                radii="300"
                aria-pressed={promptPolls}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Polls
                </Text>
              </MenuItem>
              {promptPolls && (
                <PollHistoryPrompt
                  room={room}
                  requestClose={() => {
                    setPromptPolls(false);
                    requestClose();
                  }}
                />
              )}
            </>
          )}
        </UseStateProvider>
        <UseStateProvider initial={false}>
          {(promptJump, setPromptJump) => (
            <>
              <MenuItem
                onClick={() => setPromptJump(true)}
                size="300"
                after={<Icon size="100" src={Icons.RecentClock} />}
                radii="300"
                aria-pressed={promptJump}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Jump to Time
                </Text>
              </MenuItem>
              {promptJump && (
                <JumpToTime
                  onSubmit={(eventId) => {
                    setPromptJump(false);
                    navigateRoom(room.roomId, eventId);
                    requestClose();
                  }}
                  onCancel={() => setPromptJump(false)}
                />
              )}
            </>
          )}
        </UseStateProvider>
      </Box>
      <Line variant="Surface" size="300" />
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <UseStateProvider initial={false}>
          {(promptLeave, setPromptLeave) => (
            <>
              <MenuItem
                onClick={() => setPromptLeave(true)}
                variant="Critical"
                fill="None"
                size="300"
                after={<Icon size="100" src={Icons.ArrowGoLeft} />}
                radii="300"
                aria-pressed={promptLeave}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Leave Room
                </Text>
              </MenuItem>
              {promptLeave && (
                <LeaveRoomPrompt
                  roomId={room.roomId}
                  onDone={requestClose}
                  onCancel={() => setPromptLeave(false)}
                />
              )}
            </>
          )}
        </UseStateProvider>
      </Box>
    </Menu>
  );
});

function CallButton({
  livekitSupported,
  hasCallPermission,
}: {
  livekitSupported: boolean;
  hasCallPermission: boolean;
}) {
  const room = useRoom();
  const direct = useIsDirectRoom();

  const callEmbed = useCallEmbed();
  const startCall = useCallStart(direct);
  const callStarted = callEmbed && callEmbed.roomId === room.roomId;
  const inAnotherCall = callEmbed && !callStarted;

  const callBlocked = !livekitSupported || !hasCallPermission;
  const disabled = !!(inAnotherCall || callStarted || callBlocked);

  const blockerTooltip = () => {
    if (inAnotherCall) return 'Already in another call — End the current call to join!';
    if (!livekitSupported)
      return 'Your homeserver does not advertise a LiveKit/MatrixRTC focus, so calls cannot be started.';
    if (!hasCallPermission) return 'You do not have permission to start a call in this room.';
    return null;
  };
  const blocker = blockerTooltip();

  const startVoice = () => {
    if (disabled) return;
    startCall(room, { microphone: true, video: false, sound: true });
  };
  const startVideo = () => {
    if (disabled) return;
    startCall(room, { microphone: true, video: true, sound: true });
  };

  return (
    <>
      <TooltipProvider
        position="Bottom"
        offset={4}
        tooltip={
          <Tooltip>
            <Text size="L400">{blocker ?? 'Start voice call'}</Text>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <IconButton
            variant="Surface"
            fill="None"
            ref={triggerRef}
            onClick={startVoice}
            disabled={disabled}
            aria-label="Start voice call"
          >
            <Icon size="400" src={Icons.Phone} />
          </IconButton>
        )}
      </TooltipProvider>
      <TooltipProvider
        position="Bottom"
        offset={4}
        tooltip={
          <Tooltip>
            <Text size="L400">{blocker ?? 'Start video call'}</Text>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <IconButton
            variant="Surface"
            fill="None"
            ref={triggerRef}
            onClick={startVideo}
            disabled={disabled}
            aria-label="Start video call"
          >
            <Icon size="400" src={Icons.VideoCamera} />
          </IconButton>
        )}
      </TooltipProvider>
    </>
  );
}

export function RoomViewHeader({ callView }: { callView?: boolean }) {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const screenSize = useScreenSizeContext();
  const room = useRoom();
  const space = useSpaceOptionally();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);

  const hasCallPermission = permissions.stateEvent(
    StateEvent.GroupCallMemberPrefix,
    mx.getSafeUserId(),
  );
  const livekitSupported = useLivekitSupport();
  const rtcSupported = webRTCSupported();

  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [pinMenuAnchor, setPinMenuAnchor] = useState<RectCords>();
  const direct = useIsDirectRoom();

  const pinnedEvents = useRoomPinnedEvents(room);
  const avatarMxc = useRoomAvatar(room, direct);
  const name = useRoomName(room);
  const topic = useRoomTopic(room);
  const avatarUrl = avatarMxc
    ? (mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined)
    : undefined;

  const [peopleDrawer, setPeopleDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');

  const dmUserId = direct ? guessDmRoomUserId(room, mx.getSafeUserId()) : undefined;
  const dmUserPresence = useUserPresence(dmUserId ?? '');

  const [searchOpen, setSearchOpen] = useAtom(roomSearchOpenAtom);
  const requestSearchFocus = useSetAtom(roomSearchFocusRequestAtom);
  const [galleryOpen, setGalleryOpen] = useAtom(roomGalleryOpenAtom);
  const handleGalleryClick = () => {
    // A gallery of a call is not a thing; the button is not rendered there.
    setGalleryOpen((open) => !open);
  };
  const handleSearchClick = () => {
    if (callView) {
      // No right-side drawer in call view — fall back to the global search page.
      const searchParams: _SearchPathSearchParams = {
        rooms: room.roomId,
      };
      const path = space
        ? getSpaceSearchPath(getCanonicalAliasOrRoomId(mx, space.roomId))
        : getHomeSearchPath();
      navigate(withSearchParam(path, searchParams));
      return;
    }
    // Both branches land on the same component — the members drawer, which
    // searches people and messages together. Desktop reveals it as the side
    // panel; below that it opens full-screen over the timeline. Only the
    // presentation differs, so the button means the same thing at every width.
    if (screenSize === ScreenSize.Desktop) {
      // Open it if needed and put the caret in its search box, so the toolbar
      // button is a real entry point rather than the search being reachable
      // only by opening the member list and noticing the field.
      setPeopleDrawer(true);
      requestSearchFocus((n) => n + 1);
      return;
    }
    setSearchOpen((open) => {
      // Focus only when opening; toggling shut should not pull the caret back.
      if (!open) requestSearchFocus((n) => n + 1);
      return !open;
    });
  };

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const handleOpenPinMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setPinMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const openSettings = useOpenRoomSettings();
  const parentSpace = useSpaceOptionally();
  const handleMemberToggle = () => {
    if (callView) {
      openSettings(room.roomId, parentSpace?.roomId, RoomSettingsPage.MembersPage);
      return;
    }
    setPeopleDrawer(!peopleDrawer);
  };

  return (
    <PageHeader
      className={ContainerColor({ variant: 'Surface' })}
      balance={screenSize === ScreenSize.Mobile}
    >
      <Box grow="Yes" gap="300">
        {screenSize === ScreenSize.Mobile && (
          <BackRouteHandler>
            {(onBack) => (
              <Box shrink="No" alignItems="Center">
                <IconButton fill="None" onClick={onBack}>
                  <Icon src={Icons.ArrowLeft} />
                </IconButton>
              </Box>
            )}
          </BackRouteHandler>
        )}
        <Box grow="Yes" alignItems="Center" gap="300">
          {screenSize !== ScreenSize.Mobile && (
            <Avatar size="300">
              <RoomAvatar
                roomId={room.roomId}
                src={avatarUrl}
                alt={name}
                renderFallback={() => (
                  <RoomIcon size="200" joinRule={room.getJoinRule()} roomType={room.getType()} />
                )}
              />
            </Avatar>
          )}
          <Box direction="Column">
            <Box alignItems="Center" gap="200">
              {dmUserId && dmUserPresence && (
                <PresenceBadge
                  presence={dmUserPresence.presence}
                  status={dmUserPresence.status}
                  size="300"
                />
              )}
              <Text size={topic ? 'H5' : 'H3'} truncate>
                {name}
              </Text>
            </Box>
            {topic && (
              <UseStateProvider initial={false}>
                {(viewTopic, setViewTopic) => (
                  <>
                    <Overlay open={viewTopic} backdrop={<OverlayBackdrop />}>
                      <OverlayCenter>
                        <FocusTrap
                          focusTrapOptions={{
                            initialFocus: false,
                            clickOutsideDeactivates: true,
                            onDeactivate: () => setViewTopic(false),
                            escapeDeactivates: stopPropagation,
                          }}
                        >
                          <RoomTopicViewer
                            name={name}
                            topic={topic}
                            requestClose={() => setViewTopic(false)}
                          />
                        </FocusTrap>
                      </OverlayCenter>
                    </Overlay>
                    <Text
                      as="button"
                      type="button"
                      onClick={() => setViewTopic(true)}
                      className={css.HeaderTopic}
                      size="T200"
                      priority="300"
                      truncate
                    >
                      {topic}
                    </Text>
                  </>
                )}
              </UseStateProvider>
            )}
          </Box>
        </Box>

        <Box shrink="No">
          {/* Search is always reachable from the toolbar. On desktop the button
              opens the members drawer and focuses its unified people + message
              search; smaller screens have no drawer, so it toggles the search
              overlay instead. */}
          <TooltipProvider
            position="Bottom"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>Search</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                ref={triggerRef}
                onClick={handleSearchClick}
                aria-label="Search"
                // Only a toggle on smaller screens, where it shows/hides the
                // search overlay. On desktop it is a plain action — it focuses
                // the drawer's search box — so it carries no pressed state; the
                // drawer's own button already reflects whether that is open.
                aria-pressed={
                  screenSize === ScreenSize.Desktop ? undefined : !callView && searchOpen
                }
              >
                <Icon
                  size="400"
                  src={Icons.Search}
                  filled={screenSize !== ScreenSize.Desktop && !callView && searchOpen}
                />
              </IconButton>
            )}
          </TooltipProvider>
          {!callView && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{galleryOpen ? 'Back to Conversation' : 'Media Gallery'}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={handleGalleryClick}
                  aria-label={galleryOpen ? 'Back to conversation' : 'Media gallery'}
                  aria-pressed={galleryOpen}
                >
                  <Icon size="400" src={Icons.Photo} filled={galleryOpen} />
                </IconButton>
              )}
            </TooltipProvider>
          )}
          <TooltipProvider
            position="Bottom"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>Pinned Messages</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                style={{ position: 'relative' }}
                onClick={handleOpenPinMenu}
                ref={triggerRef}
                aria-pressed={!!pinMenuAnchor}
              >
                {pinnedEvents.length > 0 && (
                  <Badge
                    style={{
                      position: 'absolute',
                      left: toRem(3),
                      top: toRem(3),
                    }}
                    variant="Secondary"
                    size="400"
                    fill="Solid"
                    radii="Pill"
                  >
                    <Text as="span" size="L400">
                      {pinnedEvents.length}
                    </Text>
                  </Badge>
                )}
                <Icon size="400" src={Icons.Pin} filled={!!pinMenuAnchor} />
              </IconButton>
            )}
          </TooltipProvider>
          <PopOut
            anchor={pinMenuAnchor}
            position="Bottom"
            content={
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  returnFocusOnDeactivate: false,
                  onDeactivate: () => setPinMenuAnchor(undefined),
                  clickOutsideDeactivates: true,
                  isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                  isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                  escapeDeactivates: stopPropagation,
                }}
              >
                <RoomPinMenu room={room} requestClose={() => setPinMenuAnchor(undefined)} />
              </FocusTrap>
            }
          />
          {!room.isCallRoom() && rtcSupported && (
            <CallButton livekitSupported={livekitSupported} hasCallPermission={hasCallPermission} />
          )}
          {screenSize === ScreenSize.Desktop && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  {callView ? (
                    <Text>Members</Text>
                  ) : (
                    <Text>{peopleDrawer ? 'Hide Members' : 'Show Members'}</Text>
                  )}
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton fill="None" ref={triggerRef} onClick={handleMemberToggle}>
                  <Icon size="400" src={Icons.User} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          <TooltipProvider
            position="Bottom"
            align="End"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>More Options</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                onClick={handleOpenMenu}
                ref={triggerRef}
                aria-pressed={!!menuAnchor}
              >
                <Icon size="400" src={Icons.VerticalDots} filled={!!menuAnchor} />
              </IconButton>
            )}
          </TooltipProvider>
          <PopOut
            anchor={menuAnchor}
            position="Bottom"
            align="End"
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
                <RoomMenu room={room} requestClose={() => setMenuAnchor(undefined)} />
              </FocusTrap>
            }
          />
        </Box>
      </Box>
    </PageHeader>
  );
}
