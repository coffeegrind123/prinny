import { useCallback, useEffect } from 'react';
import { Box } from 'folds';
import { useParams } from 'react-router-dom';
import { isKeyHotkey } from '../../utils/is-hotkey';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { RoomView } from './RoomView';
import { MembersDrawer } from './MembersDrawer';
import { roomSearchOpenAtom } from '../../state/roomSearch';
import { mediaFeedRequestAtom, roomGalleryOpenAtom } from '../../state/roomGallery';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useKeyDown } from '../../hooks/useKeyDown';
import { markAsRead } from '../../utils/notifications';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { CallView } from '../call/CallView';
import { RoomViewHeader } from './RoomViewHeader';
import { RoomKnocksBar } from './RoomKnocksBar';
import { LiveLocationBanner } from './location/LiveLocationBanner';
import { ThreadView } from './thread/ThreadView';
import { threadViewAtom } from '../../state/threadView';
import { ChatEffects } from './ChatEffects';
import { callChatAtom } from '../../state/callEmbed';
import { CallChatView } from './CallChatView';
import { MobileSwipeBack } from './MobileSwipeBack';
import { useCallEmbed } from '../../hooks/useCallEmbed';
import { useCallMembers, useCallSession } from '../../hooks/useCall';
import { useIsRoomBackdrop } from '../../hooks/useRoomBackdrop';
import { ResizeHandle } from '../../components/resize-handle';
import { useResizablePane } from '../../hooks/useResizablePane';

export function Room() {
  const { eventId } = useParams();
  const room = useRoom();
  const mx = useMatrixClient();

  const callSession = useCallSession(room);
  const callMembers = useCallMembers(callSession);
  const callEmbed = useCallEmbed();

  const [isDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [hideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');
  const [searchOpen, setSearchOpen] = useAtom(roomSearchOpenAtom);
  const screenSize = useScreenSizeContext();

  // Search drawer is ephemeral — close it when switching rooms or leaving.
  useEffect(() => {
    setSearchOpen(false);
    return () => setSearchOpen(false);
  }, [room.roomId, setSearchOpen]);

  // So is the gallery, and the feed opened out of it: both belong to the room
  // they were opened in, and neither should be the first thing you see in the
  // next one.
  const setGalleryOpen = useSetAtom(roomGalleryOpenAtom);
  const setMediaFeedRequest = useSetAtom(mediaFeedRequestAtom);
  useEffect(() => {
    setGalleryOpen(false);
    setMediaFeedRequest(undefined);
    return () => {
      setGalleryOpen(false);
      setMediaFeedRequest(undefined);
    };
  }, [room.roomId, setGalleryOpen, setMediaFeedRequest]);

  const [threadView, setThreadView] = useAtom(threadViewAtom);
  const closeThread = useCallback(() => setThreadView(undefined), [setThreadView]);
  // A thread belonging to a room you have navigated away from must not stay on
  // screen over the new one.
  const openThreadRootId = threadView?.roomId === room.roomId ? threadView.rootId : undefined;
  useEffect(() => {
    if (threadView && threadView.roomId !== room.roomId) setThreadView(undefined);
  }, [room.roomId, threadView, setThreadView]);
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room.roomId);
  const chat = useAtomValue(callChatAtom);

  // This listener is on `window`, so a backdrop room mounted behind the room
  // list would answer Escape too — marking a room read that is not even on
  // screen, and racing the visible room for the same key.
  const isBackdrop = useIsRoomBackdrop();
  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (isBackdrop) return;
        if (isKeyHotkey('escape', evt)) {
          markAsRead(mx, room.roomId, hideReadReceipts);
        }
      },
      [mx, room.roomId, hideReadReceipts, isBackdrop],
    ),
  );

  const callView = callEmbed?.roomId === room.roomId || room.isCallRoom() || callMembers.length > 0;

  // The member drawer reads its own pane; the thread panel has no component of
  // its own to hang a width on, so it is applied here.
  const threadPane = useResizablePane('threadPane');

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <ChatEffects />
      <MobileSwipeBack>
        <Box grow="Yes">
          {callView && (screenSize === ScreenSize.Desktop || !chat) && (
            <Box grow="Yes" direction="Column">
              <RoomViewHeader callView />
              <Box grow="Yes">
                <CallView />
              </Box>
            </Box>
          )}
          {!callView && (
            <Box grow="Yes" direction="Column" style={{ position: 'relative' }}>
              <RoomViewHeader />
              <RoomKnocksBar room={room} />
              <LiveLocationBanner room={room} />
              <Box grow="Yes">
                <RoomView eventId={eventId} />
              </Box>
              {/* On anything narrower than desktop the thread takes over the
                room, matching how search behaves — a 360px panel beside a
                phone-width timeline would leave neither usable. */}
              {openThreadRootId && screenSize !== ScreenSize.Desktop && (
                <Box style={{ position: 'absolute', inset: 0, zIndex: 11 }}>
                  <ThreadView
                    key={openThreadRootId}
                    room={room}
                    rootId={openThreadRootId}
                    onClose={closeThread}
                  />
                </Box>
              )}
              {searchOpen && screenSize !== ScreenSize.Desktop && (
                <Box style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
                  {/*
                  Same component the desktop side panel uses, rendered
                  full-screen. There used to be a second, messages-only search
                  view here, so the toolbar's search button led somewhere
                  different depending purely on window width. Both were driven
                  by the same hooks (useMessageSearch / useClientRoomSearch /
                  SearchResultGroup), so collapsing onto this one costs no
                  capability and gains people search on mobile.
                */}
                  <MembersDrawer
                    key={room.roomId}
                    room={room}
                    members={members}
                    overlay
                    onClose={() => setSearchOpen(false)}
                  />
                </Box>
              )}
            </Box>
          )}

          {callView && chat && (
            <>
              {screenSize === ScreenSize.Desktop && (
                <ResizeHandle paneId="callChatPane" side="After" label="call chat" />
              )}
              <CallChatView />
            </>
          )}
          {/* A thread takes the side panel when one is open, in preference to
            the member list — both cannot share the space, and the thread is
            what the user just asked for. */}
          {!callView && screenSize === ScreenSize.Desktop && openThreadRootId && (
            <>
              <ResizeHandle paneId="threadPane" side="After" label="thread panel" />
              <Box shrink="No" style={threadPane.style}>
                <ThreadView
                  key={openThreadRootId}
                  room={room}
                  rootId={openThreadRootId}
                  onClose={closeThread}
                />
              </Box>
            </>
          )}
          {!callView && screenSize === ScreenSize.Desktop && !openThreadRootId && isDrawer && (
            <>
              <ResizeHandle paneId="membersPane" side="After" label="member list" />
              <MembersDrawer key={room.roomId} room={room} members={members} />
            </>
          )}
        </Box>
      </MobileSwipeBack>
    </PowerLevelsContextProvider>
  );
}
