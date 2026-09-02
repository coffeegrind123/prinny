import { Box, Button, Text, config } from 'folds';
import { UserProfile } from '../../../hooks/useUserProfile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { getProfileBiography, getProfilePronouns } from '../../../../types/matrix/profile';
import { useUserPresence } from '../../../hooks/useUserPresence';
import { useUserRichPresence } from '../../../hooks/useUserRichPresence';
import { UserRichPresence } from '../../../components/user-profile/UserRichPresence';
import { UserHero, UserHeroName } from '../../../components/user-profile/UserHero';
import * as profileCss from '../../../components/user-profile/styles.css';
import * as css from './ProfilePreview.css';

type ProfilePreviewProps = {
  profile: UserProfile;
  bannerMxc?: string;
  userId: string;
  requestEdit: () => void;
};

export function ProfilePreview({ profile, bannerMxc, userId, requestEdit }: ProfilePreviewProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? (mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 128, 128, 'crop') ?? undefined)
    : undefined;
  const bannerUrl = bannerMxc
    ? (mxcUrlToHttp(mx, bannerMxc, useAuthentication) ?? undefined)
    : undefined;
  const pronouns = getProfilePronouns(profile.extended)
    .map((pronoun) => pronoun.summary)
    .join(', ');
  const biography = getProfileBiography(profile.extended);
  const presence = useUserPresence(userId);
  const richPresence = useUserRichPresence(userId);

  return (
    <Box className={css.PreviewColumn} direction="Column" gap="200">
      <Text size="L400">Profile Preview</Text>
      {/*
        Built from the same UserHero/UserHeroName the real profile card uses,
        rather than a second copy of that layout. It was a copy until now, and
        the two had already drifted: this one reserved 44px under the banner
        where the card reserves half the avatar, padded the avatar ring where
        the card outlines it, and fell back to a flat colour where the card
        falls back to a blurred avatar. A preview that does not match what it is
        previewing is worse than no preview, and sharing the components is the
        only version of "matching" that stays true.
      */}
      <div className={css.ProfileCard}>
        <UserHero
          userId={userId}
          avatarUrl={avatarUrl}
          bannerUrl={bannerUrl}
          profileLoaded={profile.loaded}
          presence={presence && presence.lastActiveTs !== 0 ? presence : undefined}
          status={presence?.status}
        />
        <Box direction="Column" gap="500" style={{ padding: config.space.S400 }}>
          <UserHeroName displayName={displayName} userId={userId} pronouns={pronouns} />
          {biography && (
            <Box direction="Column" gap="100">
              <Text size="L400">About Me</Text>
              <Text className={profileCss.Biography} size="T300" priority="300">
                {biography}
              </Text>
            </Box>
          )}
          {richPresence && <UserRichPresence presence={richPresence} />}
          <Button variant="Primary" fill="Soft" radii="300" onClick={requestEdit}>
            <Text size="B300">Edit Profile</Text>
          </Button>
        </Box>
      </div>
    </Box>
  );
}
