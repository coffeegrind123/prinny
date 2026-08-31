import { useCallback, useSyncExternalStore } from 'react';
import { isShiftPressed, subscribeShiftKey } from '../state/shiftKey';

const noopSubscribe = () => () => undefined;

/**
 * Whether the Shift key is held.
 *
 * Pass `false` to opt out — a component that cannot show anything different
 * while Shift is down has no reason to subscribe, and not subscribing keeps a
 * modifier press from re-rendering every message in the timeline. The hover
 * toolbar passes its own hover state, so at any moment the store has roughly
 * one listener: the message under the pointer.
 */
export function useShiftKey(active = true): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => (active ? subscribeShiftKey(onStoreChange) : noopSubscribe()),
    [active],
  );

  const getSnapshot = useCallback(() => (active ? isShiftPressed() : false), [active]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
