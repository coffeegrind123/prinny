import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { NotificationCountType, ReceiptType } from 'matrix-js-sdk';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { roomToUnreadAtom } from '../state/room/roomToUnread';
import { useMatrixClient } from './useMatrixClient';

const RECENT_EVENT_COUNT = 5;

type DebugWindow = Window & {
  mx?: unknown;
  unreadDebug?: (roomId: string) => unknown;
};

/**
 * With developer tools on, exposes the client as `window.mx` and an unread
 * inspector, `unreadDebug(roomId)`, for the devtools console. Neither exists
 * otherwise, so a page script cannot reach the client through them.
 */
export function DebugHandle() {
  const mx = useMatrixClient();
  const [developerTools] = useSetting(settingsAtom, 'developerTools');
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const roomToUnreadRef = useRef(roomToUnread);
  roomToUnreadRef.current = roomToUnread;

  useEffect(() => {
    if (!developerTools) {
      return undefined;
    }
    const target = window as DebugWindow;
    target.mx = mx;
    // The SDK's view of the read position and counts next to the badge state
    // the UI renders, which is what to compare when a room shows the wrong one.
    target.unreadDebug = (roomId: string) => {
      const room = mx.getRoom(roomId);
      if (!room) {
        return undefined;
      }
      const userId = mx.getSafeUserId();
      return {
        upTo: room.getEventReadUpTo(userId),
        upToServerOnly: room.getEventReadUpTo(userId, true),
        public: room.getReadReceiptForUserId(userId, false, ReceiptType.Read),
        private: room.getReadReceiptForUserId(userId, false, ReceiptType.ReadPrivate),
        counts: {
          total: room.getUnreadNotificationCount(NotificationCountType.Total),
          highlight: room.getUnreadNotificationCount(NotificationCountType.Highlight),
        },
        badge: roomToUnreadRef.current.get(roomId),
        last: room
          .getLiveTimeline()
          .getEvents()
          .slice(-RECENT_EVENT_COUNT)
          .map((e) => [e.getId(), e.getSender(), e.getType(), e.getTs()]),
      };
    };
    return () => {
      delete target.mx;
      delete target.unreadDebug;
    };
  }, [mx, developerTools]);

  return null;
}
