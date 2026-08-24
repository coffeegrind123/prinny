import { useCallback, useSyncExternalStore } from 'react';
import { MatrixEvent, RelationType, Room, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

/**
 * Whether the timeline draws no row for this event, under the current settings.
 *
 * Matches `RoomTimeline`'s own filter: it renders nothing for an event carrying
 * an annotation or replacement relation (`reactionOrEditEvent`), nothing for a
 * redaction, and nothing for a redacted message unless hidden events are shown.
 */
function isUnrenderedEvent(mEvent: MatrixEvent, showHiddenEvents: boolean): boolean {
  if (mEvent.isRedaction()) return true;
  const relType = mEvent.getRelation()?.rel_type;
  if (relType === RelationType.Annotation || relType === RelationType.Replace) return true;
  if (mEvent.isRedacted() && !showHiddenEvents) return true;
  return false;
}

/**
 * Returns a Map of eventId → userIds — which users' read receipts stop at each
 * event in the timeline.
 *
 * **A receipt does not have to land on something the timeline draws.** A read
 * marker points at the newest event that person has seen, and plenty of events
 * are real timeline entries that render no row: an edit (`m.replace`), a
 * reaction, a redaction. Editing a message appends such an event, so the next
 * person to read the room has their marker land on the edit — and keying the
 * map by the raw event id meant no `Message` on screen ever asked for that id
 * and the avatar simply vanished. Which is the report: "the read indicator
 * disappears when it's on a message that has been edited."
 *
 * So each receipt is carried back to the nearest rendered event at or before
 * it. That is what the marker means anyway — everything up to here has been
 * seen — and it fixes reactions and redactions by the same stroke, since they
 * move a marker onto an undrawn event in exactly the same way.
 */
function computeReceipts(
  room: Room,
  ownUserId: string,
  showHiddenEvents: boolean
): Map<string, string[]> {
  const members = room.getJoinedMembers();
  const timeline = room.getLiveTimeline().getEvents();

  // Position of every event, and — for each position — the id of the last
  // event at or before it that the timeline actually draws.
  const indexById = new Map<string, number>();
  const anchorAtIndex: (string | undefined)[] = new Array(timeline.length);
  let lastRendered: string | undefined;
  timeline.forEach((mEvent, index) => {
    const eventId = mEvent.getId();
    if (eventId) indexById.set(eventId, index);
    if (eventId && !isUnrenderedEvent(mEvent, showHiddenEvents)) lastRendered = eventId;
    anchorAtIndex[index] = lastRendered;
  });

  const receiptMap = new Map<string, string[]>();

  for (const member of members) {
    if (member.userId === ownUserId) continue;
    const readUpTo = room.getEventReadUpTo(member.userId);
    if (!readUpTo) continue;
    const index = indexById.get(readUpTo);
    if (index === undefined) continue;
    // No rendered event this far back in the loaded timeline — the same
    // "nothing to attach it to" case as a receipt outside it entirely.
    const anchorId = anchorAtIndex[index];
    if (!anchorId) continue;

    const list = receiptMap.get(anchorId);
    if (list) {
      list.push(member.userId);
    } else {
      receiptMap.set(anchorId, [member.userId]);
    }
  }

  return receiptMap;
}

/**
 * Whether a recompute actually changed anything.
 *
 * `useSyncExternalStore` compares snapshots by identity, so handing back a
 * fresh Map on every timeline event would re-render every message on screen
 * even when no receipt moved — which is most events. Keeping the previous
 * Map when the contents match is what turns "one recompute" into "one
 * recompute and no render".
 */
function sameReceipts(a: Map<string, string[]>, b: Map<string, string[]>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [eventId, userIds] of a) {
    const other = b.get(eventId);
    if (!other || other.length !== userIds.length) return false;
    for (let i = 0; i < userIds.length; i += 1) {
      if (userIds[i] !== other[i]) return false;
    }
  }
  return true;
}

const EMPTY_RECEIPTS: Map<string, string[]> = new Map();

type ReceiptStore = {
  snapshot: Map<string, string[]>;
  subscribers: Set<() => void>;
  detach?: () => void;
  /**
   * The setting the snapshot was computed under. Toggling "show hidden events"
   * changes which events count as drawn, and therefore where receipts land, so
   * a store built under the old value has to be recomputed rather than served.
   */
  showHiddenEvents: boolean;
};

/**
 * Keyed by Room so a store dies with the room object it describes. Entries are
 * also deleted when the last subscriber leaves, so a room revisited later
 * recomputes rather than serving a snapshot frozen at the moment everything
 * unmounted.
 */
const storeByRoom = new WeakMap<Room, ReceiptStore>();

function getStore(room: Room, ownUserId: string, showHiddenEvents: boolean): ReceiptStore {
  const existing = storeByRoom.get(room);
  if (existing) {
    if (existing.showHiddenEvents !== showHiddenEvents) {
      existing.showHiddenEvents = showHiddenEvents;
      existing.snapshot = computeReceipts(room, ownUserId, showHiddenEvents);
    }
    return existing;
  }

  const store: ReceiptStore = {
    snapshot: computeReceipts(room, ownUserId, showHiddenEvents),
    subscribers: new Set(),
    showHiddenEvents,
  };
  storeByRoom.set(room, store);
  return store;
}

function refresh(room: Room, ownUserId: string, store: ReceiptStore): void {
  const next = computeReceipts(room, ownUserId, store.showHiddenEvents);
  if (sameReceipts(store.snapshot, next)) return;
  store.snapshot = next;
  store.subscribers.forEach((notify) => notify());
}

function subscribeToReceipts(
  room: Room,
  ownUserId: string,
  showHiddenEvents: boolean,
  onChange: () => void
): () => void {
  const store = getStore(room, ownUserId, showHiddenEvents);
  store.subscribers.add(onChange);

  if (!store.detach) {
    const handleReceipt: RoomEventHandlerMap[RoomEvent.Receipt] = (event, r) => {
      if (r.roomId !== room.roomId) return;
      refresh(room, ownUserId, store);
    };
    // A new event landed in the live timeline — readUpTo may now point at it,
    // so recompute. Cheap (joined-members count × eventSet lookup) and bounded
    // by member count.
    const handleTimeline = () => refresh(room, ownUserId, store);

    room.on(RoomEvent.Receipt, handleReceipt);
    room.on(RoomEvent.Timeline, handleTimeline);
    store.detach = () => {
      room.removeListener(RoomEvent.Receipt, handleReceipt);
      room.removeListener(RoomEvent.Timeline, handleTimeline);
    };

    // Anything that moved between the snapshot getStore took and the listeners
    // going on is invisible otherwise.
    refresh(room, ownUserId, store);
  }

  return () => {
    store.subscribers.delete(onChange);
    if (store.subscribers.size > 0) return;
    store.detach?.();
    store.detach = undefined;
    storeByRoom.delete(room);
  };
}

/**
 * Which users' read receipts stop at each event in the timeline, as a Map of
 * eventId → userIds. Used for Element-style avatar dots at last-read positions.
 *
 * The map is rebuilt whenever the room emits `RoomEvent.Receipt` (someone's
 * read marker moved), so every Message component sees consistent receipt
 * positions instead of a stale snapshot from its mount time. The previous
 * `useMemo([room, enabled, ownUserId])` never recomputed once mounted — each
 * Message captured receipts at the position they were when it scrolled into
 * view, and as receipts advanced the indicator visibly multiplied across old
 * messages.
 *
 * ONE subscription per room, shared by every caller. `Message` calls this, so
 * there is a caller per rendered message: subscribing per component put a
 * `Room.receipt` AND a `Room.timeline` listener on the same emitter for every
 * message on screen, which tripped matrix-js-sdk's own
 * `MaxListenersExceededWarning: 51 Room.timeline listeners added` and, worse,
 * ran the whole joined-members × timeline recompute 51 times for a single
 * incoming event. The room-wide answer does not depend on which message asks
 * for it, so it is computed once and handed to all of them.
 */
export function useElementReadReceipts(
  room: Room,
  enabled: boolean,
  showHiddenEvents: boolean
): Map<string, string[]> {
  const mx = useMatrixClient();
  const ownUserId = mx.getUserId()!;

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled) return () => undefined;
      return subscribeToReceipts(room, ownUserId, showHiddenEvents, onChange);
    },
    [room, ownUserId, enabled, showHiddenEvents]
  );

  const getSnapshot = useCallback(
    () => (enabled ? getStore(room, ownUserId, showHiddenEvents).snapshot : EMPTY_RECEIPTS),
    [room, ownUserId, enabled, showHiddenEvents]
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
