import { useCallback } from 'react';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import FileSaver from '../utils/save-file';
import { safeDownloadFilename } from '../utils/mimeTypes';
import { useMatrixClient } from './useMatrixClient';
import { useMediaAuthentication } from './useMediaAuthentication';
import { AsyncState, AsyncStatus, useAsyncCallback } from './useAsyncCallback';
import { decryptFile, downloadEncryptedMedia, downloadMedia, mxcUrlToHttp } from '../utils/matrix';
import { downloadRemoteMedia } from '../utils/tauri-media-proxy';

export type MediaDownload = {
  /** Fetch (or, once fetched, re-save) the attachment under `downloadName`. */
  download: () => void;
  state: AsyncState<string, Error>;
  downloading: boolean;
  hasError: boolean;
  /** The name the file lands on disk under — the sender's, flattened. */
  downloadName: string;
};

/**
 * Save an attachment to disk under the name its sender gave it.
 *
 * This is the ONLY download path that can promise that. The media elements'
 * own "Download" item cannot: on the blob path — which is every encrypted
 * attachment and, on any homeserver that has authenticated media, every
 * attachment full stop — the browser has nothing to name the file after but
 * the object URL's UUID. So each attachment keeps one explicit download
 * control of ours, and that control sets `a[download]` itself.
 *
 * Lifted out of the old FileHeader so the filename caption, the file card and
 * anything else needing a download share one implementation rather than three
 * copies that drift.
 */
export function useMediaDownload(
  filename: string,
  url: string,
  mimeType: string,
  encInfo?: EncryptedAttachmentInfo,
  /**
   * An already-http media URL to save instead of resolving `url` as an mxc.
   *
   * For media that never was a Matrix attachment — a picture inside a linked
   * Twitter or Bluesky post, which the media feed lists alongside real
   * attachments. Fetched through the same referrer-stripping path the elements
   * use, because the CDNs that need it answer 403 to a plain cross-origin GET.
   */
  directUrl?: string,
): MediaDownload {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  // `filename` is sender-supplied. It is safe as display text (React escapes
  // it), but the download sink needs a flattened basename — see
  // safeDownloadFilename().
  const downloadName = safeDownloadFilename(filename);

  const [state, load] = useAsyncCallback<string, Error, []>(
    useCallback(async () => {
      if (directUrl) {
        const remote = await downloadRemoteMedia(directUrl, mimeType);
        const remoteURL = URL.createObjectURL(remote);
        FileSaver.saveAs(remoteURL, downloadName);
        return remoteURL;
      }
      const mediaUrl = mxcUrlToHttp(mx, url, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      const fileContent = encInfo
        ? await downloadEncryptedMedia(mediaUrl, (encBuf) => decryptFile(encBuf, mimeType, encInfo))
        : await downloadMedia(mediaUrl);

      const fileURL = URL.createObjectURL(fileContent);
      FileSaver.saveAs(fileURL, downloadName);
      return fileURL;
    }, [mx, url, useAuthentication, mimeType, encInfo, downloadName, directUrl]),
  );

  const download = useCallback(() => {
    if (state.status === AsyncStatus.Success) {
      // Already fetched — re-issue the save rather than pulling it again.
      FileSaver.saveAs(state.data, downloadName);
      return;
    }
    // `useAsync` records the failure in `state` AND re-throws it. Nothing here
    // awaits, and an ignored rejection is reported as "Uncaught (in promise)",
    // so swallow what the caller already renders from `state`.
    load().catch(() => undefined);
  }, [state, load, downloadName]);

  return {
    download,
    state,
    downloading: state.status === AsyncStatus.Loading,
    hasError: state.status === AsyncStatus.Error,
    downloadName,
  };
}
