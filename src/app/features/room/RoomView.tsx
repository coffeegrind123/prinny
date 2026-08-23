import { useCallback, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Text, config } from 'folds';
import { EventType } from 'matrix-js-sdk';
import { isKeyHotkey } from '../../utils/is-hotkey';
import { useStateEvent } from '../../hooks/useStateEvent';
import { StateEvent } from '../../../types/matrix/room';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { safeFocusEditor, useEditor } from '../../components/editor';
import { RoomInputPlaceholder } from './RoomInputPlaceholder';
import { RoomTimeline } from './RoomTimeline';
import { RoomViewTyping } from './RoomViewTyping';
import { RoomTombstone } from './RoomTombstone';
import { RoomInput } from './RoomInput';
import { RoomViewFollowing, RoomViewFollowingPlaceholder } from './RoomViewFollowing';
import { Page } from '../../components/page';
import { useKeyDown } from '../../hooks/useKeyDown';
import { editableActiveElement } from '../../utils/dom';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoom } from '../../hooks/useRoom';
import { PinnedMessageBanner } from './PinnedMessageBanner';
import { MediaFeedHost, RoomGallery, RoomMediaProvider } from './gallery';
import { mediaFeedRequestAtom, roomGalleryOpenAtom } from '../../state/roomGallery';

const FN_KEYS_REGEX = /^F\d+$/;
const shouldFocusMessageField = (evt: KeyboardEvent): boolean => {
  const { code } = evt;
  if (evt.metaKey || evt.altKey || evt.ctrlKey) {
    return false;
  }

  if (FN_KEYS_REGEX.test(code)) return false;

  if (
    code.startsWith('OS') ||
    code.startsWith('Meta') ||
    code.startsWith('Shift') ||
    code.startsWith('Alt') ||
    code.startsWith('Control') ||
    code.startsWith('Arrow') ||
    code.startsWith('Page') ||
    code.startsWith('End') ||
    code.startsWith('Home') ||
    code === 'Tab' ||
    code === 'Space' ||
    code === 'Enter' ||
    code === 'NumLock' ||
    code === 'ScrollLock'
  ) {
    return false;
  }

  return true;
};

export function RoomView({ eventId }: { eventId?: string }) {
  const roomInputRef = useRef<HTMLDivElement>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);

  const [hideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');

  const galleryOpen = useAtomValue(roomGalleryOpenAtom);
  const feedRequest = useAtomValue(mediaFeedRequestAtom);

  const room = useRoom();
  const { roomId } = room;
  const editor = useEditor();

  const mx = useMatrixClient();

  const tombstoneEvent = useStateEvent(room, StateEvent.RoomTombstone);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canMessage = permissions.event(EventType.RoomMessage, mx.getSafeUserId());

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        // No composer is mounted in gallery mode, so there is nothing to type
        // into and `safeFocusEditor` would be reaching for a detached editor.
        if (galleryOpen) return;
        if (editableActiveElement()) return;
        const portalContainer = document.getElementById('portalContainer');
        if (portalContainer && portalContainer.children.length > 0) {
          return;
        }
        if (shouldFocusMessageField(evt) || isKeyHotkey('mod+v', evt)) {
          safeFocusEditor(editor);
        }
      },
      [editor, galleryOpen],
    ),
  );

  // The media scan walks the room's history, so it only runs once something is
  // actually looking at it — the gallery, or a feed opened from a message.
  const mediaActive = galleryOpen || feedRequest?.roomId === roomId;

  return (
    <Page ref={roomViewRef}>
      <RoomMediaProvider room={room} enabled={mediaActive}>
        <Box grow="Yes" direction="Column">
          {galleryOpen ? (
            <RoomGallery />
          ) : (
            <>
              <RoomTimeline
                key={roomId}
                room={room}
                eventId={eventId}
                roomInputRef={roomInputRef}
                editor={editor}
              />
              <RoomViewTyping room={room} />
            </>
          )}
        </Box>
        <MediaFeedHost room={room} />
      </RoomMediaProvider>
      {/* The gallery replaces the conversation rather than sitting on top of
          it, so everything that belongs to the conversation goes with it: a
          composer under a wall of photos has nothing to compose into, the
          pinned-message banner is about messages you cannot see, and the read
          receipts track a timeline that is not on screen. */}
      {!galleryOpen && (
        <Box shrink="No" direction="Column">
          <div style={{ padding: `0 ${config.space.S400}` }}>
            <PinnedMessageBanner room={room} />
            {tombstoneEvent ? (
              <RoomTombstone
                roomId={roomId}
                body={tombstoneEvent.getContent().body}
                replacementRoomId={tombstoneEvent.getContent().replacement_room}
              />
            ) : (
              <>
                {canMessage && (
                  <RoomInput
                    room={room}
                    editor={editor}
                    roomId={roomId}
                    fileDropContainerRef={roomViewRef}
                    ref={roomInputRef}
                  />
                )}
                {!canMessage && (
                  <RoomInputPlaceholder
                    style={{ padding: config.space.S200 }}
                    alignItems="Center"
                    justifyContent="Center"
                  >
                    <Text align="Center">You do not have permission to post in this room</Text>
                  </RoomInputPlaceholder>
                )}
              </>
            )}
          </div>
          {hideReadReceipts ? <RoomViewFollowingPlaceholder /> : <RoomViewFollowing room={room} />}
        </Box>
      )}
    </Page>
  );
}
