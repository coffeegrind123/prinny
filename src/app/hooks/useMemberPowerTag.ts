import { useCallback, useMemo } from 'react';
import { MatrixClient, Room, RoomMember } from 'matrix-js-sdk';
import { getPowerLevelTag, PowerLevelTags, usePowerLevelTags } from './usePowerLevelTags';
import { IPowerLevels, readPowerLevel } from './usePowerLevels';
import { MemberPowerTag, MemberPowerTagIcon } from '../../types/matrix/room';
import { useRoomCreatorsTag } from './useRoomCreatorsTag';
import { ThemeKind } from './useTheme';
import { accessibleColor } from '../plugins/color';

export type GetMemberPowerTag = (userId: string) => MemberPowerTag;

export const useGetMemberPowerTag = (
  room: Room,
  creators: Set<string>,
  powerLevels: IPowerLevels,
) => {
  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);

  const getMemberPowerTag: GetMemberPowerTag = useCallback(
    (userId) => {
      if (creators.has(userId)) {
        return creatorsTag;
      }

      const power = readPowerLevel.user(powerLevels, userId);
      return getPowerLevelTag(powerLevelTags, power);
    },
    [creators, creatorsTag, powerLevels, powerLevelTags],
  );

  return getMemberPowerTag;
};

// A power-tag icon key is either an `mxc://` URI, which we resolve through the
// homeserver's media endpoint, or a short literal (an emoji) rendered as text.
// It arrives from an `m.room.power_levels`-adjacent state event, so anyone who
// can set room state chooses it. Returning a non-mxc key verbatim used to let a
// room admin put an arbitrary URL into an `<img src>` that every member's client
// fetches on every render — an IP-address and presence beacon aimed at the whole
// room. Anything carrying URL structure is therefore dropped rather than
// forwarded; genuine emoji keys contain neither a scheme separator nor a slash.
const looksLikeUrl = (key: string): boolean => key.includes(':') || key.includes('/');

export const getPowerTagIconSrc = (
  mx: MatrixClient,
  useAuthentication: boolean,
  icon: MemberPowerTagIcon,
): string | undefined => {
  const key = icon?.key;
  if (!key) return undefined;
  if (key.startsWith('mxc://')) {
    return mx.mxcUrlToHttp(key, 96, 96, 'scale', undefined, undefined, useAuthentication) ?? '🌻';
  }
  return looksLikeUrl(key) ? undefined : key;
};

export const useAccessiblePowerTagColors = (
  themeKind: ThemeKind,
  creatorsTag: MemberPowerTag,
  powerLevelTags: PowerLevelTags,
): Map<string, string> => {
  const accessibleColors: Map<string, string> = useMemo(() => {
    const colors: Map<string, string> = new Map();
    if (creatorsTag.color) {
      colors.set(creatorsTag.color, accessibleColor(themeKind, creatorsTag.color));
    }

    Object.values(powerLevelTags).forEach((tag) => {
      const { color } = tag;
      if (!color) return;

      colors.set(color, accessibleColor(themeKind, color));
    });

    return colors;
  }, [powerLevelTags, creatorsTag, themeKind]);

  return accessibleColors;
};

export const useFlattenPowerTagMembers = (
  members: RoomMember[],
  getTag: GetMemberPowerTag,
): Array<MemberPowerTag | RoomMember> => {
  const PLTagOrRoomMember = useMemo(() => {
    let prevTag: MemberPowerTag | undefined;
    const tagOrMember: Array<MemberPowerTag | RoomMember> = [];
    members.forEach((member) => {
      const tag = getTag(member.userId);
      if (tag !== prevTag) {
        prevTag = tag;
        tagOrMember.push(tag);
      }
      tagOrMember.push(member);
    });
    return tagOrMember;
  }, [members, getTag]);

  return PLTagOrRoomMember;
};
