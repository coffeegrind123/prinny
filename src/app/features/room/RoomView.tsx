import { CSSProperties, useCallback, useRef } from 'react';
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
import { ContainerColor } from '../../styles/ContainerColor.css';

/**
 * How the conversation is taken off screen while the gallery is up.
 *
 * `visibility` rather than `display` on purpose — see the note at the call
 * site. `pointerEvents` is belt and braces: a hidden subtree already swallows
 * nothing, but the gallery overlay paints over it and a stray hover target
 * underneath would be a bug that only shows up as a wrong cursor.
 */
const HIDDEN_UNDER_GALLERY: CSSProperties = {
  visibility: 'hidden',
  pointerEvents: 'none',
};

const GALLERY_OVERLAY: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
};

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

  const [hideOthersReadReceipts] = useSetting(settingsAtom, 'hideOthersReadReceipts');

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
        // The composer is still mounted in gallery mode, just hidden under it
        // — typing must not pull focus into something the reader cannot see.
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
    <Page ref={roomViewRef} style={{ position: 'relative' }}>
      <RoomMediaProvider room={room} enabled={mediaActive}>
        {/* The conversation is HIDDEN under the gallery, never unmounted.
            Unmounting it threw away the timeline's scroll position, its loaded
            pagination window and its unread state, so coming back out of the
            gallery re-ran the "scroll to last read message" pass and dumped the
            reader back at messages they had already scrolled past — the jump
            that made the toggle unusable as a toggle. `visibility: hidden`
            keeps the boxes in the layout at exactly the size they had, so
            `scrollTop`, `clientHeight` and every observer that measures against
            them survive the round trip untouched; `display: none` would not,
            because the browser resets the scroll offset of a scroller it has
            taken out of the flow. Hidden elements are also out of the tab
            order, so nothing behind the gallery can be typed into or focused. */}
        <Box
          grow="Yes"
          direction="Column"
          aria-hidden={galleryOpen || undefined}
          style={galleryOpen ? HIDDEN_UNDER_GALLERY : undefined}
        >
          <RoomTimeline
            key={roomId}
            room={room}
            eventId={eventId}
            roomInputRef={roomInputRef}
            editor={editor}
          />
          <RoomViewTyping room={room} />
        </Box>
        {/* Painted in the page's own surface colour and stretched over the
            whole page: the gallery still reads as a mode that replaces the
            conversation rather than a panel floating above it, and the
            composer, the pinned banner and the read receipts stay covered —
            a message box under a wall of photos has nothing to send into. */}
        {galleryOpen && (
          <Box
            direction="Column"
            className={ContainerColor({ variant: 'Surface' })}
            style={GALLERY_OVERLAY}
          >
            <RoomGallery />
          </Box>
        )}
        <MediaFeedHost room={room} />
      </RoomMediaProvider>
      <Box
        shrink="No"
        direction="Column"
        aria-hidden={galleryOpen || undefined}
        style={galleryOpen ? HIDDEN_UNDER_GALLERY : undefined}
      >
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
        {hideOthersReadReceipts ? (
          <RoomViewFollowingPlaceholder />
        ) : (
          <RoomViewFollowing room={room} />
        )}
      </Box>
    </Page>
  );
}
