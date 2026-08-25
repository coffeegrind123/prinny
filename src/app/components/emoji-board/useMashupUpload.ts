import { useCallback } from 'react';
import { IImageInfo } from '../../../types/matrix/common';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { findStoredMashup, rememberMashup } from '../../state/emojiMashups';
import { KitchenEmoji, mashupBody, mashupShortcode } from '../../plugins/emoji-kitchen';

export type MashupUpload = {
  shortcode: string;
  mxc: string;
  body: string;
  info: IImageInfo;
};

const MIME_TYPE = 'image/png';

/**
 * Reads the real pixel dimensions rather than assuming them.
 *
 * Emoji Kitchen artwork is not all one size, and `info` is what other clients
 * size the emote from — a guess here shows up as a wrongly scaled image
 * somewhere else. Failing to decode is not worth failing the upload over, so
 * the dimensions are simply omitted in that case.
 */
const measure = async (blob: Blob): Promise<{ w: number; h: number } | undefined> => {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
};

/**
 * Turns a chosen pairing into something Matrix can carry: an `mxc://` URI.
 *
 * A reaction key and an inline emoticon are both plain strings, so the picture
 * has to be on the homeserver before either can point at it — a `gstatic.com`
 * URL is no use to anyone receiving the message, and would leave every reader
 * fetching from Google to see a reaction. The upload is deliberately
 * **unencrypted**, even in an encrypted room: a reaction key has nowhere to put
 * the decryption info, and the same is already true of every custom emoji from
 * an image pack. Nothing private is disclosed by it — it is a picture Google
 * publishes at a public URL.
 *
 * Repeat uses cost nothing. The stored list is keyed by shortcode, so the
 * second time anyone reaches for 😍 + 😭 it resolves to the URI already
 * uploaded — which matters beyond bandwidth, because a fresh URI for the same
 * mashup would split its reactions into two chips.
 */
export const useMashupUpload = (): ((
  a: KitchenEmoji,
  b: KitchenEmoji,
  url: string,
) => Promise<MashupUpload>) => {
  const mx = useMatrixClient();

  return useCallback(
    async (a: KitchenEmoji, b: KitchenEmoji, url: string): Promise<MashupUpload> => {
      const shortcode = mashupShortcode(a, b);
      const body = mashupBody(a, b);

      const stored = findStoredMashup(mx, shortcode);
      if (stored) {
        // Re-record it so the picker's recent list reflects the use, but do
        // not wait on the round trip to hand back a URI we already have.
        rememberMashup(mx, {
          shortcode: stored.shortcode,
          left: stored.left,
          right: stored.right,
          mxc: stored.mxc,
          body: stored.body,
          info: stored.info,
        });
        return {
          shortcode,
          mxc: stored.mxc,
          body: stored.body,
          info: stored.info ?? {},
        };
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Emoji Kitchen returned ${response.status} for this combination.`);
      }
      const blob = await response.blob();

      const filename = `${shortcode}.png`;
      const uploaded = await mx.uploadContent(new File([blob], filename, { type: MIME_TYPE }), {
        name: filename,
        type: MIME_TYPE,
        includeFilename: true,
      });

      const mxc = uploaded.content_uri;
      if (!mxc) throw new Error('emoji-kitchen: upload returned no content URI');

      const info: IImageInfo = {
        ...(await measure(blob)),
        mimetype: MIME_TYPE,
        size: blob.size,
      };

      await rememberMashup(mx, {
        shortcode,
        left: a.codepoint,
        right: b.codepoint,
        mxc,
        body,
        info,
      });

      return { shortcode, mxc, body, info };
    },
    [mx],
  );
};
