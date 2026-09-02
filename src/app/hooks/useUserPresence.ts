import { useEffect, useMemo, useState } from 'react';
import { MatrixClient, User, UserEvent, UserEventHandlerMap } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

export enum Presence {
  Online = 'online',
  Unavailable = 'unavailable',
  Offline = 'offline',
}

export type UserPresence = {
  presence: Presence;
  status?: string;
  active: boolean;
  lastActiveTs?: number;
};

const getUserPresence = (user: User): UserPresence => ({
  presence: user.presence as Presence,
  status: user.presenceStatusMsg,
  active: user.currentlyActive,
  lastActiveTs: user.getLastActiveTs(),
});

// ── Shared presence subscription ────────────────────────────────────────────
//
// Presence events are re-emitted on the MatrixClient for every `User`, so a
// naive hook subscribes at the client level — correct, but it registered the
// three listeners (Presence / CurrentlyActive / LastPresenceTs) *per component
// instance*. A member drawer or nav list of N users therefore put 3N listeners
// on the client and tripped EventEmitter's max-listener warning (the default is
// 10; even a raised cap of 50 is exceeded by a 17-member room's 51 listeners).
//
// Instead we keep exactly ONE set of listeners on the client for the whole app
// and fan each event out to the per-user subscribers that care. Listener count
// is now constant (3) regardless of how many components observe presence.

type PresenceListener = (presence: UserPresence | undefined) => void;

const clientSubscribers = new WeakMap<MatrixClient, Map<string, Set<PresenceListener>>>();
const clientTeardown = new WeakMap<MatrixClient, () => void>();

const ensureClientListeners = (mx: MatrixClient) => {
  if (clientTeardown.has(mx)) return;

  const onPresence: UserEventHandlerMap[UserEvent.Presence] = (_event, user) => {
    const subs = clientSubscribers.get(mx)?.get(user.userId);
    if (!subs || subs.size === 0) return;
    const presence = getUserPresence(user);
    subs.forEach((cb) => cb(presence));
  };

  mx.on(UserEvent.Presence, onPresence);
  mx.on(UserEvent.CurrentlyActive, onPresence);
  mx.on(UserEvent.LastPresenceTs, onPresence);

  clientTeardown.set(mx, () => {
    mx.removeListener(UserEvent.Presence, onPresence);
    mx.removeListener(UserEvent.CurrentlyActive, onPresence);
    mx.removeListener(UserEvent.LastPresenceTs, onPresence);
  });
};

const subscribeUserPresence = (
  mx: MatrixClient,
  userId: string,
  cb: PresenceListener,
): (() => void) => {
  ensureClientListeners(mx);

  let map = clientSubscribers.get(mx);
  if (!map) {
    map = new Map();
    clientSubscribers.set(mx, map);
  }

  let set = map.get(userId);
  if (!set) {
    set = new Set();
    map.set(userId, set);
  }
  set.add(cb);

  return () => {
    const users = clientSubscribers.get(mx);
    const userSet = users?.get(userId);
    if (!users || !userSet) return;
    userSet.delete(cb);
    if (userSet.size === 0) users.delete(userId);

    // Nothing is watching presence anymore — drop the client listeners so a
    // replaced/logged-out client isn't retained and the next login starts clean.
    if (users.size === 0) {
      clientTeardown.get(mx)?.();
      clientTeardown.delete(mx);
    }
  };
};

export const useUserPresence = (userId: string): UserPresence | undefined => {
  const mx = useMatrixClient();

  const [presence, setPresence] = useState<UserPresence | undefined>(() => {
    const u = userId ? mx.getUser(userId) : null;
    return u ? getUserPresence(u) : undefined;
  });

  useEffect(() => {
    if (!userId) {
      setPresence(undefined);
      return undefined;
    }

    // Sync immediately from whatever the store currently holds. The peer's
    // `User` object is created lazily (from the first presence EDU / membership),
    // so it may not have existed at first render; re-reading here also keeps the
    // badge correct when a single nav item is reused for a different room.
    const u = mx.getUser(userId);
    setPresence(u ? getUserPresence(u) : undefined);

    return subscribeUserPresence(mx, userId, setPresence);
  }, [mx, userId]);

  return presence;
};

export const usePresenceLabel = (): Record<Presence, string> =>
  useMemo(
    () => ({
      [Presence.Online]: 'Active',
      [Presence.Unavailable]: 'Busy',
      [Presence.Offline]: 'Away',
    }),
    [],
  );
