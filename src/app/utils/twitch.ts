/**
 * Twitch links as an embedded player.
 *
 * A Twitch link's homeserver preview is the channel's avatar as a large
 * og:image and a line of text, which reads as a big empty card. Twitch's own
 * player shows the stream, VOD or clip instead.
 *
 * The iframe src is built here from parsed, constrained parts only (a login,
 * a numeric VOD id or a clip slug), never from the message text, in the same
 * spirit as the YouTube embed.
 *
 * Twitch refuses to play unless `parent` names the hostname of the page that
 * embeds the player: `prinny.app` on the web, `localhost` in the desktop app
 * (http://localhost:44548), and whatever a self-hoster serves from.
 */

export type TwitchTarget =
  | { kind: 'channel'; channel: string }
  | { kind: 'video'; id: string }
  | { kind: 'clip'; slug: string };

const SITE_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'go.twitch.tv']);
const CLIP_HOSTS = new Set(['clips.twitch.tv', 'm.clips.twitch.tv']);
const PLAYER_HOST = 'player.twitch.tv';

/** Twitch logins: letters, digits and underscore, at most 25. */
const LOGIN = /^[A-Za-z0-9_]{1,25}$/;
const VIDEO_ID = /^\d{1,20}$/;
const CLIP_SLUG = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * First path segments that are Twitch pages, not channels. A link to
 * `twitch.tv/directory` must not become a player for a channel named
 * "directory".
 */
const RESERVED = new Set([
  'directory',
  'downloads',
  'drops',
  'friends',
  'inventory',
  'jobs',
  'login',
  'logout',
  'messages',
  'moderator',
  'p',
  'payments',
  'popout',
  'prime',
  'search',
  'settings',
  'signup',
  'store',
  'subscriptions',
  'team',
  'turbo',
  'u',
  'user',
  'videos',
  'wallet',
]);

const login = (value: string | undefined): string | null =>
  value && LOGIN.test(value) && !RESERVED.has(value.toLowerCase()) ? value.toLowerCase() : null;

/** What a Twitch URL points at, or null when it is not a stream, VOD or clip. */
export const getTwitchTarget = (raw: string): TwitchTarget | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (CLIP_HOSTS.has(host)) {
    // clips.twitch.tv/<slug>, and the embed form clips.twitch.tv/embed?clip=<slug>
    const slug = parts[0] === 'embed' ? url.searchParams.get('clip') : parts[0];
    return slug && CLIP_SLUG.test(slug) && parts.length <= 1 ? { kind: 'clip', slug } : null;
  }

  if (host === PLAYER_HOST) {
    const video = url.searchParams.get('video')?.replace(/^v/, '');
    if (video && VIDEO_ID.test(video)) return { kind: 'video', id: video };
    const channel = login(url.searchParams.get('channel') ?? undefined);
    return channel ? { kind: 'channel', channel } : null;
  }

  if (!SITE_HOSTS.has(host)) return null;

  // twitch.tv/videos/<id>
  if (parts[0] === 'videos' && parts.length === 2 && VIDEO_ID.test(parts[1])) {
    return { kind: 'video', id: parts[1] };
  }
  const channel = login(parts[0]);
  if (!channel) return null;
  // twitch.tv/<channel>/clip/<slug>
  if (parts[1] === 'clip' && parts.length === 3 && CLIP_SLUG.test(parts[2])) {
    return { kind: 'clip', slug: parts[2] };
  }
  // twitch.tv/<channel>/v/<id>, the old VOD form
  if (parts[1] === 'v' && parts.length === 3 && VIDEO_ID.test(parts[2])) {
    return { kind: 'video', id: parts[2] };
  }
  // twitch.tv/<channel>; other channel pages (about, schedule) are not streams
  return parts.length === 1 ? { kind: 'channel', channel } : null;
};

/**
 * The player URL for a target, embedded from `parentHost`. Never autoplays:
 * the frame loads for everyone who reads the message.
 */
export const twitchEmbedUrl = (target: TwitchTarget, parentHost: string): string => {
  const params = new URLSearchParams();
  if (target.kind === 'clip') {
    params.set('clip', target.slug);
  } else if (target.kind === 'video') {
    params.set('video', target.id);
  } else {
    params.set('channel', target.channel);
  }
  params.set('parent', parentHost);
  params.set('autoplay', 'false');
  const base =
    target.kind === 'clip' ? 'https://clips.twitch.tv/embed' : 'https://player.twitch.tv/';
  return `${base}?${params.toString()}`;
};
