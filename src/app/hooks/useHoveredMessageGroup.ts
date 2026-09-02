import { useCallback, useSyncExternalStore } from 'react';
import { isHoveredMessageGroup, subscribeHoveredMessageGroup } from '../state/hoveredMessageGroup';

const noopSubscribe = () => () => undefined;

/**
 * Whether the pointer is on ANY message of the group headed by `groupHeadId`.
 *
 * Pass `undefined` to opt out — a collapsed message has no header to put
 * anything on, so it has no reason to subscribe, and not subscribing keeps the
 * store's listener map to one entry per group rather than one per message.
 */
export function useHoveredMessageGroup(groupHeadId: string | undefined): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      groupHeadId ? subscribeHoveredMessageGroup(groupHeadId, onStoreChange) : noopSubscribe(),
    [groupHeadId],
  );

  const getSnapshot = useCallback(
    () => (groupHeadId ? isHoveredMessageGroup(groupHeadId) : false),
    [groupHeadId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
