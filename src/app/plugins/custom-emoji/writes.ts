import { MatrixClient } from 'matrix-js-sdk';
import { PackContent, RoomIdToStateKey } from './types';
import { PACK_ROOMS_TYPES, ROOM_PACK_TYPES, packRoomsWrites } from './compat';

/**
 * Writes a room pack under both names (see compat.ts), stable first.
 *
 * A room's power levels can allow one name and not the other — an old room
 * that lowered the level for `im.ponies.room_emotes` only, say. The save
 * counts as done when at least one write went through; it fails only when
 * every write did, and then with the first error, which is the stable one.
 */
export async function sendRoomImagePack(
  mx: MatrixClient,
  roomId: string,
  stateKey: string,
  content: PackContent | Record<string, never>,
): Promise<void> {
  const errors: unknown[] = [];

  for (const type of ROOM_PACK_TYPES) {
    try {
      await mx.sendStateEvent(roomId, type as never, content as never, stateKey);
    } catch (err) {
      errors.push(err);
    }
  }

  if (errors.length === ROOM_PACK_TYPES.length) throw errors[0];
}

/** Writes the globally enabled pack references under both names. */
export async function setPackRooms(mx: MatrixClient, rooms: RoomIdToStateKey): Promise<void> {
  const writes = packRoomsWrites(rooms);
  for (const type of PACK_ROOMS_TYPES) {
    await mx.setAccountData(type as never, writes[type] as never);
  }
}
