import { MatrixClient, MatrixEvent, RoomMember, RoomMemberEvent } from 'matrix-js-sdk';
import { useEffect, useState } from 'react';

/**
 * Above this many joined members the full roster is only fetched for a caller
 * that shows it. One `/members` for a room that size is megabytes of state the
 * client has to parse and store, and every room open paid for it.
 */
const MAX_EAGER_MEMBER_COUNT = 1000;

export enum RosterLoad {
  /** Fetch the full roster whatever the room's size. */
  Full,
  /**
   * Keep the lazily-loaded members in a large room (the roster grows as people
   * speak); for callers that do not list everyone.
   */
  LazyIfLarge,
}

export const useRoomMembers = (
  mx: MatrixClient,
  roomId: string,
  load: RosterLoad = RosterLoad.Full,
): RoomMember[] => {
  const [members, setMembers] = useState<RoomMember[]>([]);

  useEffect(() => {
    const room = mx.getRoom(roomId);
    const loadRoster =
      !!room && (load === RosterLoad.Full || room.getJoinedMemberCount() <= MAX_EAGER_MEMBER_COUNT);
    let loadingMembers = loadRoster;
    let disposed = false;

    const updateMemberList = (event?: MatrixEvent) => {
      if (!room || disposed || (event && event.getRoomId() !== roomId)) return;
      if (loadingMembers) return;
      setMembers(room.getMembers());
    };

    if (room) {
      setMembers(room.getMembers());
    }
    if (room && loadRoster) {
      // Settled either way: a rejected `/members` used to leave
      // `loadingMembers` set, so the list ignored every later membership
      // event until the room changed.
      room
        .loadMembersIfNeeded()
        .catch((err) => {
          console.warn('[members] loading the member list failed', roomId, err);
        })
        .then(() => {
          loadingMembers = false;
          if (disposed) return;
          updateMemberList();
        });
    }

    mx.on(RoomMemberEvent.Membership, updateMemberList);
    mx.on(RoomMemberEvent.PowerLevel, updateMemberList);
    return () => {
      disposed = true;
      mx.removeListener(RoomMemberEvent.Membership, updateMemberList);
      mx.removeListener(RoomMemberEvent.PowerLevel, updateMemberList);
    };
  }, [mx, roomId, load]);

  return members;
};
