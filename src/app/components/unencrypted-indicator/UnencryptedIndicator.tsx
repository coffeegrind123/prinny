import { Room, JoinRule } from 'matrix-js-sdk';
import { as, Badge, color, Icon, Icons, Text } from 'folds';
import { useStateEvent } from '../../hooks/useStateEvent';
import { useRoomJoinRule } from '../../hooks/useRoomMeta';
import { StateEvent } from '../../../types/matrix/room';

const TITLE = 'Not end-to-end encrypted';

/**
 * Whether to warn that a room is unencrypted. Public rooms are left out:
 * anyone can join and read them, so being unencrypted is expected there, and
 * a warning on every one would bury the rooms where it matters (DMs,
 * invite-only, knock and space-restricted rooms).
 */
export const useUnencryptedWarning = (room: Room): boolean => {
  const encrypted = !!useStateEvent(room, StateEvent.RoomEncryption);
  const joinRule = useRoomJoinRule(room)?.join_rule;
  return !encrypted && joinRule !== JoinRule.Public;
};

/** Compact icon for dense lists. */
export const UnencryptedIcon = as<'span'>(({ as: AsIcon = 'span', ...props }, ref) => (
  <AsIcon
    title={TITLE}
    aria-label={TITLE}
    style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
    ref={ref}
    {...props}
  >
    <Icon size="50" src={Icons.Warning} style={{ color: color.Warning.Main }} filled />
  </AsIcon>
));

/** Labelled badge for headers. */
export const UnencryptedBadge = as<'div'>(({ as: AsBadge = 'div', ...props }, ref) => (
  <Badge as={AsBadge} variant="Warning" fill="Soft" radii="300" title={TITLE} {...props} ref={ref}>
    <Text as="span" size="L400" truncate>
      Unencrypted
    </Text>
  </Badge>
));
