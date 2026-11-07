import { Room } from 'matrix-js-sdk';
import { useCallback, useMemo, useState } from 'react';
import { AccountDataEvent } from '../../types/matrix/accountData';
import {
  getGlobalImagePacks,
  getPackRoomsRefs,
  getRoomImagePack,
  getRoomImagePacks,
  getUserImagePack,
  ImagePack,
  ImageUsage,
  isPackRoomsType,
  isRoomPackType,
} from '../plugins/custom-emoji';
import { useMatrixClient } from './useMatrixClient';
import { useAccountDataCallback } from './useAccountDataCallback';
import { useStateEventCallback } from './useStateEventCallback';
import { useMashupImagePack } from './useMashupImagePack';

export const useUserImagePack = (): ImagePack | undefined => {
  const mx = useMatrixClient();
  const [userPack, setUserPack] = useState(() => getUserImagePack(mx));

  useAccountDataCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === AccountDataEvent.PoniesUserEmotes) {
          setUserPack(getUserImagePack(mx));
        }
      },
      [mx],
    ),
  );

  return userPack;
};

export const useGlobalImagePacks = (): ImagePack[] => {
  const mx = useMatrixClient();
  const [globalPacks, setGlobalPacks] = useState(() => getGlobalImagePacks(mx));

  useAccountDataCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (isPackRoomsType(mEvent.getType())) {
          setGlobalPacks(getGlobalImagePacks(mx));
        }
      },
      [mx],
    ),
  );

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        const eventType = mEvent.getType();
        const roomId = mEvent.getRoomId();
        const stateKey = mEvent.getStateKey();
        if (isRoomPackType(eventType) && roomId && typeof stateKey === 'string') {
          // Checked against the references, not the packs already shown: a pack
          // enabled before it existed (or created under the other name) must
          // appear as soon as its event arrives.
          const refs = getPackRoomsRefs(mx)[roomId];
          if (refs && stateKey in refs) {
            setGlobalPacks(getGlobalImagePacks(mx));
          }
        }
      },
      [mx],
    ),
  );

  return globalPacks;
};

export const useRoomImagePack = (room: Room, stateKey: string): ImagePack | undefined => {
  const mx = useMatrixClient();
  const [roomPack, setRoomPack] = useState(() => getRoomImagePack(room, stateKey));

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (
          mEvent.getRoomId() === room.roomId &&
          isRoomPackType(mEvent.getType()) &&
          mEvent.getStateKey() === stateKey
        ) {
          setRoomPack(getRoomImagePack(room, stateKey));
        }
      },
      [room, stateKey],
    ),
  );

  return roomPack;
};

export const useRoomImagePacks = (room: Room): ImagePack[] => {
  const mx = useMatrixClient();
  const [roomPacks, setRoomPacks] = useState(() => getRoomImagePacks(room));

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getRoomId() === room.roomId && isRoomPackType(mEvent.getType())) {
          setRoomPacks(getRoomImagePacks(room));
        }
      },
      [room],
    ),
  );

  return roomPacks;
};

export const useRoomsImagePacks = (rooms: Room[]) => {
  const mx = useMatrixClient();
  const [roomPacks, setRoomPacks] = useState(() => rooms.flatMap(getRoomImagePacks));

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (
          rooms.find((room) => room.roomId === mEvent.getRoomId()) &&
          isRoomPackType(mEvent.getType())
        ) {
          setRoomPacks(rooms.flatMap(getRoomImagePacks));
        }
      },
      [rooms],
    ),
  );

  return roomPacks;
};

export const useRelevantImagePacks = (usage: ImageUsage, rooms: Room[]): ImagePack[] => {
  const userPack = useUserImagePack();
  const globalPacks = useGlobalImagePacks();
  const roomsPacks = useRoomsImagePacks(rooms);
  // Emoji mashups are not stored as a real `im.ponies.*` pack, but every
  // consumer of this hook — the board, `:` autocomplete, the search index —
  // should see them as one. Injecting here rather than at those call sites is
  // what keeps them from each needing to know mashups exist.
  const mashupPack = useMashupImagePack();

  const relevantPacks = useMemo(() => {
    const packs = userPack ? [userPack] : [];
    if (mashupPack) packs.push(mashupPack);
    const globalPackIds = new Set(globalPacks.map((pack) => pack.id));

    const relPacks = packs.concat(
      globalPacks,
      roomsPacks.filter((pack) => !globalPackIds.has(pack.id)),
    );

    return relPacks.filter((pack) => pack.getImages(usage).length > 0);
  }, [userPack, mashupPack, globalPacks, roomsPacks, usage]);

  return relevantPacks;
};
