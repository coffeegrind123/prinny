import { Room } from 'matrix-js-sdk';
import { Chip, Icon, Icons, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useRoomName } from '../../hooks/useRoomMeta';
import { RoomIcon } from '../../components/room-avatar';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { getAllParents, guessPerfectParent } from '../../utils/room';
import { useOrphanSpaces } from '../../state/hooks/roomList';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { mDirectAtom } from '../../state/mDirectList';
import { useAllJoinedRoomsSet, useGetRoom } from '../../hooks/useGetRoom';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { stripOptionalText } from '../../utils/unsafeText';

type CallRoomNameProps = {
  room: Room;
  /** Plain text link for the voice panel instead of a chip. */
  plain?: boolean;
};
export function CallRoomName({ room, plain }: CallRoomNameProps) {
  const mx = useMatrixClient();
  const name = useRoomName(room);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const orphanSpaces = useOrphanSpaces(mx, allRoomsAtom, roomToParents);
  const mDirects = useAtomValue(mDirectAtom);
  const dm = mDirects.has(room.roomId);

  const allRoomsSet = useAllJoinedRoomsSet();
  const getRoom = useGetRoom(allRoomsSet);

  const allParents = getAllParents(roomToParents, room.roomId);
  const orphanParents = allParents && orphanSpaces.filter((o) => allParents.has(o));
  const perfectOrphanParent = orphanParents && guessPerfectParent(mx, room.roomId, orphanParents);

  const { navigateRoom } = useRoomNavigate();

  const label = (
    <>
      {name}
      {!dm && perfectOrphanParent && (
        <Text as="span" size="T200" priority="300">
          {' •'}{' '}
          <b>{stripOptionalText(getRoom(perfectOrphanParent)?.name) ?? perfectOrphanParent}</b>
        </Text>
      )}
    </>
  );

  if (plain) {
    return (
      <Text
        as="button"
        type="button"
        size="T200"
        priority="300"
        truncate
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          textAlign: 'left',
          cursor: 'pointer',
        }}
        onClick={() => navigateRoom(room.roomId)}
      >
        {label}
      </Text>
    );
  }

  return (
    <Chip
      variant="Background"
      radii="Pill"
      before={
        dm ? (
          <Icon size="200" src={Icons.VolumeHigh} filled />
        ) : (
          <RoomIcon size="200" joinRule={room.getJoinRule()} roomType={room.getType()} filled />
        )
      }
      onClick={() => navigateRoom(room.roomId)}
    >
      <Text size="L400" truncate>
        {label}
      </Text>
    </Chip>
  );
}
