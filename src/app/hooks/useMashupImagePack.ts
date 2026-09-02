import { useCallback, useMemo } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import {
  ImagePack,
  ImageUsage,
  PackContent,
  PackImages,
  getUserImagePack,
} from '../plugins/custom-emoji';
import { StoredMashup, useStoredMashups } from '../state/emojiMashups';
import { useMatrixClient } from './useMatrixClient';
import { useAccountData } from './useAccountData';

/**
 * The account's own emote pack, read straight from account data.
 *
 * `useImagePacks` exports the same thing, but importing it here would close a
 * cycle — that module injects this one's synthetic pack into
 * `useRelevantImagePacks`. Reading the event directly keeps the dependency
 * one-way.
 */
const useOwnEmotePack = (): ImagePack | undefined => {
  const mx = useMatrixClient();
  const event = useAccountData(AccountDataEvent.PoniesUserEmotes);
  const userId = mx.getUserId();

  return useMemo(
    () => (event && userId ? ImagePack.fromMatrixEvent(userId, event) : undefined),
    [event, userId],
  );
};

/**
 * Not a real pack address — nothing is written to `im.ponies.*` under this id.
 * It only has to be stable and not collide with a room id or an mxid, which is
 * what the board and sidebar key packs by.
 */
export const MASHUP_PACK_ID = 'app.prinny.emoji_mashups';

export const MASHUP_PACK_NAME = 'Mashups';

/**
 * The mashups this account has made, dressed up as an image pack.
 *
 * Everything downstream of the picker — the board's group and sidebar icon,
 * `:` autocomplete, the search index, reaction rendering — already knows how
 * to handle an {@link ImagePack}. Presenting the stored list as one is what
 * makes a mashup typeable as `:mash_heart_eyes_sob:` without a line of new
 * code in any of those places.
 *
 * It is assembled in memory rather than written to `im.ponies.user_emotes`
 * because the two have different jobs: the account's real emote pack is a
 * curated thing other clients read, while this is a recency-ordered, capped
 * cache that fills up on its own. A mashup that has been pinned into the real
 * pack drops out of here, so the board never shows the same shortcode twice.
 */
export const useMashupImagePack = (): ImagePack | undefined => {
  const mashups = useStoredMashups();
  const userPack = useOwnEmotePack();

  const pinned = useMemo(() => new Set(userPack?.images.collection.keys() ?? []), [userPack]);

  return useMemo(() => {
    const unpinned = mashups.filter((mashup) => !pinned.has(mashup.shortcode));
    if (unpinned.length === 0) return undefined;

    const images: PackImages = {};
    unpinned.forEach((mashup) => {
      images[mashup.shortcode] = {
        url: mashup.mxc,
        body: mashup.body,
        usage: [ImageUsage.Emoticon],
        info: mashup.info,
      };
    });

    const content: PackContent = {
      pack: {
        display_name: MASHUP_PACK_NAME,
        usage: [ImageUsage.Emoticon],
      },
      images,
    };

    return new ImagePack(MASHUP_PACK_ID, content, undefined);
  }, [mashups, pinned]);
};

const writeUserPack = (mx: MatrixClient, images: PackImages): Promise<unknown> => {
  const current = getUserImagePack(mx);
  const content: PackContent = {
    pack: current?.meta.content ?? {},
    images,
  };
  return mx.setAccountData(AccountDataEvent.PoniesUserEmotes, content);
};

const currentUserImages = (mx: MatrixClient): PackImages => {
  const images: PackImages = {};
  getUserImagePack(mx)?.images.collection.forEach((image, shortcode) => {
    images[shortcode] = image.content;
  });
  return images;
};

export type MashupPinning = {
  isPinned: (shortcode: string) => boolean;
  /**
   * Copies a mashup into `im.ponies.user_emotes`, or removes it again.
   *
   * This is the step that makes a mashup portable. The synthetic pack above is
   * only visible to this client; MSC2545 is what Element and everything else
   * reads, so a mashup worth keeping earns a place in the account's real emote
   * pack rather than living in a Prinny-only cache forever.
   */
  togglePin: (mashup: StoredMashup) => Promise<unknown>;
};

export const useMashupPinning = (): MashupPinning => {
  const mx = useMatrixClient();
  const userPack = useOwnEmotePack();

  const isPinned = useCallback(
    (shortcode: string) => userPack?.images.collection.has(shortcode) ?? false,
    [userPack],
  );

  const togglePin = useCallback(
    (mashup: StoredMashup) => {
      const images = currentUserImages(mx);
      if (images[mashup.shortcode]) {
        delete images[mashup.shortcode];
      } else {
        images[mashup.shortcode] = {
          url: mashup.mxc,
          body: mashup.body,
          usage: [ImageUsage.Emoticon],
          info: mashup.info,
        };
      }
      return writeUserPack(mx, images);
    },
    [mx],
  );

  return useMemo(() => ({ isPinned, togglePin }), [isPinned, togglePin]);
};
