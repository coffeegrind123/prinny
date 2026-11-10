import { Spinner } from 'folds';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { IAudioInfo } from '../../../../types/matrix/common';
import { useMediaSrc } from '../../../hooks/useMediaSrc';
import { AttachmentLoadError } from './AttachmentLoadError';

export type AudioContentProps = {
  mimeType: string;
  url: string;
  info: IAudioInfo;
  encInfo?: EncryptedAttachmentInfo;
  /** Sender's filename, so a save from the element's own menu keeps it. */
  filename?: string;
};
export function AudioContent({ mimeType, url, encInfo, filename }: AudioContentProps) {
  const { src, state, retry, needsBlob, onSrcError, controlsList } = useMediaSrc(
    url,
    mimeType,
    encInfo,
    filename,
  );

  if (needsBlob && state.status === AsyncStatus.Error) {
    return <AttachmentLoadError error={state.error} onRetry={retry} size="300" />;
  }

  if (needsBlob && state.status !== AsyncStatus.Success) {
    return <Spinner variant="Secondary" size="400" />;
  }

  return (
    <audio
      style={{ width: '100%' }}
      controls
      controlsList={controlsList}
      preload="metadata"
      src={src}
      onError={onSrcError}
    />
  );
}
