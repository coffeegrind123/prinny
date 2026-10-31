import { Box, color, Icon, Icons, Spinner, Text } from 'folds';
import classNames from 'classnames';
import { LiveChip } from './LiveChip';
import * as css from './styles.css';
import { CallRoomName } from './CallRoomName';
import { CallControl, CallHangupButton, CallPanelControls } from './CallControl';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { useCallMembers, useCallSession } from '../../hooks/useCall';
import { ScreenSize, useScreenSize } from '../../hooks/useScreenSize';
import { MemberGlance } from './MemberGlance';
import { StatusDivider } from './components';
import { CallEmbed } from '../../plugins/call/CallEmbed';
import { useCallConnectionStatus, useCallJoined } from '../../hooks/useCallEmbed';
import { useCallSpeakers } from '../../hooks/useCallSpeakers';
import { MemberSpeaking } from './MemberSpeaking';

type CallStatusProps = {
  callEmbed: CallEmbed;
};
export function CallStatus({ callEmbed }: CallStatusProps) {
  const { room } = callEmbed;

  const callSession = useCallSession(room);
  const callMembers = useCallMembers(callSession);
  const screenSize = useScreenSize();
  const callJoined = useCallJoined(callEmbed);
  const speakers = useCallSpeakers(callEmbed);

  const compact = screenSize === ScreenSize.Mobile;

  const memberVisible = callJoined && callMembers.length > 0;

  return (
    <Box
      className={classNames(css.CallStatus, ContainerColor({ variant: 'Background' }))}
      shrink="No"
      gap="400"
      alignItems={compact ? undefined : 'Center'}
      direction={compact ? 'Column' : 'Row'}
    >
      <Box grow="Yes" alignItems="Center" gap="200">
        {memberVisible ? (
          <Box shrink="No">
            <LiveChip room={room} members={callMembers} />
          </Box>
        ) : (
          <Spinner variant="Secondary" size="200" />
        )}
        <Box grow="Yes" alignItems="Center" gap="Inherit">
          {!compact && (
            <>
              <CallRoomName room={room} />
              {speakers.size > 0 && (
                <>
                  <StatusDivider />
                  <span data-spacing-node />
                  <MemberSpeaking room={room} speakers={speakers} />
                </>
              )}
            </>
          )}
        </Box>
        {memberVisible && (
          <Box shrink="No">
            <MemberGlance room={room} members={callMembers} speakers={speakers} />
          </Box>
        )}
      </Box>
      {memberVisible && !compact && <StatusDivider />}
      <Box shrink="No" alignItems="Center" gap="Inherit">
        {compact && (
          <Box grow="Yes">
            <CallRoomName room={room} />
          </Box>
        )}
        <CallControl callJoined={callJoined} compact={compact} callEmbed={callEmbed} />
      </Box>
    </Box>
  );
}

/** "Voice Connected" panel for the bottom of the room list. */
export function CallVoicePanel({ callEmbed }: CallStatusProps) {
  const { room } = callEmbed;
  const callJoined = useCallJoined(callEmbed);
  const connectionStatus = useCallConnectionStatus(callEmbed);

  return (
    <Box
      className={classNames(css.CallStatus, ContainerColor({ variant: 'Background' }))}
      shrink="No"
      direction="Column"
      gap="200"
    >
      <Box alignItems="Center" gap="200">
        {callJoined ? (
          <Icon size="200" src={Icons.VolumeHigh} filled style={{ color: color.Success.Main }} />
        ) : (
          <Spinner variant="Secondary" size="200" />
        )}
        <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
          <Text size="T300" style={{ color: color.Success.Main }} truncate>
            {callJoined ? 'Voice Connected' : connectionStatus}
          </Text>
          <CallRoomName room={room} plain />
        </Box>
        <Box shrink="No">
          <CallHangupButton callEmbed={callEmbed} callJoined={callJoined} />
        </Box>
      </Box>
      <CallPanelControls callJoined={callJoined} callEmbed={callEmbed} />
    </Box>
  );
}
