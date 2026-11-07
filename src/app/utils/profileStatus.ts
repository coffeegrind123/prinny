/**
 * MSC4426 user status (open; Element Web and X ship it) and the MSC4532
 * persistent presence override (open; palpo implements it).
 *
 *   profile field m.status / org.matrix.msc4426.status   { text, emoji }
 *     both required; text ≤ 256 bytes, emoji ≤ 32 bytes
 *   profile field m.call / org.matrix.msc4426.call       { call_joined_ts? }  (seconds)
 *
 *   account data org.continuwuity.presence_v2.msc4532.presence.persistent
 *     { state_override?: active|idle|busy|offline, status?: { msg? } }
 *
 * A status in a profile field can be read by anyone who can look up the
 * profile, room or no room, and is not hidden by being invisible. That is why
 * publishing it is opt-in (state/ownPresence.ts); reading others' is not.
 *
 * We write only the unstable status key. Servers check `m.*` profile keys
 * against the spec's list (see `M_TIMEZONE` in types/matrix/profile.ts), so
 * `m.status` would be refused until the MSC is merged; it is read first all
 * the same, for the day it is.
 */

export const M_STATUS = 'm.status';
export const MSC4426_STATUS = 'org.matrix.msc4426.status';
export const M_CALL = 'm.call';
export const MSC4426_CALL = 'org.matrix.msc4426.call';

export const STATUS_PROFILE_FIELDS = [M_STATUS, MSC4426_STATUS, M_CALL, MSC4426_CALL];

export const STATUS_TEXT_MAX_BYTES = 256;
export const STATUS_EMOJI_MAX_BYTES = 32;

/**
 * Element drops a status whose emoji is empty, so one is always sent. Used
 * when the user has not picked any (and for migrating a plain status_msg).
 */
export const DEFAULT_STATUS_EMOJI = '💬';

export type ProfileStatus = {
  text: string;
  emoji: string;
};

type Content = Record<string, unknown>;

const isRecord = (value: unknown): value is Content =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const utf8 = new TextEncoder();
const byteLength = (value: string): number => utf8.encode(value).length;

/**
 * One status field, as another user wrote it. Both fields must be strings
 * within the MSC's limits; a status with nothing in either is no status.
 */
export const parseProfileStatus = (value: unknown): ProfileStatus | undefined => {
  if (!isRecord(value)) return undefined;
  const { text, emoji } = value;
  if (typeof text !== 'string' || typeof emoji !== 'string') return undefined;
  if (byteLength(text) > STATUS_TEXT_MAX_BYTES || byteLength(emoji) > STATUS_EMOJI_MAX_BYTES) {
    return undefined;
  }
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const cleanEmoji = emoji.trim();
  if (!cleanText && !cleanEmoji) return undefined;
  return { text: cleanText, emoji: cleanEmoji };
};

/** The status in a profile: stable key first. */
export const getProfileStatus = (profile: Content): ProfileStatus | undefined =>
  parseProfileStatus(profile[M_STATUS]) ?? parseProfileStatus(profile[MSC4426_STATUS]);

/** Whether a (possibly partial) profile update says anything about the status or call. */
export const touchesProfileStatus = (update: Content): boolean =>
  M_STATUS in update || MSC4426_STATUS in update || M_CALL in update || MSC4426_CALL in update;

/** When the user joined the call they are in, in ms, or undefined when not in one. */
export const getProfileCallJoinedMs = (profile: Content): number | undefined => {
  const call = isRecord(profile[M_CALL]) ? profile[M_CALL] : profile[MSC4426_CALL];
  if (!isRecord(call)) return undefined;
  const ts = call.call_joined_ts;
  return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts * 1000 : undefined;
};

/**
 * "In a call · 12 min", shown only when there is no status: MSC4426 says
 * m.status takes precedence when both are set.
 */
export const formatCallStatus = (joinedMs: number, now: number = Date.now()): string => {
  const minutes = Math.floor((now - joinedMs) / 60000);
  if (minutes < 1) return '📞 In a call';
  if (minutes < 60) return `📞 In a call · ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `📞 In a call · ${hours} h ${minutes % 60} min`;
};

/** The one line to show for a profile: its status, else its call, else nothing. */
export const profileStatusLine = (profile: Content, now?: number): string | undefined => {
  const status = getProfileStatus(profile);
  if (status) return formatProfileStatus(status);
  const joined = getProfileCallJoinedMs(profile);
  return joined !== undefined ? formatCallStatus(joined, now) : undefined;
};

/** "🌴 On holiday", for places that show the status as one string. */
export const formatProfileStatus = (status: ProfileStatus): string =>
  [status.emoji, status.text].filter(Boolean).join(' ');

// The project's TS lib predates Intl.Segmenter; every engine we ship on has it.
type GraphemeSegmenter = new (
  locale: undefined,
  options: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string }> };

const graphemes = (value: string): string[] => {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), (s) => s.segment);
  }
  return Array.from(value);
};

const EMOJI_GRAPHEME = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u;

/** Cuts `value` to at most `maxBytes` UTF-8 bytes without splitting a character. */
export const truncateBytes = (value: string, maxBytes: number): string => {
  let out = '';
  for (const g of graphemes(value)) {
    if (byteLength(out + g) > maxBytes) break;
    out += g;
  }
  return out;
};

/**
 * Splits "🌴 On holiday" into its emoji and text, for `/status`. A leading
 * emoji counts only when a space or the end follows it, so "🙂ok" stays text.
 */
export const splitLeadingEmoji = (input: string): { emoji?: string; text: string } => {
  const trimmed = input.trim();
  const [first, ...rest] = graphemes(trimmed);
  if (!first || !EMOJI_GRAPHEME.test(first)) return { text: trimmed };
  const remainder = rest.join('');
  if (remainder !== '' && !/^\s/.test(remainder)) return { text: trimmed };
  return { emoji: first, text: remainder.trim() };
};

/**
 * The `{ text, emoji }` we publish: trimmed, cut to the MSC's byte limits, and
 * always with an emoji. Undefined when there is no text, which means "clear".
 */
export const buildProfileStatus = (
  text: string,
  emoji: string | undefined,
): ProfileStatus | undefined => {
  const cleanText = truncateBytes(text.replace(/\s+/g, ' ').trim(), STATUS_TEXT_MAX_BYTES).trim();
  if (!cleanText) return undefined;
  const chosen = emoji?.trim() ? truncateBytes(emoji.trim(), STATUS_EMOJI_MAX_BYTES) : '';
  return { text: cleanText, emoji: chosen || DEFAULT_STATUS_EMOJI };
};

/** MSC4532 */
export const MSC4532_FEATURE = 'org.continuwuity.presence_v2.msc4532';
export const MSC4532_PERSISTENT = 'org.continuwuity.presence_v2.msc4532.presence.persistent';

export enum PresenceChoice {
  Online = 'online',
  Away = 'unavailable',
  Invisible = 'offline',
}

const OVERRIDE_FOR: Record<PresenceChoice, string | undefined> = {
  // Online is no override: let the server work it out from activity.
  [PresenceChoice.Online]: undefined,
  [PresenceChoice.Away]: 'idle',
  [PresenceChoice.Invisible]: 'offline',
};

/**
 * The persistent-presence content after a user-made change. Keys we do not
 * own (a `busy` set elsewhere is replaced only when the user picks a presence
 * here; unknown `status` keys always survive) are carried over.
 *
 * Pass `presence` only when the user picked one, and `statusMsg` only when the
 * user changed the message: the MSC forbids touching either on our own.
 */
export const persistentPresenceContent = (
  current: unknown,
  change: { presence?: PresenceChoice; statusMsg?: string },
): Content => {
  const next: Content = isRecord(current) ? { ...current } : {};

  if (change.presence !== undefined) {
    const override = OVERRIDE_FOR[change.presence];
    if (override) {
      next.state_override = override;
    } else {
      delete next.state_override;
    }
  }

  if (change.statusMsg !== undefined) {
    const status: Content = isRecord(next.status) ? { ...next.status } : {};
    const msg = change.statusMsg.trim();
    if (msg) {
      status.msg = msg;
    } else {
      delete status.msg;
    }
    next.status = status;
  }

  return next;
};
