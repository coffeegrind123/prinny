import { MouseEventHandler, useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Chip,
  config,
  Icon,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Scroll,
  Text,
  toRem,
} from 'folds';
import { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import { FocusTrap } from 'focus-trap-react';
import { Room } from 'matrix-js-sdk';
import * as css from './styles.css';
import { stopPropagation } from '../../utils/keyboard';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { UserAvatar } from '../../components/user-avatar';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { getMouseEventCords } from '../../utils/dom';

type LiveChipProps = {
  room: Room;
  members: CallMembership[];
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function useCallDuration(members: CallMembership[]): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  if (members.length === 0) return '0:00';
  const oldestStart = Math.min(...members.map((m) => m.createdTs()));
  return formatDuration(now - oldestStart);
}

export function LiveChip({ room, members }: LiveChipProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const openUserProfile = useOpenUserRoomProfile();
  const duration = useCallDuration(members);

  const [cords, setCords] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setCords(evt.currentTarget.getBoundingClientRect());
  };

  return (
    <PopOut
      anchor={cords}
      position="Top"
      align="Start"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: () => setCords(undefined),
            clickOutsideDeactivates: true,
            isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
            isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu
            style={{
              maxHeight: '75vh',
              maxWidth: toRem(300),
              display: 'flex',
            }}
          >
            <Box grow="Yes">
              <Scroll size="0" hideTrack visibility="Hover">
                <Box direction="Column" style={{ padding: config.space.S100 }}>
                  {members.map((callMember) => {
                    const userId = callMember.sender;
                    if (!userId) return null;
                    const name =
                      getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
                    const avatarMxc = getMemberAvatarMxc(room, userId);
                    const avatarUrl = avatarMxc
                      ? (mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96) ?? undefined)
                      : undefined;

                    return (
                      <MenuItem
                        key={callMember.memberId}
                        size="400"
                        variant="Surface"
                        radii="300"
                        style={{ paddingLeft: config.space.S200 }}
                        onClick={(evt) =>
                          openUserProfile(
                            room.roomId,
                            undefined,
                            userId,
                            getMouseEventCords(evt.nativeEvent),
                            'Right',
                          )
                        }
                        before={
                          <Avatar size="200" radii="400">
                            <UserAvatar
                              userId={userId}
                              src={avatarUrl}
                              alt={name}
                              renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                            />
                          </Avatar>
                        }
                      >
                        <Text size="T300" truncate>
                          {name}
                        </Text>
                      </MenuItem>
                    );
                  })}
                </Box>
              </Scroll>
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <Chip
        variant="Surface"
        fill="Soft"
        before={
          <span className={css.LiveSpeakerIcon}>
            <Icon size="200" src={Icons.VolumeHigh} filled />
          </span>
        }
        after={<Icon size="50" src={cords ? Icons.ChevronBottom : Icons.ChevronTop} />}
        radii="Pill"
        onClick={handleOpenMenu}
      >
        <Text className={css.LiveTimer} as="span" size="L400">
          {duration}
        </Text>
      </Chip>
    </PopOut>
  );
}
