import {
  MATRIX_ANIMATED_PROPERTY_NAME,
  MATRIX_ANIMATED_UNSTABLE_PROPERTY_NAME,
} from '../../types/matrix/common';

/**
 * Detection helpers for media that is *animated but not a video* — GIFs, and
 * the muted MP4/WebM surrogates that Twitter, Tenor, Giphy and Bluesky serve in
 * place of a real GIF file.
 *
 * Why this is a separate concern from `isVideoUrl`: a GIF and a video need
 * opposite treatment. A video wants `controls`, no autoplay and audio. A GIF
 * wants autoplay, `loop`, `muted` and no chrome — and, critically, it must
 * never be routed through a *thumbnailer*, because every server-side thumbnail
 * of an animated image is a single still frame. Conflating the two is what
 * makes a linked GIF render as a frozen picture.
 *
 * Everything here parses the URL rather than substring-matching it. These
 * values arrive from message content and third-party API JSON, so a check like
 * `url.includes('media.tenor.com')` is also true for
 * `https://attacker.example/media.tenor.com/x.gif`.
 */

/**
 * Image types that can carry animation. WebP, APNG and AVIF are included
 * because a server-side thumbnail flattens them exactly like a GIF, so they
 * need the same "don't thumbnail this" handling even though the extension is
 * not `.gif`.
 */
export const ANIMATED_IMAGE_MIME_TYPES: readonly string[] = [
  'image/gif',
  'image/webp',
  'image/apng',
  'image/avif',
];

/**
 * Image types that are animated often enough to assume it.
 *
 * WebP and AVIF are deliberately NOT here. Both are now the *default static*
 * format for og:image on a large slice of the web, so assuming animation from
 * the type alone would make every ordinary link preview skip the thumbnailer
 * and pull a full-size hero image. They are still handled — but only where the
 * link itself is the image file, where the user asked for that exact file and
 * there is nothing to thumbnail on their behalf.
 */
export const ALWAYS_ANIMATED_MIME_TYPES: readonly string[] = ['image/gif', 'image/apng'];

const ALWAYS_ANIMATED_EXTENSIONS: ReadonlySet<string> = new Set(['gif', 'apng']);

const ANIMATED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'gif',
  'webp',
  'apng',
  'avif',
  'avifs',
]);

const IMAGE_EXTENSION_MIME: Readonly<Record<string, string>> = {
  gif: 'image/gif',
  webp: 'image/webp',
  apng: 'image/apng',
  avif: 'image/avif',
  avifs: 'image/avif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

const VIDEO_EXTENSION_MIME: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
};

const AUDIO_EXTENSION_MIME: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
};

/**
 * Lower-cased file extension of a URL's *path*, or `''`.
 *
 * Parsing rather than regex-matching the whole string matters here: Tenor's GIF
 * URLs carry `?hh=498&ww=498`, and Bluesky's carry a fragment, so a naive
 * `endsWith('.gif')` misses both. Returns `''` for anything that is not a
 * parseable absolute URL, which makes every predicate below fail closed.
 */
export const urlFileExtension = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) return '';
  let pathname: string;
  try {
    pathname = new URL(value).pathname;
  } catch {
    return '';
  }
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  if (dot < 1) return '';
  return lastSegment.slice(dot + 1).toLowerCase();
};

/** Lower-cased hostname of a URL, or `''` when it does not parse. */
export const urlHostname = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) return '';
  try {
    return new URL(value).hostname.replace(/\.$/, '').toLowerCase();
  } catch {
    return '';
  }
};

/** True when `host` is `domain` or any subdomain of it. */
export const hostMatches = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

/** True when the URL path names a still or animated image file. */
export const isImageUrl = (value: unknown): boolean =>
  urlFileExtension(value) in IMAGE_EXTENSION_MIME;

/** True when the URL path names an image format that can be animated. */
export const isAnimatedImageUrl = (value: unknown): boolean =>
  ANIMATED_IMAGE_EXTENSIONS.has(urlFileExtension(value));

/**
 * True for the formats worth assuming are animated wherever they appear —
 * `.gif` and `.apng`. See `ALWAYS_ANIMATED_MIME_TYPES` for why WebP and AVIF
 * are excluded from this narrower test.
 */
export const isAlwaysAnimatedImageUrl = (value: unknown): boolean =>
  ALWAYS_ANIMATED_EXTENSIONS.has(urlFileExtension(value));

/** Content-type counterpart of `isAlwaysAnimatedImageUrl`. */
export const isAlwaysAnimatedMimeType = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  return ALWAYS_ANIMATED_MIME_TYPES.includes(value.split(';')[0].trim().toLowerCase());
};

/**
 * True for a content type that can carry animation. Tolerates parameters
 * (`image/webp; charset=binary`) and casing, both of which appear in the wild
 * in `og:image:type`.
 */
export const isAnimatedImageMimeType = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const base = value.split(';')[0].trim().toLowerCase();
  return ANIMATED_IMAGE_MIME_TYPES.includes(base);
};

/**
 * Best-guess content type for a media URL, used to stamp a `Blob` built from
 * proxied bytes. A blob with an empty `type` has no content type at all, and a
 * media element handed such a blob refuses to play it on the stricter engines
 * (WebKitGTK on the Linux desktop build, Android's WebView) — it is one of the
 * ways a proxied GIF ends up as a blank box.
 */
export const mimeTypeFromUrl = (value: unknown): string | undefined => {
  const ext = urlFileExtension(value);
  return (
    IMAGE_EXTENSION_MIME[ext] ?? VIDEO_EXTENSION_MIME[ext] ?? AUDIO_EXTENSION_MIME[ext] ?? undefined
  );
};

/**
 * True for Twitter's animated-GIF surrogate.
 *
 * Twitter has no GIF storage: an uploaded GIF is transcoded to a silent MP4 and
 * served from `video.twimg.com/tweet_video/…`. Real videos come from
 * `/ext_tw_video/` or `/amplify_video/`. The path segment is therefore the only
 * reliable discriminator — vxtwitter's `media_extended[].type` reports these as
 * `"video"` in its documented shape and as `"gif"` in newer builds, so neither
 * value alone can be trusted.
 */
export const isTwitterGifUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    hostMatches(parsed.hostname.toLowerCase(), 'twimg.com') &&
    parsed.pathname.startsWith('/tweet_video/')
  );
};

/**
 * Hosts whose `og:video` is always a silent looping GIF surrogate rather than a
 * video the user should press play on.
 */
const GIF_VIDEO_HOSTS: readonly string[] = ['tenor.com', 'giphy.com', 'gfycat.com', 'redgifs.com'];

const isGifHost = (value: unknown): boolean => {
  const host = urlHostname(value);
  if (!host) return false;
  return GIF_VIDEO_HOSTS.some((domain) => hostMatches(host, domain));
};

/**
 * Decide whether an `og:video` should be presented as a GIF (autoplay, loop,
 * muted, no chrome) or as a video (controls, no autoplay).
 *
 * Two independent signals, either sufficient:
 *  - the page or the video itself lives on a dedicated GIF host, or is an
 *    Imgur `.gifv` — Imgur serves those as MP4 and they are GIFs by definition;
 *  - the page declared an `image/gif` `og:image`. Only GIF-sharing pages
 *    advertise a literal GIF as their preview image, so pairing that with an
 *    `og:video` is a reliable tell. Deliberately narrower than
 *    `isAnimatedImageMimeType` — animated WebP is a common decorative asset on
 *    ordinary sites and would produce false positives.
 */
export const isGifStyleVideo = (
  pageUrl: unknown,
  videoUrl: unknown,
  ogImageType: unknown,
): boolean => {
  if (isGifHost(pageUrl) || isGifHost(videoUrl)) return true;
  if (urlFileExtension(pageUrl) === 'gifv') return true;
  if (isAnimatedImageUrl(pageUrl)) return true;
  if (
    typeof ogImageType === 'string' &&
    ogImageType.split(';')[0].trim().toLowerCase() === 'image/gif'
  )
    return true;
  return false;
};

export type GifVideoSource = { src: string; type: string };

export type GifSurrogate = {
  /** Ordered best-first; rendered as `<source>` children. */
  sources: GifVideoSource[];
  width?: number;
  height?: number;
};

/**
 * Map a Tenor GIF URL onto Tenor's own small video renditions.
 *
 * Tenor selects the rendition from a suffix on the *id* path segment and
 * ignores the file extension entirely — verified against
 * `media.tenor.com/uo6y8vuwoZI<suffix>/happy-happy-happy.<ext>`:
 *
 * | suffix  | served content-type | bytes |
 * |---------|---------------------|-------|
 * | `AAAAC` | image/gif           | 3.3 M |
 * | `AAAAM` | image/gif           | 301 K |
 * | `AAAP1` | video/mp4           |  58 K |
 * | `AAAP3` | video/webm          |  48 K |
 *
 * Bluesky posts a GIF as an external embed whose `uri` is the `AAAAC` GIF, so
 * rendering that URL verbatim costs 3.3 MB for a 48 KB animation. This returns
 * the video renditions instead — the same substitution the official Bluesky web
 * client makes, except pointed at Tenor directly rather than through
 * `t.gifs.bsky.app`, so viewing a GIF does not disclose the reader's IP to
 * Bluesky's proxy.
 *
 * Returns `null` for anything that is not a recognisable Tenor GIF; callers
 * fall back to rendering the original URL as an image.
 */
export const parseTenorGif = (value: unknown): GifSurrogate | null => {
  if (typeof value !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!hostMatches(parsed.hostname.toLowerCase(), 'tenor.com')) return null;

  // `/{id}/{filename}` or Tenor's newer `/m/{id}/{filename}`.
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const filename = segments[segments.length - 1];
  const id = segments[segments.length - 2];
  if (!id.includes('AAAAC')) return null;
  // The id is spliced back into a URL, so refuse anything that is not the
  // opaque token Tenor actually uses.
  if (!/^[A-Za-z0-9_-]+$/.test(id) || !/^[A-Za-z0-9_.-]+$/.test(filename)) return null;

  const prefix = segments.slice(0, -2).join('/');
  const base = `https://${parsed.hostname}${prefix ? `/${prefix}` : ''}`;
  const stem = filename.replace(/\.[^.]+$/, '');
  const variant = (suffix: string, ext: string) =>
    `${base}/${id.replace('AAAAC', suffix)}/${stem}.${ext}`;

  const width = Number(parsed.searchParams.get('ww')) || undefined;
  const height = Number(parsed.searchParams.get('hh')) || undefined;

  return {
    sources: [
      { src: variant('AAAP3', 'webm'), type: 'video/webm' },
      { src: variant('AAAP1', 'mp4'), type: 'video/mp4' },
    ],
    width: width && width > 0 ? width : undefined,
    height: height && height > 0 ? height : undefined,
  };
};

/* ────────────────────────────────────────────────────────────────────────────
 * MSC4230 — `info.is_animated`
 *
 * Everything above this line answers "could a file of this TYPE be animated?"
 * from a MIME type or a URL, which is all a link preview can know. MSC4230 asks
 * a different and stricter question about a file we are holding: is THIS file
 * animated? A `.webp` or `.png` is usually not, so the type-level helpers would
 * answer `true` for most static images and the flag would be worse than absent.
 *
 * The distinction matters to the receiver, and Prinny already documents why in
 * `UrlPreviewCard`: a server-side thumbnail of an animated image is a single
 * flattened frame, so a client that knows an image is animated can skip the
 * thumbnailer instead of showing a still and hoping.
 * ──────────────────────────────────────────────────────────────────────────── */

/** How much of a file we are willing to read to answer the question. */
const ANIMATION_SNIFF_BYTES = 512 * 1024;

const ascii = (view: DataView, offset: number, length: number): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
};

/**
 * GIF: walk the block structure and count Image Descriptors. Two or more means
 * more than one frame, which is the definition of animated.
 *
 * Deliberately NOT the common shortcut of looking for a Graphics Control
 * Extension: a GCE is also how transparency is declared, and a single-frame
 * transparent GIF written by Pillow carries one (verified — offset 25 of a
 * 100-byte static GIF). Its presence says nothing about frame count.
 *
 * Returns `undefined` rather than `false` if the walk runs off the end of the
 * buffer, because "I stopped looking" is not "there is only one frame".
 */
const gifIsAnimated = (view: DataView): boolean | undefined => {
  const { byteLength } = view;
  if (byteLength < 13 || ascii(view, 0, 3) !== 'GIF') return undefined;

  // Logical Screen Descriptor: the packed field at byte 10 says whether a
  // Global Colour Table follows and how big it is (3 * 2^(N+1) bytes).
  const packed = view.getUint8(10);
  let offset = 13;
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);

  let frames = 0;
  while (offset < byteLength) {
    const block = view.getUint8(offset);

    if (block === 0x3b) return frames > 1; // trailer: the file ended cleanly
    if (block === 0x21) {
      // Extension: label, then length-prefixed sub-blocks until a 0 length.
      offset += 2;
      while (offset < byteLength) {
        const size = view.getUint8(offset);
        offset += 1 + size;
        if (size === 0) break;
      }
    } else if (block === 0x2c) {
      frames += 1;
      if (frames > 1) return true; // no need to read the rest of the file
      // Image Descriptor is 10 bytes; its packed field declares a Local Colour
      // Table the same way the global one did.
      const localPacked = view.getUint8(offset + 9);
      offset += 10;
      if (localPacked & 0x80) offset += 3 * 2 ** ((localPacked & 0x07) + 1);
      offset += 1; // LZW minimum code size
      while (offset < byteLength) {
        const size = view.getUint8(offset);
        offset += 1 + size;
        if (size === 0) break;
      }
    } else {
      return undefined; // not a structure we recognise; do not guess
    }
  }

  return undefined; // ran out of buffer before the trailer
};

/**
 * WebP: only the extended (VP8X) format can animate, and it says so in a flag.
 * Definitive both ways, and readable from the first 21 bytes.
 */
const webpIsAnimated = (view: DataView): boolean | undefined => {
  if (view.byteLength < 21) return undefined;
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WEBP') return undefined;
  if (ascii(view, 12, 4) !== 'VP8X') return false; // simple format: single frame
  return (view.getUint8(20) & 0x02) !== 0; // ANIM flag
};

/**
 * PNG/APNG: an APNG is a PNG carrying an `acTL` chunk before the first `IDAT`.
 * Chunks are `[u32 length][4-byte type][data][u32 crc]`, so this is an exact
 * walk rather than a search for the bytes anywhere in the file — `acTL` could
 * otherwise appear inside compressed pixel data by chance.
 */
const pngIsAnimated = (view: DataView): boolean | undefined => {
  if (view.byteLength < 8) return undefined;
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return undefined;

  let offset = 8;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset);
    const type = ascii(view, offset + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false; // acTL must precede IDAT
    offset += 12 + length;
  }
  return undefined;
};

/**
 * MSC4230: is this image animated?
 *
 * `true` / `false` are only returned when they were actually determined.
 * `undefined` means "could not tell" and the caller must OMIT the field rather
 * than write `false` — the spec treats an absent flag as unknown, and a
 * confidently wrong `false` would make receivers thumbnail an animation.
 */
export const blobIsAnimated = async (blob: Blob): Promise<boolean | undefined> => {
  // ImageDecoder is the authoritative answer and covers formats no hand-written
  // header check does (AVIF in particular). It is Chromium-only at the time of
  // writing, which covers WebView2 on Windows and Android's WebView, but not
  // WebKitGTK on the Linux desktop build — hence the fallbacks below.
  const decoderCtor = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder;
  if (decoderCtor && blob.type) {
    try {
      const decoder = new decoderCtor({ data: await blob.arrayBuffer(), type: blob.type });
      await decoder.tracks.ready;
      const animated = Array.from(decoder.tracks).some((track) => track.animated);
      decoder.close();
      return animated;
    } catch {
      // Unsupported type, or a decoder that refused the data. Fall through.
    }
  }

  const view = new DataView(await blob.slice(0, ANIMATION_SNIFF_BYTES).arrayBuffer());
  // Sniffed from the bytes, not from `blob.type` — a file picked from disk can
  // arrive with an empty or plainly wrong type, and the magic numbers cannot.
  const gif = gifIsAnimated(view);
  if (gif !== undefined) return gif;
  const webp = webpIsAnimated(view);
  if (webp !== undefined) return webp;
  return pngIsAnimated(view);
};

/**
 * The MSC4230 fields for an `info` object, ready to spread.
 *
 * Returns an EMPTY object when animation could not be determined. That is the
 * whole point of the tri-state: the spec reads an absent flag as "unknown",
 * while `is_animated: false` is a positive claim that this is a still image.
 */
export const animatedImageInfo = (
  animated: boolean | undefined,
): {
  [MATRIX_ANIMATED_PROPERTY_NAME]?: boolean;
  [MATRIX_ANIMATED_UNSTABLE_PROPERTY_NAME]?: boolean;
} =>
  animated === undefined
    ? {}
    : {
        [MATRIX_ANIMATED_PROPERTY_NAME]: animated,
        [MATRIX_ANIMATED_UNSTABLE_PROPERTY_NAME]: animated,
      };
