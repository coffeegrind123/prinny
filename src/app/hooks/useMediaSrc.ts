import { useCallback, useEffect, useRef, useState } from 'react';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { useMatrixClient } from './useMatrixClient';
import { AsyncState, AsyncStatus, useAsyncCallback } from './useAsyncCallback';
import { decryptFile, downloadEncryptedMedia, downloadMedia, mxcUrlToHttp } from '../utils/matrix';
import { useMediaAuthentication } from './useMediaAuthentication';
import { safeDownloadFilename } from '../utils/mimeTypes';

export type MediaSrc = {
  /** Ready to hand to an <audio>/<video> element, or undefined while loading. */
  src?: string;
  /** State of the blob fetch. Always Idle when the media streams directly. */
  state: AsyncState<string, Error>;
  /** True when the media had to be fetched rather than streamed. */
  needsBlob: boolean;
  /**
   * Hand this to the media element's `onError`.
   *
   * Its job is the filename in the streamed URL (see `withFilename`). That form
   * is what the spec requires, but it is a request to somebody else's
   * homeserver and this cannot verify every one of them — so a server that does
   * not serve it answers 404 and the attachment would simply not play. One
   * retry without the filename turns that into a file that plays under a dull
   * name, which is the right way round. Anything else that fires `onError` is a
   * no-op after the first call, so this cannot loop.
   */
  onSrcError: () => void;
};

/** `/_matrix/media/v3/download/<server>/<id>` or its `/_matrix/client/v1/media/` twin. */
const MEDIA_DOWNLOAD_PATH_REG =
  /\/_matrix\/(?:media\/v3|client\/v1\/media)\/download\/[^/]+\/[^/]+$/;

/**
 * Append the sender's filename to a media download URL.
 *
 * `GET /_matrix/media/v3/download/{server}/{mediaId}/{fileName}` is the same
 * resource with a `Content-Disposition` naming the file — and, just as usefully,
 * with the name as the URL's last path segment. Both are what the browser reads
 * when the user picks "Download" from a media element's own menu, so without
 * this the file lands on disk under the opaque media id.
 *
 * Only the plain download form is rewritten. A thumbnail URL carries resize
 * parameters and is not the file the user asked for, and anything else is a
 * shape this does not recognise — both are left exactly as they came.
 */
const withFilename = (mediaUrl: string, filename?: string): string => {
  if (!filename) return mediaUrl;
  try {
    const parsed = new URL(mediaUrl);
    if (!MEDIA_DOWNLOAD_PATH_REG.test(parsed.pathname)) return mediaUrl;
    parsed.pathname = `${parsed.pathname}/${encodeURIComponent(safeDownloadFilename(filename))}`;
    return parsed.href;
  } catch {
    // Not an absolute URL we can take apart — leave it alone rather than
    // guessing at string concatenation.
    return mediaUrl;
  }
};

/**
 * Resolves an mxc URL to something an HTML media element can actually play.
 *
 * Encrypted attachments are ciphertext, and authenticated media needs an
 * Authorization header a bare media element cannot send — both have to be
 * fetched into a blob URL first. Plain unauthenticated media streams natively,
 * which matters on long files: streaming starts playing immediately, while a
 * blob has to download in full first.
 *
 * Extracted from AudioContent so the voice-message player shares exactly this
 * behaviour rather than growing its own subtly different copy.
 *
 * `filename` is optional and affects nothing about playback: it is there so the
 * file keeps its name if the user saves it from the media element's own menu.
 * That works on the streaming path (the name goes into the URL) and is a
 * best-effort on the blob path — the blob is built as a named `File`, which
 * some engines use as the suggested name and none are harmed by. Neither is
 * guaranteed, which is why every media attachment also carries an explicit
 * download control that sets the name itself; see `useMediaDownload`.
 */
export function useMediaSrc(
  url: string,
  mimeType: string,
  encInfo?: EncryptedAttachmentInfo,
  filename?: string,
  /**
   * Set false to make this hook inert.
   *
   * For callers that render some attachments and some media that is not a
   * Matrix attachment at all (the media feed, which also shows pictures out of
   * linked posts). Hooks cannot be called conditionally, and an mxc-less call
   * would otherwise start a doomed fetch on every authenticated-media
   * homeserver — a request per page, all of them 404.
   */
  enabled: boolean = true,
): MediaSrc {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  // Set once the named URL has failed to load — see `onSrcError`.
  const [namedUrlRejected, setNamedUrlRejected] = useState(false);
  useEffect(() => {
    // A different attachment gets its own chance; the rejection belonged to the
    // previous URL, not to this homeserver forever.
    setNamedUrlRejected(false);
  }, [url, filename]);

  const needsBlob = enabled && (!!encInfo || useAuthentication);
  const directUrl =
    needsBlob || !enabled
      ? undefined
      : (() => {
          const mediaUrl = mxcUrlToHttp(mx, url, useAuthentication);
          if (!mediaUrl) return undefined;
          return namedUrlRejected ? mediaUrl : withFilename(mediaUrl, filename);
        })();

  const onSrcError = useCallback(() => setNamedUrlRejected(true), []);

  const [srcState, loadSrc] = useAsyncCallback<string, Error, []>(
    useCallback(async () => {
      const mediaUrl = mxcUrlToHttp(mx, url, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      const fileContent = encInfo
        ? await downloadEncryptedMedia(mediaUrl, (encBuf) => decryptFile(encBuf, mimeType, encInfo))
        : await downloadMedia(mediaUrl);
      const named = filename
        ? new File([fileContent], safeDownloadFilename(filename), {
            type: fileContent.type || mimeType,
          })
        : fileContent;
      return URL.createObjectURL(named);
    }, [mx, url, useAuthentication, mimeType, encInfo, filename]),
  );

  useEffect(() => {
    // `useAsync` records the failure in `srcState` and re-throws it too; nothing
    // awaits here, and an ignored rejection surfaces as "Uncaught (in promise)".
    if (needsBlob) loadSrc().catch(() => undefined);
  }, [needsBlob, loadSrc]);

  // Release the object URL when it is replaced, and when we unmount.
  const blobRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (srcState.status !== AsyncStatus.Success) return;
    if (blobRef.current && blobRef.current !== srcState.data) {
      URL.revokeObjectURL(blobRef.current);
    }
    blobRef.current = srcState.data;
  }, [srcState]);
  useEffect(
    () => () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    },
    [],
  );

  const src = needsBlob
    ? srcState.status === AsyncStatus.Success
      ? srcState.data
      : undefined
    : directUrl;

  return { src, state: srcState, needsBlob, onSrcError };
}
