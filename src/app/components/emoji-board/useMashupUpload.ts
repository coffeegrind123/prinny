import { useCallback } from 'react';
import { IImageInfo } from '../../../types/matrix/common';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { findStoredMashup, rememberMashup } from '../../state/emojiMashups';
import {
  MASHUP_MIME_TYPE,
  MASHUP_PNG_SIZE,
  MashupEmoji,
  mashupBody,
  mashupShortcode,
  renderMashupPng,
} from '../../plugins/emoji-mashup';

export type MashupUpload = {
  shortcode: string;
  mxc: string;
  body: string;
  info: IImageInfo;
};

/**
 * Turns a chosen pair into something Matrix can carry: an `mxc://` URI.
 *
 * A reaction key and an inline emoticon are both plain strings, so the picture
 * has to exist in the media repo before either can point at it. The upload is
 * deliberately **unencrypted**, even in an encrypted room — a reaction key has
 * nowhere to put the decryption info, and the same is already true of every
 * custom emoji from an image pack. Nothing private is disclosed by it: the
 * image is two public emoji stacked, generated locally.
 *
 * Repeat uses cost nothing. The stored list is keyed by shortcode, so the
 * second time anyone reaches for 😍 + 😭 it resolves to the URI already
 * uploaded — which matters beyond bandwidth, because a fresh URI for the same
 * mashup would split its reactions into two chips.
 */
export const useMashupUpload = (): ((
  face: MashupEmoji,
  mouth: MashupEmoji
) => Promise<MashupUpload>) => {
  const mx = useMatrixClient();

  return useCallback(
    async (face: MashupEmoji, mouth: MashupEmoji): Promise<MashupUpload> => {
      const shortcode = mashupShortcode(face, mouth);
      const body = mashupBody(face, mouth);

      const stored = findStoredMashup(mx, shortcode);
      if (stored) {
        // Re-record it so the picker's recent list reflects the use, but do
        // not wait on the round trip to hand back a URI we already have.
        rememberMashup(mx, {
          shortcode: stored.shortcode,
          face: stored.face,
          mouth: stored.mouth,
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

      const blob = await renderMashupPng(face.codepoint, mouth.codepoint);
      const filename = `${shortcode}.png`;

      const response = await mx.uploadContent(
        new File([blob], filename, { type: MASHUP_MIME_TYPE }),
        {
          name: filename,
          type: MASHUP_MIME_TYPE,
          includeFilename: true,
        }
      );

      const mxc = response.content_uri;
      if (!mxc) throw new Error('emoji-mashup: upload returned no content URI');

      const info: IImageInfo = {
        w: MASHUP_PNG_SIZE,
        h: MASHUP_PNG_SIZE,
        mimetype: MASHUP_MIME_TYPE,
        size: blob.size,
      };

      await rememberMashup(mx, {
        shortcode,
        face: face.codepoint,
        mouth: mouth.codepoint,
        mxc,
        body,
        info,
      });

      return { shortcode, mxc, body, info };
    },
    [mx]
  );
};
