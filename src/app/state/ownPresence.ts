import { MatrixClient, SetPresence } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getAccountData } from '../utils/room';
import { useAccountData } from '../hooks/useAccountData';
import { Presence, useUserPresence } from '../hooks/useUserPresence';
import {
  MSC4426_STATUS,
  MSC4532_FEATURE,
  MSC4532_PERSISTENT,
  PresenceChoice,
  buildProfileStatus,
  formatProfileStatus,
  persistentPresenceContent,
} from '../utils/profileStatus';

export type OwnPresenceContent = {
  /** The status message the user last saved, kept across presence changes. */
  status?: string;
  /** The emoji saved with it (MSC4426 requires one when it is published). */
  emoji?: string;
  /** The presence picked in the profile menu; absent means online. */
  presence?: Presence;
  /**
   * Opt-in: also publish the status as the MSC4426 profile field. Off by
   * default, because a profile field can be read by anyone, including people
   * who share no room, and stays visible while invisible (so it is removed
   * for as long as the user is invisible). Kept in account data so every
   * device follows the same choice.
   */
  share_status?: boolean;
};

const PRESENCE_VALUES: readonly string[] = Object.values(Presence);

const parseContent = (content: unknown): OwnPresenceContent => {
  if (typeof content !== 'object' || content === null) {
    return {};
  }
  const { status, emoji, presence, share_status: shareStatus } = content as Record<string, unknown>;
  return {
    status: typeof status === 'string' ? status : undefined,
    emoji: typeof emoji === 'string' ? emoji : undefined,
    share_status: shareStatus === true ? true : undefined,
    presence:
      typeof presence === 'string' && PRESENCE_VALUES.includes(presence)
        ? (presence as Presence)
        : undefined,
  };
};

const getContent = (mx: MatrixClient): OwnPresenceContent =>
  parseContent(getAccountData(mx, AccountDataEvent.PrinnyPresence)?.getContent());

// PUT /presence replaces the whole presence state, and servers drop status_msg
// when presence goes offline or is set without one. So the user's message is
// kept in account data and re-sent with every presence change.
export const getRememberedStatus = (mx: MatrixClient): string => getContent(mx).status ?? '';

export const sendPresence = (
  mx: MatrixClient,
  presence: Presence,
  statusMsg: string = getRememberedStatus(mx),
): Promise<void> => mx.setPresence({ presence, status_msg: statusMsg });

const SYNC_PRESENCE: Record<Presence, SetPresence | undefined> = {
  // Left unset, /sync marks the user online, which is what online wants.
  [Presence.Online]: undefined,
  [Presence.Unavailable]: SetPresence.Unavailable,
  [Presence.Offline]: SetPresence.Offline,
};

/**
 * Sets the user's presence so that it sticks. A PUT /presence on its own is
 * undone by the next /sync, which (with no `set_presence`) tells the server
 * the user is online again; so the sync loop is switched to send the same
 * state from now on.
 */
export const applyOwnPresence = (mx: MatrixClient, presence: Presence): Promise<void> => {
  mx.setSyncPresence(SYNC_PRESENCE[presence]);
  return sendPresence(mx, presence);
};

/**
 * Puts the status on the profile (MSC4426) or takes it off, per the opt-in,
 * the message and the presence: invisible takes it off, because a profile
 * field would keep saying "I'm here" to everyone. Never throws; a server
 * without extended profiles answers "unsupported", which the settings show.
 */
export type ProfileStatusResult = 'published' | 'removed' | 'skipped' | 'unsupported' | 'failed';

const isUnsupportedProfileWrite = (err: unknown): boolean => {
  const { httpStatus, errcode } = (err ?? {}) as { httpStatus?: number; errcode?: string };
  return httpStatus === 404 || httpStatus === 405 || errcode === 'M_UNRECOGNIZED';
};

/**
 * Whether the homeserver says it has profile fields (MSC4133). matrix-js-sdk
 * refuses a profile-field write itself when it does not, with a plain Error
 * and no status code, so without asking first a server like Conduit read as
 * "could not update" instead of "not supported".
 */
const supportsProfileFields = async (mx: MatrixClient): Promise<boolean> => {
  try {
    return await mx.doesServerSupportExtendedProfiles();
  } catch {
    // /versions could not be read: let the write itself decide
    return true;
  }
};

export const publishProfileStatus = async (
  mx: MatrixClient,
  content: OwnPresenceContent,
  presence: Presence,
): Promise<ProfileStatusResult> => {
  if (!content.share_status) return 'skipped';
  if (!(await supportsProfileFields(mx))) return 'unsupported';
  const status = buildProfileStatus(content.status ?? '', content.emoji);
  try {
    if (status && presence !== Presence.Offline) {
      await mx.setExtendedProfileProperty(MSC4426_STATUS, status);
      return 'published';
    }
    await mx.deleteExtendedProfileProperty(MSC4426_STATUS);
    return 'removed';
  } catch (err) {
    if (isUnsupportedProfileWrite(err)) return 'unsupported';
    console.warn('[status] could not update the profile status', err);
    return 'failed';
  }
};

/**
 * MSC4532 persistent presence, on servers that advertise it. Called only for
 * changes the user made: the MSC forbids clients from touching it otherwise,
 * so the idle detector and the startup restore never come through here.
 */
const writePersistentPresence = async (
  mx: MatrixClient,
  change: { presence?: Presence; statusMsg?: string },
): Promise<void> => {
  try {
    if (!(await mx.doesServerSupportUnstableFeature(MSC4532_FEATURE))) return;
    const current = getAccountData(mx, MSC4532_PERSISTENT as never)?.getContent();
    const next = persistentPresenceContent(current, {
      presence: change.presence as unknown as PresenceChoice | undefined,
      statusMsg: change.statusMsg,
    });
    await mx.setAccountData(MSC4532_PERSISTENT as never, next as never);
  } catch (err) {
    console.warn('[presence] could not write the MSC4532 persistent presence', err);
  }
};

/** Stores the status message (and emoji) and applies it everywhere it goes. */
export const saveStatusMessage = async (
  mx: MatrixClient,
  presence: Presence,
  status: string,
  emoji?: string,
): Promise<void> => {
  const content: OwnPresenceContent = { ...getContent(mx), status };
  if (emoji !== undefined) content.emoji = emoji;
  await mx.setAccountData(AccountDataEvent.PrinnyPresence, content);
  await sendPresence(mx, presence, status);
  await publishProfileStatus(mx, content, presence);
  await writePersistentPresence(mx, { statusMsg: status });
};

/** Re-applies the profile status for `presence` from what is saved. */
export const republishProfileStatus = (
  mx: MatrixClient,
  presence: Presence,
): Promise<ProfileStatusResult> => publishProfileStatus(mx, getContent(mx), presence);

/** Turns publishing the status on the profile on or off. */
export const setShareStatus = async (
  mx: MatrixClient,
  share: boolean,
  presence: Presence,
): Promise<ProfileStatusResult> => {
  const content: OwnPresenceContent = { ...getContent(mx) };
  if (share) {
    content.share_status = true;
  } else {
    delete content.share_status;
  }
  await mx.setAccountData(AccountDataEvent.PrinnyPresence, content);
  if (share) return publishProfileStatus(mx, content, presence);
  // Turning it off takes the field down; publishProfileStatus would skip.
  if (!(await supportsProfileFields(mx))) return 'unsupported';
  try {
    await mx.deleteExtendedProfileProperty(MSC4426_STATUS);
    return 'removed';
  } catch (err) {
    return isUnsupportedProfileWrite(err) ? 'unsupported' : 'failed';
  }
};

export const getChosenPresence = (mx: MatrixClient): Presence =>
  getContent(mx).presence ?? Presence.Online;

/**
 * Applies a presence picked by the user and remembers it for the next start.
 *
 * Each step runs whatever happened to the one before. A refused presence
 * update (a 429 is common when the picker is used twice quickly) used to
 * abort the rest, so going invisible left a shared status on the public
 * profile and the choice was forgotten. The first failure is still reported.
 */
export const saveChosenPresence = async (mx: MatrixClient, presence: Presence): Promise<void> => {
  const content: OwnPresenceContent = { ...getContent(mx), presence };
  const results = await Promise.allSettled([
    applyOwnPresence(mx, presence),
    mx.setAccountData(AccountDataEvent.PrinnyPresence, content),
    publishProfileStatus(mx, content, presence),
    writePersistentPresence(mx, { presence }),
  ]);
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
};

export const useShareStatus = (): boolean => {
  const event = useAccountData(AccountDataEvent.PrinnyPresence);
  return parseContent(event?.getContent()).share_status === true;
};

export const useChosenPresence = (): Presence => {
  const event = useAccountData(AccountDataEvent.PrinnyPresence);
  return parseContent(event?.getContent()).presence ?? Presence.Online;
};

/** The user's own status: what the server reports, else the remembered message. */
export const useOwnStatus = (userId: string): string => {
  const presence = useUserPresence(userId);
  const event = useAccountData(AccountDataEvent.PrinnyPresence);
  return presence?.status?.trim() || parseContent(event?.getContent()).status?.trim() || '';
};

/** The emoji saved with the user's status, if any. */
export const useOwnStatusEmoji = (): string | undefined => {
  const event = useAccountData(AccountDataEvent.PrinnyPresence);
  return parseContent(event?.getContent()).emoji;
};

/** The user's status as one line, emoji first. */
export const useOwnStatusLine = (userId: string): string => {
  const text = useOwnStatus(userId);
  const emoji = useOwnStatusEmoji();
  return text ? formatProfileStatus({ text, emoji: emoji ?? '' }) : '';
};
