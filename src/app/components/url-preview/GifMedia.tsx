import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Box, Icon, Icons, Spinner, Text, color, toRem } from 'folds';
import { UrlPreviewImg } from './UrlPreview';
import {
  fetchAsBlobUrl,
  fetchNoReferrerBlobUrl,
  isAllowedMediaUrl,
} from '../../utils/tauri-media-proxy';
import { isTauri } from '../../utils/desktop-notifications';
import { isWebUrl, webUrlOrUndefined } from '../../utils/safeUrl';
import { GifVideoSource, mimeTypeFromUrl } from '../../utils/animatedMedia';
import { onEnterOrSpace } from '../../utils/keyboard';

/**
 * Resolve a remote media URL to something the WebView will actually load.
 *
 * `video.twimg.com` answers 403 to any request carrying a cross-origin
 * `Referer`, so an allowlisted media URL has to be fetched with the referrer
 * stripped and handed to the element as a `blob:`. There are two ways to do
 * that and both are needed:
 *
 *  - **`stripReferrer` (any browser).** For `<video>` there is no other option.
 *    `referrerpolicy` is not a content attribute on media elements — writing it
 *    on a `<video>` does nothing at all — so the element always sends the
 *    document referrer and always gets a 403. `fetch()` does honour the policy,
 *    and twimg serves CORS, so the bytes come through there. See
 *    `fetchNoReferrerBlobUrl` for the measured before/after.
 *  - **The native proxy (Tauri only).** Rust's HTTP client is outside CORS
 *    entirely and sets a real browser UA, so it is preferred inside the shell
 *    and the in-page fetch becomes its fallback.
 *
 * `<img>` needs neither: `referrerpolicy` *is* honoured there, which is exactly
 * why plain GIF links kept playing while Twitter's MP4 surrogates did not.
 * Callers that render an image therefore leave `stripReferrer` off and keep the
 * cheap direct-URL path.
 *
 * Skipping both proxies for non-allowlisted hosts is not just an optimisation:
 * the IPC command rejects them, so an unconditional attempt burned a round trip
 * and logged a warning for every Tenor/Giphy GIF before falling back to the URL
 * it could have used immediately.
 *
 * Returns `null` while a proxy fetch is still outstanding, so callers can show
 * a placeholder instead of an element with an empty `src`.
 */
export const useResolvedMediaSrc = (src: string, stripReferrer = false): string | null => {
  const allowed = isAllowedMediaUrl(src);
  const proxied = allowed && (isTauri() || stripReferrer);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(proxied ? null : src);

  useEffect(() => {
    const useNative = isTauri() && isAllowedMediaUrl(src);
    const useNoReferrer = stripReferrer && isAllowedMediaUrl(src);
    if (!useNative && !useNoReferrer) {
      setResolvedSrc(src);
      return undefined;
    }
    setResolvedSrc(null);
    let cancelled = false;
    let createdBlob: string | null = null;

    const resolve = async (): Promise<string | null> => {
      const mimeType = mimeTypeFromUrl(src);
      const native = useNative ? await fetchAsBlobUrl(src, mimeType) : null;
      if (native) return native;
      // Falling back to the direct URL is useless for the hosts that need this
      // — a 403 is exactly what the direct URL returns — so try the in-page
      // no-referrer fetch before giving up on a blob.
      if (useNoReferrer) return fetchNoReferrerBlobUrl(src, mimeType);
      return null;
    };

    resolve().then((blobUrl) => {
      if (cancelled) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }
      if (blobUrl) {
        createdBlob = blobUrl;
        setResolvedSrc(blobUrl);
      } else {
        // Every proxy failed — fall back to the direct URL so the engine can
        // show its own error state instead of an indefinite spinner.
        setResolvedSrc(src);
      }
    });
    return () => {
      cancelled = true;
      if (createdBlob) URL.revokeObjectURL(createdBlob);
    };
  }, [src, stripReferrer]);

  return resolvedSrc;
};

const MediaPlaceholder = ({ aspect }: { aspect: string }) => (
  <Box
    alignItems="Center"
    justifyContent="Center"
    style={{
      width: '100%',
      aspectRatio: aspect,
      maxHeight: toRem(320),
      backgroundColor: color.SurfaceVariant.Container,
    }}
  >
    <Spinner variant="Secondary" size="400" />
  </Box>
);

export type ProxiedVideoProps = {
  src: string;
  /**
   * Alternative renditions offered as `<source>` children so the engine picks
   * by `canPlayType` instead of us user-agent sniffing. Only used on the direct
   * (non-proxied) path — when the native proxy is in play there is a single
   * blob to hand over.
   */
  sources?: GifVideoSource[];
  poster?: string;
  isGif: boolean;
  width?: number;
  height?: number;
  className?: string;
  /**
   * Chrome drawn over the video — the "Feed" chip a linked post's video gets,
   * matching the one an uploaded video gets in the timeline.
   *
   * Rendered in a positioned wrapper the plain path does not otherwise need, so
   * a caller that wants no overlay still gets the bare element.
   */
  renderOverlay?: () => ReactNode;
};

/**
 * A `<video>` that behaves like a GIF when `isGif` is set: autoplaying, looping,
 * silent and chrome-free.
 *
 * The reason this needs more than the four corresponding attributes: a
 * chrome-less autoplaying video whose autoplay is *refused* is an inert frozen
 * frame with no way to start it, which is precisely how "the GIF doesn't play"
 * presents. Autoplay is refused by default on two of the three shells this app
 * ships in — WebKitGTK (Linux desktop) gates even muted autoplay behind a
 * user gesture, and Android's WebView sets `mediaPlaybackRequiresUserGesture`
 * to true — so the failure path is the common case, not an edge case.
 *
 * So: the mute is applied imperatively before `play()` (React assigns the
 * `muted` *property* after mount, which can land too late for the autoplay
 * gate), the returned promise is inspected, and a refusal falls back to native
 * controls. Clicking a playing GIF toggles it, matching every other GIF surface.
 */
export function ProxiedVideo({
  src,
  sources,
  poster,
  isGif,
  width,
  height,
  className,
  renderOverlay,
}: ProxiedVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [paused, setPaused] = useState(false);
  // `stripReferrer` — a media element cannot express a referrer policy, so an
  // allowlisted video has to arrive as a blob or not at all.
  const resolvedSrc = useResolvedMediaSrc(src, true);

  // Anything that changes the media has to re-arm the autoplay attempt.
  const mediaKey = `${resolvedSrc ?? ''}|${(sources ?? []).map((s) => s.src).join(',')}`;

  useEffect(() => {
    setAutoplayBlocked(false);
    setPaused(false);
  }, [mediaKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isGif || !resolvedSrc) return undefined;

    let cancelled = false;
    // Set both the property and the attribute. Some engines consult the
    // attribute when deciding whether an autoplay is "muted autoplay", and
    // React only ever sets the property.
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.volume = 0;

    const attempt = () => {
      const played = video.play();
      if (played && typeof played.catch === 'function') {
        played
          .then(() => {
            if (!cancelled) setAutoplayBlocked(false);
          })
          .catch(() => {
            // NotAllowedError (gesture required) or a decode failure. Either
            // way the user needs a way to start it by hand.
            if (!cancelled) setAutoplayBlocked(true);
          });
      }
    };

    // `sources` are attached as children; wait for the engine to have selected
    // one before asking it to play.
    if (video.readyState >= 2) attempt();
    else video.addEventListener('loadeddata', attempt, { once: true });

    // Last-resort backstop. A chrome-less GIF that never loads and never
    // errors — a stalled CDN, a codec the engine declines silently, a proxy
    // that returned bytes the decoder rejects — presents as an empty box with
    // no way to interact with it and nothing in the console. If it has not
    // started within a few seconds, surface the controls so there is at least
    // something to press and something to right-click.
    const stallTimer = window.setTimeout(() => {
      if (!cancelled && video.readyState < 2) setAutoplayBlocked(true);
    }, 5000);

    return () => {
      cancelled = true;
      window.clearTimeout(stallTimer);
      video.removeEventListener('loadeddata', attempt);
    };
  }, [isGif, resolvedSrc, mediaKey]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.muted = true;
      const played = video.play();
      if (played && typeof played.catch === 'function') {
        played.then(
          () => setAutoplayBlocked(false),
          () => setAutoplayBlocked(true)
        );
      }
    } else {
      video.pause();
    }
  }, []);

  const aspect = width && height ? `${width} / ${height}` : '16 / 9';

  // `src` arrives from third-party API JSON (vxtwitter / public.api.bsky.app),
  // and the proxy falls back to using it directly when the native fetch fails.
  // An unexpected scheme there is not merely a broken load: in the Tauri shell
  // the new-window handler hands any non-blob URL to the OS URL opener.
  if (!isWebUrl(src)) return null;
  const safeSources = (sources ?? []).filter((s) => isWebUrl(s.src));

  if (!resolvedSrc) return <MediaPlaceholder aspect={aspect} />;

  // A blob: URL is a single already-fetched rendition — the alternatives would
  // point at the un-proxied origin and defeat the proxy.
  const useSourceChildren = safeSources.length > 0 && !resolvedSrc.startsWith('blob:');
  const showControls = !isGif || autoplayBlocked;

  const video = (
    <video
      ref={videoRef}
      className={className}
      src={useSourceChildren ? undefined : resolvedSrc}
      poster={webUrlOrUndefined(poster)}
      controls={showControls}
      autoPlay={isGif}
      loop
      muted={isGif}
      playsInline
      preload={isGif ? 'auto' : 'metadata'}
      // Belt-and-braces only, and deliberately not load-bearing: the HTML spec
      // defines no `referrerpolicy` content attribute on media elements, so
      // this is inert in every engine that follows it. Suppressing the referrer
      // for the hosts that require it is `useResolvedMediaSrc`'s job — it hands
      // this element a blob. A spread emits the attribute without tripping
      // React's excess-property checking.
      {...{ referrerPolicy: 'no-referrer' }}
      style={{ aspectRatio: aspect }}
      onPlay={() => setPaused(false)}
      onPause={() => setPaused(true)}
      // A load/decode failure never fires `loadeddata`, so the autoplay attempt
      // above simply never runs and a chrome-less GIF would sit there as an
      // empty box forever. Surfacing the native controls at least shows the
      // engine's own error state instead of nothing.
      onError={() => setAutoplayBlocked(true)}
      onClick={(e) => {
        e.stopPropagation();
        // With controls visible the engine owns the click.
        if (isGif && !showControls) togglePlayback();
      }}
    >
      {useSourceChildren &&
        safeSources.map((source) => <source key={source.src} src={source.src} type={source.type} />)}
    </video>
  );

  if (!isGif) {
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

  return (
    <Box style={{ position: 'relative', width: '100%' }}>
      {video}
      {renderOverlay && (
        <Box
          style={{ position: 'absolute', left: 8, top: 8 }}
          onClick={(evt) => evt.stopPropagation()}
        >
          {renderOverlay()}
        </Box>
      )}
      <Badge
        variant="Secondary"
        fill="Solid"
        radii="300"
        style={{ position: 'absolute', left: 8, bottom: 8, pointerEvents: 'none' }}
      >
        <Text size="L400">GIF</Text>
      </Badge>
      {(paused || autoplayBlocked) && !showControls && (
        <Box
          alignItems="Center"
          justifyContent="Center"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <Icon size="600" src={Icons.Play} filled style={{ color: 'white', opacity: 0.85 }} />
        </Box>
      )}
    </Box>
  );
}

export type ProxiedImgProps = {
  src: string;
  alt: string;
  title?: string;
  className?: string;
  onView?: () => void;
};

/**
 * An `<img>` that goes through the native proxy on allowlisted hosts.
 *
 * Animated formats are rendered here rather than as a `<video>` on purpose: an
 * `<img>` animates a GIF/APNG/animated-WebP with no autoplay policy attached to
 * it at all, which is why the image path is the reliable one on shells that
 * refuse to autoplay media.
 */
export function ProxiedImg({ src, alt, title, className, onView }: ProxiedImgProps) {
  const resolvedSrc = useResolvedMediaSrc(src);

  // Same reasoning as ProxiedVideo: `src` is remote-supplied JSON and the
  // non-Tauri / proxy-failure paths put it straight into an <img src>.
  if (!isWebUrl(src)) return null;

  if (!resolvedSrc) {
    return (
      <Box
        alignItems="Center"
        justifyContent="Center"
        style={{
          width: '100%',
          minHeight: '200px',
          backgroundColor: color.SurfaceVariant.Container,
        }}
      >
        <Spinner variant="Secondary" size="400" />
      </Box>
    );
  }

  return (
    <UrlPreviewImg
      className={className}
      src={resolvedSrc}
      alt={alt}
      title={title}
      referrerPolicy="no-referrer"
      tabIndex={onView ? 0 : undefined}
      onKeyDown={onView ? (evt: any) => onEnterOrSpace(onView)(evt) : undefined}
      onClick={onView}
    />
  );
}

export type GifImageProps = {
  src: string;
  alt: string;
  title?: string;
  onView?: () => void;
};

/**
 * An animated image with a GIF badge.
 *
 * The badge doubles as the signal that this preview *is* the animation, so a
 * user who sees a still first frame (a format the engine chose not to animate)
 * knows something is wrong rather than assuming the link was to a static image.
 */
export function GifImage({ src, alt, title, onView }: GifImageProps) {
  return (
    <Box style={{ position: 'relative', width: '100%' }}>
      <ProxiedImg src={src} alt={alt} title={title} onView={onView} />
      <Badge
        variant="Secondary"
        fill="Solid"
        radii="300"
        style={{ position: 'absolute', left: 8, bottom: 8, pointerEvents: 'none' }}
      >
        <Text size="L400">GIF</Text>
      </Badge>
    </Box>
  );
}
