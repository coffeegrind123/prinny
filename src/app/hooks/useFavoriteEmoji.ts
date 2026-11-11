import { useMemo } from 'react';
import { favoriteEmojisFromContent, FavoriteEmojiContent } from '../plugins/favorite-emoji';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { IEmoji } from '../plugins/emoji';
import { useAccountData } from './useAccountData';

/** The favourite emoji, following the account data as any client changes it. */
export const useFavoriteEmoji = (): IEmoji[] => {
  const event = useAccountData(AccountDataEvent.PrinnyEmojiFavorites);
  return useMemo(
    () => favoriteEmojisFromContent(event?.getContent<FavoriteEmojiContent>()),
    [event],
  );
};
