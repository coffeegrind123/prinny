import { useCallback, useSyncExternalStore } from 'react';
import { MatrixClient, RoomEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

/**
 * Pinned chats are stored as the standard `m.favourite` room tag.
 *
 * That is deliberate rather than convenient: `m.tag` is per-room account data,
 * which lives on the homeserver, and `m.favourite` is exactly what Element's
 * "Favourites" writes. So a chat pinned here is already favourited in Element,
 * a favourite starred in Element is already pinned here, and someone moving
 * between the two clients does not have to set their pins up twice. A
 * client-private setting would have been simpler and would have none of that.
 */
export const FAVOURITE_TAG = 'm.favourite';

/**
 * Pinned room id -> the tag's `order`, when it has one.
 *
 * `order` is the spec's manual-ordering hint (a number, conventionally 0..1).
 * It is optional and Element does not always write one, so it is a sort hint
 * rather than the sort: see `factoryRoomIdByPinned`.
 */
export type RoomFavourites = Map<string, number | undefined>;

const readFavourites = (mx: MatrixClient): RoomFavourites => {
  const favourites: RoomFavourites = new Map();

  mx.getRooms().forEach((room) => {
    const tag = room.tags?.[FAVOURITE_TAG];
    if (!tag) return;
    favourites.set(room.roomId, typeof tag.order === 'number' ? tag.order : undefined);
  });

  return favourites;
};

// ── Shared tag subscription ─────────────────────────────────────────────────
//
// Every room nav item asks whether it is pinned, and a virtualised list renders
// dozens at a time. One client listener each would be dozens of listeners on a
// client whose cap is 50 — the same trap `useUserPresence` documents. So there
// is exactly ONE `Room.tags` listener per client, and the snapshot is shared
// and memoised: `useSyncExternalStore` compares snapshots by identity, so
// re-reading the rooms on every render would loop forever. The cache is dropped
// on a tag change and rebuilt on the next read.

type FavouritesEntry = {
  snapshot?: RoomFavourites;
  listeners: Set<() => void>;
  teardown?: () => void;
};

const clientState = new WeakMap<MatrixClient, FavouritesEntry>();

const getEntry = (mx: MatrixClient): FavouritesEntry => {
  let entry = clientState.get(mx);
  if (!entry) {
    entry = { listeners: new Set() };
    clientState.set(mx, entry);
  }
  return entry;
};

const notify = (entry: FavouritesEntry) => {
  entry.listeners.forEach((listener) => listener());
};

/**
 * Attached on the first READ, not the first subscribe.
 *
 * `useSyncExternalStore` reads during render and subscribes in an effect, so a
 * listener attached only on subscribe would leave a gap where a tag change goes
 * unnoticed and the cache it invalidates is never dropped — a pin made in
 * Element in that window would stick as stale until the next one.
 */
const ensureListener = (mx: MatrixClient, entry: FavouritesEntry) => {
  if (entry.teardown) return;

  const onTags = () => {
    entry.snapshot = undefined;
    notify(entry);
  };
  mx.on(RoomEvent.Tags, onTags);
  entry.teardown = () => mx.removeListener(RoomEvent.Tags, onTags);
};

const getSnapshot = (mx: MatrixClient): RoomFavourites => {
  const entry = getEntry(mx);
  ensureListener(mx, entry);
  if (!entry.snapshot) entry.snapshot = readFavourites(mx);
  return entry.snapshot;
};

const subscribe = (mx: MatrixClient, listener: () => void): (() => void) => {
  const entry = getEntry(mx);
  ensureListener(mx, entry);
  entry.listeners.add(listener);

  return () => {
    entry.listeners.delete(listener);
  };
};

/**
 * Reflect a tag change we just made ourselves.
 *
 * `setRoomTag`/`deleteRoomTag` are plain HTTP calls with no local echo — the
 * `Room.tags` event only fires when the change comes back down `/sync`, so
 * without this the item would sit unmoved for a round trip after the user
 * clicked Pin. Applied only after the request succeeds, and superseded by the
 * real event when it arrives.
 */
const applyLocalChange = (mx: MatrixClient, roomId: string, favourite: boolean) => {
  const entry = getEntry(mx);
  const next = new Map(entry.snapshot ?? readFavourites(mx));

  if (favourite) next.set(roomId, next.get(roomId));
  else next.delete(roomId);

  entry.snapshot = next;
  notify(entry);
};

export const useRoomFavourites = (): RoomFavourites => {
  const mx = useMatrixClient();

  return useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(mx, listener), [mx]),
    useCallback(() => getSnapshot(mx), [mx]),
  );
};

export const useRoomFavourite = (roomId: string): boolean => useRoomFavourites().has(roomId);

export const useToggleRoomFavourite = (): ((
  roomId: string,
  favourite: boolean,
) => Promise<void>) => {
  const mx = useMatrixClient();

  return useCallback(
    async (roomId: string, favourite: boolean) => {
      if (favourite) {
        await mx.setRoomTag(roomId, FAVOURITE_TAG, {});
      } else {
        await mx.deleteRoomTag(roomId, FAVOURITE_TAG);
      }
      applyLocalChange(mx, roomId, favourite);
    },
    [mx],
  );
};
