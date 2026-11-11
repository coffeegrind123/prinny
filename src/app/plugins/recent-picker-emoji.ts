import { MatrixClient } from 'matrix-js-sdk';
import { getAccountData } from '../utils/room';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { IEmoji, findEmojiByUnicode } from './emoji';
import { PackImageReader } from './custom-emoji';
import { addRecentEmoji, getRecentEmojis } from './recent-emoji';

const MAX_ENTRIES = 100;
const isMxc = (key: string): boolean => key.startsWith('mxc://');

/**
 * `app.prinny.recent_emoji`: the picker's Recent list as Prinny keeps it, most recently used
 * first, holding unicode emoji (base form, no skin tone) AND custom emoji (by mxc URL).
 *
 * The shared `m.recent_emoji` list is unicode only, by spec and in every client that reads it,
 * so custom emoji cannot go there; and our Recent group is ordered by last use, which a
 * separate custom-only list could not interleave. Unicode picks still go to the shared list
 * too, for other clients.
 */
type PickerRecentEntry = { key: string; total: number };

const parsePickerRecents = (content: { recent?: unknown } | undefined): PickerRecentEntry[] => {
  const recent = content?.recent;
  if (!Array.isArray(recent)) return [];
  return recent.filter(
    (entry): entry is PickerRecentEntry =>
      typeof entry?.key === 'string' && typeof entry?.total === 'number',
  );
};

const readPickerRecents = (mx: MatrixClient): PickerRecentEntry[] =>
  parsePickerRecents(
    getAccountData(mx, AccountDataEvent.PrinnyRecentEmoji)?.getContent<{ recent?: unknown }>(),
  );

/** Record a pick: a unicode emoji (possibly toned) or a custom emoji's mxc URL. */
export const recordPickerRecent = (mx: MatrixClient, keyOrUnicode: string): void => {
  let key = keyOrUnicode;
  if (!isMxc(keyOrUnicode)) {
    addRecentEmoji(mx, keyOrUnicode);
    key = findEmojiByUnicode(keyOrUnicode)?.unicode ?? keyOrUnicode;
  }

  const recent = readPickerRecents(mx);
  const index = recent.findIndex((entry) => entry.key === key);
  const previous = index >= 0 ? recent.splice(index, 1)[0] : undefined;
  recent.unshift({ key, total: (previous?.total ?? 0) + 1 });
  mx.setAccountData(AccountDataEvent.PrinnyRecentEmoji, {
    recent: recent.slice(0, MAX_ENTRIES),
  }).catch((err) => console.warn('Failed to save recent emoji', err));
};

/**
 * The Recent group: Prinny's own list resolved (custom emoji whose pack is no longer available
 * are skipped), then unicode emoji used in other clients that are not in it yet.
 */
export const mergePickerRecents = (
  ownContent: { recent?: unknown } | undefined,
  sharedRecents: IEmoji[],
  customImages: PackImageReader[],
  limit: number,
): Array<IEmoji | PackImageReader> => {
  const byUrl = new Map<string, PackImageReader>();
  customImages.forEach((image) => {
    if (!byUrl.has(image.url)) byUrl.set(image.url, image);
  });

  const items: Array<IEmoji | PackImageReader> = [];
  const seen = new Set<IEmoji | PackImageReader>();
  const push = (item: IEmoji | PackImageReader | undefined) => {
    if (!item || seen.has(item) || items.length >= limit) return;
    seen.add(item);
    items.push(item);
  };

  parsePickerRecents(ownContent).forEach(({ key }) =>
    push(isMxc(key) ? byUrl.get(key) : findEmojiByUnicode(key)),
  );
  sharedRecents.forEach(push);
  return items;
};

export const resolvePickerRecents = (
  mx: MatrixClient,
  customImages: PackImageReader[],
  limit: number,
): Array<IEmoji | PackImageReader> =>
  mergePickerRecents(
    getAccountData(mx, AccountDataEvent.PrinnyRecentEmoji)?.getContent<{ recent?: unknown }>(),
    getRecentEmojis(mx),
    customImages,
    limit,
  );
