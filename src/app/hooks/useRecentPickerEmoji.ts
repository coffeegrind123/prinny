import { useMemo } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { IEmoji } from '../plugins/emoji';
import { PackImageReader } from '../plugins/custom-emoji';
import { mergePickerRecents } from '../plugins/recent-picker-emoji';
import { useAccountData } from './useAccountData';
import { useRecentEmoji } from './useRecentEmoji';

/** The emoji board's Recent group: unicode and custom emoji, most recently used first. */
export const useRecentPickerEmoji = (
  mx: MatrixClient,
  customImages: PackImageReader[],
  limit: number,
): Array<IEmoji | PackImageReader> => {
  const ownEvent = useAccountData(AccountDataEvent.PrinnyRecentEmoji);
  // The shared unicode list, as other clients write it (follows both of its keys).
  const shared = useRecentEmoji(mx, limit);
  return useMemo(
    () =>
      mergePickerRecents(ownEvent?.getContent<{ recent?: unknown }>(), shared, customImages, limit),
    [ownEvent, shared, customImages, limit],
  );
};
