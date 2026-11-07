import { useEffect, useState } from 'react';
import { ClientEvent, MatrixClient, UserEvent, UserEventHandlerMap } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { recordFullProfile } from '../state/profileStatus';

export type UserProfile = {
  avatarUrl?: string;
  displayName?: string;
  /**
   * MSC4133 extended profile fields, verbatim. Pronouns, banner, biography and
   * rich presence all live in here under their own keys — see
   * `types/matrix/profile.ts` for the readers, which validate before use since
   * every value is written by another user.
   *
   * Empty on a homeserver without extended-profile support, which is not an
   * error: the features that read it simply render nothing.
   */
  extended: Record<string, unknown>;
  /** False until the first profile fetch settles, either way. */
  loaded: boolean;
};

type FetchedProfile = Omit<UserProfile, 'loaded'>;

// Every message and member row asks for its sender's profile. Share one request
// per user and remember failures for a while, so an unreachable homeserver costs
// one request instead of one per row and per remount.
const PROFILE_FAILURE_TTL_MS = 5 * 60 * 1000;
const profileFailures = new Map<string, number>();
const profileRequests = new Map<string, Promise<FetchedProfile>>();

const hasRecentProfileFailure = (userId: string): boolean => {
  const failedAt = profileFailures.get(userId);
  if (failedAt === undefined) {
    return false;
  }
  if (Date.now() - failedAt < PROFILE_FAILURE_TTL_MS) {
    return true;
  }
  profileFailures.delete(userId);
  return false;
};

const requestProfile = async (mx: MatrixClient, userId: string): Promise<FetchedProfile> => {
  try {
    const info = await mx.getExtendedProfile(userId);
    recordFullProfile(userId, info);
    return {
      avatarUrl: typeof info.avatar_url === 'string' ? info.avatar_url : undefined,
      displayName: typeof info.displayname === 'string' ? info.displayname : undefined,
      extended: info,
    };
  } catch {
    // The extended-profile endpoint is unstable and absent on most
    // homeservers, where this rejects. Falling back to the plain profile
    // API matters: the name and avatar come from the same response, so
    // treating the failure as "no profile" would blank out every user on a
    // server that simply has not implemented MSC4133.
    const info = await mx.getProfileInfo(userId);
    return { avatarUrl: info.avatar_url, displayName: info.displayname, extended: {} };
  }
};

const fetchProfile = (mx: MatrixClient, userId: string): Promise<FetchedProfile> => {
  const pending = profileRequests.get(userId);
  if (pending) {
    return pending;
  }

  const request = requestProfile(mx, userId)
    .catch((err) => {
      profileFailures.set(userId, Date.now());
      throw err;
    })
    .finally(() => profileRequests.delete(userId));
  profileRequests.set(userId, request);
  return request;
};

export const useUserProfile = (userId: string): UserProfile => {
  const mx = useMatrixClient();

  const [profile, setProfile] = useState<UserProfile>(() => {
    const user = mx.getUser(userId);
    return {
      avatarUrl: user?.avatarUrl,
      displayName: user?.displayName,
      extended: {},
      loaded: false,
    };
  });

  useEffect(() => {
    const user = mx.getUser(userId);
    const onAvatarChange: UserEventHandlerMap[UserEvent.AvatarUrl] = (event, myUser) => {
      setProfile((cp) => ({
        ...cp,
        avatarUrl: myUser.avatarUrl,
      }));
    };
    const onDisplayNameChange: UserEventHandlerMap[UserEvent.DisplayName] = (event, myUser) => {
      setProfile((cp) => ({
        ...cp,
        displayName: myUser.displayName,
      }));
    };
    const onProfileUpdate = (
      updatedUserId: string,
      updatedProfile: Record<string, unknown> | null,
    ) => {
      if (updatedUserId !== userId) return;
      setProfile((current) => ({
        ...current,
        // A null profile is a deletion, not a partial update.
        extended: updatedProfile === null ? {} : { ...current.extended, ...updatedProfile },
        loaded: true,
      }));
    };

    if (hasRecentProfileFailure(userId)) {
      setProfile((current) => ({ ...current, loaded: true }));
    } else {
      fetchProfile(mx, userId).then(
        (fetched) => setProfile({ ...fetched, loaded: true }),
        () => setProfile((current) => ({ ...current, loaded: true })),
      );
    }

    mx.on(ClientEvent.UserProfileUpdate, onProfileUpdate);
    user?.on(UserEvent.AvatarUrl, onAvatarChange);
    user?.on(UserEvent.DisplayName, onDisplayNameChange);
    return () => {
      mx.removeListener(ClientEvent.UserProfileUpdate, onProfileUpdate);
      user?.removeListener(UserEvent.AvatarUrl, onAvatarChange);
      user?.removeListener(UserEvent.DisplayName, onDisplayNameChange);
    };
  }, [mx, userId]);

  return profile;
};
