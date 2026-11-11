import { MatrixClient } from 'matrix-js-sdk';
import { getAccountData } from '../utils/room';
import { IEmoji, findEmojiByUnicode } from './emoji';
import { AccountDataEvent } from '../../types/matrix/accountData';

/** `app.prinny.emoji_favorites`: base (tone-free) unicode strings, newest first. */
export type FavoriteEmojiContent = {
  favorites?: unknown;
};

const favoriteUnicodes = (content: FavoriteEmojiContent | undefined): string[] => {
  if (!Array.isArray(content?.favorites)) return [];
  const seen = new Set<string>();
  return content.favorites.filter((u): u is string => {
    if (typeof u !== 'string' || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
};

const readFavoriteUnicodes = (mx: MatrixClient): string[] =>
  favoriteUnicodes(
    getAccountData(mx, AccountDataEvent.PrinnyEmojiFavorites)?.getContent<FavoriteEmojiContent>(),
  );

/** Favourites that are known emoji, in stored order; anything else is skipped. */
export const favoriteEmojisFromContent = (content: FavoriteEmojiContent | undefined): IEmoji[] => {
  const seen = new Set<IEmoji>();
  return favoriteUnicodes(content).reduce<IEmoji[]>((list, unicode) => {
    const emoji = findEmojiByUnicode(unicode);
    if (emoji && !seen.has(emoji)) {
      seen.add(emoji);
      list.push(emoji);
    }
    return list;
  }, []);
};

export const getFavoriteEmojis = (mx: MatrixClient): IEmoji[] =>
  favoriteEmojisFromContent(
    getAccountData(mx, AccountDataEvent.PrinnyEmojiFavorites)?.getContent<FavoriteEmojiContent>(),
  );

// setAccountData resolves after the sync echo; toggles run one after another so a quick second
// toggle reads the first one's result instead of overwriting it.
let toggleQueue: Promise<unknown> = Promise.resolve();

/**
 * Add the emoji to the favourites, or remove it. The picker hands over what it shows, which may
 * carry the reader's skin tone; the base emoji is what is stored, so the tone setting applies.
 */
export const toggleFavoriteEmoji = (mx: MatrixClient, unicode: string): Promise<unknown> => {
  const run = toggleQueue
    .catch(() => undefined)
    .then(() => {
      const emoji = findEmojiByUnicode(unicode);
      if (!emoji) return undefined;
      const current = readFavoriteUnicodes(mx).filter((u) => findEmojiByUnicode(u) !== emoji);
      const removing = current.length < readFavoriteUnicodes(mx).length;
      const next = removing ? current : [emoji.unicode, ...current];
      return mx.setAccountData(AccountDataEvent.PrinnyEmojiFavorites, { favorites: next });
    });
  toggleQueue = run;
  return run;
};
