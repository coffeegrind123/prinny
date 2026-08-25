import { useCallback, useMemo } from 'react';
import { Room } from 'matrix-js-sdk';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { MediaFeed } from './MediaFeed';
import { useRoomMediaContext } from './RoomMediaProvider';
import { mediaFeedRequestAtom, roomGalleryOpenAtom } from '../../../state/roomGallery';
import { embedMediaItems, MediaItem } from '../../../hooks/useRoomMedia';
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

  /**
   * The entries a preview card handed over, built the same way the scan builds
   * them — `embedMediaItems` is the one definition of what a linked post
   * contributes, so a seeded picture and the scanned one are the same `key`
   * and cannot both appear.
   *
   * The sender comes off the event when it is still in the timeline set, which
   * for a card the reader just clicked it always is; the empty fallback only
   * costs the feed's "sent by" line on an event that has been evicted.
   */
  const seedItems = useMemo((): MediaItem[] => {
    const seed = request?.embed;
    if (!seed || request.roomId !== room.roomId) return [];
    const mEvent = findRoomEventById(room, request.eventId);
    return embedMediaItems(
      {
        eventId: request.eventId,
        roomId: room.roomId,
        sender: mEvent?.getSender() ?? '',
        ts: seed.ts,
        url: seed.post.url,
        provider: seed.post.provider,
      },
      seed.post,
    );
  }, [request, room]);

  /**
   * The scan's list with anything seeded and not yet found folded in.
   *
   * Newest first, matching the order the scan publishes in — the feed reverses
   * it once, and an entry inserted out of order would read as a picture from
   * the wrong part of the conversation.
   */
  const items = useMemo(() => {
    if (seedItems.length === 0) return media.items;
    const known = new Set(media.items.map((item) => item.key));
    const extra = seedItems.filter((item) => !known.has(item.key));
    if (extra.length === 0) return media.items;
    return [...media.items, ...extra].sort((a, b) => b.ts - a.ts);
  }, [media.items, seedItems]);

  /**
   * The entry to open on. A seeded request names its picture by position in the
   * post, which is only a key once the entries exist.
   */
  const initialItemKey = useMemo(() => {
    if (request?.itemKey) return request.itemKey;
    const index = request?.embed?.index;
    if (index === undefined) return undefined;
    return seedItems[index]?.key;
  }, [request, seedItems]);

  if (!request || request.roomId !== room.roomId) return null;

  return (
    <MediaFeed
      room={room}
      items={items}
      imagePackRooms={imagePackRooms}
      initialEventId={request.eventId}
      initialItemKey={initialItemKey}
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
