// Maps a Discord `SET_ACTIVITY` payload — as captured by the desktop RPC
// bridge, see `src-tauri/src/rich_presence.rs` in the prinny-client repo — to an
// MSC4320 rich-presence profile field value. Pure and side-effect-free so it
// can be unit-tested, and so the Rust side never has to understand the schema:
// it forwards the activity object verbatim and this decides what it means.
import {
  MSC4320_RPC_ACTIVITY,
  MSC4320_RPC_MEDIA,
  MSC4544_RPC_ACTIVITY,
  MSC4544_RPC_MUSIC,
} from '../../types/matrix/richPresence';

/**
 * A Discord RPC activity, as sent by a client over the local pipe. Every field
 * is optional because it is another application's payload, not ours — a client
 * that omits `name` or invents a `type` must not be able to throw here.
 */
export type DiscordRichPresenceActivity = {
  type?: number;
  name?: string;
  details?: string;
  state?: string;
  application_id?: string;
  timestamps?: { start?: number; end?: number };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
};

export type MediaPayload = {
  type: typeof MSC4320_RPC_MEDIA;
  artist: string;
  track: string;
  album?: string;
  progress?: { length: number; time_complete: number };
  cover_art?: string;
  player?: string;
};
export type ActivityPayload =
  | MediaPayload
  | {
      type: typeof MSC4320_RPC_ACTIVITY;
      name: string;
      details?: string;
      image?: string;
    };

export type MappedActivity = { payload: ActivityPayload; coverUrl?: string };

// Discord timestamps arrive as seconds (10 digits) or ms (13). Normalise to ms.
const toMs = (ts: number | undefined): number | undefined => {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return undefined;
  return ts > 1e12 ? ts : ts * 1000;
};

// Only resolve http(s) image URLs; Discord also uses bare asset keys, which are
// not fetchable. SSRF protection is the homeserver's job — the URL goes to its
// preview_url endpoint, never to a fetch from here.
const httpUrl = (v: string | undefined): string | undefined => {
  if (!v) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Discord activity type 2 = Listening -> `m.rpc.media` (track = details,
 * artist = state, playback window -> live progress). Everything else ->
 * `m.rpc.activity`. The cover image URL comes back separately so the caller can
 * resolve it to an MXC through the homeserver rather than downloading it here.
 */
export const mapDiscordActivity = (activity: DiscordRichPresenceActivity): MappedActivity => {
  const track = activity.details;
  const artist = activity.state;
  if (activity.type === 2 && track && artist) {
    const startMs = toMs(activity.timestamps?.start);
    const endMs = toMs(activity.timestamps?.end);
    const progress =
      startMs && endMs && endMs > startMs
        ? { length: Math.round((endMs - startMs) / 1000), time_complete: endMs }
        : undefined;
    return {
      payload: {
        type: MSC4320_RPC_MEDIA,
        artist,
        track,
        album: activity.assets?.large_text || undefined,
        progress,
        player: activity.name || undefined,
      },
      coverUrl: httpUrl(activity.assets?.large_image),
    };
  }
  const name = activity.name || activity.details || 'Discord';
  const secondary = [activity.details, activity.state].filter(
    (v): v is string => !!v && v !== name,
  );
  const details = Array.from(new Set(secondary)).join(' · ') || undefined;
  return {
    payload: { type: MSC4320_RPC_ACTIVITY, name, details },
    coverUrl: httpUrl(activity.assets?.large_image),
  };
};

export const isMediaPayload = (p: ActivityPayload): p is MediaPayload =>
  p.type === MSC4320_RPC_MEDIA;

// Merge a resolved image MXC into a payload: cover_art for media, image for
// activity. The reader renders both via mxcUrlToHttp.
export const withCoverArt = (p: ActivityPayload, mxc: string): ActivityPayload => {
  if (isMediaPayload(p)) return { ...p, cover_art: mxc };
  return { ...p, image: mxc };
};

export const sameActivityPayload = (
  a: ActivityPayload | null,
  b: ActivityPayload | null,
): boolean => {
  if (a === null || b === null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
};

/**
 * What identifies "the same activity" across updates, so its MSC4544 entry
 * keeps one `id` while a track's progress or a game's details change, and
 * gets a new one when the track or game does.
 */
export const activityIdentity = (p: ActivityPayload): string =>
  isMediaPayload(p) ? `music\0${p.track}\0${p.artist}` : `activity\0${p.name}`;

/**
 * The same activity as one MSC4544 entry (unstable names, as Extera writes
 * them). `expiry` is absolute ms. Field mapping: `player` → `player_name`,
 * `cover_art` → `cover_url`, `image` → `large_icon_url`, and our progress
 * (length in s, end in ms) → absolute `since`/`until`.
 */
export const toMsc4544Entry = (
  p: ActivityPayload,
  id: string,
  expiry: number,
): Record<string, unknown> => {
  if (isMediaPayload(p)) {
    const entry: Record<string, unknown> = { id, type: MSC4544_RPC_MUSIC, expiry, track: p.track };
    if (p.artist) entry.artist = p.artist;
    if (p.album) entry.album = p.album;
    if (p.player) entry.player_name = p.player;
    if (p.cover_art) entry.cover_url = p.cover_art;
    if (p.progress) {
      const until = p.progress.time_complete;
      entry.progress = { since: until - p.progress.length * 1000, until };
    }
    return entry;
  }
  const entry: Record<string, unknown> = { id, type: MSC4544_RPC_ACTIVITY, expiry, name: p.name };
  if (p.details) entry.details = p.details;
  if (p.image) entry.large_icon_url = p.image;
  return entry;
};
