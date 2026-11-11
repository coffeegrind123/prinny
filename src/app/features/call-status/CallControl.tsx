import { Box, Chip, Icon, IconButton, Icons, Spinner, Text, Tooltip, TooltipProvider } from 'folds';
import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { StatusDivider } from './components';
import { CallEmbed, useCallControlState } from '../../plugins/call';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { callEmbedAtom } from '../../state/callEmbed';
import { useCameraAvailable } from '../../hooks/useCameraAvailable';

// The voice panel marks a muted mic or deafened sound as critical, the bar as a warning.
const offVariant = (panel?: boolean) => (panel ? 'Critical' : 'Warning');
const panelStyle = (panel?: boolean) => (panel ? { width: '100%' } : undefined);

type MicrophoneButtonProps = {
  enabled: boolean;
  onToggle: () => Promise<unknown>;
  disabled?: boolean;
  /** Equal-width button for the voice panel row. */
  panel?: boolean;
};
function MicrophoneButton({ enabled, onToggle, disabled, panel }: MicrophoneButtonProps) {
  const [micState, toggleMic] = useAsyncCallback(onToggle);
  const loading = micState.status === AsyncStatus.Loading;

  return (
    <TooltipProvider
      position="Top"
      tooltip={
        <Tooltip>
          <Text size="T200">{enabled ? 'Turn Off Microphone' : 'Turn On Microphone'}</Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          variant={enabled ? 'Surface' : offVariant(panel)}
          fill="Soft"
          radii="300"
          size="300"
          style={panelStyle(panel)}
          onClick={toggleMic}
          outlined
          disabled={disabled || loading}
        >
          <Icon size="100" src={enabled ? Icons.Mic : Icons.MicMute} filled={!enabled} />
        </IconButton>
      )}
    </TooltipProvider>
  );
}

type SoundButtonProps = {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Equal-width button for the voice panel row. */
  panel?: boolean;
};
function SoundButton({ enabled, onToggle, disabled, panel }: SoundButtonProps) {
  return (
    <TooltipProvider
      position="Top"
      tooltip={
        <Tooltip>
          <Text size="T200">{enabled ? 'Turn Off Sound' : 'Turn On Sound'}</Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          variant={enabled ? 'Surface' : offVariant(panel)}
          fill="Soft"
          radii="300"
          size="300"
          style={panelStyle(panel)}
          onClick={() => onToggle()}
          outlined
          disabled={disabled}
        >
          <Icon
            size="100"
            src={enabled ? Icons.Headphone : Icons.HeadphoneMute}
            filled={!enabled}
          />
        </IconButton>
      )}
    </TooltipProvider>
  );
}

type VideoButtonProps = {
  enabled: boolean;
  onToggle: () => Promise<unknown>;
  disabled?: boolean;
  /** Equal-width button for the voice panel row. */
  panel?: boolean;
};
function VideoButton({ enabled, onToggle, disabled, panel }: VideoButtonProps) {
  const [videoState, toggleVideo] = useAsyncCallback(onToggle);
  const loading = videoState.status === AsyncStatus.Loading;
  // A camera removed mid-call can still be switched off, so only starting is blocked.
  const cameraMissing = !useCameraAvailable() && !enabled;

  return (
    <TooltipProvider
      position="Top"
      tooltip={
        <Tooltip>
          <Text size="T200">
            {cameraMissing ? 'Camera Unavailable' : enabled ? 'Stop Camera' : 'Start Camera'}
          </Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          variant={enabled ? 'Success' : 'Surface'}
          fill="Soft"
          radii="300"
          size="300"
          style={panelStyle(panel)}
          onClick={toggleVideo}
          outlined
          disabled={disabled || loading || cameraMissing}
        >
          <Icon
            size="100"
            src={enabled ? Icons.VideoCamera : Icons.VideoCameraMute}
            filled={enabled}
          />
        </IconButton>
      )}
    </TooltipProvider>
  );
}

type ScreenShareButtonProps = {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Equal-width button for the voice panel row. */
  panel?: boolean;
};
function ScreenShareButton({ enabled, onToggle, disabled, panel }: ScreenShareButtonProps) {
  return (
    <TooltipProvider
      position="Top"
      tooltip={
        <Tooltip>
          <Text size="T200">{enabled ? 'Stop Screenshare' : 'Start Screenshare'}</Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          variant={enabled ? 'Success' : 'Surface'}
          fill="Soft"
          radii="300"
          size="300"
          style={panelStyle(panel)}
          onClick={onToggle}
          outlined
          disabled={disabled}
        >
          <Icon size="100" src={Icons.ScreenShare} filled={enabled} />
        </IconButton>
      )}
    </TooltipProvider>
  );
}

/** Before the call is joined there is nothing to hang up: just drop the embed. */
function useCallHangup(callEmbed: CallEmbed, callJoined: boolean): [boolean, () => void] {
  const setCallEmbed = useSetAtom(callEmbedAtom);
  const [hangupState, hangup] = useAsyncCallback(
    useCallback(() => callEmbed.hangup(), [callEmbed]),
  );
  const exiting =
    hangupState.status === AsyncStatus.Loading || hangupState.status === AsyncStatus.Success;

  const handleHangup = () => {
    if (!callJoined) {
      setCallEmbed(undefined);
      return;
    }
    hangup();
  };

  return [exiting, handleHangup];
}

export function CallControl({
  callEmbed,
  compact,
  callJoined,
}: {
  callEmbed: CallEmbed;
  compact: boolean;
  callJoined: boolean;
}) {
  const { microphone, video, sound, screenshare } = useCallControlState(callEmbed.control);

  const handleMicrophoneToggle = useCallback(
    () => callEmbed.control.toggleMicrophone(),
    [callEmbed],
  );
  const handleVideoToggle = useCallback(() => callEmbed.control.toggleVideo(), [callEmbed]);

  const [exiting, handleHangup] = useCallHangup(callEmbed, callJoined);

  return (
    <Box shrink="No" alignItems="Center" gap="300">
      <Box alignItems="Inherit" gap="200">
        <MicrophoneButton
          enabled={microphone}
          onToggle={handleMicrophoneToggle}
          disabled={!callJoined}
        />
        <SoundButton
          enabled={sound}
          onToggle={() => callEmbed.control.toggleSound()}
          disabled={!callJoined}
        />
        {!compact && <StatusDivider />}
        <VideoButton enabled={video} onToggle={handleVideoToggle} disabled={!callJoined} />
        {!compact && (
          <ScreenShareButton
            enabled={screenshare}
            onToggle={() => callEmbed.control.toggleScreenshare()}
            disabled={!callJoined}
          />
        )}
      </Box>
      <StatusDivider />
      <Chip
        variant="Critical"
        radii="Pill"
        fill="Soft"
        before={
          exiting ? (
            <Spinner variant="Critical" fill="Soft" size="50" />
          ) : (
            <Icon size="50" src={Icons.PhoneDown} filled />
          )
        }
        disabled={exiting}
        outlined
        onClick={handleHangup}
      >
        {!compact && (
          <Text as="span" size="L400">
            End
          </Text>
        )}
      </Chip>
    </Box>
  );
}

export function CallHangupButton({
  callEmbed,
  callJoined,
}: {
  callEmbed: CallEmbed;
  callJoined: boolean;
}) {
  const [exiting, handleHangup] = useCallHangup(callEmbed, callJoined);

  return (
    <TooltipProvider
      position="Top"
      tooltip={
        <Tooltip>
          <Text size="T200">Disconnect</Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          variant="Critical"
          fill="None"
          radii="300"
          size="300"
          onClick={handleHangup}
          disabled={exiting}
          aria-label="Disconnect"
        >
          {exiting ? (
            <Spinner variant="Critical" fill="Soft" size="50" />
          ) : (
            <Icon size="100" src={Icons.PhoneDown} filled />
          )}
        </IconButton>
      )}
    </TooltipProvider>
  );
}

/** Row of equal-width call buttons for the voice panel. */
export function CallPanelControls({
  callEmbed,
  callJoined,
}: {
  callEmbed: CallEmbed;
  callJoined: boolean;
}) {
  const { microphone, video, sound, screenshare } = useCallControlState(callEmbed.control);

  const handleMicrophoneToggle = useCallback(
    () => callEmbed.control.toggleMicrophone(),
    [callEmbed],
  );
  const handleVideoToggle = useCallback(() => callEmbed.control.toggleVideo(), [callEmbed]);

  return (
    <Box grow="Yes" gap="100">
      <Box grow="Yes">
        <MicrophoneButton
          enabled={microphone}
          onToggle={handleMicrophoneToggle}
          disabled={!callJoined}
          panel
        />
      </Box>
      <Box grow="Yes">
        <SoundButton
          enabled={sound}
          onToggle={() => callEmbed.control.toggleSound()}
          disabled={!callJoined}
          panel
        />
      </Box>
      <Box grow="Yes">
        <VideoButton enabled={video} onToggle={handleVideoToggle} disabled={!callJoined} panel />
      </Box>
      <Box grow="Yes">
        <ScreenShareButton
          enabled={screenshare}
          onToggle={() => callEmbed.control.toggleScreenshare()}
          disabled={!callJoined}
          panel
        />
      </Box>
    </Box>
  );
}
