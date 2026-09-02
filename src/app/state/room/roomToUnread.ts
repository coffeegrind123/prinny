import { produce } from 'immer';
import { atom, useSetAtom } from 'jotai';
import {
  IRoomTimelineData,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import { ReceiptContent, ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import { useCallback, useEffect } from 'react';
import {
  Membership,
  NotificationType,
  RoomAccountDataEvent,
  RoomToUnread,
  UnreadInfo,
  Unread,
  StateEvent,
} from '../../../types/matrix/room';
import {
  getAllParents,
  getNotificationType,
  getRoomMarkedUnread,
  getUnreadInfo,
  getUnreadInfos,
  isNotificationEvent,
} from '../../utils/room';
import { roomToParentsAtom } from './roomToParents';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { useSyncState } from '../../hooks/useSyncState';
import { useRoomsNotificationPreferencesContext } from '../../hooks/useRoomsNotificationPreferences';

export type RoomToUnreadAction =
  | {
      type: 'RESET';
      unreadInfos: UnreadInfo[];
    }
  | {
      type: 'PUT';
      unreadInfo: UnreadInfo;
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

const EMPTY_UNREAD: Unread = { highlight: 0, total: 0, from: null, marked: false };

export const unreadInfoToUnread = (unreadInfo: UnreadInfo): Unread => ({
  highlight: unreadInfo.highlight,
  total: unreadInfo.total,
  from: null,
  marked: unreadInfo.marked,
});

/**
 * Whether any room contributing to a parent is marked unread.
 *
 * Counts propagate to parents as deltas, which works because addition has an
 * inverse. `marked` is a boolean OR, which does not — you cannot subtract one
 * child's `true` from a parent and learn whether the others were also true. So
 * it is recomputed from the parent's `from` set each time instead, which is the
 * only representation that stays correct when a marked child is removed while
 * another marked sibling remains.
 */
const anyMarked = (roomToUnread: RoomToUnread, from: Set<string>): boolean => {
  let marked = false;
  from.forEach((roomId) => {
    if (roomToUnread.get(roomId)?.marked) marked = true;
  });
  return marked;
};

const putUnreadInfo = (
  roomToUnread: RoomToUnread,
  allParents: Set<string>,
  unreadInfo: UnreadInfo,
) => {
  const oldUnread = roomToUnread.get(unreadInfo.roomId) ?? EMPTY_UNREAD;
  roomToUnread.set(unreadInfo.roomId, unreadInfoToUnread(unreadInfo));

  const newH = unreadInfo.highlight - oldUnread.highlight;
  const newT = unreadInfo.total - oldUnread.total;

  allParents.forEach((parentId) => {
    const oldParentUnread = roomToUnread.get(parentId) ?? EMPTY_UNREAD;
    const newFrom = new Set([...(oldParentUnread.from ?? []), unreadInfo.roomId]);
    roomToUnread.set(parentId, {
      highlight: oldParentUnread.highlight + newH,
      total: oldParentUnread.total + newT,
      from: newFrom,
      marked: anyMarked(roomToUnread, newFrom),
    });
  });
};

const deleteUnreadInfo = (roomToUnread: RoomToUnread, allParents: Set<string>, roomId: string) => {
  const oldUnread = roomToUnread.get(roomId);
  if (!oldUnread) return;
  roomToUnread.delete(roomId);

  allParents.forEach((parentId) => {
    const oldParentUnread = roomToUnread.get(parentId);
    if (!oldParentUnread) return;
    const newFrom = new Set([...(oldParentUnread.from ?? roomId)]);
    newFrom.delete(roomId);
    if (newFrom.size === 0) {
      roomToUnread.delete(parentId);
      return;
    }
    roomToUnread.set(parentId, {
      highlight: oldParentUnread.highlight - oldUnread.highlight,
      total: oldParentUnread.total - oldUnread.total,
      from: newFrom,
      marked: anyMarked(roomToUnread, newFrom),
    });
  });
};

export const unreadEqual = (u1: Unread, u2: Unread): boolean => {
  const countEqual = u1.highlight === u2.highlight && u1.total === u2.total;

  if (!countEqual) return false;
  // Without this, flagging a room unread produces an Unread that compares equal
  // to the old one (both have zero counts), the PUT is discarded as a no-op,
  // and nothing re-renders.
  if (u1.marked !== u2.marked) return false;

  const f1 = u1.from;
  const f2 = u2.from;
  if (f1 === null && f2 === null) return true;
  if (f1 === null || f2 === null) return false;

  if (f1.size !== f2.size) return false;

  let fromEqual = true;
  f1?.forEach((item) => {
    if (!f2?.has(item)) {
      fromEqual = false;
    }
  });

  return fromEqual;
};

const baseRoomToUnread = atom<RoomToUnread>(new Map());
export const roomToUnreadAtom = atom<RoomToUnread, [RoomToUnreadAction], undefined>(
  (get) => get(baseRoomToUnread),
  (get, set, action) => {
    if (action.type === 'RESET') {
      const draftRoomToUnread: RoomToUnread = new Map();
      action.unreadInfos.forEach((unreadInfo) => {
        putUnreadInfo(
          draftRoomToUnread,
          getAllParents(get(roomToParentsAtom), unreadInfo.roomId),
          unreadInfo,
        );
      });
      set(baseRoomToUnread, draftRoomToUnread);
      return;
    }
    if (action.type === 'PUT') {
      const { unreadInfo } = action;
      const currentUnread = get(baseRoomToUnread).get(unreadInfo.roomId);
      if (currentUnread && unreadEqual(currentUnread, unreadInfoToUnread(unreadInfo))) {
        // Do not update if unread data has not changes
        // like total & highlight
        return;
      }
      set(
        baseRoomToUnread,
        produce(get(baseRoomToUnread), (draftRoomToUnread) =>
          putUnreadInfo(
            draftRoomToUnread,
            getAllParents(get(roomToParentsAtom), unreadInfo.roomId),
            unreadInfo,
          ),
        ),
      );
      return;
    }
    if (action.type === 'DELETE' && get(baseRoomToUnread).has(action.roomId)) {
      set(
        baseRoomToUnread,
        produce(get(baseRoomToUnread), (draftRoomToUnread) =>
          deleteUnreadInfo(
            draftRoomToUnread,
            getAllParents(get(roomToParentsAtom), action.roomId),
            action.roomId,
          ),
        ),
      );
    }
  },
);

export const useBindRoomToUnreadAtom = (mx: MatrixClient, unreadAtom: typeof roomToUnreadAtom) => {
  const setUnreadAtom = useSetAtom(unreadAtom);
  const roomsNotificationPreferences = useRoomsNotificationPreferencesContext();

  useEffect(() => {
    setUnreadAtom({
      type: 'RESET',
      unreadInfos: getUnreadInfos(mx),
    });
  }, [mx, setUnreadAtom]);

  useSyncState(
    mx,
    useCallback(
      (state, prevState) => {
        if (
          (state === SyncState.Prepared && prevState === null) ||
          (state === SyncState.Syncing && prevState !== SyncState.Syncing)
        ) {
          setUnreadAtom({
            type: 'RESET',
            unreadInfos: getUnreadInfos(mx),
          });
        }
      },
      [mx, setUnreadAtom],
    ),
  );

  useEffect(() => {
    const handleTimelineEvent = (
      mEvent: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: IRoomTimelineData,
    ) => {
      if (!room || !data.liveEvent || room.isSpaceRoom() || !isNotificationEvent(mEvent)) return;
      if (getNotificationType(mx, room.roomId) === NotificationType.Mute) {
        setUnreadAtom({
          type: 'DELETE',
          roomId: room.roomId,
        });
        return;
      }

      if (mEvent.getSender() === mx.getUserId()) return;
      setUnreadAtom({ type: 'PUT', unreadInfo: getUnreadInfo(room) });
    };
    mx.on(RoomEvent.Timeline, handleTimelineEvent);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [mx, setUnreadAtom]);

  useEffect(() => {
    const handleReceipt = (mEvent: MatrixEvent, room: Room) => {
      const myUserId = mx.getUserId();
      if (!myUserId) return;
      if (room.isSpaceRoom()) return;
      const content = mEvent.getContent<ReceiptContent>();

      const isMyReceipt = Object.keys(content).find((eventId) =>
        (Object.keys(content[eventId]) as ReceiptType[]).find(
          (receiptType) => content[eventId][receiptType][myUserId],
        ),
      );
      if (isMyReceipt) {
        // A read receipt clears the counts but not an explicit MSC2867 flag —
        // those are independent, and a user who marks a room unread and then
        // scrolls it into view (which sends a receipt) expects the flag to
        // survive. `markAsRead` is what clears the flag, because that is the
        // deliberate "I have read this" action.
        if (getRoomMarkedUnread(room)) {
          setUnreadAtom({ type: 'PUT', unreadInfo: getUnreadInfo(room) });
          return;
        }
        setUnreadAtom({ type: 'DELETE', roomId: room.roomId });
      }
    };
    mx.on(RoomEvent.Receipt, handleReceipt);
    return () => {
      mx.removeListener(RoomEvent.Receipt, handleReceipt);
    };
  }, [mx, setUnreadAtom]);

  useEffect(() => {
    // MSC2867 lives in room account data, which arrives through /sync like any
    // other event — including when ANOTHER of the user's clients sets it. This
    // is what makes the flag actually synchronise rather than being local UI.
    const handleRoomAccountData = (mEvent: MatrixEvent, room: Room) => {
      const type = mEvent.getType();
      if (
        type !== RoomAccountDataEvent.MarkedUnread &&
        type !== RoomAccountDataEvent.MarkedUnreadLegacy
      ) {
        return;
      }
      if (room.isSpaceRoom() || room.getMyMembership() !== Membership.Join) return;

      if (getRoomMarkedUnread(room)) {
        setUnreadAtom({ type: 'PUT', unreadInfo: getUnreadInfo(room) });
        return;
      }

      // Flag cleared. The room may still have real unread events behind it, so
      // this is a recompute rather than an unconditional DELETE.
      const unreadInfo = getUnreadInfo(room);
      if (unreadInfo.total > 0 || unreadInfo.highlight > 0) {
        setUnreadAtom({ type: 'PUT', unreadInfo });
        return;
      }
      setUnreadAtom({ type: 'DELETE', roomId: room.roomId });
    };
    mx.on(RoomEvent.AccountData, handleRoomAccountData);
    return () => {
      mx.removeListener(RoomEvent.AccountData, handleRoomAccountData);
    };
  }, [mx, setUnreadAtom]);

  useEffect(() => {
    setUnreadAtom({
      type: 'RESET',
      unreadInfos: getUnreadInfos(mx),
    });
  }, [mx, setUnreadAtom, roomsNotificationPreferences]);

  useEffect(() => {
    const handleMembershipChange = (room: Room, membership: string) => {
      if (membership !== Membership.Join) {
        setUnreadAtom({
          type: 'DELETE',
          roomId: room.roomId,
        });
      }
    };
    mx.on(RoomEvent.MyMembership, handleMembershipChange);
    return () => {
      mx.removeListener(RoomEvent.MyMembership, handleMembershipChange);
    };
  }, [mx, setUnreadAtom]);

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === StateEvent.SpaceChild) {
          setUnreadAtom({
            type: 'RESET',
            unreadInfos: getUnreadInfos(mx),
          });
        }
      },
      [mx, setUnreadAtom],
    ),
  );
};
