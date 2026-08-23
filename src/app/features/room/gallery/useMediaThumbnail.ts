import { useCallback, useEffect, useRef } from 'react';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { decryptFile, downloadEncryptedMedia, mxcUrlToHttp } from '../../../utils/matrix';
import { getImageSafeMimeType } from '../../../utils/mimeTypes';
import { MediaItem } from '../../../hooks/useRoomMedia';

/** Longest edge, in device-independent pixels, asked of the server thumbnailer. */
const THUMBNAIL_SIZE = 512;

export type MediaThumbnail = {
  src?: string;
  /**
   * What to try when `src` fails to load.
   *
   * The still for an unencrypted image is a *server-side thumbnail*, which the
   * timeline never asks for — it renders the full attachment. So a homeserver
   * whose thumbnailer is missing, disabled, or unable to handle a remote or
   * exotic file answers the gallery with a 404/502 while the same picture
   * renders perfectly in the conversation, and every tile comes out grey. The
   * full attachment is always there to fall back on; it is only bigger.
   */
  fallbackSrc?: string;
  loading: boolean;
  /**
   * No still exists for this attachment and none can be made cheaply — an
   * encrypted video whose sender attached no thumbnail. The tile falls back to
   * the blurhash and its own play badge.
   */
  unavailable: boolean;
};

/**
 * A still for one gallery tile, at the smallest cost that produces one.
 *
 * Three paths, in order of preference:
 *
 * 1. The sender's own thumbnail (`info.thumbnail_url` / `thumbnail_file`).
 *    Always the right answer when it exists — it is small, and for encrypted
 *    video it is the only still that exists at all.
 * 2. A server-side thumbnail of the image. Costs the homeserver a resize and
 *    us one small request; the tile never downloads a 12 MP photo to draw it
 *    at 160px. Unencrypted images only — the server cannot resize ciphertext.
 * 3. The encrypted image itself, downloaded and decrypted. Unavoidable for
 *    encrypted attachments, and the reason tiles load lazily.
 *
 * An unencrypted video with no sender thumbnail has no path here at all; the
 * tile renders the file itself in a metadata-only `<video>`, which shows its
 * first frame without fetching the body.
 */
export const useMediaThumbnail = (item: MediaItem, load: boolean): MediaThumbnail => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const thumbMxc = item.thumbnail?.thumbnail_file?.url ?? item.thumbnail?.thumbnail_url;
  const thumbEncInfo = item.thumbnail?.thumbnail_file;
  const thumbMimeType = getImageSafeMimeType(item.thumbnail?.thumbnail_info?.mimetype);

  // Media inside a linked post is already a plain https URL on the provider's
  // CDN, and the provider has usually given a small rendition to draw the tile
  // with. Nothing to resolve, decrypt or resize — the still IS the URL.
  const embedSrc =
    item.source === 'embed'
      ? item.type === 'image'
        ? (item.posterUrl ?? item.httpUrl)
        : item.posterUrl
      : undefined;
  const isEmbed = item.source === 'embed';

  const hasSenderThumbnail = typeof thumbMxc === 'string';
  const unavailable = isEmbed
    ? !embedSrc
    : !hasSenderThumbnail && item.type === 'video' && !!item.encInfo;

  const [state, loadSrc] = useAsyncCallback<string, Error, []>(
    useCallback(async () => {
      if (isEmbed) {
        if (!embedSrc) throw new Error('No still for this embed');
        return embedSrc;
      }
      if (hasSenderThumbnail) {
        const mediaUrl = mxcUrlToHttp(mx, thumbMxc ?? '', useAuthentication);
        if (!mediaUrl) throw new Error('Invalid media URL');
        if (thumbEncInfo) {
          const fileContent = await downloadEncryptedMedia(mediaUrl, (encBuf) =>
            decryptFile(encBuf, thumbMimeType, thumbEncInfo),
          );
          return URL.createObjectURL(fileContent);
        }
        return mediaUrl;
      }

      if (item.type !== 'image') throw new Error('No thumbnail for this attachment');

      const fileEncInfo = item.encInfo;
      if (fileEncInfo) {
        const mediaUrl = mxcUrlToHttp(mx, item.mxcUrl ?? '', useAuthentication);
        if (!mediaUrl) throw new Error('Invalid media URL');
        const fileContent = await downloadEncryptedMedia(mediaUrl, (encBuf) =>
          decryptFile(encBuf, item.mimeType, fileEncInfo),
        );
        return URL.createObjectURL(fileContent);
      }

      const scaled = mxcUrlToHttp(
        mx,
        item.mxcUrl ?? '',
        useAuthentication,
        THUMBNAIL_SIZE,
        THUMBNAIL_SIZE,
        'crop',
      );
      if (!scaled) throw new Error('Invalid media URL');
      return scaled;
    }, [
      mx,
      useAuthentication,
      isEmbed,
      embedSrc,
      hasSenderThumbnail,
      thumbMxc,
      thumbEncInfo,
      thumbMimeType,
      item.type,
      item.encInfo,
      item.mxcUrl,
      item.mimeType,
    ]),
  );

  useEffect(() => {
    if (!load || unavailable) return;
    if (state.status === AsyncStatus.Idle) loadSrc();
  }, [load, unavailable, state.status, loadSrc]);

  // A still that fails to load is a grey tile and nothing else — no error, no
  // retry, no clue which of the three paths above gave up. Say which, with the
  // URL, because "the gallery is blank" and "this homeserver 401s thumbnails"
  // are the same picture from the outside.
  useEffect(() => {
    if (state.status !== AsyncStatus.Error) return;
    console.warn('[gallery] thumbnail failed', {
      eventId: item.eventId,
      source: item.source,
      type: item.type,
      encrypted: !!item.encInfo,
      senderThumbnail: hasSenderThumbnail,
      mxcUrl: item.mxcUrl,
      httpUrl: item.httpUrl,
      error: state.error,
    });
  }, [
    state,
    item.eventId,
    item.source,
    item.type,
    item.encInfo,
    item.mxcUrl,
    item.httpUrl,
    hasSenderThumbnail,
  ]);

  // Only the decrypt paths mint an object URL; a plain media URL must not be
  // revoked, so track what we created rather than whatever `src` currently is.
  const blobRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state.status !== AsyncStatus.Success) return;
    if (state.data.startsWith('blob:')) blobRef.current = state.data;
  }, [state]);
  useEffect(
    () => () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    },
    [],
  );

  // Only the server-thumbnail path has a fallback: a sender-supplied thumbnail
  // and a decrypted blob either exist or do not, and an embed's URL is the
  // provider's own.
  const fallbackSrc =
    !isEmbed && !hasSenderThumbnail && item.type === 'image' && !item.encInfo && item.mxcUrl
      ? (mxcUrlToHttp(mx, item.mxcUrl, useAuthentication) ?? undefined)
      : undefined;

  return {
    src: state.status === AsyncStatus.Success ? state.data : undefined,
    fallbackSrc,
    loading: state.status === AsyncStatus.Loading,
    unavailable: unavailable || state.status === AsyncStatus.Error,
  };
};
