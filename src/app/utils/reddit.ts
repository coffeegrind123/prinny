import type { MatrixClient } from 'matrix-js-sdk';
import { ProviderContentError, retryEmbed } from './embedFetch';
import { isTauri } from './desktop-notifications';
import { mxcUrlToHttp } from './matrix';

/**
 * Reddit post client — the fourth provider whose post links this client
 * renders inline, alongside Twitter, Bluesky and Rule34 (see `socialEmbed.ts`).
 *
 * Unlike those three, the page cannot talk to Reddit itself. Measured on
 * 03.10.2026, from a residential connection, in curl and in a real Chromium:
 *
 *  - The well-known `reddit.com/….json` endpoint answers a logged-out client
 *    with 403 "You've been blocked by network security", and the post page
 *    itself serves a "Prove your humanity" challenge.
 *  - `embed.reddit.com/r/{sub}/comments/{id}/` — the page Reddit's own embed
 *    widget frames — serves the post's media, but neither it nor `/oembed`
 *    sends an `Access-Control-Allow-Origin` header, so an in-page `fetch`
 *    can never read it.
 *
 * So inside the shell the request is made by the `fetch_reddit_post` command
 * (`src-tauri/src/reddit.rs`), off the webview where CORS does not apply.
 *
 * The web build has no such command and reads the post from vxreddit.com
 * instead — see "The web build" below for the two ways it gets there.
 *
 * The media needs no such help: `v.redd.it` sends
 * `access-control-allow-origin: *`, and the image and MP4 hosts serve a
 * cross-origin `Referer`, so every URL here goes straight into an element.
 */

/** Names this provider in the shared retry layer's log line. */
const ENDPOINT = 'reddit post';

/**
 * Hosts whose post paths name a Reddit post. The two fixer domains mirror
 * what `fxtwitter`/`vxtwitter` are to X, and people paste them for the same
 * reason; the path shape is Reddit's own.
 */
const REDDIT_HOSTS: ReadonlySet<string> = new Set([
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'np.reddit.com',
  'm.reddit.com',
  'i.reddit.com',
  'sh.reddit.com',
  'rxddit.com',
  'www.rxddit.com',
  'old.rxddit.com',
  'vxreddit.com',
  'www.vxreddit.com',
]);

/** `redd.it/{id}` — Reddit's own short link. */
const SHORT_HOST = 'redd.it';

/** What `fetch_reddit_post` takes. Mirrors `RedditTarget` in reddit.rs. */
export type RedditTarget =
  | { kind: 'post'; id: string; subreddit?: string }
  | { kind: 'share'; subreddit: string; token: string };

// The same bounds the shell enforces. Checked here too so a malformed link is
// rejected without an IPC round trip, and so nothing unvalidated is ever
// interpolated into a cache key or a log line.
const POST_ID_REG = /^[a-z0-9]{1,12}$/;
const SUBREDDIT_REG = /^[A-Za-z0-9_-]{2,32}$/;
const SHARE_TOKEN_REG = /^[A-Za-z0-9]{1,32}$/;

/**
 * The post a Reddit link names, or null.
 *
 * Parsed with `new URL` for the reason `getRule34PostId` and `getHnItemId`
 * are: a regex over the whole string accepts
 * `https://evil.example/reddit.com/r/x/comments/abc` as readily as the real
 * thing. Accepted shapes:
 *
 *   /r/{sub}/comments/{id}[/{slug}[/{comment}]]   a post, or a comment on it
 *   /user/{name}/comments/{id}                    a profile post (sub u_{name})
 *   /comments/{id}, /gallery/{id}, redd.it/{id}   no subreddit named
 *   /r/{sub}/s/{token}                            the app's share link
 *
 * A comment permalink resolves to its post: the media being linked is the
 * post's either way.
 */
export function getRedditTarget(url: string): RedditTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.replace(/\.$/, '').toLowerCase();
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);

  const post = (id: string | undefined, subreddit?: string): RedditTarget | null => {
    const lowered = id?.toLowerCase();
    if (!lowered || !POST_ID_REG.test(lowered)) return null;
    if (subreddit !== undefined && !SUBREDDIT_REG.test(subreddit)) return null;
    return subreddit === undefined
      ? { kind: 'post', id: lowered }
      : { kind: 'post', id: lowered, subreddit };
  };

  if (host === SHORT_HOST) {
    return segments.length === 1 ? post(segments[0]) : null;
  }
  if (!REDDIT_HOSTS.has(host)) return null;

  const [first, second, third, fourth] = segments;
  if (first === 'r' && third === 'comments') return post(fourth, second);
  if (first === 'r' && third === 's') {
    if (!second || !SUBREDDIT_REG.test(second)) return null;
    if (!fourth || !SHARE_TOKEN_REG.test(fourth) || segments.length > 4) return null;
    return { kind: 'share', subreddit: second, token: fourth };
  }
  if ((first === 'user' || first === 'u') && third === 'comments' && second) {
    return post(fourth, `u_${second}`);
  }
  if (first === 'comments' || first === 'gallery') return post(second);
  return null;
}

const targetKey = (target: RedditTarget): string =>
  target.kind === 'post' ? `post:${target.id}` : `share:${target.subreddit}/${target.token}`;

/**
 * How one piece of media is drawn. The four need mutually exclusive treatment:
 *
 *  - `image` — a still;
 *  - `gif` — an animated image file, drawn by an `<img>` (which animates with
 *    no autoplay policy attached);
 *  - `clip` — a silent looping MP4 standing in for a GIF;
 *  - `video` — a real video, usually with sound: controls, no autoplay.
 */
export type RedditMediaKind = 'image' | 'gif' | 'clip' | 'video';

export type RedditVideoSource = { url: string; width?: number; height?: number };

export type RedditMedia = {
  kind: RedditMediaKind;
  /**
   * The file to show. For a video, the best muxed MP4 when Reddit made one —
   * a plain `<video src>` with sound and seeking — else the HLS playlist.
   */
  url: string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  /**
   * The video's unsigned HLS playlist. The MP4s are signed for a few hours;
   * this does not expire, so the card falls back to it when an MP4 fails.
   */
  hlsUrl?: string;
  /** Muxed MP4 renditions, smallest first. */
  sources: RedditVideoSource[];
  durationSecs?: number;
  caption?: string;
  /**
   * The homeserver's copy of the file, when it arrived through the
   * homeserver's URL preview. `url` is then an authenticated-media URL, which
   * an element can load (the service worker signs it) but the remote-media
   * download path cannot, so a download goes by this instead.
   */
  mxcUrl?: string;
  /** Known only for that copy, whose URL carries no extension to infer one from. */
  mimeType?: string;
};

/**
 * One post, every field already validated.
 *
 * Validated again here although the shell checked it, for the reason
 * `parseRule34Post` validates at the boundary: every value reaches a `src`,
 * an `href` or rendered text, and the shell's checks are a different
 * repository's promise.
 */
export type RedditPost = {
  id: string;
  subreddit: string;
  title?: string;
  author?: string;
  score?: number;
  commentCount?: number;
  nsfw: boolean;
  /** Epoch milliseconds. */
  createdAt?: number;
  permalink: string;
  media: RedditMedia[];
  /** When the earliest signed media URL stops working, epoch milliseconds. */
  expiresAt?: number;
  /**
   * Which route answered: inside the shell, the embed page or the `.json`
   * listing; on the web, vxreddit read by the page itself or by the homeserver.
   */
  source: 'embed' | 'json' | 'vxreddit' | 'homeserver';
};

/** True for an https URL on a `redd.it` host — the only media this embed shows. */
export const isRedditMediaUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/\.$/, '').toLowerCase();
    return host === 'redd.it' || host.endsWith('.redd.it');
  } catch {
    return false;
  }
};

const isPermalink = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'www.reddit.com';
  } catch {
    return false;
  }
};

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const integer = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;

const MEDIA_KINDS: ReadonlySet<string> = new Set(['image', 'gif', 'clip', 'video']);

const parseMedia = (raw: unknown): RedditMedia | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.kind !== 'string' || !MEDIA_KINDS.has(m.kind)) return null;
  if (!isRedditMediaUrl(m.url)) return null;
  const sources = Array.isArray(m.sources)
    ? m.sources.flatMap((s): RedditVideoSource[] => {
        const src = s as Record<string, unknown> | null;
        if (!src || !isRedditMediaUrl(src.url)) return [];
        return [{ url: src.url, width: positive(src.width), height: positive(src.height) }];
      })
    : [];
  return {
    kind: m.kind as RedditMediaKind,
    url: m.url,
    width: positive(m.width),
    height: positive(m.height),
    thumbnailUrl: isRedditMediaUrl(m.thumbnailUrl) ? m.thumbnailUrl : undefined,
    hlsUrl: isRedditMediaUrl(m.hlsUrl) ? m.hlsUrl : undefined,
    sources,
    durationSecs: positive(m.durationSecs),
    caption: text(m.caption, 300),
  };
};

/** A raw `fetch_reddit_post` answer as a validated post, or null. */
export const parseRedditPost = (raw: unknown): RedditPost | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !POST_ID_REG.test(p.id)) return null;
  if (typeof p.subreddit !== 'string' || !SUBREDDIT_REG.test(p.subreddit)) return null;
  if (!isPermalink(p.permalink)) return null;
  const media = Array.isArray(p.media)
    ? p.media.map(parseMedia).filter((m): m is RedditMedia => m !== null)
    : [];
  if (media.length === 0) return null;
  return {
    id: p.id,
    subreddit: p.subreddit,
    title: text(p.title, 300),
    author: typeof p.author === 'string' && SUBREDDIT_REG.test(p.author) ? p.author : undefined,
    score: integer(p.score),
    commentCount: integer(p.commentCount),
    nsfw: p.nsfw === true,
    createdAt: positive(p.createdAt),
    permalink: p.permalink,
    media,
    expiresAt: positive(p.expiresAt),
    source: p.source === 'json' ? 'json' : 'embed',
  };
};

/* -------------------------------------------------------------------------- */
/* The web build                                                               */
/* -------------------------------------------------------------------------- */

/**
 * vxreddit.com (github.com/dylanpdx/vxReddit) is the one public Reddit fixer
 * that still answers — rxddit.com now serves "Reddit blocked the request" for
 * every post. It sends `Access-Control-Allow-Origin`, but it serves the post's
 * meta tags only to a link-preview crawler: any User-Agent outside the
 * `crawler-user-agents` list's "social-preview" tag gets a 302 to reddit.com,
 * which a page cannot read. Measured 03.10.2026, so there are two routes:
 *
 *   browser lets a page set User-Agent (Firefox)       Chromium does not
 *   ──────────────────────────────────────────────     ───────────────────────
 *   page ── fetch, Discordbot UA ──► vxreddit          page ── preview_url ──►
 *        ◄── every og:image, og:video, CORS ──              homeserver ── UA
 *                                                           "Synapse (bot; …)"
 *                                                           ──► vxreddit
 *
 * "Synapse" is on that crawler list, so a Synapse homeserver's preview of the
 * vxreddit URL carries the post's media. What survives Synapse's parser:
 *
 *  - ONE image. Open Graph meta tags are folded into a dict, so of a gallery's
 *    repeated `og:image` the last one wins, and Synapse re-hosts it (`mxc://`).
 *  - `og:video` untouched: a silent video's direct `v.redd.it` MP4, or for one
 *    with sound vxreddit's `/redditvideo.mp4` muxer (a 307 to an AWS Lambda
 *    that takes ~12 s cold to answer).
 *  - `og:description` is NOT the post's text when vxreddit sent none — Synapse
 *    summarises the body ("Redirecting... or click here.") — so it is unread.
 *
 * Neither route reports NSFW or a post date.
 */
const VXREDDIT_ORIGIN = 'https://vxreddit.com';

/** A User-Agent vxreddit's crawler filter admits. */
const VXREDDIT_BOT_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';

/** What a vxreddit page says about a post, read from either route. */
type VxRedditImage = {
  url: string;
  thumbnailUrl?: string;
  mxcUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
};

export type VxRedditCard = {
  url?: string;
  title?: string;
  siteName?: string;
  /** In page order. For a video post the only one is its poster. */
  images: VxRedditImage[];
  videoUrl?: string;
  videoWidth?: number;
  videoHeight?: number;
};

/** The vxreddit page for a target; vxreddit takes Reddit's own path shapes. */
export const vxRedditUrl = (target: RedditTarget): string => {
  if (target.kind === 'share') {
    return `${VXREDDIT_ORIGIN}/r/${target.subreddit}/s/${target.token}`;
  }
  return target.subreddit
    ? `${VXREDDIT_ORIGIN}/r/${target.subreddit}/comments/${target.id}/`
    : `${VXREDDIT_ORIGIN}/comments/${target.id}/`;
};

let userAgentSettable: boolean | undefined;

/**
 * Whether this browser sends a `User-Agent` a page sets on a request.
 *
 * Read off a `Request` object, so it costs no network round trip: Chromium
 * drops the header from the `Request` (`headers.get` → null) while still
 * accepting it on a bare `Headers`, and Firefox keeps it.
 */
const canSetUserAgent = (): boolean => {
  if (userAgentSettable === undefined) {
    try {
      const probe = new Request(VXREDDIT_ORIGIN, { headers: { 'User-Agent': VXREDDIT_BOT_UA } });
      userAgentSettable = probe.headers.get('user-agent') === VXREDDIT_BOT_UA;
    } catch {
      userAgentSettable = false;
    }
  }
  return userAgentSettable;
};

/**
 * vxreddit's stats line, from `build_stats_line` in its utils.py:
 * `u/{author} on {r/sub | u/user} - ⬆️ {score}[ | 💬 {comments}]`.
 *
 * Doubles as the proof that vxreddit answered at all. A preview fetcher it does
 * not admit is redirected to reddit.com and comes back with Reddit's own
 * meta tags — site name "Reddit", a stock image — which must not be rendered
 * as the post.
 */
const STATS_LINE_REG =
  /^u\/(\S+) on (r|u)\/([A-Za-z0-9_-]{2,32}) - ⬆️ (-?\d+)(?: \| \u{1F4AC} (\d+))?$/u;

/** vxreddit's `og:url`: `https://www.reddit.com/comments/{id}[/_/{comment}]`. */
const VX_PERMALINK_REG = /^https:\/\/www\.reddit\.com\/comments\/([a-z0-9]{1,12})(?:\/|$)/;

/** What Synapse puts in a preview's `og:image` after re-hosting it. */
const MXC_REG = /^mxc:\/\/[A-Za-z0-9.:[\]-]+\/[A-Za-z0-9_-]+$/;

/** The re-hosted file's type as Synapse sniffed it. */
const IMAGE_MIME_REG = /^image\/[a-z0-9.+-]{1,40}$/;

/** A `v.redd.it` video id: the first path segment of every rendition. */
const VREDDIT_ID_REG = /^[a-z0-9]{6,20}$/;

/** vxreddit's title for a post with no media of its own (text and link posts). */
const VXREDDIT_PLACEHOLDER_TITLE = 'vxReddit';

const dimension = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value;
  return positive(n);
};

const isGifUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.gif');
  } catch {
    return false;
  }
};

/**
 * The `v.redd.it` id behind a vxreddit `og:video`, and whether it is a file a
 * `<video src>` can play as-is.
 *
 *   https://v.redd.it/{id}/CMAF_720.mp4?source=fallback      silent, direct
 *   https://vxreddit.com/redditvideo.mp4?video_url=          with sound, muxed
 *     https%3A%2F%2Fv.redd.it%2F{id}%2FCMAF_720.m3u8&audio_url=…
 */
const parseVxVideo = (raw: string): { id: string; directMp4?: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname === 'vxreddit.com' && parsed.pathname === '/redditvideo.mp4') {
    const inner = parsed.searchParams.get('video_url');
    const found = inner ? parseVxVideo(inner) : null;
    return found ? { id: found.id } : null;
  }
  if (parsed.hostname !== 'v.redd.it') return null;
  const [id, file] = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (!id || !VREDDIT_ID_REG.test(id)) return null;
  return file?.toLowerCase().endsWith('.mp4') ? { id, directMp4: raw } : { id };
};

/**
 * A vxreddit card as a post, or a `ProviderContentError` naming why not.
 *
 * Audio videos play from Reddit's unsigned HLS playlist rather than vxreddit's
 * muxed MP4: the playlist answers at once from Reddit's own CDN, where the
 * muxer is a cold Lambda that holds the first frame back by seconds and sees
 * every viewer's address. A silent video has a plain MP4 and keeps the
 * playlist as its fallback, as the shell's posts do.
 */
export const postFromVxRedditCard = (
  card: VxRedditCard,
  target: RedditTarget,
  source: 'vxreddit' | 'homeserver',
): RedditPost => {
  const stats = card.siteName ? STATS_LINE_REG.exec(card.siteName) : null;
  if (!stats) {
    throw new ProviderContentError(
      ENDPOINT,
      `invalid: not a vxreddit answer (site name ${JSON.stringify(card.siteName ?? null)})`,
    );
  }
  const [, author, prefix, name, score, comments] = stats;
  const subreddit = prefix === 'u' ? `u_${name}` : name;
  if (!SUBREDDIT_REG.test(subreddit)) {
    throw new ProviderContentError(ENDPOINT, 'invalid: subreddit out of range');
  }

  const idMatch = card.url ? VX_PERMALINK_REG.exec(card.url) : null;
  const id = idMatch?.[1] ?? (target.kind === 'post' ? target.id : undefined);
  if (!id || !POST_ID_REG.test(id)) {
    throw new ProviderContentError(ENDPOINT, 'invalid: no post id in the answer');
  }

  const title =
    card.title && card.title !== VXREDDIT_PLACEHOLDER_TITLE ? text(card.title, 300) : undefined;

  const media: RedditMedia[] = [];
  const video = card.videoUrl ? parseVxVideo(card.videoUrl) : null;
  if (video) {
    const hlsUrl = `https://v.redd.it/${video.id}/HLSPlaylist.m3u8`;
    const poster = card.images[0];
    media.push({
      kind: 'video',
      url: video.directMp4 ?? hlsUrl,
      width: card.videoWidth,
      height: card.videoHeight,
      thumbnailUrl: poster ? (poster.thumbnailUrl ?? poster.url) : undefined,
      hlsUrl,
      sources: [],
    });
  } else {
    card.images.forEach((image) => {
      const gif = image.mimeType === 'image/gif' || isGifUrl(image.url);
      media.push({
        kind: gif ? 'gif' : 'image',
        url: image.url,
        width: image.width,
        height: image.height,
        // A thumbnail is a still; an animated file has to be drawn whole.
        thumbnailUrl: gif ? undefined : image.thumbnailUrl,
        sources: [],
        mxcUrl: image.mxcUrl,
        mimeType: image.mimeType,
      });
    });
  }
  if (media.length === 0) {
    throw new ProviderContentError(ENDPOINT, 'nomedia: vxreddit found no image or video');
  }

  return {
    id,
    subreddit,
    title,
    author: SUBREDDIT_REG.test(author) ? author : undefined,
    score: integer(Number(score)),
    commentCount: comments === undefined ? undefined : integer(Number(comments)),
    nsfw: false,
    permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
    media,
    source,
  };
};

/**
 * A vxreddit page's meta tags as a card. Media URLs off a `redd.it` host are
 * dropped here, as `parseRedditPost` drops them from the shell's answer.
 */
export const parseVxRedditHtml = (html: string): VxRedditCard => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const values = (key: string): string[] =>
    Array.from(doc.querySelectorAll('meta'))
      .filter((m) => (m.getAttribute('property') ?? m.getAttribute('name')) === key)
      .map((m) => m.getAttribute('content') ?? '')
      .filter((v) => v.length > 0);
  const first = (key: string): string | undefined => values(key)[0];

  return {
    url: first('og:url'),
    title: first('og:title'),
    siteName: first('og:site_name'),
    images: values('og:image')
      .filter(isRedditMediaUrl)
      .map((url) => ({ url })),
    videoUrl: first('og:video'),
    videoWidth: dimension(first('og:video:width')),
    videoHeight: dimension(first('og:video:height')),
  };
};

/**
 * What the web build needs from the homeserver: its URL preview, and the http
 * form of what it re-hosted (full file, or a still `thumbnail`).
 */
export type RedditHomeserverRoute = {
  preview: (url: string) => Promise<Record<string, unknown>>;
  mediaUrl: (mxc: string, thumbnail: boolean) => string | undefined;
};

/** Width and height the card's inline still is scaled into; Reddit's own preview is 640px. */
const HOMESERVER_THUMBNAIL_PX = 640;

export const homeserverRoute = (
  mx: MatrixClient,
  useAuthentication: boolean,
): RedditHomeserverRoute => ({
  preview: async (url) => (await mx.getUrlPreview(url, Date.now())) as Record<string, unknown>,
  mediaUrl: (mxc, thumbnail) =>
    (thumbnail
      ? mxcUrlToHttp(
          mx,
          mxc,
          useAuthentication,
          HOMESERVER_THUMBNAIL_PX,
          HOMESERVER_THUMBNAIL_PX,
          'scale',
          false,
        )
      : mxcUrlToHttp(mx, mxc, useAuthentication)) ?? undefined,
});

/** A homeserver's preview of a vxreddit page as a card. */
export const vxRedditCardFromPreview = (
  og: Record<string, unknown>,
  route: Pick<RedditHomeserverRoute, 'mediaUrl'>,
): VxRedditCard => {
  const str = (key: string): string | undefined =>
    typeof og[key] === 'string' && og[key] !== '' ? (og[key] as string) : undefined;

  const images: VxRedditImage[] = [];
  const mxc = str('og:image');
  if (mxc && MXC_REG.test(mxc)) {
    const url = route.mediaUrl(mxc, false);
    if (url) {
      images.push({
        url,
        thumbnailUrl: route.mediaUrl(mxc, true),
        mxcUrl: mxc,
        width: dimension(og['og:image:width']),
        height: dimension(og['og:image:height']),
        mimeType: IMAGE_MIME_REG.test(str('og:image:type') ?? '')
          ? str('og:image:type')
          : undefined,
      });
    }
  }

  return {
    url: str('og:url'),
    title: str('og:title'),
    siteName: str('og:site_name'),
    images,
    videoUrl: str('og:video') ?? str('og:video:secure_url'),
    videoWidth: dimension(og['og:video:width']),
    videoHeight: dimension(og['og:video:height']),
  };
};

const resolveViaVxReddit = async (target: RedditTarget): Promise<RedditPost> => {
  const res = await fetch(vxRedditUrl(target), {
    headers: { 'User-Agent': VXREDDIT_BOT_UA },
    // vxreddit's answer to a UA it did not see is a redirect to reddit.com.
    // Not followed: the hop would hand the reader's address to Reddit for a
    // page CORS forbids reading anyway.
    redirect: 'manual',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (res.type === 'opaqueredirect') {
    // A plain Error, not a content verdict: the post may be fine, this browser
    // just did not send the User-Agent. The caller moves to the homeserver.
    throw new Error(`${ENDPOINT}: vxreddit redirected — the User-Agent was not sent`);
  }
  if (!res.ok) throw new Error(`${ENDPOINT}: vxreddit HTTP ${res.status}`);
  return postFromVxRedditCard(parseVxRedditHtml(await res.text()), target, 'vxreddit');
};

const resolveViaHomeserver = async (
  target: RedditTarget,
  route: RedditHomeserverRoute,
): Promise<RedditPost> => {
  const og = await route.preview(vxRedditUrl(target));
  try {
    return postFromVxRedditCard(vxRedditCardFromPreview(og, route), target, 'homeserver');
  } catch (err) {
    // The one failure that is the homeserver's to fix, not the post's: its
    // preview fetcher is not a User-Agent vxreddit serves (Synapse is; other
    // homeserver software may not be), so it previewed reddit.com instead.
    if (err instanceof ProviderContentError && err.message.includes('not a vxreddit answer')) {
      console.warn('[reddit] the homeserver preview of vxreddit is not vxreddit’s', {
        siteName: og['og:site_name'],
        url: og['og:url'],
      });
    }
    throw err;
  }
};

const resolveOnWeb = async (
  target: RedditTarget,
  route: RedditHomeserverRoute | undefined,
): Promise<RedditPost> => {
  let post: RedditPost | undefined;
  if (canSetUserAgent()) {
    try {
      post = await resolveViaVxReddit(target);
    } catch (err) {
      // vxreddit's own verdict on the post (deleted, no media) holds on every
      // route; only a transport failure is worth asking the homeserver about.
      if (err instanceof ProviderContentError || !route) throw err;
      console.warn('[reddit] vxreddit direct failed, asking the homeserver', String(err));
    }
  }
  if (!post) {
    if (!route) throw new ProviderContentError(ENDPOINT, 'no route to vxreddit');
    post = await resolveViaHomeserver(target, route);
  }
  console.debug('[reddit] resolved', {
    id: post.id,
    source: post.source,
    media: post.media.map((m) => m.kind),
  });
  return post;
};

/**
 * Error prefixes from `fetch_reddit_post` meaning "asking again cannot help":
 * deleted or missing post, a text or link post with no media, a target the
 * shell refused. Anything else — a timeout, a 5xx, the edge refusing a
 * request — is worth the shared retry policy.
 */
const FINAL_ERROR_PREFIXES = ['gone:', 'nomedia:', 'invalid:'];

/**
 * Margin before a signed URL's expiry at which a cached post is re-fetched,
 * so a card mounted just before the deadline still gets URLs that work.
 */
const EXPIRY_MARGIN_MS = 10 * 60 * 1000;

type CacheEntry = { pending: Promise<RedditPost>; expiresAt?: number };

/**
 * One in-flight-or-successful request per post.
 *
 * Not `sharedRequest`'s cache, which keeps a success for the whole session:
 * a Reddit video's MP4 URLs are signed for a few hours, so a post resolved
 * this morning is a set of dead links by the afternoon. An entry is kept until
 * its `expiresAt` (less a margin) and re-fetched after. Failures are dropped
 * at once, as everywhere else in this layer.
 */
const cache = new Map<string, CacheEntry>();

const resolveViaShell = async (target: RedditTarget): Promise<RedditPost> => {
  const { invoke } = await import('@tauri-apps/api/core');
  let raw: unknown;
  try {
    raw = await invoke('fetch_reddit_post', { target });
  } catch (err) {
    const message = String(err);
    if (FINAL_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
      throw new ProviderContentError(ENDPOINT, message);
    }
    throw new Error(`${ENDPOINT}: ${message}`, { cause: err });
  }
  const post = parseRedditPost(raw);
  if (!post) throw new ProviderContentError(ENDPOINT, 'answer carries no usable media');
  console.debug('[reddit] resolved', {
    id: post.id,
    source: post.source,
    media: post.media.map((m) => m.kind),
  });
  return post;
};

/**
 * One post, cached per the policy above and retried per `embedFetch`'s.
 *
 * Inside the shell this is `fetch_reddit_post`. On the web it is vxreddit,
 * read directly where the browser allows it and through `homeserver`
 * otherwise; with neither, it rejects, which the card reads as "fall through
 * to the homeserver's preview of the Reddit link itself".
 */
export function fetchRedditPost(
  target: RedditTarget,
  homeserver?: RedditHomeserverRoute,
): Promise<RedditPost> {
  const inShell = isTauri();
  if (!inShell && !homeserver && !canSetUserAgent()) {
    return Promise.reject(new ProviderContentError(ENDPOINT, 'no route to vxreddit'));
  }
  const key = targetKey(target);
  const cached = cache.get(key);
  if (cached && (cached.expiresAt === undefined || Date.now() < cached.expiresAt)) {
    return cached.pending;
  }

  const entry: CacheEntry = {
    pending: retryEmbed(ENDPOINT, key, () =>
      inShell ? resolveViaShell(target) : resolveOnWeb(target, homeserver),
    ),
  };
  entry.pending.then(
    (post) => {
      if (post.expiresAt !== undefined) entry.expiresAt = post.expiresAt - EXPIRY_MARGIN_MS;
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  cache.set(key, entry);
  return entry.pending;
}
