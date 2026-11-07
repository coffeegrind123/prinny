import { useEffect, useState } from 'react';
import { ClientEvent, MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { ProfileStatus, getProfileStatus, touchesProfileStatus } from '../utils/profileStatus';

/**
 * Other users' MSC4426 statuses, as far as this client has seen them.
 *
 * Fed by profile fetches that already happen (`useUserProfile`) and by the
 * profile updates the homeserver pushes in /sync (MSC4429, which asks for the
 * status keys — see USER_PROFILE_FIELDS). Reading from here costs no request,
 * which matters in the room list: a profile fetch per DM row would be one
 * request per conversation on every load.
 */
const statuses = new Map<string, ProfileStatus | null>();
const listeners = new Map<string, Set<() => void>>();

const notify = (userId: string) => listeners.get(userId)?.forEach((listener) => listener());

/** Records what a full profile says (absent status = none). */
export const recordFullProfile = (userId: string, profile: Record<string, unknown>): void => {
  const next = getProfileStatus(profile) ?? null;
  const prev = statuses.get(userId);
  statuses.set(userId, next);
  if (JSON.stringify(prev ?? null) !== JSON.stringify(next)) notify(userId);
};

/** Records a partial update; ignored unless it mentions a status key. */
const recordProfileUpdate = (userId: string, update: Record<string, unknown> | null): void => {
  if (update === null) {
    recordFullProfile(userId, {});
    return;
  }
  if (touchesProfileStatus(update)) recordFullProfile(userId, update);
};

const installed = new WeakSet<MatrixClient>();

const installListener = (mx: MatrixClient) => {
  if (installed.has(mx)) return;
  installed.add(mx);
  mx.on(ClientEvent.UserProfileUpdate, (userId: string, update: Record<string, unknown> | null) =>
    recordProfileUpdate(userId, update),
  );
};

/** A user's MSC4426 status, when one is known. */
export const useProfileStatus = (userId: string | undefined): ProfileStatus | undefined => {
  const mx = useMatrixClient();
  const [status, setStatus] = useState(() => (userId ? statuses.get(userId) : undefined));

  useEffect(() => {
    installListener(mx);
    if (!userId) {
      setStatus(undefined);
      return undefined;
    }
    const update = () => setStatus(statuses.get(userId));
    update();
    const set = listeners.get(userId) ?? new Set();
    set.add(update);
    listeners.set(userId, set);
    return () => {
      set.delete(update);
      if (set.size === 0) listeners.delete(userId);
    };
  }, [mx, userId]);

  return status ?? undefined;
};
