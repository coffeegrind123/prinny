import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { IPreviewUrlResponse } from 'matrix-js-sdk';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Spinner,
  Text,
  as,
  color,
  config,
  Button,
  Chip,
  toRem,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { RenderViewerProps, ImageOverlay } from '../ImageOverlay';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { UrlPreview, UrlPreviewContent, UrlPreviewImg } from './UrlPreview';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import * as css from './UrlPreviewCard.css';
import * as urlPreviewCss from './UrlPreview.css';
import { tryDecodeURIComponent } from '../../utils/dom';
import { mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ImageViewer } from '../image-viewer';
import { stopPropagation, onEnterOrSpace } from '../../utils/keyboard';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { isYoutubeUrl, getYoutubeVideoId } from '../../utils/youtube';
import { pipedEmbedUrl, usePipedInstance } from '../../utils/piped';
import { useYoutubeMeta } from '../../hooks/useYoutubeMeta';
import { fetchOgPreview } from '../../utils/tauri-og-preview';
import { hostnameOrUndefined, isWebUrl, webUrlOrUndefined } from '../../utils/safeUrl';
import { GifImage, ProxiedImg, ProxiedVideo } from './GifMedia';
import {
  isAlwaysAnimatedImageUrl,
  isAlwaysAnimatedMimeType,
  isAnimatedImageUrl,
  isGifStyleVideo,
  isImageUrl,
  parseTenorGif,
  urlHostname,
} from '../../utils/animatedMedia';
import { htmlToPlainText } from '../../utils/htmlText';
import { useHlsPlayback } from './useHlsPlayback';
import {
  bskyThreadToPost,
  fetchBskyPost,
  fetchBskyProfile,
  fetchVxTweet,
  getBskyPostInfo,
  getBskyProfileActor,
  getTwitterId,
  isVxGifMedia,
  SocialEmbedPost,
  vxTweetToPost,
} from '../../utils/socialEmbed';
import { mediaFeedRequestAtom } from '../../state/roomGallery';

const linkStyles = { color: color.Secondary.Main, textDecoration: 'none' };

// Hacker News item URLs: https://news.ycombinator.com/item?id=12345678
//
// Parsed with `new URL` rather than matched against the raw string. A regex
// over the whole URL accepts `https://evil.example/news.ycombinator.com/item?id=1`
// as readily as the real thing, and the id it yields is interpolated straight
// into an API path below — so the host check has to be made against a parsed
// origin, not against a substring of someone else's URL.
function getHnItemId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.hostname.replace(/\.$/, '').toLowerCase() !== 'news.ycombinator.com') return null;
  if (parsed.pathname !== '/item') return null;
  const id = parsed.searchParams.get('id');
  // Digits only, and bounded: the value is a path segment in the fetch below.
  return id !== null && /^\d{1,15}$/.test(id) ? id : null;
}

const HN_API = 'https://hacker-news.firebaseio.com/v0';

async function fetchHnItem(id: string): Promise<any> {
  const resp = await fetch(`${HN_API}/item/${id}.json`);
  if (!resp.ok) throw new Error(`hn item HTTP ${resp.status}`);
  const data = await resp.json();
  // An id that never existed, or one whose item has been purged, answers a
  // literal `null` body with a 200. Checking `resp.ok` alone would leave the
  // card rendering an empty shell instead of falling through to the
  // homeserver preview.
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('hn item: no such item');
  }
  // A deleted item keeps its id and timestamp and loses everything worth
  // showing — no title, no text, no author. Treated as a failure so the card
  // falls through rather than rendering a row of blanks. `dead` (flagged) is
  // NOT treated this way: those still carry their content.
  if (data.deleted === true) throw new Error('hn item: deleted');
  return data;
}

const RELATIVE_TIME_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

// HN timestamps are epoch SECONDS, unlike every other time value in this app.
function timeAgo(epochSeconds: unknown): string {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return '';
  }
  const delta = Math.round(Date.now() / 1000) - epochSeconds;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const unit = RELATIVE_TIME_UNITS.find(([, secs]) => Math.abs(delta) >= secs);
  if (!unit) return rtf.format(-delta, 'second');
  return rtf.format(-Math.round(delta / unit[1]), unit[0]);
}

const SOUNDCLOAK_HOST = 'sc1.maid.zone';
const SOUNDCLOAK_RESTREAM_PATH = '/_/api/restream/';

// The Piped instance is chosen from a curated allowlist (utils/piped.ts) via a
// reachability probe, never taken as free text from a message — so the only
// variable part of the iframe src is the video id, which `getYoutubeVideoId`
// already constrains, plus an origin that is guaranteed to be one of the pinned
// entries.
const YOUTUBE_EMBED_BASE = 'https://www.youtube.com/embed/';

function rewriteEmbedUrl(url: string, useSoundcloak: boolean): string {
  if (useSoundcloak) {
    const scMatch = url.match(/^https?:\/\/soundcloud\.com\/([^/]+)\/([^/?]+)/);
    if (scMatch) {
      // The two captured segments come straight out of a message-supplied URL.
      // Splicing them in raw let a crafted soundcloud.com link steer the
      // resulting soundcloak URL — `..%2f` style traversal, an injected `?`/`#`
      // that reparents the rest of the path into a query, or a second `//` that
      // changes which host the path resolves against. Percent-encode each
      // segment so it can only ever be one path component.
      return `https://${SOUNDCLOAK_HOST}${SOUNDCLOAK_RESTREAM_PATH}${encodeURIComponent(
        scMatch[1],
      )}/${encodeURIComponent(scMatch[2])}`;
    }
  }
  return url;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|ogg)(\?|$)/i.test(url);
}

function isAudioUrl(url: string): boolean {
  return /\.(mp3|wav|ogg|flac|m4a|aac)(\?|$)/i.test(url);
}

// True only for a real soundcloak restream endpoint. The previous unanchored
// substring test matched the path of any host — `https://attacker.example/
// sc1.maid.zone/_/api/restream/x` was treated as a trusted stream — and it ran
// even with the soundcloak integration switched off, so the rewrite could not
// be the only thing that produced such a URL.
function isSoundcloakStreamUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.host === SOUNDCLOAK_HOST &&
      parsed.pathname.startsWith(SOUNDCLOAK_RESTREAM_PATH)
    );
  } catch {
    return false;
  }
}

// `soundcloakEnabled` is required, not optional: a soundcloak stream URL is
// only ever legitimate when the user opted into the integration, so the check
// must not be consultable while the feature is off.
function isDirectAudioUrl(url: string, soundcloakEnabled: boolean): boolean {
  return isAudioUrl(url) || (soundcloakEnabled && isSoundcloakStreamUrl(url));
}

// Bandcamp's own embedded player, verified by parsing rather than by looking
// for `bandcamp.com/EmbeddedPlayer` anywhere in the string — the substring test
// also accepted `https://attacker.example/bandcamp.com/EmbeddedPlayer/x` and
// rendered the attacker's origin in an iframe. og:video is chosen by whoever
// controls the linked page, so it is untrusted input.
function isBandcampEmbedUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.host !== 'bandcamp.com' && !parsed.host.endsWith('.bandcamp.com')) return false;
    return parsed.pathname.startsWith('/EmbeddedPlayer');
  } catch {
    return false;
  }
}

// HLS-aware <video>. Bluesky videos are HLS m3u8 streams (`playlist`
// field on app.bsky.embed.video#view) and Chromium-based browsers
// don't play those natively — only Safari does. hls.js is loaded
// lazily via dynamic import so users who never see a bsky video
// don't pay the ~80kB-gzipped bundle hit.
function HlsVideo({
  src,
  poster,
  width,
  height,
  className,
  renderOverlay,
}: {
  src: string;
  poster?: string;
  width?: number;
  height?: number;
  className?: string;
  /** Chrome drawn over the player — see `ProxiedVideo`'s own `renderOverlay`. */
  renderOverlay?: () => ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const errorMsg = useHlsPlayback(videoRef, src);

  const aspect = width && height ? `${width} / ${height}` : '16 / 9';

  // `src` (the HLS playlist) and `poster` come from the Bluesky API response,
  // i.e. remote JSON. Validate the scheme before either reaches a media
  // element — see the note in ProxiedVideo.
  if (!isWebUrl(src)) return null;
  const safePoster = webUrlOrUndefined(poster);

  if (errorMsg) {
    return (
      <Box
        direction="Column"
        gap="100"
        alignItems="Center"
        justifyContent="Center"
        style={{
          width: '100%',
          aspectRatio: aspect,
          maxHeight: toRem(320),
          backgroundColor: color.SurfaceVariant.Container,
          padding: config.space.S300,
        }}
      >
        {safePoster && (
          <img
            src={safePoster}
            alt=""
            referrerPolicy="no-referrer"
            style={{ maxHeight: '60%', borderRadius: 4 }}
          />
        )}
        <Text size="T200" align="Center">
          {errorMsg}
        </Text>
      </Box>
    );
  }

  const video = (
    <video
      ref={videoRef}
      poster={safePoster}
      controls
      loop
      playsInline
      preload="metadata"
      // Inert in a spec-following engine — media elements have no
      // `referrerpolicy` content attribute — and kept only because it costs
      // nothing. hls.js fetches the segments itself, so the referrer on those
      // requests is decided by the loader, not by this element. A spread emits
      // it without tripping React's excess-property checking.
      {...{ referrerPolicy: 'no-referrer' }}
      style={{ aspectRatio: aspect, width: '100%' }}
      className={className}
      onClick={(e) => e.stopPropagation()}
    />
  );

  if (!renderOverlay) return video;
  return (
    <Box style={{ position: 'relative', width: '100%' }}>
      {video}
      <Box
        style={{ position: 'absolute', left: 8, top: 8 }}
        onClick={(evt) => evt.stopPropagation()}
      >
        {renderOverlay()}
      </Box>
    </Box>
  );
}

export const UrlPreviewCard = as<
  'div',
  {
    url: string;
    ts: number;
    renderViewer?: (props: RenderViewerProps) => ReactNode;
    /**
     * Where the message carrying this link lives.
     *
     * Both are needed to open a picture from the card in the room's media feed
     * — the feed is a room's whole media history, so there has to be a room and
     * an event for the picture to sit in. Without them (search results, pinned
     * previews, the notification inbox) the card keeps the single-image viewer,
     * which is the right fallback there for the same reason it is for an
     * attachment in those places: there is no surrounding feed to swipe.
     */
    roomId?: string;
    eventId?: string;
  }
>(({ url, ts, renderViewer, roomId, eventId, ...props }, ref) => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [useVxTwitter] = useSetting(settingsAtom, 'useVxTwitter');
  const [useSoundcloak] = useSetting(settingsAtom, 'useSoundcloak');
  const [useBlueskyEmbeds] = useSetting(settingsAtom, 'useBlueskyEmbeds');
  const [useHackerNewsEmbeds] = useSetting(settingsAtom, 'useHackerNewsEmbeds');
  const [usePiped] = useSetting(settingsAtom, 'usePiped');
  const [pipedInstance] = useSetting(settingsAtom, 'pipedInstance');
  const pipedBase = usePipedInstance(pipedInstance);
  const [clientPreviewFallback] = useSetting(settingsAtom, 'clientPreviewFallback');
  // Asked for every YouTube link, from the same host the iframe embeds — see
  // useYoutubeMeta. `isYoutubeUrl`/`getYoutubeVideoId` are recomputed here
  // rather than reusing `ytVideoId` below because hooks cannot wait for it:
  // several early returns sit between the two, and this must run on every
  // render regardless of which branch the card takes.
  const ytMeta = useYoutubeMeta(
    isYoutubeUrl(url) ? getYoutubeVideoId(url) : null,
    usePiped,
    pipedBase,
  );

  // The previewed URL itself is message content, and it is rendered into five
  // separate `<a href>` positions below. Every value derived from the preview
  // metadata is scheme-checked individually, but `url` arrives from the caller's
  // URL extractor, so gate it once here rather than at each anchor. In the Tauri
  // shell an anchor with `target="_blank"` reaches the OS URL opener.
  const safeUrl = webUrlOrUndefined(url);

  const embedUrl = rewriteEmbedUrl(url, useSoundcloak);
  const twId = useVxTwitter ? getTwitterId(url) : null;
  // Gated like the Twitter path above. Merely rendering a message containing a
  // bsky.app link otherwise fired two unprompted cross-origin requests to
  // public.api.bsky.app (resolveHandle, then getPostThread), which discloses
  // the viewer's IP to a host the message *sender* picked and tells that
  // sender when the message was rendered — a read receipt they control.
  const bskyPost = useBlueskyEmbeds ? getBskyPostInfo(url) : null;
  // Gated identically to the post path: rendering a message must not fire an
  // unprompted request to a host the *sender* chose.
  const bskyActor = useBlueskyEmbeds && !bskyPost ? getBskyProfileActor(url) : null;
  // Gated for the same reason as the two above, even though the host here is
  // fixed: the request still happens because a *sender* put an HN link in a
  // message, so it discloses the viewer's IP to firebaseio.com on someone
  // else's cue and tells that sender when the message was rendered.
  const hnItemId = useHackerNewsEmbeds ? getHnItemId(url) : null;

  // vxtwitter client-side fetch
  const [vxData, setVxData] = useState<any>(null);
  const [vxLoading, setVxLoading] = useState(false);
  // Read, not just written: it gates the homeserver preview below.
  const [vxError, setVxError] = useState(false);
  useEffect(() => {
    if (!twId) return;
    setVxLoading(true);
    setVxError(false);
    fetchVxTweet(twId)
      .then((d) => {
        setVxData(d);
        setVxLoading(false);
      })
      .catch(() => {
        setVxError(true);
        setVxLoading(false);
      });
  }, [twId]);

  // Bluesky client-side fetch — public API, no auth needed.
  const [bskyData, setBskyData] = useState<any>(null);
  const [bskyLoading, setBskyLoading] = useState(false);
  // Read, not just written: it is what lets a failed post fetch fall through to
  // the ordinary preview instead of leaving the message with no card at all.
  const [bskyError, setBskyError] = useState(false);
  useEffect(() => {
    if (!bskyPost) return;
    setBskyLoading(true);
    setBskyError(false);
    fetchBskyPost(bskyPost.actor, bskyPost.rkey)
      .then((d) => {
        setBskyData(d);
        setBskyLoading(false);
      })
      .catch(() => {
        setBskyError(true);
        setBskyLoading(false);
      });
    // bskyPost is a fresh object each render — narrow deps to its primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bskyPost?.actor, bskyPost?.rkey]);

  // Bluesky profile fetch — public API, no auth.
  const [bskyProfile, setBskyProfile] = useState<any>(null);
  const [bskyProfileLoading, setBskyProfileLoading] = useState(false);
  const [bskyProfileError, setBskyProfileError] = useState(false);
  useEffect(() => {
    if (!bskyActor) return;
    setBskyProfileLoading(true);
    setBskyProfileError(false);
    fetchBskyProfile(bskyActor)
      .then((d) => {
        setBskyProfile(d);
        setBskyProfileLoading(false);
      })
      .catch(() => {
        setBskyProfileError(true);
        setBskyProfileLoading(false);
      });
  }, [bskyActor]);

  // Hacker News item fetch — public API, no key, no auth, CORS open.
  const [hnItem, setHnItem] = useState<any>(null);
  const [hnLoading, setHnLoading] = useState(false);
  // Read, not just written: it decides between rendering the HN card and
  // falling through to the homeserver preview.
  const [hnError, setHnError] = useState(false);
  useEffect(() => {
    if (!hnItemId) return;
    setHnLoading(true);
    setHnError(false);
    fetchHnItem(hnItemId)
      .then((d) => {
        setHnItem(d);
        setHnLoading(false);
      })
      .catch(() => {
        setHnError(true);
        setHnLoading(false);
      });
  }, [hnItemId]);

  const [viewerSrc, setViewerSrc] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Set once the homeserver has refused to thumbnail this card's og:image, so
  // the image sources below switch to the original for the rest of this card's
  // life. Without the latch the failing <img> re-requests the same rejected
  // thumbnail on every re-render — the console fills with identical 400s and
  // the card never recovers. Keyed on `url` so a recycled card starts clean.
  const [thumbnailRejected, setThumbnailRejected] = useState(false);
  useEffect(() => {
    setThumbnailRejected(false);
  }, [url]);

  const [mediaFeedViewer] = useSetting(settingsAtom, 'mediaFeedViewer');
  const setMediaFeedRequest = useSetAtom(mediaFeedRequestAtom);
  /** Whether a picture in this card can be opened in the room's media feed. */
  const feedAvailable = mediaFeedViewer && !!roomId && !!eventId;

  /**
   * Open one picture of this post in the room's media feed.
   *
   * The post is handed over whole rather than as a URL, because the feed's
   * entries are keyed by the picture's *position* in the post and only
   * `socialEmbed`'s normalisers know that order — this card draws images and
   * videos in separate rows, so its own layout order is not it. Matching the
   * clicked URL against the normalised list is what bridges the two.
   *
   * Returns false when there is nothing to open — no room context, the feed
   * switched off, or a picture that is not part of the post at all (a link
   * card's thumbnail, which the gallery deliberately does not collect). The
   * callers fall back to the plain single-image viewer on false, so switching
   * `mediaFeedViewer` off restores exactly the old behaviour.
   */
  const openPostMediaInFeed = useCallback(
    (post: SocialEmbedPost | undefined, mediaUrl: string | undefined): boolean => {
      if (!feedAvailable || !roomId || !eventId || !post || !mediaUrl) return false;
      const index = post.media.findIndex((media) => media.url === mediaUrl);
      if (index < 0) return false;
      setMediaFeedRequest({ roomId, eventId, embed: { ts, post, index } });
      return true;
    },
    [feedAvailable, roomId, eventId, ts, setMediaFeedRequest],
  );

  /**
   * The "Feed" chip a post's video gets, or nothing when the feed cannot take
   * it.
   *
   * A video is not opened by clicking it — the click belongs to the player —
   * so it gets the same chip an uploaded video gets in the timeline rather
   * than the click behaviour a picture gets.
   */
  const renderFeedChip = (
    post: SocialEmbedPost | undefined,
    mediaUrl: string | undefined,
  ): (() => ReactNode) | undefined => {
    if (!feedAvailable || !post || !mediaUrl) return undefined;
    if (!post.media.some((media) => media.url === mediaUrl)) return undefined;
    return () => (
      <Chip
        variant="Secondary"
        radii="Pill"
        size="400"
        onClick={() => openPostMediaInFeed(post, mediaUrl)}
        before={<Icon size="50" src={Icons.Category} />}
        aria-label="Watch in the media feed"
      >
        <Text size="B300">Feed</Text>
      </Chip>
    );
  };

  const isYt = isYoutubeUrl(url);
  const ytVideoId = isYt ? getYoutubeVideoId(url) : null;

  // Single source of truth for "this renders as a bare audio player". The
  // soundcloak arm is only consulted when the integration is switched on.
  const directAudioEmbed = isDirectAudioUrl(embedUrl, useSoundcloak);
  const directAudio = directAudioEmbed || isAudioUrl(url);

  const [previewStatus, loadPreview] = useAsyncCallback(
    useCallback(() => mx.getUrlPreview(embedUrl, ts), [embedUrl, ts, mx]),
  );

  // Ask the homeserver for a preview only when its answer can actually be used.
  //
  // Direct audio (soundcloak restream, raw mp3/ogg): homeservers reject
  // non-text content types with 502 "content type not allowed", and the audio
  // renderer below needs no OG data anyway.
  //
  // Twitter/X while our own renderer is in play: the card is built from
  // api.vxtwitter.com and the homeserver's answer is discarded unread. Worse,
  // it is an answer nobody could use — fetched from here, `x.com` replies 200
  // with `<title>Post / X</title>`, a stock `og:image` and no tweet text at
  // all, because X serves scrapers a placeholder. From a homeserver's address
  // it commonly refuses outright with 403, which Synapse relays as the
  // `[502] Got error 403` in the console. That error is X declining to be
  // scraped, not a fault in the homeserver or this client — the fix is not to
  // ask. It IS asked once vxtwitter itself fails, because that is the one case
  // where the standard card is what gets rendered.
  const skipHomeserverPreview = directAudio || (twId !== null && !vxError);

  useEffect(() => {
    if (skipHomeserverPreview) return;
    // The rejection is deliberately swallowed: `useAsyncCallback` records the
    // failure in `previewStatus` (which drives both the fallback below and the
    // decision to render nothing) AND re-throws so callers that await it can
    // handle it. Nothing awaits this one, so without a catch every failed
    // preview surfaced as an "Uncaught (in promise) MatrixError" in the
    // console. A homeserver returning 502 here is routine — it means the target
    // site refused Synapse's preview fetcher, which is not this client's
    // problem to report.
    loadPreview().catch(() => {});
  }, [loadPreview, skipHomeserverPreview]);

  // Client-side OG fallback (desktop/mobile app, opt-in). When the homeserver
  // preview_url errors — e.g. a 504 because the target rejects Synapse's
  // non-browser User-Agent — fetch the page ourselves and parse its meta tags.
  // Skipped for URLs that already have a dedicated renderer (Twitter, Bluesky,
  // YouTube, direct audio) since those don't rely on the homeserver preview.
  const [ogFallback, setOgFallback] = useState<IPreviewUrlResponse | null>(null);
  const [ogFallbackTried, setOgFallbackTried] = useState(false);
  useEffect(() => {
    if (!clientPreviewFallback) return;
    if (previewStatus.status !== AsyncStatus.Error) return;
    if (ogFallbackTried) return;
    // A dedicated renderer only holds this off while it can still produce a
    // card. Once its own API has definitively failed — three attempts, see
    // `socialEmbed` — there is nothing else coming, and skipping the fallback
    // here is what turned a moment's bad connection into a message with no
    // preview at all. `bsky.app` and `x.com` both serve real og: tags to a
    // fetcher, so this recovers a genuine card rather than an empty one.
    if (twId && !vxError) return;
    if (bskyPost && !bskyError) return;
    if (bskyActor && !bskyProfileError) return;
    if (hnItemId && !hnError) return;
    if (isYt) return;
    if (directAudio) return;
    setOgFallbackTried(true);
    fetchOgPreview(embedUrl).then((data) => {
      if (data) setOgFallback(data as IPreviewUrlResponse);
    });
    // bskyPost is a fresh object each render — depend on its primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clientPreviewFallback,
    previewStatus.status,
    ogFallbackTried,
    twId,
    vxError,
    bskyPost?.actor,
    bskyPost?.rkey,
    bskyError,
    bskyActor,
    bskyProfileError,
    hnItemId,
    hnError,
    isYt,
    directAudio,
    embedUrl,
  ]);

  if (twId && dismissed) return null;
  // vxtwitter path — render directly from API response
  if (twId && vxData) {
    const allMedia = (vxData.media_extended ?? []) as Array<{
      type: string;
      url: string;
      thumbnail_url?: string;
      altText?: string;
      duration_millis?: number;
      size?: { width: number; height: number };
    }>;
    // A GIF and a video are the same media kind on Twitter's wire format and
    // only the presentation differs — a GIF must autoplay, loop and show no
    // chrome. `isVxGifMedia` carries the reasoning for how the two are told
    // apart; the gallery scan needs the identical call.
    const isGifMedia = isVxGifMedia;
    // The same post the media scan would build for this link, so a picture
    // clicked here and the gallery entry for it are one and the same.
    const twPost = vxTweetToPost(url, twId, vxData);
    return (
      <UrlPreview {...props} ref={ref}>
        <Box grow="Yes" direction="Column" style={{ position: 'relative', minWidth: 0 }}>
          <IconButton
            size="300"
            radii="300"
            variant="SurfaceVariant"
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            aria-label="Dismiss embed"
            style={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
          >
            <Icon size="50" src={Icons.Cross} />
          </IconButton>
          {(() => {
            const imgs = allMedia.filter((m) => m.type === 'image' || m.type === 'photo');
            const vids = allMedia.filter((m) => m.type === 'video' || m.type === 'gif');
            return (
              <>
                {imgs.length > 0 && (
                  <Box direction="Row" gap="100" style={{ width: '100%', flexWrap: 'wrap' }}>
                    {imgs.map((m, i) => {
                      // 1 image: full width. 2+: 2-column grid that fills.
                      const basis = imgs.length === 1 ? '100%' : 'calc(50% - 2px)';
                      return (
                        <Box
                          key={i}
                          style={{
                            flexBasis: basis,
                            flexGrow: 1,
                            minWidth: '160px',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            borderRadius: '8px',
                          }}
                        >
                          <ProxiedImg
                            src={m.url}
                            alt={m.altText || vxData.text || ''}
                            title={m.altText || vxData.text}
                            onView={() => {
                              if (!openPostMediaInFeed(twPost, m.url)) setViewerSrc(m.url);
                            }}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                )}
                {vids.map((m, i) => (
                  <ProxiedVideo
                    key={i}
                    src={m.url}
                    poster={m.thumbnail_url}
                    isGif={isGifMedia(m)}
                    width={m.size?.width}
                    height={m.size?.height}
                    className={urlPreviewCss.UrlPreviewVideo}
                    renderOverlay={renderFeedChip(twPost, m.url)}
                  />
                ))}
              </>
            );
          })()}
          <UrlPreviewContent>
            <Text
              style={linkStyles}
              truncate
              as="a"
              href={safeUrl}
              target="_blank"
              rel="noreferrer"
              size="T200"
              priority="300"
            >
              {vxData.user_name
                ? `${vxData.user_name}${vxData.user_screen_name ? ` (@${vxData.user_screen_name})` : ''} | `
                : ''}
              {tryDecodeURIComponent(url)}
            </Text>
            {vxData.text && <Text size="T300">{vxData.text}</Text>}
            <Text size="T200" priority="300">
              {`${vxData.likes ?? 0} likes · ${vxData.retweets ?? 0} retweets · ${vxData.replies ?? 0} replies`}
            </Text>
          </UrlPreviewContent>
          {viewerSrc && renderViewer && (
            <ImageOverlay
              src={viewerSrc}
              alt={vxData.text || 'Image'}
              viewer={!!viewerSrc}
              requestClose={() => setViewerSrc(undefined)}
              renderViewer={renderViewer}
              externalUrl={url}
            />
          )}
          {viewerSrc && !renderViewer && (
            <Overlay open backdrop={<OverlayBackdrop />}>
              <OverlayCenter>
                <FocusTrap
                  focusTrapOptions={{
                    initialFocus: false,
                    onDeactivate: () => setViewerSrc(undefined),
                    clickOutsideDeactivates: true,
                    escapeDeactivates: stopPropagation,
                  }}
                >
                  <ImageViewer
                    src={viewerSrc}
                    alt={vxData.text || 'Image'}
                    requestClose={() => setViewerSrc(undefined)}
                    externalUrl={url}
                  />
                </FocusTrap>
              </OverlayCenter>
            </Overlay>
          )}
        </Box>
      </UrlPreview>
    );
  }
  if (twId && vxLoading) {
    return (
      <UrlPreview {...props} ref={ref}>
        <Box
          grow="Yes"
          alignItems="Center"
          justifyContent="Center"
          style={{ padding: config.space.S400 }}
        >
          <Spinner variant="Secondary" size="400" />
        </Box>
      </UrlPreview>
    );
  }
  // vxError: fall through to standard preview so Matrix og: metadata still shows

  // Bluesky native render — uses public getPostThread API; supports
  // multi-image posts (1–4 images) plus video and external-link embeds.
  if (bskyPost && dismissed) return null;
  if (bskyPost && bskyData) {
    const post = bskyData?.thread?.post;
    const author = post?.author;
    const record = post?.record ?? {};
    const embed = post?.embed ?? {};
    const images: Array<{
      thumb: string;
      fullsize: string;
      alt?: string;
      aspectRatio?: { height: number; width: number };
    }> = Array.isArray(embed.images) ? embed.images : [];
    // recordWithMedia#view: media nested under embed.media
    const mediaImages: typeof images = Array.isArray(embed.media?.images) ? embed.media.images : [];
    const allImages = images.length ? images : mediaImages;

    const videoView =
      embed.$type === 'app.bsky.embed.video#view' ||
      embed.media?.$type === 'app.bsky.embed.video#view'
        ? embed.$type === 'app.bsky.embed.video#view'
          ? embed
          : embed.media
        : null;
    const externalView =
      embed.$type === 'app.bsky.embed.external#view'
        ? embed.external
        : embed.media?.$type === 'app.bsky.embed.external#view'
          ? embed.media.external
          : null;

    const displayName = author?.displayName || author?.handle || 'Bluesky';
    const handle = author?.handle ? `@${author.handle}` : '';
    // As on the Twitter path: the post exactly as the media scan builds it,
    // so a picture clicked here names the gallery entry for that picture.
    const bskySocialPost = bskyThreadToPost(url, bskyPost.actor, bskyPost.rkey, bskyData);

    return (
      <UrlPreview {...props} ref={ref}>
        <Box grow="Yes" direction="Column" style={{ position: 'relative', minWidth: 0 }}>
          <IconButton
            size="300"
            radii="300"
            variant="SurfaceVariant"
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            aria-label="Dismiss embed"
            style={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
          >
            <Icon size="50" src={Icons.Cross} />
          </IconButton>
          {allImages.length > 0 && (
            <Box direction="Row" gap="100" style={{ width: '100%', flexWrap: 'wrap' }}>
              {allImages.map((img, i) => {
                // 1 image: full width. 2+: 2-column grid that fills.
                const basis = allImages.length === 1 ? '100%' : 'calc(50% - 2px)';
                return (
                  <Box
                    key={i}
                    style={{
                      flexBasis: basis,
                      flexGrow: 1,
                      minWidth: '160px',
                      maxWidth: '100%',
                      overflow: 'hidden',
                      borderRadius: '8px',
                    }}
                  >
                    <ProxiedImg
                      src={img.fullsize || img.thumb}
                      alt={img.alt || ''}
                      title={img.alt}
                      onView={() => {
                        const src = img.fullsize || img.thumb;
                        if (!openPostMediaInFeed(bskySocialPost, src)) setViewerSrc(src);
                      }}
                    />
                  </Box>
                );
              })}
            </Box>
          )}
          {videoView && videoView.playlist && (
            <HlsVideo
              src={videoView.playlist}
              poster={videoView.thumbnail}
              width={videoView.aspectRatio?.width}
              height={videoView.aspectRatio?.height}
              className={urlPreviewCss.UrlPreviewVideo}
              renderOverlay={renderFeedChip(bskySocialPost, videoView.playlist)}
            />
          )}
          {externalView && (
            <Box direction="Column" gap="100" style={{ padding: config.space.S200 }}>
              {/* A GIF posted on Bluesky is not a media embed at all — it is an
                  *external link* embed whose `uri` is the Tenor GIF. Rendering
                  only `thumb` therefore showed a still frame for every Bluesky
                  GIF. Prefer Tenor's own video renditions (48 KB webm / 58 KB
                  mp4 against 3.3 MB for the GIF the uri points at), and fall
                  back to the GIF itself for any other animated external link,
                  which an <img> animates with no autoplay policy attached. */}
              {(() => {
                const tenorGif = parseTenorGif(externalView.uri);
                if (tenorGif) {
                  const tenorSrc = tenorGif.sources[tenorGif.sources.length - 1].src;
                  return (
                    <ProxiedVideo
                      src={tenorSrc}
                      sources={tenorGif.sources}
                      poster={externalView.thumb}
                      isGif
                      width={tenorGif.width}
                      height={tenorGif.height}
                      className={urlPreviewCss.UrlPreviewVideo}
                      renderOverlay={renderFeedChip(bskySocialPost, tenorSrc)}
                    />
                  );
                }
                if (isAnimatedImageUrl(externalView.uri)) {
                  return (
                    <GifImage
                      src={externalView.uri}
                      alt={externalView.title || ''}
                      title={externalView.title}
                      onView={() => {
                        if (!openPostMediaInFeed(bskySocialPost, externalView.uri))
                          setViewerSrc(externalView.uri);
                      }}
                    />
                  );
                }
                return (
                  externalView.thumb && (
                    <ProxiedImg
                      src={externalView.thumb}
                      alt={externalView.title || ''}
                      onView={() => setViewerSrc(externalView.thumb)}
                    />
                  )
                );
              })()}
              {externalView.title &&
                // `uri` is whatever the Bluesky API returned for an embed the
                // post author controls. Only link it when it is http(s) — in
                // the Tauri shell an href with any other scheme is forwarded to
                // the OS URL opener, i.e. it launches a local protocol handler.
                // Otherwise still show the title, just not as a link.
                (isWebUrl(externalView.uri) ? (
                  <Text size="T300" priority="500">
                    <a href={externalView.uri} target="_blank" rel="noreferrer" style={linkStyles}>
                      {externalView.title}
                    </a>
                  </Text>
                ) : (
                  <Text size="T300" priority="500">
                    {externalView.title}
                  </Text>
                ))}
              {externalView.description && (
                <Text size="T200" priority="300">
                  {externalView.description}
                </Text>
              )}
            </Box>
          )}
          <UrlPreviewContent>
            <Text
              style={linkStyles}
              truncate
              as="a"
              href={safeUrl}
              target="_blank"
              rel="noreferrer"
              size="T200"
              priority="300"
            >
              {`${displayName}${handle ? ` ${handle}` : ''} | `}
              {tryDecodeURIComponent(url)}
            </Text>
            {typeof record.text === 'string' && record.text.length > 0 && (
              <Text size="T300" style={{ whiteSpace: 'pre-wrap' }}>
                {record.text}
              </Text>
            )}
            <Text size="T200" priority="300">
              {`${post?.likeCount ?? 0} likes · ${post?.repostCount ?? 0} reposts · ${post?.replyCount ?? 0} replies${
                typeof post?.quoteCount === 'number' && post.quoteCount > 0
                  ? ` · ${post.quoteCount} quotes`
                  : ''
              }`}
            </Text>
          </UrlPreviewContent>
          {viewerSrc && renderViewer && (
            <ImageOverlay
              src={viewerSrc}
              alt={record.text || 'Image'}
              viewer={!!viewerSrc}
              requestClose={() => setViewerSrc(undefined)}
              renderViewer={renderViewer}
              externalUrl={url}
            />
          )}
          {viewerSrc && !renderViewer && (
            <Overlay open backdrop={<OverlayBackdrop />}>
              <OverlayCenter>
                <FocusTrap
                  focusTrapOptions={{
                    initialFocus: false,
                    onDeactivate: () => setViewerSrc(undefined),
                    clickOutsideDeactivates: true,
                    escapeDeactivates: stopPropagation,
                  }}
                >
                  <ImageViewer
                    src={viewerSrc}
                    alt={record.text || 'Image'}
                    requestClose={() => setViewerSrc(undefined)}
                    externalUrl={url}
                  />
                </FocusTrap>
              </OverlayCenter>
            </Overlay>
          )}
        </Box>
      </UrlPreview>
    );
  }
  // Bluesky PROFILE card. Every field comes from a third-party API, so the
  // avatar is scheme-checked before it reaches an <img src> and the text
  // fields render as React children (escaped) with hard length bounds.
  if (bskyActor && dismissed) return null;
  if (bskyActor && bskyProfile && !bskyProfileError) {
    const pr = bskyProfile;
    const handle = typeof pr.handle === 'string' ? pr.handle.slice(0, 253) : bskyActor;
    const displayName =
      typeof pr.displayName === 'string' && pr.displayName.trim()
        ? pr.displayName.slice(0, 120)
        : handle;
    const description = typeof pr.description === 'string' ? pr.description.slice(0, 500) : '';
    const avatar = webUrlOrUndefined(pr.avatar);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

    return (
      <UrlPreview {...props} ref={ref}>
        <Box
          as="a"
          {...{ href: safeUrl, target: '_blank', rel: 'noreferrer noopener' }}
          direction="Column"
          gap="200"
          style={{ padding: config.space.S300, textDecoration: 'none', color: 'inherit' }}
        >
          <Box gap="300" alignItems="Center">
            {avatar && (
              <img
                src={avatar}
                alt=""
                width={48}
                height={48}
                style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
              />
            )}
            <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
              <Text size="T300" truncate>
                <b>{displayName}</b>
              </Text>
              <Text size="T200" priority="300" truncate>
                @{handle}
              </Text>
            </Box>
          </Box>

          {description && (
            <Text size="T200" style={{ whiteSpace: 'pre-wrap' }}>
              {description}
            </Text>
          )}

          <Box gap="300" wrap="Wrap">
            <Text size="T200" priority="300">
              <b>{num(pr.followersCount).toLocaleString()}</b> followers
            </Text>
            <Text size="T200" priority="300">
              <b>{num(pr.followsCount).toLocaleString()}</b> following
            </Text>
            <Text size="T200" priority="300">
              <b>{num(pr.postsCount).toLocaleString()}</b> posts
            </Text>
            <Text size="T200" priority="400">
              Bluesky
            </Text>
          </Box>
        </Box>
      </UrlPreview>
    );
  }
  if (bskyActor && bskyProfileLoading) {
    return (
      <UrlPreview {...props} ref={ref}>
        <Box
          grow="Yes"
          alignItems="Center"
          justifyContent="Center"
          style={{ padding: config.space.S400 }}
        >
          <Spinner variant="Secondary" size="400" />
        </Box>
      </UrlPreview>
    );
  }
  // bskyProfileError: fall through to the Matrix og: preview.

  if (bskyPost && bskyLoading) {
    return (
      <UrlPreview {...props} ref={ref}>
        <Box
          grow="Yes"
          alignItems="Center"
          justifyContent="Center"
          style={{ padding: config.space.S400 }}
        >
          <Spinner variant="Secondary" size="400" />
        </Box>
      </UrlPreview>
    );
  }
  // bskyError: fall through to Matrix og: preview

  // Hacker News card. HN serves no OpenGraph metadata at all, so the
  // homeserver preview falls back to scraping the page and the description
  // comes out as the site's navigation strip ("new | past | comments | ask |
  // show | jobs | submit login") followed by fragments of the story line. That
  // data is junk at the source — no amount of rendering fixes it, only a
  // different source does.
  //
  // Every field below is third-party JSON, so it is treated exactly like the
  // Bluesky card's: strings are length-bounded and rendered as React children
  // (escaped), numbers are range-checked, and the outbound story link is
  // scheme-checked with `webUrlOrUndefined` before it reaches an href.
  if (hnItemId && hnItem && !hnError) {
    const title = typeof hnItem.title === 'string' ? hnItem.title.slice(0, 300) : '';
    const author = typeof hnItem.by === 'string' ? hnItem.by.slice(0, 64) : '';
    // Present on a story that links out, absent on Ask HN and on comments —
    // in which case the card's own link is the HN discussion itself.
    const itemUrl = webUrlOrUndefined(hnItem.url);
    const host = itemUrl ? urlHostname(itemUrl).replace(/^www\./, '') : '';
    // Ask HN / Show HN bodies and comment bodies arrive as an HTML fragment.
    // Flattened to text and handed to React as a string — never as markup.
    const body = typeof hnItem.text === 'string' ? htmlToPlainText(hnItem.text).slice(0, 1000) : '';
    const count = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
    const score = count(hnItem.score);
    const comments = count(hnItem.descendants);
    const posted = timeAgo(hnItem.time);
    const headingHref = itemUrl ?? safeUrl;

    return (
      <UrlPreview {...props} ref={ref}>
        <Box
          direction="Column"
          gap="200"
          grow="Yes"
          style={{ padding: config.space.S300, minWidth: 0 }}
        >
          <Box gap="200" alignItems="Center" wrap="Wrap">
            <Text size="T200" priority="400">
              Hacker News
            </Text>
            {host && (
              <Text size="T200" priority="300" truncate>
                {host}
              </Text>
            )}
          </Box>

          {title &&
            (headingHref ? (
              <Text size="T300">
                <a href={headingHref} target="_blank" rel="noreferrer noopener" style={linkStyles}>
                  <b>{title}</b>
                </a>
              </Text>
            ) : (
              <Text size="T300">
                <b>{title}</b>
              </Text>
            ))}

          {body && (
            <Text size="T200" style={{ whiteSpace: 'pre-wrap' }}>
              {body}
            </Text>
          )}

          <Box gap="300" wrap="Wrap" alignItems="Center">
            {score !== null && (
              <Text size="T200" priority="300">
                <b>{score.toLocaleString()}</b> {score === 1 ? 'point' : 'points'}
              </Text>
            )}
            {author && (
              <Text size="T200" priority="300">
                by <b>{author}</b>
              </Text>
            )}
            {posted && (
              <Text size="T200" priority="300">
                {posted}
              </Text>
            )}
            {comments !== null && safeUrl && (
              <Text size="T200" priority="300">
                <a href={safeUrl} target="_blank" rel="noreferrer noopener" style={linkStyles}>
                  <b>{comments.toLocaleString()}</b> {comments === 1 ? 'comment' : 'comments'}
                </a>
              </Text>
            )}
            {comments === null && safeUrl && (
              <Text size="T200" priority="300">
                <a href={safeUrl} target="_blank" rel="noreferrer noopener" style={linkStyles}>
                  Discuss on Hacker News
                </a>
              </Text>
            )}
          </Box>
        </Box>
      </UrlPreview>
    );
  }
  if (hnItemId && hnLoading) {
    return (
      <UrlPreview {...props} ref={ref}>
        <Box
          grow="Yes"
          alignItems="Center"
          justifyContent="Center"
          style={{ padding: config.space.S400 }}
        >
          <Spinner variant="Secondary" size="400" />
        </Box>
      </UrlPreview>
    );
  }
  // hnError: fall through to the Matrix og: preview. It is a poor card, but a
  // poor card beats no card when the API is unreachable.

  // SoundCloud/soundcloak or direct MP3 — render audio player directly, skip preview
  if (directAudio) {
    const audioSrc = directAudioEmbed ? embedUrl : url;
    return (
      <Box direction="Column" style={{ padding: config.space.S200 }} gap="100">
        {/* isAudioUrl only inspects the file extension, so the scheme still
            has to be checked before the value reaches a media element. */}
        {isWebUrl(audioSrc) && (
          <audio
            className={urlPreviewCss.UrlPreviewVideo}
            src={audioSrc}
            controls
            preload="metadata"
          />
        )}
        <Text size="T200" priority="300">
          <a
            href={safeUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: color.Secondary.Main, textDecoration: 'none' }}
          >
            {tryDecodeURIComponent(url)}
          </a>
        </Text>
      </Box>
    );
  }

  const effectivePreview =
    previewStatus.status === AsyncStatus.Success ? previewStatus.data : ogFallback;

  // Keep rendering nothing while a fallback fetch is still outstanding (status
  // is Error but we've opted in and haven't given up) so the card can appear
  // once the fallback resolves instead of being permanently suppressed.
  const fallbackPending =
    clientPreviewFallback &&
    previewStatus.status === AsyncStatus.Error &&
    !ogFallback &&
    !ogFallbackTried;

  // A link that IS the media renders without any preview data. A bare
  // .mp4/.mp3/.gif serves no HTML, so the homeserver has nothing to scrape and
  // returns an empty preview — which used to bail out here and render nothing
  // at all. Images belong in this set for the same reason videos do: when a
  // homeserver has url previews disabled, or its preview fetch fails, a linked
  // GIF produced no card whatsoever rather than the animation the link names.
  const isDirectMediaLink =
    isWebUrl(url) && (isVideoUrl(url) || isAudioUrl(url) || isImageUrl(url));

  // Same reasoning as a direct media link: the YouTube branch builds its player
  // from the video id and its title from `ytMeta`, so it needs nothing the
  // homeserver could have scraped. Without this a link whose preview YouTube
  // refused to serve — the common case, not the rare one — rendered no card at
  // all rather than a working embed.
  const isEmbeddableYoutube = isYt && !!ytVideoId;

  /**
   * Which dedicated renderer owns this link, if any — regardless of whether
   * its setting is on, because "it is switched off" is one of the answers.
   */
  const dedicated = (() => {
    if (getBskyPostInfo(url))
      return { what: 'Bluesky post', enabled: useBlueskyEmbeds, failed: bskyError };
    if (getBskyProfileActor(url))
      return { what: 'Bluesky profile', enabled: useBlueskyEmbeds, failed: bskyProfileError };
    if (getTwitterId(url)) return { what: 'post on X', enabled: useVxTwitter, failed: vxError };
    return undefined;
  })();

  /**
   * A last-resort card for a link whose dedicated renderer produced nothing.
   *
   * X and Bluesky cards are built by this client, not from anything the
   * homeserver scraped, so when the renderer comes back empty there is
   * usually nothing else coming either — a homeserver with url previews
   * disabled (Synapse's default) has no answer for these links.
   *
   * That combination used to render NOTHING AT ALL: no card, no link, no
   * reason, while a YouTube link in the same message still drew one, because
   * YouTube is exempted from the check below and these were not. A message
   * that silently loses its card is indistinguishable from a broken client —
   * it is precisely what "bsky posts don't embed any more" looks like from
   * the outside, and it takes a source dive to tell the two apart.
   *
   * So say which it is. Whether the embed is switched off or its API failed
   * is the one thing the reader cannot otherwise discover, and it is the
   * difference between a setting to flip and a fault worth reporting.
   *
   * Deliberately NOT shown while the renderer is still working: with the
   * setting on and no failure yet, the fetch is in flight and the spinner
   * above owns the frame.
   */
  const dedicatedPending = !!dedicated && dedicated.enabled && !dedicated.failed;
  const dedicatedFallback: IPreviewUrlResponse | undefined =
    dedicated && !dedicatedPending && !effectivePreview && !fallbackPending
      ? ({
          'og:title': hostnameOrUndefined(url) ?? dedicated.what,
          'og:description': dedicated.enabled
            ? `This ${dedicated.what} could not be loaded.`
            : `Embeds for this are turned off — see Settings, General.`,
        } as unknown as IPreviewUrlResponse)
      : undefined;

  const shownPreview = effectivePreview ?? dedicatedFallback;

  if (
    !shownPreview &&
    previewStatus.status !== AsyncStatus.Loading &&
    !fallbackPending &&
    !isDirectMediaLink &&
    !isEmbeddableYoutube
  ) {
    return null;
  }

  if (dismissed) return null;

  const renderContent = (prev: IPreviewUrlResponse) => {
    // Homeserver previews return og:image as an mxc:// URI (re-uploaded by the
    // server); the client-side fallback returns a direct http(s) URL. Pass the
    // latter through untouched — only mxc URIs need mxcUrlToHttp resolution.
    const rawOgImage = (prev['og:image'] as string) || '';
    // The client-side OG fallback returns whatever the linked page declared, and
    // that value is loaded directly as an <img src> from the attacker's host.
    // Parse it rather than prefix-matching `https?://`, so only a well-formed
    // http(s) URL takes the direct-image path; anything else falls through to
    // mxcUrlToHttp, which yields undefined for a non-mxc value and renders no
    // image at all.
    const isDirectImage = isWebUrl(rawOgImage);

    // Is the preview image an animation? Three independent signals, because
    // each covers a case the others miss:
    //  - `og:image:type`, which Synapse sets to the *actual* content type of
    //    the image it downloaded and re-uploaded (`image/gif` for a Tenor
    //    link, and for a bare .gif URL where the link itself is the image);
    //  - the og:image URL's own extension, for the client-side OG fallback,
    //    which returns the page's declared URL and carries no type;
    //  - the previewed URL's extension, for a homeserver that returns nothing
    //    useful at all.
    //
    // The first two use the narrow gif/apng test on purpose. A page's og:image
    // being WebP or AVIF says nothing — both are ordinary static formats now —
    // so assuming animation there would make every third link preview skip the
    // thumbnailer and pull a full-size hero image. The third is the broad test
    // because there the link IS the image file: the user asked for that exact
    // file, and there is nothing to thumbnail on their behalf.
    const definitelyAnimated =
      isAlwaysAnimatedMimeType(prev['og:image:type']) || isAlwaysAnimatedImageUrl(rawOgImage);
    const ogImageAnimated = definitelyAnimated || isAnimatedImageUrl(url);

    // THE thumbnail trap: every server-side thumbnail of an animated image is
    // one still frame. Synapse will only animate a thumbnail when asked with
    // `?animated=true` (MSC2705), which `mxcUrlToHttp` has no parameter for,
    // and homeservers that predate the MSC ignore it regardless. So an animated
    // og:image must skip the thumbnailer entirely and use the download URL —
    // the original bytes the server already holds. This is the single reason a
    // linked GIF rendered as a frozen picture; it is also exactly what the
    // timeline does for an uploaded GIF, where animation has always worked.
    const animatedImgUrl = ogImageAnimated
      ? isDirectImage
        ? rawOgImage
        : mxcUrlToHttp(mx, rawOgImage, useAuthentication)
      : null;

    // The un-thumbnailed original, and the fallback when the thumbnailer says
    // no. A homeserver answers `/thumbnail` with **400** — not 404 — for media
    // it holds but has no thumbnail for (Synapse: "Cannot find any thumbnails
    // for the requested media"), which is routine for anything its thumbnailer
    // skipped or failed on, including og:image files it re-uploaded from
    // someone else's page. The full-size download of that same mxc serves
    // fine, so a broken-image card is a self-inflicted wound: ask for the
    // original instead of showing nothing.
    const fullImgUrl = isDirectImage ? rawOgImage : mxcUrlToHttp(mx, rawOgImage, useAuthentication);

    const thumbUrl =
      animatedImgUrl ??
      (thumbnailRejected
        ? fullImgUrl
        : isDirectImage
          ? rawOgImage
          : mxcUrlToHttp(mx, rawOgImage, useAuthentication, 256, 256, 'scale', false));

    const imgUrl =
      animatedImgUrl ??
      (thumbnailRejected
        ? fullImgUrl
        : isDirectImage
          ? rawOgImage
          : mxcUrlToHttp(mx, rawOgImage, useAuthentication, 512, 512, 'scale', false));

    // og:image is a poster, never the media. When the link itself is the file,
    // it is the only correct source — previously the <video> was pointed at
    // og:image, so a direct .mp4 got an empty src and silently rendered nothing.
    const directVideoUrl = isVideoUrl(url) && isWebUrl(url) ? url : '';
    const directAudioUrl = isAudioUrl(url) && isWebUrl(url) ? url : '';
    // A direct image link with no usable og:image at all (preview disabled,
    // preview failed, or a homeserver that declines to re-upload). The URL is
    // the media, so it is its own preview.
    const directImageUrl = isImageUrl(url) && isWebUrl(url) ? url : '';

    // On a YouTube link the fetched metadata wins over the homeserver's scrape,
    // which for this one host is usually empty or the literal string "YouTube".
    // It is only ever a replacement, never a requirement: when the fetch failed
    // this falls straight back to whatever the preview carried.
    const title = (isYt ? ytMeta.title : undefined) ?? (prev['og:title'] as string | undefined);
    const description = prev['og:description'] as string | undefined;
    const siteName =
      (isYt ? ytMeta.author : undefined) ?? (prev['og:site_name'] as string | undefined);
    const isVideo = isVideoUrl(url) || (prev['og:type'] as string)?.startsWith('video');

    // Sites that ship a tiny favicon-style og:image (48×48, 64×64 logo) want
    // a text-only embed, not a card with an awkwardly-stretched icon. If both
    // declared dimensions are ≤ 96px we treat the image as decorative and
    // skip rendering it; the title/description/siteName cluster still shows.
    // Larger images (article hero shots, post media) render as before.
    const ogImageWidth = Number(prev['og:image:width']) || 0;
    const ogImageHeight = Number(prev['og:image:height']) || 0;
    const imageIsTinyFavicon =
      ogImageWidth > 0 && ogImageHeight > 0 && ogImageWidth <= 96 && ogImageHeight <= 96;

    // og:video data (Bandcamp etc.). Split into two validated, mutually
    // exclusive shapes up front so neither sink can be reached with an
    // unvetted value:
    //  - bandcampEmbedUrl: a genuinely-parsed https bandcamp.com embed, the
    //    only thing allowed into an iframe here.
    //  - inlineOgVideoUrl: anything else, which must at least be http(s)
    //    before it reaches <video src> and the <a href> fallback inside it.
    // video.twimg.com stays excluded because it 403s on cross-origin requests.
    // `og:video:secure_url` is included because some sites declare only that
    // one. Tenor declares all three, but they are read in document order and a
    // page that omits the bare `og:video` previously produced no player at all.
    const ogVideoUrl = (prev['og:video'] || prev['og:video:url'] || prev['og:video:secure_url']) as
      | string
      | undefined;
    const bandcampEmbedUrl = isBandcampEmbedUrl(ogVideoUrl) ? ogVideoUrl : undefined;
    const inlineOgVideoUrl =
      !bandcampEmbedUrl && isWebUrl(ogVideoUrl) && !/video\.twimg\.com/.test(ogVideoUrl)
        ? ogVideoUrl
        : undefined;
    // An og:video we rejected must not suppress the still image as well —
    // otherwise a bad value silently blanks the whole card.
    const hasOgVideo = !!(bandcampEmbedUrl || inlineOgVideoUrl);
    // GIF-sharing sites have no GIF to give: Tenor's and Giphy's `og:video` is
    // an MP4 of the animation and their `og:image` is the GIF. Rendered as a
    // plain <video> it came out as a still poster behind a play button, which
    // is not what "linking a GIF" means anywhere else on the internet. Measured
    // Tenor OG output for reference:
    //   og:type              video.other
    //   og:image             https://media1.tenor.com/m/<id>AAAAC/<name>.gif
    //   og:image:type        image/gif
    //   og:video             https://media.tenor.com/<id>AAAPo/<name>.mp4
    const ogVideoIsGif =
      !!inlineOgVideoUrl && isGifStyleVideo(url, inlineOgVideoUrl, prev['og:image:type']);
    const ogVideoWidth = Number(prev['og:video:width']) || undefined;
    const ogVideoHeight = Number(prev['og:video:height']) || undefined;
    const ogVideoAspect =
      ogVideoWidth && ogVideoHeight ? `${ogVideoWidth} / ${ogVideoHeight}` : undefined;

    return (
      <Box grow="Yes" direction="Column" style={{ position: 'relative', minWidth: 0 }}>
        {/* Dismiss button */}
        <IconButton
          size="300"
          radii="300"
          variant="SurfaceVariant"
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          aria-label="Dismiss embed"
          style={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
        >
          <Icon size="50" src={Icons.Cross} />
        </IconButton>

        {/* YouTube iframe embed */}
        {isYt && ytVideoId && (
          <Box
            style={{
              position: 'relative',
              paddingBottom: '56.25%',
              height: 0,
              overflow: 'hidden',
              backgroundColor: color.SurfaceVariant.Container,
            }}
          >
            <iframe
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              src={
                usePiped ? pipedEmbedUrl(pipedBase, ytVideoId) : `${YOUTUBE_EMBED_BASE}${ytVideoId}`
              }
              title={title || 'YouTube video'}
              // This frame auto-loads for anyone who reads the message, so it
              // gets the narrowest sandbox that still plays video. Deliberately
              // absent: allow-top-navigation (would let the frame navigate this
              // window away) and allow-popups (would let it open new ones).
              sandbox="allow-scripts allow-same-origin allow-presentation"
              // Trimmed to what playback needs. clipboard-write in particular
              // has no business being delegated to an embed the message sender
              // chose; accelerometer/gyroscope are sensor access playback
              // doesn't require.
              // `allow` already grants fullscreen to the frame; a separate
              // `allowFullScreen` attribute is redundant and makes Chrome warn
              // that the allow policy takes precedence.
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            />
          </Box>
        )}

        {/* og:video embed (Bandcamp etc.) — see the validation above; both
            branches consume an already-vetted URL. */}
        {!isYt && bandcampEmbedUrl && (
          <iframe
            style={{ border: 0, width: '100%', height: '120px' }}
            src={bandcampEmbedUrl}
            title={title || 'Bandcamp'}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            seamless
          />
        )}
        {/* Tenor/Giphy and friends: the og:video IS the animation, so it plays
            itself, loops and carries no chrome. ProxiedVideo also falls back to
            controls if the shell refuses to autoplay, which is the difference
            between a GIF that is paused and a GIF that cannot be started. */}
        {!isYt && inlineOgVideoUrl && ogVideoIsGif && (
          <ProxiedVideo
            src={inlineOgVideoUrl}
            poster={imgUrl || undefined}
            isGif
            width={ogVideoWidth}
            height={ogVideoHeight}
            className={urlPreviewCss.UrlPreviewVideo}
          />
        )}
        {!isYt && inlineOgVideoUrl && !ogVideoIsGif && (
          <video
            className={urlPreviewCss.UrlPreviewVideo}
            src={inlineOgVideoUrl}
            controls
            preload="metadata"
            poster={imgUrl || undefined}
            style={ogVideoAspect ? { aspectRatio: ogVideoAspect } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <a href={inlineOgVideoUrl} target="_blank" rel="noreferrer">
              {title || 'Video'}
            </a>
          </video>
        )}

        {/* Direct video URL.
            Gated on `directVideoUrl` rather than falling back to `imgUrl`: the
            comment above is right that og:image is a poster and never the
            media, and feeding it to a <video src> produced a permanently
            broken player for every `og:type: video.*` page that declares no
            playable video — including Tenor, whose og:image is now the GIF
            itself. Without a real video URL this falls through to the image
            branch, which shows the poster and the link. */}
        {!isYt && !hasOgVideo && isVideo && directVideoUrl && (
          <video
            className={urlPreviewCss.UrlPreviewVideo}
            src={directVideoUrl}
            poster={imgUrl || undefined}
            controls
            preload="metadata"
            style={ogVideoAspect ? { aspectRatio: ogVideoAspect } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <a href={directVideoUrl} target="_blank" rel="noreferrer">
              {title || 'Video'}
            </a>
          </video>
        )}

        {/* Audio embed — same reasoning: an <audio> pointed at og:image is a
            dead player, so `og:type: music.*` pages with no direct audio file
            (Spotify, Last.fm) fall through to the image branch instead. */}
        {directAudioUrl && (
          <audio
            className={urlPreviewCss.UrlPreviewVideo}
            src={directAudioUrl}
            controls
            preload="metadata"
            onClick={(e) => e.stopPropagation()}
          >
            <a href={directAudioUrl} target="_blank" rel="noreferrer">
              {title || 'Audio'}
            </a>
          </audio>
        )}

        {/* Preview image (only if no video/audio player showing and the
            image isn't a tiny favicon-style icon).

            `stillImageUrl` falls back to the link itself so a bare image URL
            still renders when the homeserver produced no og:image — previews
            can be disabled server-side, and Synapse declines any target it
            cannot fetch. The GIF badge is attached whenever the source is an
            animated format, which is also the tell that the card is showing
            the animation rather than a thumbnail of it.

            The tiny-favicon suppression is deliberately not applied to a direct
            image link: the dimensions there describe the linked image itself,
            and a genuinely 64×64 GIF is still the thing the user linked. */}
        {!isYt &&
          !hasOgVideo &&
          !(isVideo && directVideoUrl) &&
          !directAudioUrl &&
          (() => {
            const stillImageUrl = thumbUrl || directImageUrl;
            if (!stillImageUrl) return null;
            if (imageIsTinyFavicon && !directImageUrl) return null;
            const viewerTarget = imgUrl || directImageUrl || undefined;
            // Badge only what is unambiguously an animation. A `.webp` link
            // still skips the thumbnailer (see `ogImageAnimated`) and animates
            // if it is animated, but labelling every WebP "GIF" would be wrong
            // far more often than it would be right.
            const animated =
              definitelyAnimated ||
              isAlwaysAnimatedImageUrl(stillImageUrl) ||
              isAlwaysAnimatedImageUrl(url);
            if (animated) {
              return (
                <GifImage
                  src={stillImageUrl}
                  alt={title || ''}
                  title={title}
                  onView={() => setViewerSrc(viewerTarget)}
                />
              );
            }
            return (
              <UrlPreviewImg
                src={stillImageUrl}
                alt={title || ''}
                title={title}
                tabIndex={0}
                onKeyDown={(evt) => onEnterOrSpace(() => setViewerSrc(viewerTarget))(evt)}
                onClick={() => setViewerSrc(viewerTarget)}
                onError={() => {
                  // A thumbnail the homeserver refuses to generate — retry once
                  // with the original. A direct image link has no thumbnail to
                  // fall back from, and re-latching after the original fails
                  // too is a no-op React bails out of, so this cannot loop.
                  if (!isDirectImage && fullImgUrl) setThumbnailRejected(true);
                }}
              />
            );
          })()}

        <UrlPreviewContent>
          <Text
            style={linkStyles}
            truncate
            as="a"
            href={safeUrl}
            target="_blank"
            rel="noreferrer"
            size="T200"
            priority="300"
          >
            {siteName ? `${siteName} | ` : ''}
            {tryDecodeURIComponent(url)}
          </Text>
          {title && (
            <Text
              style={{ fontWeight: '600' }}
              as="a"
              href={safeUrl}
              target="_blank"
              rel="noreferrer"
              size="T300"
              truncate={!expanded}
            >
              {title}
            </Text>
          )}
          {/* Description — shown in full up to 100 words; longer ones collapse
              behind a Show all toggle. (Replaces the old og: metadata dump that
              used to live behind this button.) */}
          {description &&
            (() => {
              const words = description.trim().split(/\s+/);
              const isLong = words.length > 100;
              const shown = isLong && !expanded ? `${words.slice(0, 100).join(' ')}…` : description;
              return (
                <>
                  <Text size="T200" priority="300" style={{ whiteSpace: 'pre-wrap' }}>
                    {shown}
                  </Text>
                  {isLong && (
                    <Button
                      variant="Secondary"
                      fill="Soft"
                      size="300"
                      radii="300"
                      onClick={() => setExpanded(!expanded)}
                    >
                      <Text size="B300">{expanded ? 'Show less' : 'Show all'}</Text>
                    </Button>
                  )}
                </>
              );
            })()}
        </UrlPreviewContent>

        {/* Image viewer — use renderViewer if provided, fall back to FocusTrap */}
        {viewerSrc && renderViewer && (
          <ImageOverlay
            src={viewerSrc}
            alt={title || 'Image'}
            viewer={!!viewerSrc}
            requestClose={() => setViewerSrc(undefined)}
            renderViewer={renderViewer}
            externalUrl={url}
          />
        )}
        {viewerSrc && !renderViewer && (
          <Overlay open backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: () => setViewerSrc(undefined),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <ImageViewer
                  src={viewerSrc}
                  alt={title || 'Image'}
                  requestClose={() => setViewerSrc(undefined)}
                  externalUrl={url}
                />
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
      </Box>
    );
  };

  return (
    <UrlPreview {...props} ref={ref}>
      {shownPreview || isDirectMediaLink || isEmbeddableYoutube ? (
        // A direct media link renders from the URL alone, so an absent preview
        // is fine — without this it sat on the spinner forever waiting for
        // metadata a raw .mp4 will never provide.
        renderContent((shownPreview ?? {}) as IPreviewUrlResponse)
      ) : (
        <Box
          grow="Yes"
          alignItems="Center"
          justifyContent="Center"
          style={{ padding: config.space.S400 }}
        >
          <Spinner variant="Secondary" size="400" />
        </Box>
      )}
    </UrlPreview>
  );
});

export const UrlPreviewHolder = as<'div'>(({ children, ...props }, ref) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const backAnchorRef = useRef<HTMLDivElement>(null);
  const frontAnchorRef = useRef<HTMLDivElement>(null);
  const [backVisible, setBackVisible] = useState(true);
  const [frontVisible, setFrontVisible] = useState(true);

  /**
   * Whether any card inside actually drew something.
   *
   * A card decides for itself whether it has anything to show — a refused
   * preview, a link the homeserver would not scrape, an embed kind the user has
   * switched off — and returns null. The holder cannot know that in advance,
   * because from here they are all perfectly ordinary React elements. So an
   * every-card-returned-null holder still existed, and the parent's flex `gap`
   * still spaced it: an empty band under the message that looked like a preview
   * stuck loading forever.
   *
   * The test is STRUCTURAL — did any card render an element — and deliberately
   * not the row's height. Height cannot answer this question here, because the
   * answer is used to set `display: none` on an ancestor, and an element inside
   * a `display: none` subtree has no box at all: its `offsetHeight` is 0
   * forever and a `ResizeObserver` on it stops being notified, since the box it
   * watches never changes size again. So a height test that hid the holder once
   * could never see the card that arrived afterwards — a one-way latch.
   *
   * Every card here is asynchronous. The Bluesky, X and Hacker News cards fetch
   * their post before they can draw anything, and the ordinary card waits on
   * the homeserver's preview, so on the first commit — the one this effect
   * measures — all of them render null. That is what silently hid every one of
   * those cards for good, while a YouTube link in the same message still drew
   * one, because YouTube builds from the video id and renders on that first
   * pass. It is exactly what "Bluesky posts don't embed" looks like from the
   * outside.
   *
   * A card with nothing to show returns null, so counting the elements the row
   * actually holds asks the same question — and the DOM answers it whether the
   * holder is hidden or not. The holder's own chrome (the scroll anchor and the
   * edge gradient/buttons) is marked `data-holder-chrome` so it never counts as
   * a card.
   */
  const rowRef = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    const measure = () => {
      const hasCard = Array.from(el.children).some(
        (child) => (child as HTMLElement).dataset?.holderChrome === undefined
      );
      setEmpty(!hasCard);
    };
    // childList on the row itself: a card that resolves goes from `null` to an
    // element, which is an insertion here — and mutations are still delivered
    // for a subtree that is currently hidden, which is the whole point.
    const observer = new MutationObserver(measure);
    observer.observe(el, { childList: true });
    measure();
    return () => observer.disconnect();
  }, []);

  const intersectionObserver = useIntersectionObserver(
    useCallback((entries) => {
      const backAnchor = backAnchorRef.current;
      const frontAnchor = frontAnchorRef.current;
      const backEntry = backAnchor && getIntersectionObserverEntry(backAnchor, entries);
      const frontEntry = frontAnchor && getIntersectionObserverEntry(frontAnchor, entries);
      if (backEntry) {
        setBackVisible(backEntry.isIntersecting);
      }
      if (frontEntry) {
        setFrontVisible(frontEntry.isIntersecting);
      }
    }, []),
    useCallback(
      () => ({
        root: scrollRef.current,
        rootMargin: '10px',
      }),
      [],
    ),
  );

  useEffect(() => {
    const backAnchor = backAnchorRef.current;
    const frontAnchor = frontAnchorRef.current;
    if (backAnchor) intersectionObserver?.observe(backAnchor);
    if (frontAnchor) intersectionObserver?.unobserve(frontAnchor);
    return () => {
      if (backAnchor) intersectionObserver?.observe(backAnchor);
      if (frontAnchor) intersectionObserver?.unobserve(frontAnchor);
    };
  }, [intersectionObserver]);

  const handleScrollBack = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const { offsetWidth, scrollLeft } = scroll;
    scroll.scrollTo({
      left: scrollLeft - offsetWidth / 1.3,
      behavior: 'smooth',
    });
  };
  const handleScrollFront = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const { offsetWidth, scrollLeft } = scroll;
    scroll.scrollTo({
      left: scrollLeft + offsetWidth / 1.3,
      behavior: 'smooth',
    });
  };

  return (
    <Box
      direction="Column"
      {...props}
      ref={ref}
      style={{
        // `display: none` rather than skipping the render: the row has to stay
        // mounted to be measured, and it is this margin — not the cards — that
        // was showing as a gap under a message whose links produced no card.
        ...(empty ? { display: 'none' } : null),
        marginTop: config.space.S200,
        position: 'relative',
      }}
    >
      <Scroll ref={scrollRef} direction="Horizontal" size="0" visibility="Hover" hideTrack>
        <Box shrink="No" alignItems="Center" className={css.UrlPreviewHolderInner}>
          <div ref={backAnchorRef} />
          {!backVisible && (
            <>
              <div className={css.UrlPreviewHolderGradient({ position: 'Left' })} />
              <IconButton
                className={css.UrlPreviewHolderBtn({ position: 'Left' })}
                variant="Secondary"
                radii="Pill"
                size="300"
                outlined
                onClick={handleScrollBack}
              >
                <Icon size="300" src={Icons.ArrowLeft} />
              </IconButton>
            </>
          )}
          <Box alignItems="Inherit" gap="200" className={css.UrlPreviewHolderRow} ref={rowRef}>
            {children}

            {!frontVisible && (
              <>
                <div
                  data-holder-chrome=""
                  className={css.UrlPreviewHolderGradient({ position: 'Right' })}
                />
                <IconButton
                  data-holder-chrome=""
                  className={css.UrlPreviewHolderBtn({ position: 'Right' })}
                  variant="Primary"
                  radii="Pill"
                  size="300"
                  outlined
                  onClick={handleScrollFront}
                >
                  <Icon size="300" src={Icons.ArrowRight} />
                </IconButton>
              </>
            )}
            <div data-holder-chrome="" ref={frontAnchorRef} />
          </Box>
        </Box>
      </Scroll>
    </Box>
  );
});
