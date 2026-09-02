import { useCallback } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent, RoomOrderContent, RoomSortMode } from '../../types/matrix/accountData';
import { getAccountData } from '../utils/room';
import { useMatrixClient } from './useMatrixClient';
import { useAccountData } from './useAccountData';

/**
 * Reads the current per-user room order content from account data.
 */
export const getRoomOrderContent = (mx: MatrixClient): RoomOrderContent =>
  getAccountData(mx, AccountDataEvent.PrinnyRoomOrder)?.getContent<RoomOrderContent>() ?? {};

/**
 * Merges a partial update into the existing room order content and returns the
 * full new content to write back via `mx.setAccountData`.
 */
export const makeRoomOrderContent = (
  mx: MatrixClient,
  partial: Partial<RoomOrderContent>,
): RoomOrderContent => {
  const current = getRoomOrderContent(mx);
  return {
    sortModes: { ...current.sortModes, ...partial.sortModes },
    orders: { ...current.orders, ...partial.orders },
  };
};

/**
 * Writes the selected sort mode for a space to account data.
 */
export const setRoomSortMode = (mx: MatrixClient, spaceId: string, sortMode: RoomSortMode) => {
  const content = makeRoomOrderContent(mx, {
    sortModes: { [spaceId]: sortMode },
  });
  mx.setAccountData(AccountDataEvent.PrinnyRoomOrder, content);
};

/**
 * Writes a manually ordered list of child roomIds for a parent space to account
 * data. Rooms not present in the list are appended after, sorted by activity.
 */
export const setRoomOrder = (mx: MatrixClient, parentSpaceId: string, orderedRoomIds: string[]) => {
  const content = makeRoomOrderContent(mx, {
    orders: { [parentSpaceId]: orderedRoomIds },
  });
  mx.setAccountData(AccountDataEvent.PrinnyRoomOrder, content);
};

/**
 * Reactively returns the per-user room order content, updating when the
 * `app.prinny.room_order` account data event changes.
 */
export const useRoomOrderContent = (): RoomOrderContent => {
  const mx = useMatrixClient();
  const event = useAccountData(AccountDataEvent.PrinnyRoomOrder);
  return event?.getContent<RoomOrderContent>() ?? getRoomOrderContent(mx);
};

export const getRoomSortMode = (content: RoomOrderContent, spaceId: string): RoomSortMode =>
  content.sortModes?.[spaceId] === 'custom' ? 'custom' : 'default';

/**
 * Reactively returns the sort mode selected for the given space, defaulting to
 * `default` when none has been set.
 */
export const useRoomSortMode = (spaceId: string): RoomSortMode => {
  const content = useRoomOrderContent();
  return getRoomSortMode(content, spaceId);
};

/**
 * Returns a stable callback that reorders a room to just before a target room
 * within a parent space's section, persisting the result to account data and
 * switching that space to `custom` sort mode.
 */
export const useReorderRoom = (
  spaceId: string,
): ((parentSpaceId: string, orderedRoomIds: string[]) => void) => {
  const mx = useMatrixClient();
  return useCallback(
    (parentSpaceId: string, orderedRoomIds: string[]) => {
      setRoomOrder(mx, parentSpaceId, orderedRoomIds);
      setRoomSortMode(mx, spaceId, 'custom');
    },
    [mx, spaceId],
  );
};
