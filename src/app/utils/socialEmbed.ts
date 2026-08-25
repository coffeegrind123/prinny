import { isTwitterGifUrl, parseTenorGif, isAnimatedImageUrl } from './animatedMedia';
import { isWebUrl } from './safeUrl';

/**
 * Recognising and fetching the social posts this client renders inline.
 *
 * Two callers need exactly the same answers and used to have separate copies
 * of half of them: `UrlPreviewCard`, which renders one post as a card, and the
 * room media scan, which has to know which links in a room's history carry
 * pictures. The parsers, the endpoints and the "which of these fields is the
 * media" reading of each API's response live here so the card and the gallery
 * cannot disagree about what a link contains.
 *
 * Everything here is a *rich post* embed — a message whose link is a Twitter or
 * Bluesky post, and whose pictures are the author's own. Homeserver `og:image`
 * link previews are deliberately not in scope: a site's meta-card image is
 * furniture (a logo, a stock hero, an article's header) that nobody sent and
 * nobody goes looking for later, so folding those into a room's gallery would
 * bury the actual photos under them.
 */

export type SocialEmbedProvider = 'twitter' | 'bluesky';

export type SocialEmbedMediaType = 'image' | 'video';

export type SocialEmbedMedia = {
  /** Direct https URL of the media itself. */
  url: string;
  type: SocialEmbedMediaType;
  /**
   * A still for the media, when the provider gave one. Required for anything
   * that cannot be drawn without playing it (HLS), useful everywhere else.
   */
  thumbnailUrl?: string;
  /** True for a looping, silent clip — Twitter GIF surrogates, Tenor links. */
  gif: boolean;
  /**
   * True when `url` is an HLS playlist rather than a file a `<video src>` can
   * take. Bluesky serves every video this way.
   */
  hls: boolean;
  width?: number;
  height?: number;
  /** Milliseconds, when the provider reported a duration. */
  duration?: number;
  /** The author's own alt text, when they wrote any. */
  alt?: string;
  mimeType?: string;
};

export type SocialEmbedPost = {
  provider: SocialEmbedProvider;
  /** The link as it appeared in the message. */
  url: string;
  /** Stable per post, so two links to the same post are one entry. */
  id: string;
  authorName?: string;
  authorHandle?: string;
  text?: string;
  media: SocialEmbedMedia[];
};

/* -------------------------------------------------------------------------- */
/* URL recognition                                                            */
/* -------------------------------------------------------------------------- */

const TWITTER_STATUS_REG =
  /^https?:\/\/(?:[\w-]+\.)?(?:twitter\.com|x\.com|nitter\.[\w.-]+|fxtwitter\.com|vxtwitter\.com|fixupx\.com)\/(?:i\/web\/status|\w+\/status)\/(\d+)/;

export function getTwitterId(url: string): string | null {
  const m = url.match(TWITTER_STATUS_REG);
  return m ? m[1] : null;
}

// Bluesky post URLs: https://bsky.app/profile/{handle-or-did}/post/{rkey}
// Also accept the AT-protocol-friendly bsky URL shapes used by clients.
const BSKY_POST_REG =
  /^https?:\/\/(?:bsky\.app|cbsky\.app|psky\.app|deer\.social)\/profile\/([^/?#]+)\/post\/([^/?#]+)/;

export function getBskyPostInfo(url: string): { actor: string; rkey: string } | null {
  const m = url.match(BSKY_POST_REG);
  if (!m) return null;
  return { actor: m[1], rkey: m[2] };
}

// Bluesky PROFILE urls: https://bsky.app/profile/{handle-or-did}, with no
// trailing /post/{rkey}. Previously only post URLs were recognised, so a bare
// profile link rendered no card at all.
export function getBskyProfileActor(url: string): string | null {
  const m = url.match(
    /^https?:\/\/(?:bsky\.app|cbsky\.app|psky\.app|deer\.social)\/profile\/([^/?#]+)\/?(?:[?#].*)?$/,
  );
  return m ? m[1] : null;
}

/** Which provider — if any — owns this link. Cheap; no network. */
export const socialEmbedProvider = (url: string): SocialEmbedProvider | undefined => {
  if (getTwitterId(url)) return 'twitter';
  if (getBskyPostInfo(url)) return 'bluesky';
  return undefined;
};

/* -------------------------------------------------------------------------- */
/* Fetching                                                                    */
/* -------------------------------------------------------------------------- */

export const BSKY_API = 'https://public.api.bsky.app';
const VX_API = 'https://api.vxtwitter.com/Twitter/status';

/**
 * How many times one of these endpoints is asked before the answer is "no".
 *
 * A Bluesky card is built from two chained requests (`resolveHandle`, then
 * `getPostThread`) and nothing else — the homeserver's own preview of a
 * `bsky.app` link is a separate race that plenty of homeservers do not run at
 * all. So a single dropped connection used to be the whole difference between
 * a rendered post and a message with no card under it, with nothing logged and
 * nothing retried: the reported "it seems to not be doing that sometimes".
 */
const FETCH_ATTEMPTS = 3;
/** Backoff between attempts, multiplied by the attempt number. */
const RETRY_BASE_MS = 600;

/** An HTTP status this module decided against, kept so retries can read it. */
class ProviderHttpError extends Error {
  readonly status: number;

  constructor(endpoint: string, status: number) {
    super(`${endpoint} HTTP ${status}`);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

/**
 * Whether a failure is the kind that might not happen again.
 *
 * A rate limit and a 5xx are the server having a moment; a `TypeError` from
 * `fetch` is the network having one (offline, DNS, TLS, a WebView tearing the
 * request down). A 400 or a 404 is an answer — the post is gone or the handle
 * does not exist — and asking again is just noise aimed at a host the message
 * *sender* chose.
 */
const worthRetrying = (err: unknown): boolean => {
  if (err instanceof ProviderHttpError) return err.status === 429 || err.status >= 500;
  return true;
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** GET some JSON, with the retry policy above and one line if it never works. */
const fetchJson = async (endpoint: string, url: string): Promise<any> => {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(url);
      if (!resp.ok) throw new ProviderHttpError(endpoint, resp.status);
      // eslint-disable-next-line no-await-in-loop
      return await resp.json();
    } catch (err) {
      lastErr = err;
      if (!worthRetrying(err) || attempt === FETCH_ATTEMPTS) break;
      // eslint-disable-next-line no-await-in-loop
      await delay(RETRY_BASE_MS * attempt);
    }
  }
  // Every one of these used to be swallowed by a bare `.catch()` in the card,
  // so a link with no preview looked identical whether the post was deleted,
  // the API refused, or the machine was briefly offline.
  console.warn('[social-embed] fetch failed', {
    endpoint,
    url,
    attempts: FETCH_ATTEMPTS,
    error: String(lastErr),
  });
  throw lastErr;
};

/**
 * One in-flight-or-successful request per key, shared by every caller.
 *
 * The card and the room's media scan ask for exactly the same posts, and a
 * timeline can hold the same link several times over — each of which used to
 * be its own pair of requests to a third-party API. **Failures are deliberately
 * not kept**: the whole point of the retry above is that these are recoverable,
 * and a cached rejection would make the first bad moment permanent for the rest
 * of the session.
 */
const requestCache = new Map<string, Promise<any>>();

const shared = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const cached = requestCache.get(key) as Promise<T> | undefined;
  if (cached) return cached;
  const pending = run().catch((err) => {
    requestCache.delete(key);
    throw err;
  });
  requestCache.set(key, pending);
  return pending;
};

export function resolveBskyDid(actor: string): Promise<string> {
  if (actor.startsWith('did:')) return Promise.resolve(actor);
  return shared(`bsky:did:${actor}`, async () => {
    const data = await fetchJson(
      'resolveHandle',
      `${BSKY_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`,
    );
    if (typeof data?.did !== 'string') throw new Error('resolveHandle: no did');
    return data.did as string;
  });
}

export function fetchBskyPost(actor: string, rkey: string): Promise<any> {
  return shared(`bsky:post:${actor}/${rkey}`, async () => {
    const did = await resolveBskyDid(actor);
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    return fetchJson(
      'getPostThread',
      `${BSKY_API}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`,
    );
  });
}

export function fetchBskyProfile(actor: string): Promise<any> {
  return shared(`bsky:profile:${actor}`, () =>
    fetchJson(
      'getProfile',
      `${BSKY_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
    ),
  );
}

export function fetchVxTweet(id: string): Promise<any> {
  return shared(`twitter:${id}`, () =>
    fetchJson('vxtwitter', `${VX_API}/${encodeURIComponent(id)}`),
  );
}

/* -------------------------------------------------------------------------- */
/* Response → media                                                            */
/* -------------------------------------------------------------------------- */

const webUrl = (value: unknown): string | undefined => (isWebUrl(value) ? value : undefined);

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * Twitter stores an uploaded GIF as a silent MP4, so a GIF and a video are the
 * same media kind on the wire and only the presentation differs.
 *
 * `type` alone cannot make that call. vxtwitter's documented API shape reports
 * a GIF as `"video"` (its own api.md example labels a Jurassic Park GIF that
 * way) while newer builds emit `"gif"`, so keying off `type === 'gif'` alone
 * silently misclassifies every GIF served by an instance on the documented
 * shape. The URL is the reliable discriminator: Twitter serves GIF surrogates
 * from `/tweet_video/` and real videos from `/ext_tw_video/` or
 * `/amplify_video/`. `duration_millis === 0` is kept as a third signal because
 * vxtwitter documents it as the GIF marker.
 */
export const isVxGifMedia = (m: {
  type?: string;
  url?: string;
  duration_millis?: number;
}): boolean => m.type === 'gif' || isTwitterGifUrl(m.url) || m.duration_millis === 0;

/** Normalise a vxtwitter response into this module's media shape. */
export const vxTweetMedia = (data: any): SocialEmbedMedia[] => {
  const all = Array.isArray(data?.media_extended) ? data.media_extended : [];
  const media: SocialEmbedMedia[] = [];

  all.forEach((m: any) => {
    const url = webUrl(m?.url);
    if (!url) return;
    const isImage = m?.type === 'image' || m?.type === 'photo';
    const gif = !isImage && isVxGifMedia(m);
    media.push({
      url,
      type: isImage ? 'image' : 'video',
      thumbnailUrl: webUrl(m?.thumbnail_url),
      gif,
      hls: false,
      width: positive(m?.size?.width),
      height: positive(m?.size?.height),
      duration: isImage ? undefined : positive(m?.duration_millis),
      alt: typeof m?.altText === 'string' ? m.altText : undefined,
      mimeType: isImage ? undefined : 'video/mp4',
    });
  });

  return media;
};

/**
 * Normalise a Bluesky `getPostThread` response into this module's media shape.
 *
 * Handles the three embed views a post's pictures can arrive in: `images#view`
 * directly, the same nested under `recordWithMedia#view`, and `video#view`
 * (always an HLS playlist). `external#view` is included only when it is
 * actually a picture the author chose to post — a Tenor GIF or another
 * animated image — and not when it is a link card, which is the site-meta
 * furniture this gallery deliberately leaves out.
 */
export const bskyPostMedia = (data: any): SocialEmbedMedia[] => {
  const post = data?.thread?.post;
  const embed = post?.embed ?? {};
  const media: SocialEmbedMedia[] = [];

  const images: any[] = Array.isArray(embed.images)
    ? embed.images
    : Array.isArray(embed.media?.images)
      ? embed.media.images
      : [];

  images.forEach((img: any) => {
    const url = webUrl(img?.fullsize) ?? webUrl(img?.thumb);
    if (!url) return;
    media.push({
      url,
      type: 'image',
      thumbnailUrl: webUrl(img?.thumb),
      gif: false,
      hls: false,
      width: positive(img?.aspectRatio?.width),
      height: positive(img?.aspectRatio?.height),
      alt: typeof img?.alt === 'string' && img.alt ? img.alt : undefined,
    });
  });

  const videoView =
    embed.$type === 'app.bsky.embed.video#view'
      ? embed
      : embed.media?.$type === 'app.bsky.embed.video#view'
        ? embed.media
        : null;
  const playlist = webUrl(videoView?.playlist);
  if (playlist) {
    media.push({
      url: playlist,
      type: 'video',
      thumbnailUrl: webUrl(videoView?.thumbnail),
      gif: false,
      hls: true,
      width: positive(videoView?.aspectRatio?.width),
      height: positive(videoView?.aspectRatio?.height),
      alt: typeof videoView?.alt === 'string' && videoView.alt ? videoView.alt : undefined,
    });
  }

  const externalView =
    embed.$type === 'app.bsky.embed.external#view'
      ? embed.external
      : embed.media?.$type === 'app.bsky.embed.external#view'
        ? embed.media.external
        : null;
  if (externalView) {
    // A GIF posted on Bluesky is not a media embed at all — it is an external
    // link embed whose `uri` is the Tenor GIF, so this is the *only* way one
    // reaches the gallery. Prefer Tenor's own video renditions (tens of KB
    // against megabytes for the GIF the uri points at).
    const tenor = parseTenorGif(externalView.uri);
    if (tenor) {
      const best = tenor.sources[tenor.sources.length - 1];
      media.push({
        url: best.src,
        type: 'video',
        thumbnailUrl: webUrl(externalView.thumb),
        gif: true,
        hls: false,
        width: positive(tenor.width),
        height: positive(tenor.height),
        mimeType: best.type,
      });
    } else if (isAnimatedImageUrl(externalView.uri) && webUrl(externalView.uri)) {
      media.push({
        url: externalView.uri,
        type: 'image',
        thumbnailUrl: webUrl(externalView.thumb),
        gif: true,
        hls: false,
        alt: typeof externalView.title === 'string' ? externalView.title : undefined,
      });
    }
    // Anything else here is a link card. Left out on purpose — see the note at
    // the top of this file.
  }

  return media;
};

/* -------------------------------------------------------------------------- */
/* Resolution, with a cache                                                    */
/* -------------------------------------------------------------------------- */

export type SocialEmbedOptions = {
  /** `useVxTwitter`. Off means the Twitter API is never contacted. */
  twitter: boolean;
  /** `useBlueskyEmbeds`. Off means the Bluesky API is never contacted. */
  bluesky: boolean;
};

/**
 * One in-flight-or-settled promise per post, for the lifetime of the page.
 *
 * The media scan walks history repeatedly (every `loadMore`, and again when a
 * limited sync restarts the timeline), and the same link is often posted more
 * than once. Without this, each pass would re-hit vxtwitter and the Bluesky
 * API for links it has already resolved.
 *
 * A resolved `undefined` — a post that exists and has no pictures in it — is
 * cached like any other answer. A **failure** is not: it is dropped from the
 * cache so the next pass can ask again, because the request layer above only
 * gives up after three attempts and a network that was down for those is not
 * down for the rest of the session. Caching it made one bad moment permanently
 * remove that post's images from the gallery.
 */
const postCache = new Map<string, Promise<SocialEmbedPost | undefined>>();

const cacheKey = (provider: SocialEmbedProvider, id: string): string => `${provider}:${id}`;

/**
 * A vxtwitter response as this module's post shape, or undefined when the
 * tweet carries no media.
 *
 * Exported because `UrlPreviewCard` fetches the very same endpoint itself to
 * draw the card, and a click on one of the pictures in that card has to name
 * the entry the media scan produced for it. Building the post through this
 * function rather than by hand at the call site is what makes the two agree:
 * the order of `media` decides the gallery key of every picture in the post
 * (`embedMediaItems`), so a card that normalised its own copy differently
 * would open the feed on the wrong photo.
 */
export const vxTweetToPost = (url: string, id: string, data: any): SocialEmbedPost | undefined => {
  const media = vxTweetMedia(data);
  if (media.length === 0) return undefined;
  return {
    provider: 'twitter',
    url,
    id,
    authorName: typeof data?.user_name === 'string' ? data.user_name : undefined,
    authorHandle: typeof data?.user_screen_name === 'string' ? data.user_screen_name : undefined,
    text: typeof data?.text === 'string' ? data.text : undefined,
    media,
  };
};

/** A Bluesky `getPostThread` response as this module's post shape. See above. */
export const bskyThreadToPost = (
  url: string,
  actor: string,
  rkey: string,
  data: any,
): SocialEmbedPost | undefined => {
  const media = bskyPostMedia(data);
  if (media.length === 0) return undefined;
  const author = data?.thread?.post?.author;
  const record = data?.thread?.post?.record;
  return {
    provider: 'bluesky',
    url,
    id: `${actor}/${rkey}`,
    authorName: typeof author?.displayName === 'string' ? author.displayName : undefined,
    authorHandle: typeof author?.handle === 'string' ? author.handle : undefined,
    text: typeof record?.text === 'string' ? record.text : undefined,
    media,
  };
};

const resolveTwitter = async (url: string, id: string): Promise<SocialEmbedPost | undefined> =>
  vxTweetToPost(url, id, await fetchVxTweet(id));

const resolveBluesky = async (
  url: string,
  actor: string,
  rkey: string,
): Promise<SocialEmbedPost | undefined> =>
  bskyThreadToPost(url, actor, rkey, await fetchBskyPost(actor, rkey));

/**
 * The pictures behind one link, or undefined when there are none to have.
 *
 * Returns undefined without touching the network when the link is not a
 * recognised post, or when the setting that governs its provider is off. That
 * gate is the same one `UrlPreviewCard` applies and it is not cosmetic:
 * resolving one of these links discloses the reader's IP to a host the message
 * *sender* picked, and tells that sender when their message was read.
 */
export const resolveSocialEmbed = (
  url: string,
  options: SocialEmbedOptions,
): Promise<SocialEmbedPost | undefined> => {
  const twitterId = getTwitterId(url);
  if (twitterId) {
    if (!options.twitter) return Promise.resolve(undefined);
    const key = cacheKey('twitter', twitterId);
    const cached = postCache.get(key);
    if (cached) return cached;
    const pending = resolveTwitter(url, twitterId).catch(() => {
      postCache.delete(key);
      return undefined;
    });
    postCache.set(key, pending);
    return pending;
  }

  const bskyPost = getBskyPostInfo(url);
  if (bskyPost) {
    if (!options.bluesky) return Promise.resolve(undefined);
    const key = cacheKey('bluesky', `${bskyPost.actor}/${bskyPost.rkey}`);
    const cached = postCache.get(key);
    if (cached) return cached;
    const pending = resolveBluesky(url, bskyPost.actor, bskyPost.rkey).catch(() => {
      postCache.delete(key);
      return undefined;
    });
    postCache.set(key, pending);
    return pending;
  }

  return Promise.resolve(undefined);
};

/** True when at least one provider is enabled — i.e. scanning can find anything. */
export const socialEmbedsEnabled = (options: SocialEmbedOptions): boolean =>
  options.twitter || options.bluesky;
