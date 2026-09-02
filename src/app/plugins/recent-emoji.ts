import { MatrixClient } from 'matrix-js-sdk';
import { getAccountData } from '../utils/room';
import { IEmoji, emojis } from './emoji';
import { AccountDataEvent } from '../../types/matrix/accountData';

type EmojiUnicode = string;
type EmojiUsageCount = number;

/**
 * `io.element.recent_emoji` — Element's pre-spec key. A list of
 * `[unicode, count]` tuples.
 */
export type IRecentEmojiContent = {
  recent_emoji?: [EmojiUnicode, EmojiUsageCount][];
};

/**
 * `m.recent_emoji` — MSC4356, stable since **Matrix 1.18**.
 *
 * The shape is NOT the same as Element's: the spec uses a list of
 * `{ emoji, total }` objects where the legacy key used positional tuples. Both
 * carry the same information, so the two are kept in sync rather than migrated
 * — see `addRecentEmoji`.
 */
export type RecentEmojiEntry = {
  emoji: EmojiUnicode;
  total: EmojiUsageCount;
};

export type MRecentEmojiContent = {
  recent_emoji?: RecentEmojiEntry[];
};

/**
 * The recent list in spec order — most recently used first.
 *
 * Reads the stable key when present and falls back to Element's. The stable key
 * wins outright rather than the two being merged: they are two views of one
 * list, and merging counts would double them every time both were written.
 */
const readRecentEmoji = (mx: MatrixClient): RecentEmojiEntry[] => {
  const stable = getAccountData(mx, AccountDataEvent.RecentEmoji)?.getContent<MRecentEmojiContent>()
    .recent_emoji;
  if (Array.isArray(stable)) {
    return stable.filter(
      (entry): entry is RecentEmojiEntry =>
        typeof entry?.emoji === 'string' && typeof entry?.total === 'number',
    );
  }

  const legacy = getAccountData(
    mx,
    AccountDataEvent.ElementRecentEmoji,
  )?.getContent<IRecentEmojiContent>().recent_emoji;
  if (!Array.isArray(legacy)) return [];

  return legacy
    .filter(
      (entry): entry is [EmojiUnicode, EmojiUsageCount] =>
        Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number',
    )
    .map(([emoji, total]) => ({ emoji, total }));
};

export const getRecentEmojis = (mx: MatrixClient, limit?: number): IEmoji[] =>
  // Stored order IS the answer: MSC4356 defines the list as "ordered
  // descendingly by last usage time", which is what `addRecentEmoji` maintains
  // by moving the used emoji to the front. This used to `.sort()` by usage
  // count instead, which both contradicted the storage order (making a
  // list labelled "Recent" show most-used) and sorted the account-data event's
  // own content array in place, because `getContent()` is not a copy.
  readRecentEmoji(mx)
    .slice(0, limit)
    .reduce<IEmoji[]>((list, { emoji: unicode }) => {
      const emoji = emojis.find((e) => e.unicode === unicode);
      if (emoji) list.push(emoji);
      return list;
    }, []);

export function addRecentEmoji(mx: MatrixClient, unicode: string) {
  const recentEmoji = readRecentEmoji(mx);

  const emojiIndex = recentEmoji.findIndex((entry) => entry.emoji === unicode);
  let entry: RecentEmojiEntry;
  if (emojiIndex < 0) {
    entry = { emoji: unicode, total: 1 };
  } else {
    [entry] = recentEmoji.splice(emojiIndex, 1);
    entry = { emoji: entry.emoji, total: entry.total + 1 };
  }
  recentEmoji.unshift(entry);
  const capped = recentEmoji.slice(0, 100);

  // Both keys are written, not just the stable one. Element — still the client
  // most Prinny users also run — reads `io.element.recent_emoji` and nothing
  // else, so writing only `m.recent_emoji` would silently freeze their recent
  // list there. Dropping the legacy write is safe once Element adopts MSC4356.
  mx.setAccountData(AccountDataEvent.RecentEmoji, { recent_emoji: capped });
  mx.setAccountData(AccountDataEvent.ElementRecentEmoji, {
    recent_emoji: capped.map(({ emoji, total }): [EmojiUnicode, EmojiUsageCount] => [emoji, total]),
  });
}
