import { useMemo } from 'react';
import { Room } from 'matrix-js-sdk';
import { emojiShortcodeMap, EmojiReplacement } from '../plugins/emoji';
import { ImageUsage } from '../plugins/custom-emoji';
import { useRelevantImagePacks } from './useImagePacks';

/**
 * Builds a shortcode-to-emoji lookup map that combines the static unicode
 * emoji shortcodes with room-specific custom emoji shortcodes from image
 * packs. Used by the editor for live `:shortcode:` auto-replacement.
 */
export const useEmojiShortcodeMap = (imagePackRooms: Room[]): Map<string, EmojiReplacement> => {
  const imagePacks = useRelevantImagePacks(ImageUsage.Emoticon, imagePackRooms);

  return useMemo(() => {
    const map = new Map(emojiShortcodeMap);
    imagePacks.forEach((pack) => {
      pack.getImages(ImageUsage.Emoticon).forEach((img) => {
        map.set(img.shortcode.toLowerCase(), {
          key: img.url,
          shortcode: img.shortcode,
          alt: img.body,
        });
      });
    });
    return map;
  }, [imagePacks]);
};
