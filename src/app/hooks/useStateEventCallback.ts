import { MatrixClient, MatrixEvent, RoomState, RoomStateEvent } from 'matrix-js-sdk';
import { useEffect } from 'react';

export type StateEventCallback = (
  event: MatrixEvent,
  state: RoomState,
  lastStateEvent: MatrixEvent | null,
) => void;

/**
 * One `RoomState.events` listener on the client, fanned out to every subscriber.
 *
 * This hook is used by `useStateEvent`, `usePowerLevels`, `useImagePacks`,
 * `useBotInfo`, `useSpaceHierarchy`, `RoomCard` and the unread state — all of
 * which mount per room or per card, so a busy account registered one SDK
 * listener each and tripped `MaxListenersExceededWarning: 51 RoomState.events
 * listeners added` (the cap is set to 50 in `initMatrix`). Nothing was leaking:
 * every listener was removed on unmount. There were simply, legitimately, more
 * than fifty subscribers.
 *
 * Raising the cap would have silenced the warning while leaving the SDK to walk
 * a list of 50+ functions on every state event in every room. Multiplexing
 * keeps that list at one entry per client regardless of how much UI is mounted,
 * and the per-subscriber cost is a Set insert.
 */
// Each subscription is its own object rather than the bare function, because
// two components may legitimately pass the same callback identity (a module
// level or otherwise shared handler) and a Set of functions would collapse
// them into one — unmounting either would then silence both.
type Subscription = { callback: StateEventCallback };

const clientSubscribers = new WeakMap<MatrixClient, Set<Subscription>>();
const clientDispatchers = new WeakMap<MatrixClient, StateEventCallback>();

/**
 * Exported for stores that multiplex per room rather than per component, and so
 * cannot use the hook. `useRoomBots` is one: it keeps a single snapshot per room
 * and needs the state subscription attached to that snapshot's lifetime, not to
 * any one of the many components reading it.
 */
export const subscribeToStateEvents = (
  mx: MatrixClient,
  callback: StateEventCallback,
): (() => void) => {
  let subscribers = clientSubscribers.get(mx);

  if (!subscribers) {
    const set: Set<Subscription> = new Set();
    subscribers = set;
    clientSubscribers.set(mx, set);

    // Iterate a copy: a subscriber is free to unsubscribe (or mount something
    // that subscribes) while it is being notified, and mutating the live Set
    // mid-iteration would skip or double-call its neighbours.
    const dispatch: StateEventCallback = (event, state, lastStateEvent) => {
      Array.from(set).forEach((subscriber) => subscriber.callback(event, state, lastStateEvent));
    };
    clientDispatchers.set(mx, dispatch);
    mx.on(RoomStateEvent.Events, dispatch);
  }

  const subscription: Subscription = { callback };
  subscribers.add(subscription);

  return () => {
    const set = clientSubscribers.get(mx);
    if (!set) return;
    set.delete(subscription);
    if (set.size > 0) return;

    // Last subscriber gone — drop the SDK listener too, so a logged-out client
    // is not kept alive by a dispatcher nobody reads.
    const dispatch = clientDispatchers.get(mx);
    if (dispatch) mx.removeListener(RoomStateEvent.Events, dispatch);
    clientDispatchers.delete(mx);
    clientSubscribers.delete(mx);
  };
};

export const useStateEventCallback = (mx: MatrixClient, onStateEvent: StateEventCallback) => {
  useEffect(() => subscribeToStateEvents(mx, onStateEvent), [mx, onStateEvent]);
};
