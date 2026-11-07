import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { ImagePack, PackFallback } from './ImagePack';
import { ImageUsage, RoomIdToStateKey } from './types';
import { StateEvent } from '../../../types/matrix/room';
import { getAccountData, getStateEvent, getStateEvents } from '../../utils/room';
import { AccountDataEvent } from '../../../types/matrix/accountData';
import { PackMetaReader } from './PackMetaReader';
import { PackAddress } from './PackAddress';
import { PACK_ROOMS_TYPES, ROOM_PACK_TYPES, mergePackRooms, pickPackEvents } from './compat';

export function packAddressEqual(a1?: PackAddress, a2?: PackAddress): boolean {
  if (!a1 && !a2) return true;
  if (!a1 || !a2) return false;
  return a1.roomId === a2.roomId && a1.stateKey === a2.stateKey;
}

export function imageUsageEqual(u1: ImageUsage[], u2: ImageUsage[]) {
  return u1.length === u2.length && u1.every((u) => u2.includes(u));
}

export function packMetaEqual(a: PackMetaReader, b: PackMetaReader): boolean {
  return (
    a.name === b.name &&
    a.avatar === b.avatar &&
    a.attribution === b.attribution &&
    imageUsageEqual(a.usage, b.usage)
  );
}

function roomPackFallback(room: Room): PackFallback {
  const avatarUrl = getStateEvent(room, StateEvent.RoomAvatar)?.getContent().url;
  return {
    name: room.name || undefined,
    avatarUrl:
      typeof avatarUrl === 'string' && avatarUrl.startsWith('mxc://') ? avatarUrl : undefined,
  };
}

export function makeImagePacks(packEvents: MatrixEvent[], room?: Room): ImagePack[] {
  const fallback = room ? roomPackFallback(room) : undefined;
  return packEvents.reduce<ImagePack[]>((imagePacks, packEvent) => {
    const packId = packEvent.getId();
    if (!packId) return imagePacks;
    imagePacks.push(ImagePack.fromMatrixEvent(packId, packEvent, fallback));
    return imagePacks;
  }, []);
}

/** Both names' pack events in a room, one per state_key (see compat.ts). */
function getRoomPackEvents(room: Room): MatrixEvent[] {
  return pickPackEvents(
    ROOM_PACK_TYPES.flatMap((type) => getStateEvents(room, type as StateEvent)),
  );
}

export function getRoomImagePack(room: Room, stateKey: string): ImagePack | undefined {
  const [packEvent] = pickPackEvents(
    ROOM_PACK_TYPES.flatMap((type) => {
      const event = getStateEvent(room, type as StateEvent, stateKey);
      return event ? [event] : [];
    }),
  );
  if (!packEvent) return undefined;
  const packId = packEvent.getId();
  if (!packId) return undefined;
  return ImagePack.fromMatrixEvent(packId, packEvent, roomPackFallback(room));
}

export function getRoomImagePacks(room: Room): ImagePack[] {
  return makeImagePacks(getRoomPackEvents(room), room);
}

/** Every globally enabled pack reference, from both account data names. */
export function getPackRoomsRefs(mx: MatrixClient): RoomIdToStateKey {
  return mergePackRooms(
    PACK_ROOMS_TYPES.map((type) => getAccountData(mx, type as AccountDataEvent)?.getContent()),
  );
}

export function getGlobalImagePacks(mx: MatrixClient): ImagePack[] {
  const roomIdToPackInfo = getPackRoomsRefs(mx);

  return Object.keys(roomIdToPackInfo).flatMap((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room) return [];
    const packStateKeyToUnknown = roomIdToPackInfo[roomId];
    const globalPackEvents = getRoomPackEvents(room).filter((mE) => {
      const stateKey = mE.getStateKey();
      return typeof stateKey === 'string' && stateKey in packStateKeyToUnknown;
    });
    return makeImagePacks(globalPackEvents, room);
  });
}

export function getUserImagePack(mx: MatrixClient): ImagePack | undefined {
  const packEvent = getAccountData(mx, AccountDataEvent.PoniesUserEmotes);
  const userId = mx.getUserId();
  if (!packEvent || !userId) {
    return undefined;
  }

  const userImagePack = ImagePack.fromMatrixEvent(userId, packEvent);
  return userImagePack;
}
