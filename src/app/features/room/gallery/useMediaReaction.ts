import { useCallback, useEffect } from 'react';
import { MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useForceUpdate } from '../../../hooks/useForceUpdate';
import { getEventReactions, getReactionContent, matchingReactionKey } from '../../../utils/room';
import { factoryEventSentBy } from '../../../utils/matrix';
import { MessageEvent } from '../../../../types/matrix/room';

/** The feed's one-tap reaction. Matches what the emoji board sends for a heart. */
export const FEED_REACTION_KEY = '❤️';

export type MediaReaction = {
  /** Every reaction on the message, of any key — what the rail counts. */
  count: number;
  /** True when one of them is mine. */
  reacted: boolean;
  /** The heart, for the double-tap shortcut. */
  toggle: () => void;
  /**
   * Add or remove one reaction, by key.
   *
   * Same toggle semantics as the timeline's own reaction buttons: picking a
   * key you have already sent takes it back, which is what makes the emoji
   * board usable as a reaction *menu* rather than a one-way send.
   */
  react: (key: string, shortcode?: string) => void;
};

/**
 * Reactions on a feed page — real `m.reaction` events, not local likes.
 *
 * Same send/redact dance as the timeline's reaction buttons, so a heart here
 * and a 👍 in the timeline are the same kind of thing and are visible to
 * everyone in the room. Reactions arrive as ordinary timeline events, so the
 * count follows the room live.
 */
export const useMediaReaction = (room: Room, eventId: string): MediaReaction => {
  const mx = useMatrixClient();
  const [, forceUpdate] = useForceUpdate();

  useEffect(() => {
    const handleUpdate = (mEvent: MatrixEvent) => {
      const type = mEvent.getType();
      if (type !== MessageEvent.Reaction && type !== MessageEvent.RoomRedaction) return;
      forceUpdate();
    };
    const handleRedaction = () => forceUpdate();

    room.on(RoomEvent.Timeline, handleUpdate);
    room.on(RoomEvent.Redaction, handleRedaction);
    room.on(RoomEvent.LocalEchoUpdated, handleRedaction);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleUpdate);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
      room.removeListener(RoomEvent.LocalEchoUpdated, handleRedaction);
    };
  }, [room, forceUpdate]);

  // Read straight from the relations rather than memoising: the answer has to
  // be recomputed on every one of those events anyway, and it is a lookup in a
  // map plus a filter over a handful of reactions.
  const relations = getEventReactions(room.getUnfilteredTimelineSet(), eventId);
  const byKey = relations?.getSortedAnnotationsByKey() ?? [];
  const live = byKey.flatMap(([, set]) =>
    set ? Array.from(set).filter((mEvent) => !mEvent.isRedacted()) : [],
  );
  const mine = live.find(factoryEventSentBy(mx.getSafeUserId()));

  const react = useCallback(
    (key: string, shortcode?: string) => {
      // Re-read rather than closing over `live`: this callback outlives the
      // render that built it, and sending a reaction against a stale view of
      // the relations is how a toggle ends up sending a duplicate instead of
      // redacting.
      const currentRelations = getEventReactions(room.getUnfilteredTimelineSet(), eventId);
      const byKeyNow = currentRelations?.getSortedAnnotationsByKey() ?? [];
      const reactionKey = matchingReactionKey(byKeyNow, key, shortcode);
      const [, currentSet] = byKeyNow.find(([k]) => k === reactionKey) ?? [];
      const current = currentSet ? Array.from(currentSet) : [];
      const existing = current.find(factoryEventSentBy(mx.getSafeUserId()));

      if (existing && existing.isRelation() && !existing.isRedacted()) {
        const existingId = existing.getId();
        if (existingId) mx.redactEvent(room.roomId, existingId);
        return;
      }
      mx.sendEvent(
        room.roomId,
        MessageEvent.Reaction as any,
        getReactionContent(eventId, reactionKey, shortcode),
      );
    },
    [mx, room, eventId],
  );

  const toggle = useCallback(() => react(FEED_REACTION_KEY), [react]);

  return {
    count: live.length,
    reacted: !!mine,
    toggle,
    react,
  };
};
