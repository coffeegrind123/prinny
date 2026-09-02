import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Icon, IconButton, Icons, Spinner, Text, color, config } from 'folds';
import { Waveform } from '../../../components/media';
import { secondsToMinutesAndSeconds } from '../../../utils/common';
import { MAX_DURATION_SECONDS } from '../../../plugins/voice-recorder';
import { VoiceRecordStatus, VoiceRecorderControls } from './useVoiceRecorder';

type VoiceRecordBarProps = {
  controls: VoiceRecorderControls;
  onSend: () => void;
};

/**
 * The composer strip shown while recording, and again while reviewing the clip
 * before it is sent. Nothing here is destructive without a second press: stop
 * takes you to the preview, and only "discard" throws audio away.
 */
export function VoiceRecordBar({ controls, onSend }: VoiceRecordBarProps) {
  const { status, waveform, durationSeconds, recording, endingSoon } = controls;

  const [playing, setPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const previewUrl = useMemo(
    () => (recording ? URL.createObjectURL(recording.blob) : undefined),
    [recording],
  );

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  // A new take replaces the old one — never keep the previous clip's playhead.
  useEffect(() => {
    setPlaying(false);
    setPlaybackProgress(0);
  }, [previewUrl]);

  const recordingNow = status === VoiceRecordStatus.Recording;
  const starting = status === VoiceRecordStatus.Starting;
  const sending = status === VoiceRecordStatus.Sending;

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const secondsLeft = Math.max(0, Math.ceil(MAX_DURATION_SECONDS - durationSeconds));

  return (
    <Box
      alignItems="Center"
      gap="200"
      style={{
        padding: `${config.space.S200} ${config.space.S300}`,
      }}
    >
      <Box shrink="No">
        {recordingNow || starting ? (
          <IconButton
            onClick={controls.discard}
            variant="SurfaceVariant"
            size="300"
            radii="300"
            aria-label="Discard recording"
            disabled={starting}
          >
            <Icon src={Icons.Cross} size="50" />
          </IconButton>
        ) : (
          <IconButton
            onClick={togglePlayback}
            variant="SurfaceVariant"
            size="300"
            radii="300"
            aria-label={playing ? 'Pause' : 'Play'}
            disabled={sending || !previewUrl}
          >
            <Icon src={playing ? Icons.Pause : Icons.Play} size="50" />
          </IconButton>
        )}
      </Box>

      <Box grow="Yes" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
        {starting ? (
          <Text size="T200" priority="300">
            Starting microphone…
          </Text>
        ) : (
          <Waveform
            waveform={waveform}
            progress={status === VoiceRecordStatus.Preview ? playbackProgress : undefined}
            onSeek={
              status === VoiceRecordStatus.Preview && recording
                ? (ratio) => {
                    const audio = audioRef.current;
                    if (!audio) return;
                    // The blob's own metadata is authoritative; our measured
                    // duration is only a fallback for engines that report
                    // Infinity for a streamed ogg.
                    const total = Number.isFinite(audio.duration)
                      ? audio.duration
                      : recording.durationSeconds;
                    audio.currentTime = ratio * total;
                    setPlaybackProgress(ratio);
                  }
                : undefined
            }
          />
        )}
      </Box>

      <Box shrink="No" alignItems="Center" gap="200">
        <Text
          size="T200"
          style={endingSoon ? { color: color.Critical.Main } : undefined}
          priority={endingSoon ? undefined : '300'}
        >
          {endingSoon
            ? `${secondsLeft}s left`
            : secondsToMinutesAndSeconds(Math.floor(durationSeconds))}
        </Text>

        {recordingNow && (
          <IconButton
            onClick={controls.stop}
            variant="Primary"
            size="300"
            radii="300"
            aria-label="Stop recording"
          >
            <Icon src={Icons.Check} size="50" />
          </IconButton>
        )}

        {status === VoiceRecordStatus.Preview && (
          <>
            <IconButton
              onClick={controls.discard}
              variant="SurfaceVariant"
              size="300"
              radii="300"
              aria-label="Discard recording"
            >
              <Icon src={Icons.Delete} size="50" />
            </IconButton>
            <IconButton
              onClick={onSend}
              variant="Primary"
              size="300"
              radii="300"
              aria-label="Send voice message"
            >
              <Icon src={Icons.Send} size="50" />
            </IconButton>
          </>
        )}

        {sending && <Spinner variant="Primary" size="200" />}
      </Box>

      {previewUrl && (
        <audio
          ref={audioRef}
          src={previewUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPlaybackProgress(0);
          }}
          onTimeUpdate={(evt) => {
            const audio = evt.currentTarget;
            const total = Number.isFinite(audio.duration)
              ? audio.duration
              : (recording?.durationSeconds ?? 0);
            if (total > 0) setPlaybackProgress(Math.min(1, audio.currentTime / total));
          }}
          style={{ display: 'none' }}
        />
      )}
    </Box>
  );
}
