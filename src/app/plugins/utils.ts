import { SearchItemStrGetter } from '../hooks/useAsyncSearch';
import { PackImageReader } from './custom-emoji';
import { IEmoji } from './emoji';

// Variation selectors (U+FE0E/U+FE0F) and skin tone modifiers (U+1F3FB-1F3FF).
// Emoji pickers outside the app disagree on whether to emit them, so they are
// dropped on both sides of the match: "\u2764" finds red_heart, and a thumbs up
// in any skin tone finds the thumbs up.
const EMOJI_MODIFIERS_REG = /[\uFE0E\uFE0F]|\uD83C[\uDFFB-\uDFFF]/g;

/** An emoji with variation selectors and skin tones removed, for search matching. */
export const emojiSearchKey = (value: string): string => value.replace(EMOJI_MODIFIERS_REG, '');

export const getEmoticonSearchStr: SearchItemStrGetter<PackImageReader | IEmoji> = (item) => {
  const shortcode = `:${item.shortcode}:`;
  if (item instanceof PackImageReader) {
    if (item.body) {
      return [shortcode, item.body];
    }
    return shortcode;
  }

  // The emoji itself is searchable, so pasting one from a system picker finds it.
  const names = [shortcode, item.label, emojiSearchKey(item.unicode)];
  if (Array.isArray(item.shortcodes)) {
    return names.concat(item.shortcodes);
  }
  return names;
};
