import { useMemo } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getAccountData } from '../utils/room';
import { useAccountData } from '../hooks/useAccountData';

type LeftRoomsContent = {
  /** roomId -> time (ms) the leave was recorded */
  rooms?: Record<string, number>;
};

const parseLeftRooms = (content?: LeftRoomsContent): Record<string, number> => {
  const rooms = content?.rooms;
  if (!rooms || typeof rooms !== 'object') return {};
  return Object.fromEntries(Object.entries(rooms).filter(([, ts]) => typeof ts === 'number'));
};

export const getLeftRooms = (mx: MatrixClient): Record<string, number> =>
  parseLeftRooms(getAccountData(mx, AccountDataEvent.PrinnyLeftRooms)?.getContent());

// Homeservers reject events over 64 KiB. Measured JSON size of the content:
// 800 v12 room ids (`!` + 43 chars) ~48.8 KB, 800 legacy ids on a 40-char
// server name ~61.6 KB. So cap the count, then also trim by encoded size in
// case the ids are longer still. Oldest marks go first.
const MAX_LEFT_ROOMS = 800;
const MAX_LEFT_ROOMS_BYTES = 60000;

const encodedSize = (rooms: Record<string, number>): number =>
  new TextEncoder().encode(JSON.stringify({ rooms })).length;

const pruneLeftRooms = (rooms: Record<string, number>): Record<string, number> => {
  const entries = Object.entries(rooms).sort(([, a], [, b]) => b - a);
  let kept = entries.slice(0, MAX_LEFT_ROOMS);
  while (kept.length > 0 && encodedSize(Object.fromEntries(kept)) > MAX_LEFT_ROOMS_BYTES) {
    kept = kept.slice(0, Math.floor(kept.length * 0.9));
  }
  return Object.fromEntries(kept);
};

// Serialises read-modify-write: setAccountData resolves once the sync echo has
// landed, so each queued update reads the content the previous one wrote, and
// concurrent leaves (a space and all its rooms) can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

const updateLeftRooms = (
  mx: MatrixClient,
  update: (rooms: Record<string, number>) => Record<string, number> | undefined,
): Promise<unknown> => {
  queue = queue
    .catch(() => undefined)
    .then(() => {
      const rooms = update(getLeftRooms(mx));
      if (!rooms) return undefined;
      return mx.setAccountData(AccountDataEvent.PrinnyLeftRooms, {
        rooms: pruneLeftRooms(rooms),
      });
    });
  return queue;
};

/**
 * Records rooms the user left, so space auto-join never joins them back.
 * Kept in account data so every device honours it.
 */
export const markRoomsLeft = (mx: MatrixClient, roomIds: string[]): Promise<unknown> =>
  updateLeftRooms(mx, (rooms) => {
    if (roomIds.every((id) => id in rooms)) return undefined;
    const now = Date.now();
    return { ...rooms, ...Object.fromEntries(roomIds.map((id) => [id, now])) };
  });

/** Forgets leaves, once the user has joined the room again. */
export const unmarkRoomsLeft = (mx: MatrixClient, roomIds: string[]): Promise<unknown> =>
  updateLeftRooms(mx, (rooms) => {
    if (!roomIds.some((id) => id in rooms)) return undefined;
    return Object.fromEntries(Object.entries(rooms).filter(([id]) => !roomIds.includes(id)));
  });

/**
 * Leaves a room, recording the leave first: the leave's sync can re-run
 * auto-join before a mark written afterwards has come back.
 */
export const leaveRoomExplicitly = async (mx: MatrixClient, roomId: string): Promise<void> => {
  await markRoomsLeft(mx, [roomId]);
  try {
    await mx.leave(roomId);
  } catch (err) {
    // The leave didn't happen, so don't keep a mark that would block auto-join.
    await unmarkRoomsLeft(mx, [roomId]).catch(() => undefined);
    throw err;
  }
};

export const useLeftRooms = (): Set<string> => {
  const event = useAccountData(AccountDataEvent.PrinnyLeftRooms);
  return useMemo(
    () => new Set(Object.keys(parseLeftRooms(event?.getContent<LeftRoomsContent>()))),
    [event],
  );
};
