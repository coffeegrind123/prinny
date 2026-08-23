import { produce } from 'immer';
import { atom, useSetAtom } from 'jotai';
import {
  ClientEvent,
  ClientEventHandlerMap,
  EventType,
  MatrixClient,
  RoomMemberEvent,
  RoomMemberEventHandlerMap,
} from 'matrix-js-sdk';
import { useEffect } from 'react';
import { useSetting } from './hooks/settings';
import { settingsAtom } from './settings';

export const TYPING_TIMEOUT_MS = 5000; // 5 seconds

export type TypingReceipt = {
  userId: string;
  ts: number;
};
export type IRoomIdToTypingMembers = Map<string, TypingReceipt[]>;

type TypingMemberPutAction = {
  type: 'PUT';
  roomId: string;
  userId: string;
  ts: number;
};
type TypingMemberDeleteAction = {
  type: 'DELETE';
  roomId: string;
  userId: string;
};
export type IRoomIdToTypingMembersAction = TypingMemberPutAction | TypingMemberDeleteAction;

const baseRoomIdToTypingMembersAtom = atom<IRoomIdToTypingMembers>(new Map());

const putTypingMember = (
  roomToMembers: IRoomIdToTypingMembers,
  action: TypingMemberPutAction,
): IRoomIdToTypingMembers => {
  let typingMembers = roomToMembers.get(action.roomId) ?? [];

  typingMembers = typingMembers.filter((receipt) => receipt.userId !== action.userId);
  typingMembers.push({
    userId: action.userId,
    ts: action.ts,
  });
  roomToMembers.set(action.roomId, typingMembers);
  return roomToMembers;
};

const deleteTypingMember = (
  roomToMembers: IRoomIdToTypingMembers,
  action: TypingMemberDeleteAction,
): IRoomIdToTypingMembers => {
  let typingMembers = roomToMembers.get(action.roomId) ?? [];

  typingMembers = typingMembers.filter((receipt) => receipt.userId !== action.userId);
  if (typingMembers.length === 0) {
    roomToMembers.delete(action.roomId);
  } else {
    roomToMembers.set(action.roomId, typingMembers);
  }
  return roomToMembers;
};

const timeoutReceipt = (
  roomToMembers: IRoomIdToTypingMembers,
  roomId: string,
  userId: string,
  timeout: number,
): boolean | undefined => {
  const typingMembers = roomToMembers.get(roomId) ?? [];

  const target = typingMembers.find((receipt) => receipt.userId === userId);
  if (!target) return undefined;

  return Date.now() - target.ts >= timeout;
};

export const roomIdToTypingMembersAtom = atom<
  IRoomIdToTypingMembers,
  [IRoomIdToTypingMembersAction],
  undefined
>(
  (get) => get(baseRoomIdToTypingMembersAtom),
  (get, set, action) => {
    const rToTyping = get(baseRoomIdToTypingMembersAtom);

    if (action.type === 'PUT') {
      set(
        baseRoomIdToTypingMembersAtom,
        produce(rToTyping, (draft) => putTypingMember(draft, action)),
      );

      // remove typing receipt after some timeout
      // to prevent stuck typing members
      setTimeout(() => {
        const { roomId, userId } = action;
        const timeout = timeoutReceipt(
          get(baseRoomIdToTypingMembersAtom),
          roomId,
          userId,
          TYPING_TIMEOUT_MS,
        );
        if (timeout) {
          set(
            baseRoomIdToTypingMembersAtom,
            produce(get(baseRoomIdToTypingMembersAtom), (draft) =>
              deleteTypingMember(draft, {
                type: 'DELETE',
                roomId,
                userId,
              }),
            ),
          );
        }
      }, TYPING_TIMEOUT_MS);
    }

    if (
      action.type === 'DELETE' &&
      rToTyping.get(action.roomId)?.find((receipt) => receipt.userId === action.userId)
    ) {
      set(
        baseRoomIdToTypingMembersAtom,
        produce(rToTyping, (draft) => deleteTypingMember(draft, action)),
      );
    }
  },
);

export const useBindRoomIdToTypingMembersAtom = (
  mx: MatrixClient,
  typingMembersAtom: typeof roomIdToTypingMembersAtom,
) => {
  const setTypingMembers = useSetAtom(typingMembersAtom);
  const [hideTypingStatus] = useSetting(settingsAtom, 'hideTypingStatus');

  useEffect(() => {
    const handleTypingEvent: RoomMemberEventHandlerMap[RoomMemberEvent.Typing] = (
      event,
      member,
    ) => {
      // Kept in production on purpose. A missing typing indicator has three
      // indistinguishable causes from the outside — the setting is on, the
      // homeserver is not sending `m.typing`, or the typing member is not
      // loaded into room state (lazy loading only emits this for members the
      // client already has) — and this line is what tells them apart.
      console.info('[typing]', {
        roomId: member.roomId,
        userId: member.userId,
        typing: member.typing,
        suppressedBySetting: hideTypingStatus,
      });
      if (hideTypingStatus) {
        return;
      }
      setTypingMembers({
        type: member.typing ? 'PUT' : 'DELETE',
        roomId: member.roomId,
        userId: member.userId,
        ts: Date.now(),
      });
    };

    mx.on(RoomMemberEvent.Typing, handleTypingEvent);
    return () => {
      mx.removeListener(RoomMemberEvent.Typing, handleTypingEvent);
    };
  }, [mx, setTypingMembers, hideTypingStatus]);

  useEffect(() => {
    // The control for the log above, and the reason it can be read at all.
    //
    // `RoomMember.setTypingEvent` emits only when a member's typing state
    // *changes*, and `RoomState.setTypingEvent` only walks members already
    // loaded into room state — so with lazy loading, a typing member the
    // client has never seen produces no `RoomMember.typing` at all. Silence
    // from the handler above therefore means either "the homeserver sent no
    // `m.typing`" or "it did, and the member was not loaded", which are
    // different bugs with the same symptom.
    //
    // This fires for every ephemeral event off /sync regardless of member
    // state, so the pair separates them: no line here at all means the EDU
    // never arrived; a line here with no `[typing]` after it means the member
    // was not loaded.
    //
    // It cannot replace the handler above: sync.js maps ephemeral events
    // without a room (`mapSyncEventsFormat(joinObj.ephemeral)` passes no room
    // argument), so `m.typing` carries no `room_id` and cannot be attributed
    // to a room from here.
    const handleRawEvent: ClientEventHandlerMap[ClientEvent.Event] = (event) => {
      if (event.getType() !== EventType.Typing) return;
      const { user_ids: userIds } = event.getContent<{ user_ids?: string[] }>();
      console.info('[typing:raw]', {
        userIds,
        loadedMembers: (userIds ?? []).map((userId) =>
          mx
            .getRooms()
            .filter((room) => room.getMember(userId))
            .map((room) => room.roomId),
        ),
      });
    };

    mx.on(ClientEvent.Event, handleRawEvent);
    return () => {
      mx.removeListener(ClientEvent.Event, handleRawEvent);
    };
  }, [mx]);
};
