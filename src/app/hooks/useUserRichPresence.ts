import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { ClientEvent, MatrixClient } from 'matrix-js-sdk';
import {
  getProfileRichPresence,
  RICH_PRESENCE_EXPIRY_GRACE,
  RICH_PRESENCE_PROFILE_FIELDS,
  RichPresence,
} from '../../types/matrix/richPresence';
import { useMatrixClient } from './useMatrixClient';
import { userRichPresenceAtomFamily } from '../state/richPresence';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

// Re-fetch the profile at least this often so the displayed presence stays
// fresh even when push (UserProfileUpdate) events aren't arriving.
const REFRESH_INTERVAL = 3 * 60 * 1000;

// Longest song-end timer worth scheduling. setTimeout fires immediately for
// delays past 2^31-1 ms, which a bogus timestamp would turn into a refetch
// loop; anything beyond this is left to the heartbeat.
const MAX_SONG_END_DELAY = 6 * 60 * 60 * 1000;

// setTimeout's ceiling; a longer delay would fire immediately.
const MAX_TIMEOUT_DELAY = 2_147_483_647;

// Opening a big member list mounts hundreds of rows at once; cap the number of
// profile requests in flight and back off when the server rate-limits us.
const MAX_CONCURRENT_FETCHES = 4;
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 2000;
const MAX_RETRY_AFTER_MS = 30_000;
const M_LIMIT_EXCEEDED = 'M_LIMIT_EXCEEDED';

// Keep a subscription alive briefly after its last consumer unmounts, so rows
// that remount while a list reorders reuse it instead of refetching.
const TEARDOWN_GRACE = 10_000;

let activeFetches = 0;
const fetchWaiters: (() => void)[] = [];

const acquireFetchSlot = async (): Promise<void> => {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    fetchWaiters.push(resolve);
  });
};

const releaseFetchSlot = (): void => {
  const next = fetchWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeFetches -= 1;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const fetchProfileThrottled = async (
  mx: MatrixClient,
  userId: string,
): Promise<Record<string, unknown>> => {
  await acquireFetchSlot();
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await mx.getExtendedProfile(userId);
      } catch (err) {
        const { errcode, data } = err as { errcode?: string; data?: { retry_after_ms?: number } };
        if (errcode !== M_LIMIT_EXCEEDED || attempt >= MAX_RATE_LIMIT_RETRIES) {
          throw err;
        }
        await wait(Math.min(data?.retry_after_ms ?? DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS));
      }
    }
  } finally {
    releaseFetchSlot();
  }
};

const songEndDelay = (presence: RichPresence | undefined): number | undefined => {
  if (presence?.type !== 'media') {
    return undefined;
  }
  const endTs = presence.progress?.timeComplete;
  if (endTs === undefined || !Number.isFinite(endTs) || endTs < 1_000_000_000) {
    return undefined;
  }
  const endMs = endTs > 1_000_000_000_000 ? endTs : endTs * 1000;
  const delay = endMs - Date.now();
  if (delay <= 0 || delay > MAX_SONG_END_DELAY) {
    return undefined;
  }
  return delay;
};

type RichPresenceSetter = (value: RichPresence | undefined) => void;

type Subscription = {
  count: number;
  stop: () => void;
  teardown?: ReturnType<typeof setTimeout>;
};

// Keyed by client first so a new session never reuses another client's fetches.
const subscriptions = new WeakMap<MatrixClient, Map<string, Subscription>>();

// One profile fetch, update listener, heartbeat and song-end timer per user,
// shared by every component that shows that user's rich presence. They all
// read the same atom, so whichever consumer's setter is held here reaches all
// of them.
const startSubscription = (
  mx: MatrixClient,
  userId: string,
  setRichPresence: RichPresenceSetter,
): (() => void) => {
  let active = true;
  let updateVersion = 0;
  let songEndTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  // The rich presence fields as last seen. MSC4429 profile updates are
  // partial (an absent field is unchanged, a null one was removed), so they
  // are merged into this rather than read on their own.
  let fields: Record<string, unknown> = {};

  const loadProfile = async () => {
    const loadVersion = updateVersion;
    try {
      const profile = await fetchProfileThrottled(mx, userId);
      if (active && loadVersion === updateVersion) {
        fields = profile;
        apply();
      }
    } catch {
      // Keep the last known state on a failed refresh; only a profile update
      // clears it.
    }
  };

  // Re-fetch when the current media track reaches its end time, so the next
  // song shows up promptly instead of at the next heartbeat.
  //
  // Also hide the activity once its expiry passes, even if the publisher
  // crashed and no profile update ever arrives. Re-parsing the same fields
  // then yields nothing.
  function apply() {
    const presence = getProfileRichPresence(fields);
    setRichPresence(presence);

    clearTimeout(songEndTimer);
    const delay = songEndDelay(presence);
    if (delay !== undefined) {
      songEndTimer = setTimeout(loadProfile, delay);
    }

    clearTimeout(expiryTimer);
    if (presence?.expiresAt !== undefined) {
      const expiresIn = presence.expiresAt + RICH_PRESENCE_EXPIRY_GRACE - Date.now() + 1;
      expiryTimer = setTimeout(apply, Math.min(Math.max(expiresIn, 0), MAX_TIMEOUT_DELAY));
    }
  }

  const handleProfileUpdate = (updatedUserId: string, profile: Record<string, unknown> | null) => {
    if (updatedUserId !== userId) {
      return;
    }

    updateVersion += 1;
    if (profile === null) {
      fields = {};
      apply();
      return;
    }

    const touched = RICH_PRESENCE_PROFILE_FIELDS.filter((key) =>
      Object.prototype.hasOwnProperty.call(profile, key),
    );
    if (touched.length === 0) {
      return;
    }
    const next = { ...fields };
    touched.forEach((key) => {
      if (profile[key] === null) {
        delete next[key];
      } else {
        next[key] = profile[key];
      }
    });
    fields = next;
    apply();
  };

  mx.on(ClientEvent.UserProfileUpdate, handleProfileUpdate);
  loadProfile();

  // Heartbeat: re-fetch periodically so a stale "Listening to ..." card
  // doesn't linger when the publisher stops emitting push updates.
  const heartbeat = setInterval(loadProfile, REFRESH_INTERVAL);

  return () => {
    active = false;
    clearInterval(heartbeat);
    clearTimeout(songEndTimer);
    clearTimeout(expiryTimer);
    mx.removeListener(ClientEvent.UserProfileUpdate, handleProfileUpdate);
  };
};

const subscribe = (
  mx: MatrixClient,
  userId: string,
  setRichPresence: RichPresenceSetter,
): (() => void) => {
  let clientSubs = subscriptions.get(mx);
  if (!clientSubs) {
    clientSubs = new Map();
    subscriptions.set(mx, clientSubs);
  }
  const subs = clientSubs;
  let sub = subs.get(userId);
  if (!sub) {
    sub = { count: 0, stop: startSubscription(mx, userId, setRichPresence) };
    subs.set(userId, sub);
  }
  clearTimeout(sub.teardown);
  sub.count += 1;

  const current = sub;
  return () => {
    current.count -= 1;
    if (current.count > 0) {
      return;
    }
    current.teardown = setTimeout(() => {
      if (current.count > 0) {
        return;
      }
      current.stop();
      if (subs.get(userId) === current) {
        subs.delete(userId);
      }
    }, TEARDOWN_GRACE);
  };
};

export const useUserRichPresence = (userId: string): RichPresence | undefined => {
  const mx = useMatrixClient();
  const [showRichPresence] = useSetting(settingsAtom, 'showRichPresence');
  const [richPresence, setRichPresence] = useAtom(userRichPresenceAtomFamily(userId));

  useEffect(() => {
    // The setting is enforced here rather than at the render sites (five of
    // them, and counting) so there is one place to be wrong. Bailing out early
    // also means a disabled setting costs nothing: no profile fetch, and no
    // refresh timer per user on screen.
    if (!userId || !showRichPresence) {
      setRichPresence(undefined);
      return undefined;
    }
    return subscribe(mx, userId, setRichPresence);
  }, [mx, userId, showRichPresence, setRichPresence]);

  return richPresence;
};
