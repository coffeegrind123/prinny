export const MSC4320_RPC = 'com.ip-logger.msc4320.rpc';
export const MSC4320_RPC_MEDIA = 'com.ip-logger.msc4320.rpc.media';
export const MSC4320_RPC_ACTIVITY = 'com.ip-logger.msc4320.rpc.activity';

export const M_RPC = 'm.rpc';
export const M_RPC_MEDIA = 'm.rpc.media';
export const M_RPC_ACTIVITY = 'm.rpc.activity';

export const RICH_PRESENCE_PROFILE_FIELDS = [MSC4320_RPC, M_RPC];

/**
 * Extension field inside the rich presence object: absolute Unix ms after
 * which the activity is stale. MSC4320 has no expiry, so a publisher that
 * crashed or lost its connection left "Playing ..." up forever. The publisher
 * refreshes it while it runs; readers hide the activity once it has passed.
 */
export const RICH_PRESENCE_EXPIRES_AT = 'app.prinny.expires_at';
// The meow fork publishes the same object with its own expiry key; honouring
// it hides their stale activity too.
const MEOW_RICH_PRESENCE_EXPIRES_AT = 'de.mreow.pinniped.expires_at';
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
  artist: string;
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

export type RichPresence = (MediaRichPresence | ActivityRichPresence) & {
  /** Publisher-clock ms after which the activity is stale; absent when it never expires. */
  expiresAt?: number;
};

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

export const getProfileRichPresence = (
  profile: Record<string, unknown>,
): RichPresence | undefined =>
  parseRichPresence(profile[MSC4320_RPC]) ?? parseRichPresence(profile[M_RPC]);
