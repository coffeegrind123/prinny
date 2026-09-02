import { Box, config, Text } from 'folds';
import { UserHero, UserHeroName } from './UserHero';
import * as css from './styles.css';
import { mxcUrlToHttp } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useLocalTime } from '../../hooks/useLocalTime';
import { useUserPresence } from '../../hooks/useUserPresence';
import { IgnoredUserAlert, MutualRoomsChip, OptionsChip } from './UserChips';
import { PowerChip } from './PowerChip';
import { UserInviteAlert, UserBanAlert, UserKickAlert } from './UserModeration';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useMembership } from '../../hooks/useMembership';
import { Membership } from '../../../types/matrix/room';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useMemberPowerCompare } from '../../hooks/useMemberPowerCompare';
import { CreatorChip } from './CreatorChip';
import { useUserRichPresence } from '../../hooks/useUserRichPresence';
import { UserRichPresence } from './UserRichPresence';
import { useUserProfile } from '../../hooks/useUserProfile';
import {
  getProfileBanner,
  getProfileBiography,
  getProfilePronouns,
  getProfileTimezone,
} from '../../../types/matrix/profile';
import { DirectMessageComposer } from './DirectMessageComposer';

type UserRoomProfileProps = {
  userId: string;
};
export function UserRoomProfile({ userId }: UserRoomProfileProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const ignoredUsers = useIgnoredUsers();
  const ignored = ignoredUsers.includes(userId);

  const room = useRoom();
  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const { hasMorePower } = useMemberPowerCompare(creators, powerLevels);

  const myUserId = mx.getSafeUserId();
  const creator = creators.has(userId);

  const canKickUser = permissions.action('kick', myUserId) && hasMorePower(myUserId, userId);
  const canBanUser = permissions.action('ban', myUserId) && hasMorePower(myUserId, userId);
  const canUnban = permissions.action('ban', myUserId);
  const canInvite = permissions.action('invite', myUserId);

  const member = room.getMember(userId);
  const membership = useMembership(room, userId);

  const displayName = getMemberDisplayName(room, userId);
  const avatarMxc = getMemberAvatarMxc(room, userId);
  const avatarUrl = (avatarMxc && mxcUrlToHttp(mx, avatarMxc, useAuthentication)) ?? undefined;

  const presence = useUserPresence(userId);
  const richPresence = useUserRichPresence(userId);
  const profile = useUserProfile(userId);
  const pronouns = getProfilePronouns(profile.extended)
    .map((pronoun) => pronoun.summary)
    .join(', ');
  const bannerMxc = getProfileBanner(profile.extended);
  const biography = getProfileBiography(profile.extended);
  const localTime = useLocalTime(getProfileTimezone(profile.extended));
  const bannerUrl = bannerMxc
    ? (mxcUrlToHttp(mx, bannerMxc, useAuthentication) ?? undefined)
    : undefined;

  return (
    <Box direction="Column">
      <UserHero
        userId={userId}
        avatarUrl={avatarUrl}
        bannerUrl={bannerUrl}
        profileLoaded={profile.loaded}
        presence={presence && presence.lastActiveTs !== 0 ? presence : undefined}
        status={presence?.status}
      />
      <Box direction="Column" gap="500" style={{ padding: config.space.S400 }}>
        <Box direction="Column" gap="400">
          <Box gap="400" alignItems="Start">
            <UserHeroName
              displayName={displayName}
              userId={userId}
              pronouns={pronouns}
              localTime={localTime}
            />
          </Box>
          <Box alignItems="Center" gap="200" wrap="Wrap">
            {creator ? <CreatorChip /> : <PowerChip userId={userId} />}
            {userId !== myUserId && <MutualRoomsChip userId={userId} />}
            {userId !== myUserId && (
              <OptionsChip
                userId={userId}
                membership={membership}
                canInvite={canInvite}
                canKick={canKickUser}
                canBan={canBanUser}
                canUnban={canUnban}
              />
            )}
          </Box>
        </Box>
        {biography && (
          <Box direction="Column" gap="100">
            <Text size="L400">About Me</Text>
            <Text className={css.Biography} size="T300" priority="300">
              {biography}
            </Text>
          </Box>
        )}
        {richPresence && <UserRichPresence presence={richPresence} />}
        {ignored && <IgnoredUserAlert />}
        {member && membership === Membership.Ban && (
          <UserBanAlert
            reason={member.events.member?.getContent().reason}
            bannedBy={member.events.member?.getSender()}
            ts={member.events.member?.getTs()}
          />
        )}
        {member &&
          membership === Membership.Leave &&
          member.events.member &&
          member.events.member.getSender() !== userId && (
            <UserKickAlert
              reason={member.events.member?.getContent().reason}
              kickedBy={member.events.member?.getSender()}
              ts={member.events.member?.getTs()}
            />
          )}
        {member && membership === Membership.Invite && (
          <UserInviteAlert
            reason={member.events.member?.getContent().reason}
            invitedBy={member.events.member?.getSender()}
            ts={member.events.member?.getTs()}
          />
        )}
        {userId !== myUserId && !ignored && <DirectMessageComposer userId={userId} />}
      </Box>
    </Box>
  );
}
