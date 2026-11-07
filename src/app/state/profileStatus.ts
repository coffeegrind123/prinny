import { useEffect, useState } from 'react';
import { ClientEvent, MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../hooks/useMatrixClient';
import {
  STATUS_PROFILE_FIELDS,
  profileStatusLine,
  touchesProfileStatus,
} from '../utils/profileStatus';

/**
 * Other users' MSC4426 status and call fields, as far as this client has seen
 * them.
 *
 * Fed by profile fetches that already happen (`useUserProfile`) and by the
 * profile updates the homeserver pushes in /sync (MSC4429, which asks for
 * these keys — see USER_PROFILE_FIELDS). Reading from here costs no request,
 * which matters in the room list: a profile fetch per DM row would be one
 * request per conversation on every load.
 */
type StatusFields = Record<string, unknown>;

const fields = new Map<string, StatusFields>();
const listeners = new Map<string, Set<() => void>>();

const notify = (userId: string) => listeners.get(userId)?.forEach((listener) => listener());

const pick = (profile: Record<string, unknown>): StatusFields =>
  Object.fromEntries(
    STATUS_PROFILE_FIELDS.filter((key) => profile[key] !== undefined && profile[key] !== null).map(
      (key) => [key, profile[key]],
    ),
  );

const store = (userId: string, next: StatusFields) => {
  const prev = fields.get(userId);
  fields.set(userId, next);
  if (JSON.stringify(prev ?? {}) !== JSON.stringify(next)) notify(userId);
};

/** Records what a full profile says (absent keys = none). */
export const recordFullProfile = (userId: string, profile: Record<string, unknown>): void =>
  store(userId, pick(profile));

/** Records a partial update: present keys replace, null deletes, absent keys are kept. */
const recordProfileUpdate = (userId: string, update: Record<string, unknown> | null): void => {
  if (update === null) {
    store(userId, {});
    return;
  }
  if (!touchesProfileStatus(update)) return;
  const next: StatusFields = { ...fields.get(userId) };
  STATUS_PROFILE_FIELDS.forEach((key) => {
    if (!(key in update)) return;
    if (update[key] === null || update[key] === undefined) {
      delete next[key];
    } else {
      next[key] = update[key];
    }
  });
  store(userId, next);
};

const installed = new WeakSet<MatrixClient>();

const installListener = (mx: MatrixClient) => {
  if (installed.has(mx)) return;
  installed.add(mx);
  mx.on(ClientEvent.UserProfileUpdate, (userId: string, update: Record<string, unknown> | null) =>
    recordProfileUpdate(userId, update),
  );
};

/** A user's status line ("🌴 On holiday", else "📞 In a call · 5 min"), when known. */
export const useProfileStatusLine = (userId: string | undefined): string | undefined => {
  const mx = useMatrixClient();
  const read = () => (userId ? profileStatusLine(fields.get(userId) ?? {}) : undefined);
  const [line, setLine] = useState(read);

  useEffect(() => {
    installListener(mx);
    if (!userId) {
      setLine(undefined);
      return undefined;
    }
    const update = () => setLine(profileStatusLine(fields.get(userId) ?? {}));
    update();
    const set = listeners.get(userId) ?? new Set();
    set.add(update);
    listeners.set(userId, set);
    return () => {
      set.delete(update);
      if (set.size === 0) listeners.delete(userId);
    };
  }, [mx, userId]);

  return line;
};
