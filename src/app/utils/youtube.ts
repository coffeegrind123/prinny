/**
 * Hosts that serve a watch page. `youtube-nocookie.com` only ever serves
 * `/embed/`, but it is the origin a copied embed URL carries, and the id in it
 * is the same id.
 */
const WATCH_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** The link-shortener host. Its whole path is the video id. */
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

/**
 * Path prefixes that carry the id as the next segment.
 *
 * `/shorts/` is the one that matters in practice — a short shared from the
 * mobile app is the most common YouTube link there is, and it used to fall
 * through to the generic preview card because only `/watch?v=` was recognised.
 * A short is an ordinary video: `/embed/<id>` plays it, and Piped serves it
 * from the same `/streams/<id>`, so nothing downstream needs to know which
 * form the link arrived in.
 */
const ID_PATH_PREFIXES = ['shorts', 'live', 'embed', 'v'];

/** Ids are `[A-Za-z0-9_-]`; anything else is a channel, a playlist or junk. */
const VIDEO_ID = /^[\w-]+$/;

const asVideoId = (value: string | null | undefined): string | null =>
  value && VIDEO_ID.test(value) ? value : null;

/**
 * The video id in a YouTube URL, or null when there isn't one.
 *
 * Parsed rather than pattern-matched so the id survives the query strings real
 * links carry — `?si=`, `?t=42`, `?app=desktop&v=<id>`, `&feature=share` — in
 * whatever order the sharing app happened to emit them.
 */
export function getYoutubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (SHORT_HOSTS.has(host)) {
    return segments.length === 1 ? asVideoId(segments[0]) : null;
  }

  if (!WATCH_HOSTS.has(host)) return null;

  if (segments[0] === 'watch') return asVideoId(parsed.searchParams.get('v'));

  if (segments.length === 2 && ID_PATH_PREFIXES.includes(segments[0])) {
    return asVideoId(segments[1]);
  }

  return null;
}

export function isYoutubeUrl(url: string): boolean {
  return getYoutubeVideoId(url) !== null;
}
