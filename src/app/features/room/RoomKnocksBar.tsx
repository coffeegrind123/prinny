import { useCallback, useMemo, useState } from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import { KnownMembership } from 'matrix-js-sdk/lib/types';
import { JoinRule, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { RosterLoad, useRoomMembers } from '../../hooks/useRoomMembers';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { UserAvatar } from '../../components/user-avatar';
import { nameInitials } from '../../utils/common';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';

type RoomKnocksBarProps = {
  room: Room;
};

/**
 * Shows people waiting to be let into a knock-restricted room.
 *
 * Without this, setting the join rule to "ask to join" is a trap: requests
 * arrive as membership events nobody has any reason to look at, and the person
 * knocking waits forever on a room that looks like it ignored them.
 *
 * Only rendered for members who can actually act — approving needs invite
 * power, declining needs kick power.
 */
export function RoomKnocksBar({ room }: RoomKnocksBarProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const userId = mx.getSafeUserId();

  const canInvite = permissions.action('invite', userId);
  const canKick = permissions.action('kick', userId);
  // A knock made before the cached sync window is only in the full roster,
  // which in a large room is worth fetching only where knocking is allowed and
  // for someone who can answer it.
  const joinRule: string = room.getJoinRule();
  const knockable = joinRule === JoinRule.Knock || joinRule === 'knock_restricted';
  const members = useRoomMembers(
    mx,
    room.roomId,
    knockable && (canInvite || canKick) ? RosterLoad.Full : RosterLoad.LazyIfLarge,
  );

  const [dismissed, setDismissed] = useState<string[]>([]);

  const knocks = useMemo(
    () =>
      members.filter(
        (member) =>
          member.membership === KnownMembership.Knock && !dismissed.includes(member.userId),
      ),
    [members, dismissed],
  );

  const [actionState, act] = useAsyncCallback<undefined, Error, [string, 'approve' | 'deny']>(
    useCallback(
      async (targetId, action) => {
        if (action === 'approve') {
          await mx.invite(room.roomId, targetId);
        } else {
          await mx.kick(room.roomId, targetId);
        }
        // Membership updates arrive over sync, but hiding the row immediately
        // stops a second click landing on a request already handled.
        setDismissed((prev) => [...prev, targetId]);
        return undefined;
      },
      [mx, room.roomId],
    ),
  );

  const busy = actionState.status === AsyncStatus.Loading;

  if (knocks.length === 0) return null;
  if (!canInvite && !canKick) return null;

  const member = knocks[0];
  const name =
    getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;
  const avatarMxc = getMemberAvatarMxc(room, member.userId);

  return (
    <Box
      alignItems="Center"
      gap="300"
      style={{
        padding: `${config.space.S200} ${config.space.S300}`,
        backgroundColor: color.Primary.Container,
        color: color.Primary.OnContainer,
      }}
    >
      <Box shrink="No">
        <Avatar size="200">
          <UserAvatar
            userId={member.userId}
            src={
              avatarMxc
                ? (mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined)
                : undefined
            }
            alt={name}
            renderFallback={() => <Text size="H6">{nameInitials(name)}</Text>}
          />
        </Avatar>
      </Box>

      <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
        <Text size="T300" truncate>
          <b>{name}</b> is asking to join
        </Text>
        {knocks.length > 1 && (
          <Text size="T200" priority="300">
            {`and ${knocks.length - 1} more`}
          </Text>
        )}
        {member.events.member?.getContent().reason && (
          <Text size="T200" priority="300" truncate>
            {member.events.member.getContent().reason}
          </Text>
        )}
      </Box>

      <Box shrink="No" alignItems="Center" gap="200">
        {busy && <Spinner size="200" variant="Primary" />}
        {canKick && (
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            disabled={busy}
            onClick={() => act(member.userId, 'deny')}
          >
            <Text size="B300">Decline</Text>
          </Button>
        )}
        {canInvite && (
          <Button
            size="300"
            radii="300"
            variant="Primary"
            disabled={busy}
            before={<Icon size="50" src={Icons.Check} />}
            onClick={() => act(member.userId, 'approve')}
          >
            <Text size="B300">Approve</Text>
          </Button>
        )}
      </Box>
    </Box>
  );
}
