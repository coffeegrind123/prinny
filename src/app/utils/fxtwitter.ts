/**
 * api.fxtwitter.com, read into the shape api.vxtwitter.com answers with.
 *
 * vxtwitter sits behind a Cloudflare rule that answers any browser
 * User-Agent with a JS challenge (403, "Just a moment..."), which `fetch()`
 * cannot solve. Measured 16.11.2026: every request from the app's WebView and
 * from curl with a Chrome UA got the challenge, while the same request with a
 * non-browser UA got the JSON. fxtwitter answers the browser with CORS JSON.
 *
 * The desktop and Android shells still ask vxtwitter, through the shell's own
 * HTTP client (`fetch_vx_tweet`). This is the route for the web build, and
 * for the shell whenever that fails. Everything downstream (the card, the
 * gallery scan) reads the vxtwitter shape, so this converts into it rather than
 * teaching every reader a second one.
 *
 *   fxtwitter                       vxtwitter
 *   tweet.id / url / text           tweetID / tweetURL / text
 *   tweet.author.name/screen_name   user_name / user_screen_name
 *   media.all[].type  photo         media_extended[].type  image
 *   media.all[].duration (seconds)  duration_millis (0 marks a GIF)
 *   media.all[].width/height        size.{width,height}
 *   tweet.quote (nested fully)      qrt (one level; its own qrt is null)
 */

/** What fxtwitter calls a media kind, as vxtwitter calls it. */
const FX_MEDIA_TYPE: Record<string, string> = {
  photo: 'image',
  video: 'video',
  gif: 'gif',
};

const MS_PER_SECOND = 1000;

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const httpsUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
};

const convertMedia = (all: unknown): Record<string, any>[] => {
  if (!Array.isArray(all)) {
    return [];
  }
  const media: Record<string, any>[] = [];
  all.forEach((m) => {
    if (!isObject(m)) {
      return;
    }
    const type = FX_MEDIA_TYPE[str(m.type) ?? ''];
    const url = httpsUrl(m.url);
    if (!type || !url) {
      return;
    }
    const seconds = num(m.duration);
    media.push({
      type,
      url,
      thumbnail_url: httpsUrl(m.thumbnail_url),
      duration_millis:
        type === 'image' || seconds === undefined ? undefined : Math.round(seconds * MS_PER_SECOND),
      size: { width: num(m.width), height: num(m.height) },
      altText: str(m.altText) ?? null,
    });
  });
  return media;
};

const convertTweet = (tweet: Record<string, any>, withQuote: boolean): Record<string, any> => {
  const id = str(tweet.id);
  if (!id || !/^\d+$/.test(id)) {
    throw new Error('fxtwitter: tweet has no id');
  }
  const author = isObject(tweet.author) ? tweet.author : {};
  const media = convertMedia(isObject(tweet.media) ? tweet.media.all : undefined);
  const quote = withQuote && isObject(tweet.quote) ? tweet.quote : undefined;

  let qrt: Record<string, any> | null = null;
  if (quote) {
    try {
      qrt = convertTweet(quote, false);
    } catch {
      qrt = null;
    }
  }

  return {
    tweetID: id,
    tweetURL: httpsUrl(tweet.url),
    text: str(tweet.text) ?? '',
    user_name: str(author.name),
    user_screen_name: str(author.screen_name),
    likes: num(tweet.likes),
    replies: num(tweet.replies),
    retweets: num(tweet.retweets),
    hasMedia: media.length > 0,
    media_extended: media,
    qrt,
    qrtURL: qrt ? (qrt.tweetURL ?? null) : null,
  };
};

/**
 * One fxtwitter `/status/<id>` answer as a vxtwitter response.
 *
 * Throws when the answer carries no tweet: fxtwitter reports a deleted,
 * private or unknown tweet as `{ code: 404, tweet: null }` (or a tombstone
 * without an id), and there is nothing to draw from that.
 */
export const fxTweetToVx = (data: unknown): Record<string, any> => {
  if (!isObject(data) || !isObject(data.tweet)) {
    throw new Error('fxtwitter: no tweet in the answer');
  }
  return convertTweet(data.tweet, true);
};
