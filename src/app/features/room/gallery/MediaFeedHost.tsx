import { useCallback } from 'react';
import { Room } from 'matrix-js-sdk';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { MediaFeed } from './MediaFeed';
import { useRoomMediaContext } from './RoomMediaProvider';
import { mediaFeedRequestAtom, roomGalleryOpenAtom } from '../../../state/roomGallery';
import { MediaItem } from '../../../hooks/useRoomMedia';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { useImagePackRooms } from '../../../hooks/useImagePackRooms';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { roomIdToReplyDraftAtomFamily } from '../../../state/room/roomInputDrafts';
import { findRoomEventById, getReplyDraftBody } from '../../../utils/room';

/**
 * Mounts the feed when something asks for it.
 *
 * The ask comes from three places — a photo tapped in the timeline, a gallery
 * tile, the button on a video — and lands in one atom, so this is the only
 * component that has to know how to open a feed.
 */
export function MediaFeedHost({ room }: { room: Room }) {
  const media = useRoomMediaContext();
  const [request, setRequest] = useAtom(mediaFeedRequestAtom);
  const galleryOpen = useAtomValue(roomGalleryOpenAtom);
  const setGalleryOpen = useSetAtom(roomGalleryOpenAtom);
  const { navigateRoom } = useRoomNavigate();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const imagePackRooms = useImagePackRooms(room.roomId, roomToParents);
  // The reply draft is keyed by room, and the atom family is read imperatively
  // rather than subscribed to: the feed only ever writes one, and subscribing
  // would re-render every page of the feed each time the composer is typed in.
  const store = useStore();

  const requestClose = useCallback(() => setRequest(undefined), [setRequest]);

  const handleJump = useCallback(
    (item: MediaItem) => {
      setRequest(undefined);
      setGalleryOpen(false);
      navigateRoom(item.roomId, item.eventId);
    },
    [setRequest, setGalleryOpen, navigateRoom],
  );

  /**
   * Reply to the message an attachment arrived in.
   *
   * The composer lives with the timeline, so replying is necessarily a way
   * *out* of the feed — the draft is set, the feed and the gallery close, and
   * the room scrolls to the message being replied to, which is where the reply
   * box now is. Same draft shape the timeline's own reply button writes, so
   * the composer cannot tell the two apart.
   */
  const handleReply = useCallback(
    (item: MediaItem) => {
      const mEvent = findRoomEventById(room, item.eventId);
      const sender = mEvent?.getSender();
      if (mEvent && sender) {
        const { body, formattedBody } = getReplyDraftBody(mEvent, room.getUnfilteredTimelineSet());
        store.set(roomIdToReplyDraftAtomFamily(room.roomId), {
          userId: sender,
          eventId: item.eventId,
          // An attachment with no caption has no body worth quoting; its
          // filename is what the reply chip should show.
          body: body || item.filename,
          formattedBody,
          relation: mEvent.getWireContent()['m.relates_to'],
        });
      }
      setRequest(undefined);
      setGalleryOpen(false);
      navigateRoom(item.roomId, item.eventId);
    },
    [room, store, setRequest, setGalleryOpen, navigateRoom],
  );

  const handleOpenGallery = useCallback(() => {
    setRequest(undefined);
    setGalleryOpen(true);
  }, [setRequest, setGalleryOpen]);

  if (!request || request.roomId !== room.roomId) return null;

  return (
    <MediaFeed
      room={room}
      items={media.items}
      imagePackRooms={imagePackRooms}
      initialEventId={request.eventId}
      initialItemKey={request.itemKey}
      loading={media.loading}
      hasMore={media.hasMore}
      loadMore={media.loadMore}
      requestClose={requestClose}
      onOpenGallery={galleryOpen ? undefined : handleOpenGallery}
      onJump={handleJump}
      onReply={handleReply}
    />
  );
}
