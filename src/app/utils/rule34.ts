import { ProviderContentError, fetchEmbedWith, sharedRequest } from './embedFetch';
import { isWebUrl } from './safeUrl';
import { mimeTypeFromUrl, urlFileExtension } from './animatedMedia';

/**
 * Rule34 post API client — the third provider whose post links this client
 * renders inline, alongside Twitter and Bluesky (see `socialEmbed.ts`).
 *
 * Rule34 runs a Gelbooru 0.2 `dapi`, and three of its behaviours are the whole
 * reason this module exists rather than four lines inside `socialEmbed`. All
 * three were measured against the live API, not read off a wiki:
 *
 *  1. **Credentials are mandatory.** An unauthenticated request is answered
 *     with `HTTP 200` and the JSON *string*
 *     `"Missing authentication. Go to api.rule34.xxx for more information"` —
 *     not a 401, and not an array. `resp.ok` is true, `resp.json()` succeeds,
 *     and the value is a string, so anything that trusted either would carry
 *     on and report "this post has no media" forever.
 *  2. **A missing post is a 200 with a zero-length body.** Not `[]`, not
 *     `null` — nothing at all. `resp.json()` on that throws a `SyntaxError`,
 *     which the shared retry layer would otherwise read as a flaky network and
 *     ask twice more for. Hence `fetchEmbedWith` and the reader below, which
 *     classifies each of these bodies before the retry layer sees it.
 *  3. **The JSON post shape carries no tag *types*.** Categorised tags
 *     (artist / character / copyright) exist only in the `s=tag` XML endpoint,
 *     which filters by one exact `name=` per request and ignores both `json=1`
 *     and a plural `names=` — so a card would need one request per tag and a
 *     post carries well over a hundred. The card therefore shows the tag list
 *     as the API orders it and does not pretend to know which tag is the
 *     artist.
 *
 * The media CDNs (`api-cdn.rule34.xxx`, `api-cdn-mp4.rule34.xxx`) serve a
 * ranged GET carrying a cross-origin `Referer` with a 206 and send no CORS
 * headers at all, so their URLs go straight into an element and must NOT be
 * routed through the referrer-stripping in-page fetch — see
 * `PROXY_REQUIRED_MEDIA_HOSTS` in `tauri-media-proxy.ts`.
 */

/**
 * The key pair every request needs.
 *
 * These identify the app, not the reader, and rule34 expects both in the query
 * string — so they ship in the bundle exactly as the Klipy GIF key does (see
 * `utils/klipy.ts`). Set `VITE_RULE34_API_KEY` and `VITE_RULE34_USER_ID` at
 * build time to use your own; the fallbacks below are shared by every
 * deployment that never set them, so the API's rate limit is shared too. A key
 * comes from your own account page:
 * https://rule34.xxx/index.php?page=account&s=options
 */
const RULE34_API_KEY =
  import.meta.env.VITE_RULE34_API_KEY ||
  '246cc24147a823fd08e331bf432a52ee9ef51cf115e9d41ebefe82f797ca5757439daa630d0eff2675c0a54a7c1afcf3dcdd4b4821e8a8d9c0dc0623dfbcd95b';
const RULE34_USER_ID = import.meta.env.VITE_RULE34_USER_ID || '5643073';

const RULE34_API = 'https://api.rule34.xxx/index.php';

/** Names this provider in the shared fetch layer's log line. */
const ENDPOINT = 'rule34 post';

/** Hosts whose `/index.php?page=post&s=view&id=…` names a Rule34 post. */
const RULE34_POST_HOSTS: ReadonlySet<string> = new Set([
  'rule34.xxx',
  'www.rule34.xxx',
  'api.rule34.xxx',
]);

/**
 * The post id in a Rule34 post URL, or null.
 *
 * Parsed with `new URL` rather than matched against the raw string, for the
 * same reason `getHnItemId` is: a regex over the whole URL accepts
 * `https://evil.example/rule34.xxx/index.php?page=post&s=view&id=1` as readily
 * as the real thing, and the id it yields is interpolated straight into an API
 * request. The host check has to be made against a parsed origin.
 *
 * `searchParams` also gets the query right for free. A rule34 link copied out
 * of a search result carries the search with it
 * (`…&id=12606916&tags=hatsune_miku`), and one copied out of the site's own
 * pagination can order the parameters differently — neither is a different
 * post, and neither would survive a positional pattern.
 */
export function getRule34PostId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!RULE34_POST_HOSTS.has(parsed.hostname.replace(/\.$/, '').toLowerCase())) return null;
  if (parsed.pathname !== '/index.php') return null;
  if (parsed.searchParams.get('page') !== 'post') return null;
  if (parsed.searchParams.get('s') !== 'view') return null;
  const id = parsed.searchParams.get('id');
  // Digits only, and bounded: the value goes into an API query below.
  return id !== null && /^\d{1,15}$/.test(id) ? id : null;
}

/** The canonical page for a post id — the card's "open the original" link. */
export const rule34PostPageUrl = (id: string): string =>
  `https://rule34.xxx/index.php?page=post&s=view&id=${encodeURIComponent(id)}`;

/**
 * What kind of file a post holds.
 *
 * Decided from the file's own extension, which is the only signal in the
 * response that carries it — `file_url` is `…/images/<dir>/<hash>.<ext>` and
 * there is no type field. A `.gif` is called out separately from a still image
 * because the two need opposite treatment: an animation must never be routed
 * through a thumbnailer or a `<video>`, and a real video must have controls and
 * must not autoplay. See `animatedMedia.ts` for the full reasoning.
 *
 * Measured extension census over 300 consecutive posts: 187 jpeg, 83 png,
 * 14 mp4, 8 gif, 8 jpg. `webm`, `m4v` and `mov` are accepted too because the
 * site has hosted them historically and an unrecognised video would otherwise
 * fall into the still-image branch and render as a broken `<img>`.
 */
export type Rule34FileKind = 'image' | 'gif' | 'video';

const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'webm', 'm4v', 'mov']);

export const rule34FileKind = (fileUrl: string): Rule34FileKind => {
  const ext = urlFileExtension(fileUrl);
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (ext === 'gif' || ext === 'apng') return 'gif';
  return 'image';
};

/** Ratings the site assigns. Anything else is reported verbatim but unstyled. */
export type Rule34Rating = 'safe' | 'questionable' | 'explicit' | string;

/**
 * One post, with every field this client uses already validated.
 *
 * Deliberately not the raw API object: every value here arrives as third-party
 * JSON and reaches an `<img src>`, an `href`, or rendered text, so the checks
 * belong at the boundary rather than at each of the several use sites.
 */
export type Rule34Post = {
  id: string;
  /** The original file — what the viewer and the media feed open. */
  fileUrl: string;
  /**
   * The site's downscaled rendition of a still image, or the original when it
   * made none (`sample: false`, where the API repeats `file_url` here).
   *
   * Used as the *inline* source in the timeline card, because a rule34 still
   * is routinely a multi-megabyte PNG several thousand pixels wide and the
   * card is a few hundred wide. For a video post the API puts a `.jpg` still
   * in this field, which is why it is only ever consulted for `kind: 'image'`.
   */
  sampleUrl: string;
  /** Small still. The poster for a video, and a fallback for anything else. */
  previewUrl?: string;
  kind: Rule34FileKind;
  /** Dimensions of `fileUrl`, when the API reported usable ones. */
  width?: number;
  height?: number;
  /** Content type of `fileUrl`, for the download and for blob stamping. */
  mimeType?: string;
  rating?: Rule34Rating;
  score?: number;
  /** The uploader's site account name, not the artist. */
  owner?: string;
  /** Where the uploader said it came from, when that is a usable web URL. */
  sourceUrl?: string;
  tags: string[];
  commentCount?: number;
  /** Last change, epoch milliseconds — the API reports epoch seconds. */
  changedAt?: number;
  /** Set when the post is one page of a set. */
  parentId?: string;
};

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const counter = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;

/**
 * Split the API's tag string.
 *
 * Tags arrive as one space-separated string with HTML entities left in it —
 * `five_nights_at_freddy&#039;s` is a real value from the live API, not a
 * hypothetical. They render as React children (escaped) wherever they are
 * shown, so decoding here is about the *text* being right rather than about
 * safety; a tag displayed as `&#039;` is simply wrong.
 */
const NUMERIC_ENTITY_REG = /&#(\d{1,7});/g;

const decodeTag = (tag: string): string =>
  tag
    .replace(NUMERIC_ENTITY_REG, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Ampersand last, so `&amp;#039;` cannot be decoded twice into a quote.
    .replace(/&amp;/g, '&');

const parseTags = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  return (
    value
      .split(/\s+/)
      .filter((tag) => tag.length > 0)
      .map(decodeTag)
      // A tag is a path-ish token (`intersex/female` occurs); bound it so a
      // hostile value cannot become a paragraph in the card.
      .map((tag) => tag.slice(0, 120))
  );
};

/**
 * One raw API object as a validated `Rule34Post`, or null when it is not one.
 *
 * `file_url` is the single field the embed cannot do without — everything else
 * is decoration — so a post without a usable one is not a post as far as this
 * client is concerned.
 */
export const parseRule34Post = (raw: unknown): Rule34Post | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const post = raw as Record<string, unknown>;

  const id =
    typeof post.id === 'number' && Number.isInteger(post.id) && post.id > 0
      ? String(post.id)
      : typeof post.id === 'string' && /^\d{1,15}$/.test(post.id)
        ? post.id
        : null;
  if (!id) return null;

  const fileUrl = isWebUrl(post.file_url) ? post.file_url : null;
  if (!fileUrl) return null;

  const sampleUrl = isWebUrl(post.sample_url) ? post.sample_url : fileUrl;
  const previewUrl = isWebUrl(post.preview_url) ? post.preview_url : undefined;
  const kind = rule34FileKind(fileUrl);

  const parentId =
    typeof post.parent_id === 'number' && post.parent_id > 0 ? String(post.parent_id) : undefined;

  return {
    id,
    fileUrl,
    // A video's `sample_url` is a still frame, never something to draw in an
    // image slot — see the field's own note.
    sampleUrl: kind === 'image' ? sampleUrl : fileUrl,
    previewUrl,
    kind,
    width: positive(post.width),
    height: positive(post.height),
    mimeType: mimeTypeFromUrl(fileUrl),
    rating: typeof post.rating === 'string' ? post.rating.slice(0, 32) : undefined,
    score: counter(post.score),
    owner: typeof post.owner === 'string' ? post.owner.slice(0, 64) : undefined,
    sourceUrl: isWebUrl(post.source) ? post.source : undefined,
    tags: parseTags(post.tags),
    commentCount: counter(post.comment_count),
    changedAt: positive(post.change) ? positive(post.change)! * 1000 : undefined,
    parentId,
  };
};

/**
 * Read one `s=post&q=index` response body.
 *
 * Every one of these branches is a shape the live API actually returns, and
 * every one of them arrives with `HTTP 200`:
 *
 *  - `''` — no such post (deleted, or an id that never existed);
 *  - `"Missing authentication…"` — a JSON string, i.e. no credentials;
 *  - `[]` — a query that matched nothing;
 *  - `[{…}]` — the post.
 *
 * The authentication case is called out by name on purpose. It is the one
 * failure that is a *deployment* fault rather than a bad link, and without a
 * distinct message it presents exactly as "rule34 embeds don't work", which is
 * indistinguishable from the API being down.
 */
const readPostResponse = (endpoint: string, body: string): Rule34Post => {
  const text = body.trim();
  if (text.length === 0) throw new ProviderContentError(endpoint, 'no such post');

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderContentError(endpoint, `unparseable body (${text.slice(0, 120)})`);
  }

  if (typeof data === 'string') {
    // Reported at error level, not warn: nothing the reader or the sender did
    // can fix it, and it disables the whole integration.
    console.error('[rule34] API refused the request', { detail: data.slice(0, 200) });
    throw new ProviderContentError(endpoint, data.slice(0, 200));
  }
  if (!Array.isArray(data)) {
    throw new ProviderContentError(endpoint, `unexpected response shape (${typeof data})`);
  }
  if (data.length === 0) throw new ProviderContentError(endpoint, 'no such post');

  const post = parseRule34Post(data[0]);
  if (!post) throw new ProviderContentError(endpoint, 'post carries no usable file_url');
  return post;
};

/**
 * One post by id, deduplicated and retried per `embedFetch`'s policy.
 *
 * Rejects rather than resolving null so the card and the gallery scan can tell
 * "this link is dead / the API refused" from "this post has nothing in it" —
 * the first falls through to the homeserver's own preview, the second does not.
 */
export function fetchRule34Post(id: string): Promise<Rule34Post> {
  return sharedRequest(`rule34:post:${id}`, () => {
    const url =
      `${RULE34_API}?page=dapi&s=post&q=index&json=1` +
      `&id=${encodeURIComponent(id)}` +
      `&api_key=${encodeURIComponent(RULE34_API_KEY)}` +
      `&user_id=${encodeURIComponent(RULE34_USER_ID)}`;
    // The body is read *inside* the retry loop, not after it: that is what
    // separates "the server is having a moment", which is worth asking again,
    // from the three 200-with-a-bad-body answers below, which are not. The
    // credentials in `url` never reach a log — see `redactUrl`.
    return fetchEmbedWith(ENDPOINT, url, async (resp) =>
      readPostResponse(ENDPOINT, await resp.text()),
    );
  });
}

/**
 * A short, bounded tag line for a post.
 *
 * Used where there is room for a sentence rather than a tag cloud — the
 * gallery entry's caption, and an image's `alt`. A rule34 post has no prose of
 * its own and routinely carries well over a hundred tags, so the whole list
 * would be a wall of text in either place.
 */
export const rule34TagSummary = (tags: string[], maxChars = 180): string => {
  const summary: string[] = [];
  let length = 0;
  for (let i = 0; i < tags.length; i += 1) {
    const next = tags[i];
    const cost = next.length + (summary.length > 0 ? 2 : 0);
    if (length + cost > maxChars) break;
    summary.push(next);
    length += cost;
  }
  return summary.join(', ');
};
