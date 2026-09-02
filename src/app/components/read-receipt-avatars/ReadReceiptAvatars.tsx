import { useState } from 'react';
import { Box, color, Text, toRem } from 'folds';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import colorMXID from '../../../util/colorMXID';

type ReadReceiptAvatarsProps = {
  room: Room;
  userIds: string[];
  maxVisible?: number;
};

const AVATAR_SIZE = 16;
// Stack each avatar so only ~1/3 of the one behind peeks out.
const OVERLAP = Math.round((AVATAR_SIZE * 2) / 3);

export function ReadReceiptAvatars({ room, userIds, maxVisible = 3 }: ReadReceiptAvatarsProps) {
  const mx = useMatrixClient();
  const useAuth = useMediaAuthentication();
  const [hovered, setHovered] = useState<number | null>(null);

  if (userIds.length === 0) return null;

  const visible = userIds.slice(0, maxVisible);
  const overflow = userIds.length - maxVisible;

  return (
    <Box gap="100" alignItems="Center" shrink="No">
      {visible.map((userId, i) => {
        const name = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
        const member = room.getMember(userId);
        const avatarUrl = member?.getMxcAvatarUrl()
          ? (mxcUrlToHttp(mx, member.getMxcAvatarUrl()!, useAuth, 24, 24, 'crop') ?? undefined)
          : undefined;
        const isHovered = hovered === i;

        return (
          <Box
            key={userId}
            as="span"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered((cur) => (cur === i ? null : cur))}
            style={{
              width: toRem(AVATAR_SIZE),
              height: toRem(AVATAR_SIZE),
              borderRadius: '50%',
              overflow: 'hidden',
              // Match the user's placeholder avatar (UserAvatar): a circle in
              // the colorMXID-derived colour with the initial centred inside,
              // rather than a bare grey letter that reads like a newline glyph.
              backgroundColor: avatarUrl ? 'transparent' : colorMXID(userId),
              color: color.Surface.Container,
              marginLeft: i > 0 ? toRem(-OVERLAP) : 0,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: toRem(8),
              lineHeight: 1,
              position: 'relative',
              zIndex: isHovered ? 99 : i,
              transformOrigin: 'center',
              transform: isHovered ? 'scale(1.5)' : 'scale(1)',
              boxShadow: isHovered
                ? '0 0 0 1.5px var(--folds-color-surface-variant), 0 2px 6px rgba(0,0,0,0.35)'
                : 'none',
              transition: 'transform 140ms ease, box-shadow 140ms ease',
              cursor: 'default',
            }}
            title={name}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Text size="T200">{name[0]?.toUpperCase()}</Text>
            )}
          </Box>
        );
      })}
      {overflow > 0 && (
        <Text size="T200" style={{ marginLeft: toRem(-2) }}>
          +{overflow}
        </Text>
      )}
    </Box>
  );
}
