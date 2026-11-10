import { ReactNode, useCallback, useEffect } from 'react';
import { IThumbnailContent } from '../../../../types/matrix/common';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncLoad } from '../../../hooks/useAsyncCallback';
import {
  decryptFile,
  downloadEncryptedMedia,
  isFinalAttachmentError,
  mxcUrlToHttp,
} from '../../../utils/matrix';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { getImageSafeMimeType } from '../../../utils/mimeTypes';
import { AttachmentLoadError } from './AttachmentLoadError';

export type ThumbnailContentProps = {
  info: IThumbnailContent;
  renderImage: (src: string) => ReactNode;
};
export function ThumbnailContent({ info, renderImage }: ThumbnailContentProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const [thumbSrcState, loadThumbSrc] = useAsyncLoad(
    useCallback(async () => {
      const thumbInfo = info.thumbnail_info;
      const thumbMxcUrl = info.thumbnail_file?.url ?? info.thumbnail_url;
      const encInfo = info.thumbnail_file;
      if (typeof thumbMxcUrl !== 'string' || typeof thumbInfo?.mimetype !== 'string') {
        throw new Error('Failed to load thumbnail');
      }

      const mediaUrl = mxcUrlToHttp(mx, thumbMxcUrl, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      if (encInfo) {
        const fileContent = await downloadEncryptedMedia(mediaUrl, (encBuf) =>
          decryptFile(encBuf, getImageSafeMimeType(thumbInfo.mimetype), encInfo),
        );
        return URL.createObjectURL(fileContent);
      }

      return mediaUrl;
    }, [mx, info, useAuthentication]),
  );

  useEffect(() => {
    loadThumbSrc();
  }, [loadThumbSrc]);

  if (thumbSrcState.status === AsyncStatus.Success) return renderImage(thumbSrcState.data);
  // A thumbnail is decoration: a missing one or a network failure stays silent, so it cannot cover
  // the media's own controls. A tampered or undecryptable one is said, because the reader must
  // know why nothing is shown.
  if (thumbSrcState.status === AsyncStatus.Error && isFinalAttachmentError(thumbSrcState.error)) {
    return <AttachmentLoadError error={thumbSrcState.error} />;
  }
  return null;
}
