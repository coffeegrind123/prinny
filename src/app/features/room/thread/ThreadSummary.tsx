import { useMemo } from 'react';
import { Badge, Box, Icon, Icons, Text, color, config } from 'folds';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { THREAD_RELATION_TYPE } from 'matrix-js-sdk/lib/models/thread';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getMemberDisplayName } from '../../../utils/room';
import { getMxIdLocalPart } from '../../../utils/matrix';

type ThreadSummaryProps = {
  room: Room;
  mEvent: MatrixEvent;
  onClick: (rootId: string) => void;
};

/**
 * The "N replies" tile under a message that started a thread.
 *
 * Without it a thread root looks like any other message and the replies are
 * only findable by scrolling — which is the actual complaint about threads in
 * this client, more than the missing panel itself.
 *
 * Counts come from the server's bundled aggregation where available, and fall
 * back to counting what the local timeline holds. The two can disagree while a
 * room is still loading; the bundle is the more truthful of the two, so it wins.
 */
export function ThreadSummary({ room, mEvent, onClick }: ThreadSummaryProps) {
  const mx = useMatrixClient();
  const rootId = mEvent.getId();

  const summary = useMemo(() => {
    if (!rootId) return undefined;

    const bundled = mEvent.getServerAggregatedRelation(THREAD_RELATION_TYPE.name) as
      { count?: number; current_user_participated?: boolean; latest_event?: unknown } | undefined;

    let count = typeof bundled?.count === 'number' ? bundled.count : 0;
    let participated = bundled?.current_user_participated === true;
    let latestTs = 0;
    let latestSender: string | undefined;

    room
      .getUnfilteredTimelineSet()
      .getLiveTimeline()
      .getEvents()
      .forEach((event) => {
        if (event.threadRootId !== rootId) return;
        if (!bundled) count += 1;
        if (event.getSender() === mx.getUserId()) participated = true;
        if (event.getTs() > latestTs) {
          latestTs = event.getTs();
          latestSender = event.getSender() ?? undefined;
        }
      });

    if (count === 0) return undefined;
    return { count, participated, latestSender };
  }, [room, mEvent, rootId, mx]);

  if (!rootId || !summary) return null;

  const senderName = summary.latestSender
    ? (getMemberDisplayName(room, summary.latestSender) ??
      getMxIdLocalPart(summary.latestSender) ??
      summary.latestSender)
    : undefined;

  return (
    <Box
      as="button"
      type="button"
      alignItems="Center"
      gap="200"
      onClick={() => onClick(rootId)}
      style={{
        marginTop: config.space.S100,
        padding: `${config.space.S100} ${config.space.S200}`,
        background: 'none',
        border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
        borderRadius: config.radii.R300,
        cursor: 'pointer',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      <Box shrink="No">
        <Icon size="50" src={Icons.Message} />
      </Box>
      <Text size="T200" style={{ color: color.Primary.Main }}>
        {summary.count === 1 ? '1 reply' : `${summary.count} replies`}
      </Text>
      {senderName && (
        <Text size="T200" priority="300" truncate>
          {`last from ${senderName}`}
        </Text>
      )}
      {summary.participated && (
        <Badge as="span" size="200" variant="Primary" fill="Solid" radii="Pill" />
      )}
    </Box>
  );
}
