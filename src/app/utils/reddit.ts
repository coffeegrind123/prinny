import { ProviderContentError, retryEmbed } from './embedFetch';
import { isTauri } from './desktop-notifications';

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
 * So the request is made by the shell's `fetch_reddit_post` command
 * (`src-tauri/src/reddit.rs`), off the webview where CORS does not apply, and
 * this embed exists in the desktop and Android apps only. On the web build
 * every Reddit link keeps the homeserver's ordinary preview.
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
  /** Which route answered: the embed page, or the `.json` listing. */
  source: 'embed' | 'json';
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
 * Rejects outside the shell rather than resolving null: on the web build there
 * is no route to Reddit at all, and the card treats a rejection as "fall
 * through to the homeserver's preview", which is the right answer there.
 */
export function fetchRedditPost(target: RedditTarget): Promise<RedditPost> {
  if (!isTauri()) {
    return Promise.reject(new ProviderContentError(ENDPOINT, 'needs the desktop or mobile app'));
  }
  const key = targetKey(target);
  const cached = cache.get(key);
  if (cached && (cached.expiresAt === undefined || Date.now() < cached.expiresAt)) {
    return cached.pending;
  }

  const entry: CacheEntry = {
    pending: retryEmbed(ENDPOINT, key, () => resolveViaShell(target)),
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
