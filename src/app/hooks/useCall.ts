import { Room } from 'matrix-js-sdk';
import {
  MatrixRTCSession,
  MatrixRTCSessionEvent,
  MatrixRTCSessionEventHandlerMap,
} from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import { useEffect, useState } from 'react';
import { MatrixRTCSessionManagerEvents } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSessionManager';
import { useMatrixClient } from './useMatrixClient';
import { getSpaceChildren } from '../utils/room';

export const useCallSession = (room: Room): MatrixRTCSession => {
  const mx = useMatrixClient();

  const [session, setSession] = useState(mx.matrixRTC.getRoomSession(room));

  useEffect(() => {
    const start = (roomId: string) => {
      if (roomId !== room.roomId) return;
      setSession(mx.matrixRTC.getRoomSession(room));
    };
    const end = (roomId: string) => {
      if (roomId !== room.roomId) return;
      setSession(mx.matrixRTC.getRoomSession(room));
    };
    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, start);
    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, end);
    return () => {
      mx.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionStarted, start);
      mx.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionEnded, end);
    };
  }, [mx, room]);

  return session;
};

export const useCallMembersChange = (
  session: MatrixRTCSession,
  callback: (members: CallMembership[]) => void,
): void => {
  useEffect(() => {
    const handleMembershipsChange: MatrixRTCSessionEventHandlerMap[MatrixRTCSessionEvent.MembershipsChanged] =
      (oldestMembership, newMemberships) => {
        callback(newMemberships);
      };

    session.on(MatrixRTCSessionEvent.MembershipsChanged, handleMembershipsChange);
    return () => {
      session.removeListener(MatrixRTCSessionEvent.MembershipsChanged, handleMembershipsChange);
    };
  }, [session, callback]);
};

export const useCallMembers = (session: MatrixRTCSession): CallMembership[] => {
  const [memberships, setMemberships] = useState<CallMembership[]>(session.memberships);

  useCallMembersChange(session, setMemberships);

  return memberships;
};

export const useSpaceHasCall = (space: Room): boolean => {
  const mx = useMatrixClient();
  const [hasCall, setHasCall] = useState(false);

  useEffect(() => {
    const childRoomIds = getSpaceChildren(space);
    const hasLocalCall = () =>
      childRoomIds.some((roomId) => {
        const room = mx.getRoom(roomId);
        if (!room) return false;
        return mx.matrixRTC.getRoomSession(room).memberships.length > 0;
      });

    // MatrixRTC sessions are built from synced state for every joined room,
    // so no per-room /state download is needed. That download ran for every
    // child at mount, and the server refuses it (403) for most unjoined ones.
    const check = () => setHasCall(hasLocalCall());

    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, check);
    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, check);

    check();

    return () => {
      mx.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionStarted, check);
      mx.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionEnded, check);
    };
  }, [mx, space]);

  return hasCall;
};
