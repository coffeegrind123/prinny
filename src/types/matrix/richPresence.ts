export const MSC4320_RPC = 'com.ip-logger.msc4320.rpc';
export const MSC4320_RPC_MEDIA = 'com.ip-logger.msc4320.rpc.media';
export const MSC4320_RPC_ACTIVITY = 'com.ip-logger.msc4320.rpc.activity';

export const M_RPC = 'm.rpc';
export const M_RPC_MEDIA = 'm.rpc.media';
export const M_RPC_ACTIVITY = 'm.rpc.activity';

export const RICH_PRESENCE_PROFILE_FIELDS = [MSC4320_RPC, M_RPC];

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

export type RichPresence = MediaRichPresence | ActivityRichPresence;

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

  if (value.type === MSC4320_RPC_MEDIA || value.type === M_RPC_MEDIA) {
    const artist = optionalString(value.artist);
    const album = optionalString(value.album);
    const track = optionalString(value.track);
    if (!artist || !track) return undefined;

    return {
      type: 'media',
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
