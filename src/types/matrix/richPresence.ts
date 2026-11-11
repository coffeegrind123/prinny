export const MSC4320_RPC = 'com.ip-logger.msc4320.rpc';
export const MSC4320_RPC_MEDIA = 'com.ip-logger.msc4320.rpc.media';
export const MSC4320_RPC_ACTIVITY = 'com.ip-logger.msc4320.rpc.activity';

export const M_RPC = 'm.rpc';
export const M_RPC_MEDIA = 'm.rpc.media';
export const M_RPC_ACTIVITY = 'm.rpc.activity';

/**
 * MSC4544 (Extera, Zam): the same idea as a profile-field ARRAY of up to four
 * entries, each with its own absolute `expiry`. Its stable name is also
 * `m.rpc`; an array there is MSC4544 and an object is MSC4320, which is why
 * the MSC4320 parser rejects arrays. Extera writes the unstable prefix into
 * the entry types too (`xyz.extera.msc4544.rpc.activity`), Zam reads both.
 */
export const MSC4544_RPC = 'xyz.extera.msc4544.rpc';
export const MSC4544_RPC_ACTIVITY = `${MSC4544_RPC}.activity`;
export const MSC4544_RPC_MUSIC = `${MSC4544_RPC}.music`;
const M_RPC_MUSIC = 'm.rpc.music';
/** MSC4544: at most this many entries are stored at once. */
export const MSC4544_MAX_ENTRIES = 4;

export const RICH_PRESENCE_PROFILE_FIELDS = [MSC4320_RPC, M_RPC, MSC4544_RPC];

/**
 * Extension field inside the rich presence object: absolute Unix ms after
 * which the activity is stale. MSC4320 has no expiry, so a publisher that
 * crashed or lost its connection left "Playing ..." up forever. The publisher
 * refreshes it while it runs; readers hide the activity once it has passed.
 */
export const RICH_PRESENCE_EXPIRES_AT = 'app.prinny.expires_at';
// The meow fork publishes the same object with its own expiry key; honouring
// it hides their stale activity too.
export const MEOW_RICH_PRESENCE_EXPIRES_AT = 'de.mreow.pinniped.expires_at';
// Where that fork publishes it since it moved to its new namespace; read only.
const PINNIPED_RICH_PRESENCE_EXPIRES_AT = 'club.stablecat.pinniped.expires_at';
export const RICH_PRESENCE_TTL = 5 * 60 * 1000;
// The expiry is set by the publisher's clock and checked against ours, so
// allow for clocks that disagree before calling an activity stale.
export const RICH_PRESENCE_EXPIRY_GRACE = 2 * 60 * 1000;

export type RichPresenceProgress = {
  length: number;
  complete?: number;
  timeComplete?: number;
};

export type MediaRichPresence = {
  type: 'media';
  /** Always set by MSC4320; optional in MSC4544. */
  artist?: string;
  album?: string;
  track: string;
  progress?: RichPresenceProgress;
  coverArt?: string;
  player?: string;
  streamingLink?: string;
};

export type ActivityRichPresence = {
  type: 'activity';
  name: string;
  image?: string;
  details?: string;
};

/** MSC4544: placeholder in a button URL, replaced with the URL-encoded OpenID response. */
export const MSC4544_OPENID_PLACEHOLDER = '{openid_data}';
/** MSC4544: an entry carries at most this many buttons. */
export const MSC4544_MAX_BUTTONS = 3;
const BUTTON_LABEL_MAX_LENGTH = 64;

/** An MSC4544 button: a link the viewer may follow, always after confirming. */
export type RichPresenceButton = {
  label: string;
  /** http(s) only. May contain `{openid_data}` when `requestOpenId` is set. */
  url: string;
  /** The viewer's homeserver issues an OpenID token that goes into the URL. */
  requestOpenId: boolean;
};

export type RichPresence = (MediaRichPresence | ActivityRichPresence) & {
  /** Publisher-clock ms after which the activity is stale; absent when it never expires. */
  expiresAt?: number;
  /** MSC4544 only. */
  buttons?: RichPresenceButton[];
};

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/**
 * MSC4544 `buttons`: at most three, each with a label and an http(s) URL.
 * Anything else (other schemes, missing fields) is dropped, not repaired. The
 * placeholder is only meaningful with `request_openid`; without it, it stays
 * in the URL as literal text, as the MSC defines no other substitution.
 */
export const parseMsc4544Buttons = (value: unknown): RichPresenceButton[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const buttons: RichPresenceButton[] = [];
  value.slice(0, MSC4544_MAX_BUTTONS).forEach((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
    const { label, url } = raw as Record<string, unknown>;
    if (typeof label !== 'string' || label.trim() === '') return;
    if (typeof url !== 'string') return;
    const requestOpenId = (raw as Record<string, unknown>).request_openid === true;
    // The scheme is checked with the placeholder filled, since a URL that is
    // only valid after substitution would still end up opened.
    if (!isHttpUrl(url.split(MSC4544_OPENID_PLACEHOLDER).join('x'))) return;
    buttons.push({ label: label.trim().slice(0, BUTTON_LABEL_MAX_LENGTH), url, requestOpenId });
  });
  return buttons.length > 0 ? buttons : undefined;
};

/** A button URL with the OpenID response put in, as MSC4544 specifies. */
export const resolveButtonUrl = (url: string, openIdResponse?: object): string =>
  openIdResponse
    ? url.split(MSC4544_OPENID_PLACEHOLDER).join(encodeURIComponent(JSON.stringify(openIdResponse)))
    : url;

export const isRichPresenceExpired = (expiresAt: number | undefined, now = Date.now()): boolean =>
  expiresAt !== undefined && now > expiresAt + RICH_PRESENCE_EXPIRY_GRACE;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const parseProgress = (value: unknown): RichPresenceProgress | undefined => {
  if (!isRecord(value)) return undefined;

  const length = optionalNumber(value.length);
  if (length === undefined || length === 0) return undefined;

  const complete = optionalNumber(value.complete);
  const timeComplete = optionalNumber(value.time_complete);
  if (complete === undefined && timeComplete === undefined) return undefined;

  return { length, complete, timeComplete };
};

export const parseRichPresence = (value: unknown): RichPresence | undefined => {
  if (!isRecord(value)) return undefined;
  const expiresAt =
    optionalNumber(value[RICH_PRESENCE_EXPIRES_AT]) ??
    optionalNumber(value[PINNIPED_RICH_PRESENCE_EXPIRES_AT]) ??
    optionalNumber(value[MEOW_RICH_PRESENCE_EXPIRES_AT]);
  if (isRichPresenceExpired(expiresAt)) return undefined;

  if (value.type === MSC4320_RPC_MEDIA || value.type === M_RPC_MEDIA) {
    const artist = optionalString(value.artist);
    const album = optionalString(value.album);
    const track = optionalString(value.track);
    if (!artist || !track) return undefined;

    return {
      type: 'media',
      expiresAt,
      artist,
      album,
      track,
      progress: parseProgress(value.progress),
      coverArt: optionalString(value.cover_art),
      player: optionalString(value.player),
      streamingLink: optionalString(value.streaming_link),
    };
  }

  if (value.type === MSC4320_RPC_ACTIVITY || value.type === M_RPC_ACTIVITY) {
    const name = optionalString(value.name);
    if (!name) return undefined;

    return {
      type: 'activity',
      expiresAt,
      name,
      image: optionalString(value.image),
      details: optionalString(value.details),
    };
  }

  return undefined;
};

/**
 * One MSC4544 entry in our model. Entries past their `expiry` MUST NOT be
 * shown (the reader then refetches; useUserRichPresence schedules it from
 * `expiresAt`). Buttons are not taken over: the MSC requires a prompt showing
 * the full URL before following one, and the link dialog shows the host only.
 */
const parseMsc4544Entry = (value: unknown, now: number): RichPresence | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  const expiresAt = optionalNumber(value.expiry);
  if (expiresAt === undefined || isRichPresenceExpired(expiresAt, now)) return undefined;
  const buttons = parseMsc4544Buttons(value.buttons);

  if (value.type === MSC4544_RPC_MUSIC || value.type === M_RPC_MUSIC) {
    const track = optionalString(value.track);
    if (!track) return undefined;
    let progress: RichPresenceProgress | undefined;
    if (isRecord(value.progress)) {
      const since = optionalNumber(value.progress.since);
      const until = optionalNumber(value.progress.until);
      if (since !== undefined && until !== undefined && until > since) {
        // Our model: length in seconds, end time in ms (as MSC4320 writes it).
        progress = { length: Math.round((until - since) / 1000), timeComplete: until };
      }
    }
    return {
      type: 'media',
      expiresAt,
      track,
      artist: optionalString(value.artist),
      album: optionalString(value.album),
      player: optionalString(value.player_name),
      coverArt: optionalString(value.cover_url),
      progress,
      ...(buttons ? { buttons } : {}),
    };
  }

  if (value.type === MSC4544_RPC_ACTIVITY || value.type === M_RPC_ACTIVITY) {
    const name = optionalString(value.name);
    if (!name) return undefined;
    const details = [optionalString(value.details), optionalString(value.state)]
      .filter((part): part is string => !!part && part !== name)
      .join(' · ');
    return {
      type: 'activity',
      expiresAt,
      name,
      image: optionalString(value.large_icon_url),
      details: details || undefined,
      ...(buttons ? { buttons } : {}),
    };
  }

  return undefined;
};

/** The first displayable entry of an MSC4544 array (it is ordered by the sender). */
export const parseMsc4544RichPresence = (
  value: unknown,
  now = Date.now(),
): RichPresence | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value.slice(0, MSC4544_MAX_ENTRIES)) {
    const parsed = parseMsc4544Entry(entry, now);
    if (parsed) return parsed;
  }
  return undefined;
};

export const getProfileRichPresence = (
  profile: Record<string, unknown>,
): RichPresence | undefined =>
  parseRichPresence(profile[MSC4320_RPC]) ??
  parseMsc4544RichPresence(profile[MSC4544_RPC]) ??
  // Stable `m.rpc`: an object is MSC4320, an array MSC4544.
  parseRichPresence(profile[M_RPC]) ??
  parseMsc4544RichPresence(profile[M_RPC]);
