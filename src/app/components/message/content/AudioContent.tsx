import { Spinner, Text } from 'folds';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { IAudioInfo } from '../../../../types/matrix/common';
import { useMediaSrc } from '../../../hooks/useMediaSrc';

export type AudioContentProps = {
  mimeType: string;
  url: string;
  info: IAudioInfo;
  encInfo?: EncryptedAttachmentInfo;
  /** Sender's filename, so a save from the element's own menu keeps it. */
  filename?: string;
};
export function AudioContent({ mimeType, url, encInfo, filename }: AudioContentProps) {
  const { src, state, needsBlob, onSrcError } = useMediaSrc(url, mimeType, encInfo, filename);

  if (needsBlob && state.status === AsyncStatus.Error) {
    return (
      <Text size="T200" priority="300">
        Failed to load audio.
      </Text>
    );
  }

  if (needsBlob && state.status !== AsyncStatus.Success) {
    return <Spinner variant="Secondary" size="400" />;
  }

  return (
    <audio style={{ width: '100%' }} controls preload="metadata" src={src} onError={onSrcError} />
  );
}
