import { useEffect } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { isAndroid } from '../utils/platform';
import { resolveTauriIconPath } from '../utils/desktop-notifications';
import { mDirectAtom } from '../state/mDirectList';
import { allRoomsAtom } from '../state/room-list/roomList';
import { getDirectRoomAvatarUrl, getRoomAvatarUrl } from '../utils/room';
import { guessDmRoomUserId } from '../utils/matrix';
import { useMediaAuthentication } from './useMediaAuthentication';

/**
 * How many rooms to keep an avatar on disk for.
 *
 * Bounded because this is speculative work: it caches images for notifications
 * that may never arrive. Sorted by recent activity first, so the cap falls on
 * the rooms least likely to be the next to notify.
 */
const MAX_CACHED_AVATARS = 50;

/** Agreed with `UnifiedPushReceiver.kt`. Change one and you change both. */
const userAvatarKey = (userId: string) => `user:${userId}`;
const roomAvatarKey = (roomId: string) => `room:${roomId}`;

/**
 * Keep sender and room avatars on disk where the Android push receiver can
 * find them.
 *
 * A background notification is posted by Kotlin with no JavaScript running —
 * that is the whole point of that path, since a backgrounded WebView cannot be
 * relied on to execute. Kotlin therefore has no Matrix client, no media URL, and
 * no access token, and the push payload carries no avatar (the Push Gateway API
 * has no such field). Left alone it can only post a notification with no icon,
 * which is what it did.
 *
 * Rather than give the receiver credentials and a network path of its own, the
 * work happens HERE, where a logged-in client already exists: avatars are cached
 * under a key derived from the user or room id, and the receiver — which knows
 * exactly those two things from the push — recomputes the same key and reads the
 * file. No token is stored natively, no request is made while handling a push,
 * and the receiver stays incapable of talking to the network at all.
 *
 * The trade is that only a cached sender gets an icon. Someone messaging for the
 * very first time while the app is closed has no entry yet and their
 * notification looks as it does today, until the next time the app runs.
 */
export function useNotificationAvatarCache(mx: MatrixClient | undefined) {
  const mDirects = useAtomValue(mDirectAtom);
  const allRooms = useAtomValue(allRoomsAtom);
  const useAuthentication = useMediaAuthentication();

  useEffect(() => {
    if (!mx) return undefined;

    let cancelled = false;

    const run = async () => {
      // Android only: every other platform posts its notifications from
      // JavaScript, which resolves avatars on demand and needs none of this.
      if (!(await isAndroid())) return;
      if (cancelled) return;

      const accessToken = mx.getAccessToken();
      const authHeader = useAuthentication && accessToken ? `Bearer ${accessToken}` : undefined;

      const rooms = allRooms
        .map((roomId) => mx.getRoom(roomId))
        .filter((room) => !!room)
        .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
        .slice(0, MAX_CACHED_AVATARS);

      // Sequential on purpose. This is background housekeeping competing with a
      // just-started client's own sync traffic, and fifty parallel media
      // requests on a phone's connection would be felt.
      for (const room of rooms) {
        if (cancelled) return;

        const direct = mDirects.has(room.roomId);
        const url = direct
          ? getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)
          : getRoomAvatarUrl(mx, room, 96, useAuthentication);
        if (!url) continue;

        // A DM's avatar IS the other person's, so it is stored under their user
        // id: the receiver looks the sender up first, which is what makes a
        // direct message show a face rather than a room.
        const dmUserId = direct ? guessDmRoomUserId(room, mx.getSafeUserId()) : undefined;
        const key = dmUserId ? userAvatarKey(dmUserId) : roomAvatarKey(room.roomId);

        await resolveTauriIconPath(url, authHeader, mx.baseUrl, key).catch(() => undefined);
      }
    };

    run().catch(() => {
      // Housekeeping. A failure here costs an icon, never a notification.
    });

    return () => {
      cancelled = true;
    };
  }, [mx, mDirects, allRooms, useAuthentication]);
}
