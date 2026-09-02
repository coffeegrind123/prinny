import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { ClientEvent } from 'matrix-js-sdk';
import {
  getProfileRichPresence,
  MSC4320_RPC,
  M_RPC,
  RichPresence,
} from '../../types/matrix/richPresence';
import { useMatrixClient } from './useMatrixClient';
import { userRichPresenceAtomFamily } from '../state/richPresence';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

const hasRichPresenceField = (profile: Record<string, unknown>): boolean =>
  Object.prototype.hasOwnProperty.call(profile, MSC4320_RPC) ||
  Object.prototype.hasOwnProperty.call(profile, M_RPC);

// Re-fetch the profile at least this often so the displayed presence stays
// fresh even when push (UserProfileUpdate) events aren't arriving.
const REFRESH_INTERVAL = 3 * 60 * 1000;

export const useUserRichPresence = (userId: string): RichPresence | undefined => {
  const mx = useMatrixClient();
  const [showRichPresence] = useSetting(settingsAtom, 'showRichPresence');
  const [richPresence, setRichPresence] = useAtom(userRichPresenceAtomFamily(userId));

  useEffect(() => {
    let active = true;
    let updateVersion = 0;

    // The setting is enforced here rather than at the render sites (five of
    // them, and counting) so there is one place to be wrong. Bailing out early
    // also means a disabled setting costs nothing: no profile fetch, and no
    // three-minute refresh timer per user on screen.
    if (!userId || !showRichPresence) {
      setRichPresence(undefined);
      return () => {
        active = false;
      };
    }

    const handleProfileUpdate = (
      updatedUserId: string,
      profile: Record<string, unknown> | null,
    ) => {
      if (updatedUserId !== userId) return;

      updateVersion += 1;
      if (profile === null) {
        setRichPresence(undefined);
      } else if (hasRichPresenceField(profile)) {
        setRichPresence(getProfileRichPresence(profile));
      }
    };

    mx.on(ClientEvent.UserProfileUpdate, handleProfileUpdate);

    const loadProfile = async () => {
      const loadVersion = updateVersion;
      try {
        const profile = await mx.getExtendedProfile(userId);
        if (active && loadVersion === updateVersion) {
          setRichPresence(getProfileRichPresence(profile));
        }
      } catch {
        if (active && loadVersion === updateVersion) {
          setRichPresence(undefined);
        }
      }
    };

    loadProfile();

    // Heartbeat: re-fetch periodically so a stale "Listening to ..." card
    // doesn't linger when the publisher stops emitting push updates.
    const heartbeat = setInterval(loadProfile, REFRESH_INTERVAL);

    return () => {
      active = false;
      clearInterval(heartbeat);
      mx.removeListener(ClientEvent.UserProfileUpdate, handleProfileUpdate);
    };
  }, [mx, userId, showRichPresence, setRichPresence]);

  // Re-fetch when the current media track reaches its end time, so we pick up
  // the next song promptly instead of waiting for the next heartbeat.
  useEffect(() => {
    if (!userId || !richPresence || richPresence.type !== 'media' || !richPresence.progress)
      return undefined;
    const endTs = richPresence.progress.timeComplete;
    if (endTs === undefined || !Number.isFinite(endTs) || endTs < 1_000_000_000) return undefined;
    const endMs = endTs > 1_000_000_000_000 ? endTs : endTs * 1000;
    const delay = endMs - Date.now();
    if (delay <= 0) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      mx.getExtendedProfile(userId)
        .then((profile: Record<string, unknown>) => {
          if (!cancelled) setRichPresence(getProfileRichPresence(profile));
        })
        .catch(() => undefined);
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mx, userId, richPresence, setRichPresence]);

  return richPresence;
};
