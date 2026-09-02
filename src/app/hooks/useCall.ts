import { Room } from 'matrix-js-sdk';
import { EventType } from 'matrix-js-sdk/lib/@types/event';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
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
    let cancelled = false;
    let stateVersion = 0;

    const hasLocalCall = () =>
      childRoomIds.some((roomId) => {
        const room = mx.getRoom(roomId);
        if (!room) return false;
        return mx.matrixRTC.getRoomSession(room).memberships.length > 0;
      });

    const check = () => {
      stateVersion += 1;
      setHasCall(hasLocalCall());
    };

    const fetchCallState = async () => {
      const version = stateVersion;
      const results = await Promise.all(
        childRoomIds.map(async (roomId) => {
          try {
            const state = await mx.roomState(roomId);
            const membershipEvents = state.filter(
              (event) =>
                event.type === EventType.GroupCallMemberPrefix ||
                event.type === EventType.RTCMembership,
            );
            const memberships = await Promise.all(
              membershipEvents.map(async (event) => {
                try {
                  return await CallMembership.parseFromEvent(new MatrixEvent(event));
                } catch {
                  return undefined;
                }
              }),
            );
            return memberships.some((membership) => membership && !membership.isExpired());
          } catch {
            return false;
          }
        }),
      );

      if (!cancelled && version === stateVersion) {
        setHasCall(hasLocalCall() || results.some(Boolean));
      }
    };

    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, check);
    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, check);

    check();
    fetchCallState();

    return () => {
      cancelled = true;
      mx.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionStarted, check);
      mx.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionEnded, check);
    };
  }, [mx, space]);

  return hasCall;
};
