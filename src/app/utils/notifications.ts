import { EventType, MatrixClient, ReceiptType } from 'matrix-js-sdk';
import { getRoomMarkedUnread } from './room';

/**
 * MSC2867: flag a room unread, or clear the flag.
 *
 * Only ever writes the stable `m.marked_unread` key — `com.famedly.marked_unread`
 * is read for compatibility (see `getRoomMarkedUnread`) but writing it too would
 * mean maintaining two sources of truth that can disagree.
 *
 * The no-op guard is load-bearing, not an optimisation: `clearRoomMarkedUnread`
 * is called from `markAsRead`, which the timeline fires on essentially every
 * scroll-to-bottom. Without the guard that is a PUT to the homeserver per
 * scroll event.
 */
export async function setRoomMarkedUnread(mx: MatrixClient, roomId: string, unread: boolean) {
  const room = mx.getRoom(roomId);
  if (!room) return;
  if (getRoomMarkedUnread(room) === unread) return;

  await mx.setRoomAccountData(roomId, EventType.MarkedUnread, { unread });
}

/**
 * Clears the MSC2867 flag if it is set, and swallows the failure if it is not.
 *
 * Deliberately never rejects: this rides along with every read receipt, and a
 * homeserver that rejects the account-data write must not take the receipt
 * with it. The flag is cosmetic; the receipt is not.
 */
async function clearRoomMarkedUnread(mx: MatrixClient, roomId: string) {
  try {
    await setRoomMarkedUnread(mx, roomId, false);
  } catch {
    // Intentionally ignored — see above.
  }
}

/**
 * Rooms the user has explicitly flagged unread while still looking at them.
 *
 * Marking a message unread does not close the room, and an open room reports
 * itself read constantly — on scroll, on focus, on every arriving event. Those
 * automatic reports would clear the flag within a frame of it being set, which
 * is exactly what "mark unread does nothing" looked like from the outside: the
 * account data was written and then immediately overwritten by the timeline.
 *
 * A plain module-level set rather than state, because nothing renders from it:
 * it only gates the automatic path, and every read of it happens inside an
 * event handler. It is cleared when the user leaves the room (RoomTimeline's
 * cleanup) or deliberately marks the room read.
 */
const autoReadSuppressedRooms = new Set<string>();

export const suppressAutoMarkAsRead = (roomId: string) => {
  autoReadSuppressedRooms.add(roomId);
};

export const releaseAutoMarkAsRead = (roomId: string) => {
  autoReadSuppressedRooms.delete(roomId);
};

export type MarkAsReadOptions = {
  /**
   * Set by the timeline's own "you are looking at the bottom of this room"
   * reporting. Such a call is skipped while the room is flagged unread; a call
   * without it is the user asking for it, and always goes through.
   */
  auto?: boolean;
};

export async function markAsRead(
  mx: MatrixClient,
  roomId: string,
  privateReceipt: boolean,
  options?: MarkAsReadOptions,
) {
  const room = mx.getRoom(roomId);
  if (!room) return;

  // An automatic report loses to an explicit unread flag; a deliberate one
  // clears the suppression along with the flag.
  if (options?.auto) {
    if (autoReadSuppressedRooms.has(roomId)) return;
  } else {
    releaseAutoMarkAsRead(roomId);
  }

  // Reading the room clears an explicit unread flag, per MSC2867. Done before
  // the early returns below: a room that was marked unread but has no new
  // events hits `timeline.length === 0` or `latestEvent === null` and would
  // otherwise stay flagged forever, with "Mark as Read" appearing to do nothing.
  clearRoomMarkedUnread(mx, roomId);

  const timeline = room.getLiveTimeline().getEvents();
  const readEventId = room.getEventReadUpTo(mx.getUserId()!);

  const getLatestValidEvent = () => {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const latestEvent = timeline[i];
      if (latestEvent.getId() === readEventId) return null;
      if (!latestEvent.isSending()) return latestEvent;
    }
    return null;
  };
  if (timeline.length === 0) return;
  const latestEvent = getLatestValidEvent();
  if (latestEvent === null) return;

  await mx.sendReadReceipt(
    latestEvent,
    privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read,
  );
}

/**
 * "Mark unread from here": rewind the read receipt to just before `eventId`,
 * and flag the room unread.
 *
 * Both halves are needed and they do different jobs. The receipt is what puts
 * the new-message divider back above the chosen message, so returning to the
 * room lands in the right place. The MSC2867 flag is what the room list draws
 * its dot from — a rewound receipt on its own moves nothing there, because the
 * badge is fed by the server's notification counts, and those do not grow again
 * just because a receipt moved backwards. That is why this looked like it did
 * nothing: the timeline was correct and the room list, the only place anyone
 * was looking, was unchanged.
 *
 * The flag is set even when the receipt cannot be rewound — the target being
 * the first event held in the live timeline, or the one before it still
 * sending. Doing nothing at all in those cases is worse than flagging the room
 * without moving the divider.
 */
export async function markAsUnread(mx: MatrixClient, roomId: string, eventId: string) {
  const room = mx.getRoom(roomId);
  if (!room) return;

  // Before the awaits: the room is open, so the timeline is free to report it
  // read at any moment, and an await is exactly where that would get in.
  suppressAutoMarkAsRead(roomId);

  const timeline = room.getLiveTimeline().getEvents();

  let targetIndex = -1;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].getId() === eventId) {
      targetIndex = i;
      break;
    }
  }

  const previousEvent = targetIndex > 0 ? timeline[targetIndex - 1] : undefined;
  if (previousEvent && !previousEvent.isSending()) {
    try {
      await mx.sendReadReceipt(previousEvent, ReceiptType.Read);
    } catch {
      // A homeserver that refuses a backwards receipt must not cost us the
      // flag, which is the half the user actually sees.
    }
  }

  await setRoomMarkedUnread(mx, roomId, true);
}
