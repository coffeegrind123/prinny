import { useCallback, useMemo } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { IImageInfo } from '../../types/matrix/common';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getAccountData } from '../utils/room';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useAccountData } from '../hooks/useAccountData';

/**
 * A mashup this account has already uploaded.
 *
 * The list is two things at once, and both matter:
 *
 * - **A recent list**, newest first, so the picker can offer what you actually
 *   use instead of 147,000 equal choices.
 * - **An upload cache.** Every mashup costs a fetch from Google and an upload
 *   to the homeserver, and a fresh `mxc://` for one already sent would
 *   fragment its reactions. Keyed by `shortcode`, which is derived from the
 *   two halves and so is the same string on every device and for every user.
 *
 * It lives in account data rather than localStorage so it follows the account
 * to a second device, the same way GIF favourites do.
 */
export type StoredMashup = {
  shortcode: string;
  /** Codepoints of the two halves, in the order the shortcode names them. */
  left: string;
  right: string;
  mxc: string;
  body: string;
  info?: IImageInfo;
  usedAt: number;
};

export type EmojiMashupsContent = {
  mashups?: StoredMashup[];
};

/**
 * Past this many the account data event starts to get heavy for something
 * nobody scrolls to the bottom of. An evicted entry costs one re-upload of a
 * few KB, never a broken mashup.
 */
const MAX_STORED = 64;

const parseStoredMashup = (item: unknown): StoredMashup | undefined => {
  if (typeof item !== 'object' || item === null) return undefined;
  const entry = item as Partial<StoredMashup> & { face?: string; mouth?: string };
  // `face`/`mouth` are what the previous engine wrote, when a mashup was one
  // emoji's head wearing another's mouth. Emoji Kitchen has no such split, but
  // an entry written before the switch is still a perfectly good uploaded
  // emoji and keeps working — it is only the two halves that are now read
  // under different names.
  const left = entry.left ?? entry.face;
  const right = entry.right ?? entry.mouth;
  if (
    typeof entry.shortcode !== 'string' ||
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    typeof entry.mxc !== 'string' ||
    !entry.mxc.startsWith('mxc://')
  ) {
    return undefined;
  }
  return {
    shortcode: entry.shortcode,
    left,
    right,
    mxc: entry.mxc,
    body: typeof entry.body === 'string' ? entry.body : entry.shortcode,
    info: typeof entry.info === 'object' && entry.info !== null ? entry.info : undefined,
    usedAt: typeof entry.usedAt === 'number' ? entry.usedAt : 0,
  };
};

const parseMashups = (list: unknown): StoredMashup[] => {
  if (!Array.isArray(list)) return [];
  return list.map(parseStoredMashup).filter((item): item is StoredMashup => item !== undefined);
};

export const getStoredMashups = (mx: MatrixClient): StoredMashup[] => {
  const content = getAccountData(
    mx,
    AccountDataEvent.PrinnyEmojiMashups,
  )?.getContent<EmojiMashupsContent>();
  return parseMashups(content?.mashups);
};

export const findStoredMashup = (mx: MatrixClient, shortcode: string): StoredMashup | undefined =>
  getStoredMashups(mx).find((item) => item.shortcode === shortcode);

/**
 * Records a mashup as used, moving an existing entry to the front rather than
 * duplicating it — the shortcode identifies it, not the upload.
 */
export const rememberMashup = (
  mx: MatrixClient,
  mashup: Omit<StoredMashup, 'usedAt'>,
): Promise<unknown> => {
  const current = getStoredMashups(mx).filter((item) => item.shortcode !== mashup.shortcode);
  const next = [{ ...mashup, usedAt: Date.now() }, ...current].slice(0, MAX_STORED);
  return mx.setAccountData(AccountDataEvent.PrinnyEmojiMashups, { mashups: next });
};

export const forgetMashup = (mx: MatrixClient, shortcode: string): Promise<unknown> => {
  const next = getStoredMashups(mx).filter((item) => item.shortcode !== shortcode);
  return mx.setAccountData(AccountDataEvent.PrinnyEmojiMashups, { mashups: next });
};

/**
 * Reactively returns this account's mashups, newest first, updating when the
 * `app.prinny.emoji_mashups` account data event changes.
 */
export const useStoredMashups = (): StoredMashup[] => {
  const event = useAccountData(AccountDataEvent.PrinnyEmojiMashups);
  return useMemo(() => parseMashups(event?.getContent<EmojiMashupsContent>().mashups), [event]);
};

export const useForgetMashup = (): ((shortcode: string) => void) => {
  const mx = useMatrixClient();
  return useCallback(
    (shortcode: string) => {
      forgetMashup(mx, shortcode);
    },
    [mx],
  );
};
