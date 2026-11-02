import { useCallback } from 'react';
import { Box, color, Spinner, Switch, Text } from 'folds';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../../room-settings/styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useRoom } from '../../../hooks/useRoom';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { SpaceAutoJoinContent, StateEvent } from '../../../../types/matrix/room';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useStateEvent } from '../../../hooks/useStateEvent';
import { RoomPermissionsAPI } from '../../../hooks/useRoomPermissions';
import { errorMessage } from '../../../utils/errorMessage';

type SpaceAutoJoinProps = {
  permissions: RoomPermissionsAPI;
};
export function SpaceAutoJoin({ permissions }: SpaceAutoJoinProps) {
  const mx = useMatrixClient();
  const space = useRoom();

  const canEdit = permissions.stateEvent(StateEvent.SpaceAutoJoin, mx.getSafeUserId());
  const autoJoinEvent = useStateEvent(space, StateEvent.SpaceAutoJoin);
  const autoJoin = autoJoinEvent?.getContent<SpaceAutoJoinContent>().auto_join === true;

  const [toggleState, toggleAutoJoin] = useAsyncCallback(
    useCallback(
      async (value: boolean) => {
        const content: SpaceAutoJoinContent = { auto_join: value };
        await mx.sendStateEvent(space.roomId, StateEvent.SpaceAutoJoin as any, content as any);
      },
      [mx, space.roomId],
    ),
  );
  const toggling = toggleState.status === AsyncStatus.Loading;

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <SettingTile
        title="Auto Join Rooms"
        description="Ask members' clients to join every room and subspace of this space. Each member decides: only those whose auto-join is set to Spaces that ask (or Always for this space) follow it."
        after={
          <Box gap="200" alignItems="Center">
            {toggling && <Spinner variant="Secondary" />}
            <Switch value={autoJoin} onChange={toggleAutoJoin} disabled={!canEdit || toggling} />
          </Box>
        }
      >
        {toggleState.status === AsyncStatus.Error && (
          <Text style={{ color: color.Critical.Main }} size="T200">
            {errorMessage(toggleState.error)}
          </Text>
        )}
      </SettingTile>
    </SequenceCard>
  );
}
