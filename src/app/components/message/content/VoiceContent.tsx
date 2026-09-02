import { Spinner, Text } from 'folds';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { IAudioInfo } from '../../../../types/matrix/common';
import { useMediaSrc } from '../../../hooks/useMediaSrc';

export type VoiceContentProps = {
  mimeType: string;
  url: string;
  info: IAudioInfo;
  encInfo?: EncryptedAttachmentInfo;
  /** From `org.matrix.msc1767.audio.waveform`, already scaled to 0..1. */
  waveform?: number[];
  /** Milliseconds, from the audio block or `info.duration`. */
  duration?: number;
  /** Sender's filename, so a save from the element's own menu keeps it. */
  filename?: string;
};

/**
 * Voice message, played by the engine's own audio element.
 *
 * This deliberately does NOT draw a custom waveform-and-scrubber player. The
 * hand-rolled one had to reimplement things the platform already does and got
 * several of them wrong in ways that only show up on real clips:
 *
 *  - Seeking needs a duration, and the duration is exactly what a streamed
 *    Opus/ogg voice note does not report — WebKit returns `Infinity` for
 *    `duration` until the clip has been played all the way through once. The
 *    scrubber therefore had nothing to scale against on the format voice
 *    messages are actually sent in, so the progress bar sat still while audio
 *    played and dragging it did nothing.
 *  - Drawing a waveform for a clip whose sender did not supply one meant
 *    fetching the whole file, decoding it through an `AudioContext` and
 *    reducing it to peaks — per message, on the main thread, for something the
 *    user may never press play on.
 *
 * The native element gets all of that right for free, uses whatever seek and
 * speed affordances the host platform provides, and inherits its media-key,
 * screen-reader and OS integration. `info.duration` and the sender's waveform
 * are still accepted in props so senders that supply them cost nothing, and so
 * the call sites do not have to change.
 */
export function VoiceContent({ mimeType, url, encInfo, filename }: VoiceContentProps) {
  const { src, state, needsBlob, onSrcError } = useMediaSrc(url, mimeType, encInfo, filename);

  if (needsBlob && state.status === AsyncStatus.Error) {
    return (
      <Text size="T200" priority="300">
        Failed to load voice message.
      </Text>
    );
  }

  if (needsBlob && state.status !== AsyncStatus.Success) {
    return <Spinner variant="Secondary" size="400" />;
  }

  // Matches AudioContent, which has always used the native element — a voice
  // note and an audio attachment are the same thing with different framing,
  // and they should not have looked like two different players.
  return (
    <audio style={{ width: '100%' }} src={src} controls preload="metadata" onError={onSrcError} />
  );
}
