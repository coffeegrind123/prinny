import { RefObject, useEffect, useState } from 'react';

/** The MIME type an engine reports native HLS support under. */
const NATIVE_HLS_TYPE = 'application/vnd.apple.mpegurl';

/**
 * The codec probes `Hls.isSupported()` itself runs, minus the import.
 *
 * Kept in step with hls.js (`isSupported()` in its `is-supported.ts`): a media
 * source, and at least one of these decodable through it. Duplicated here only
 * to decide whether fetching hls.js is worth it at all — the real check is
 * still `Hls.isSupported()` once the module is in hand.
 */
const MSE_CODEC_PROBES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4;codecs="av01.0.01M.08"',
  'video/mp4;codecs="vp09.00.50.08"',
];

type MediaSourceCtor = { isTypeSupported?: (type: string) => boolean };

const getMediaSourceCtor = (): MediaSourceCtor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as Record<string, MediaSourceCtor | undefined>;
  return scope.ManagedMediaSource ?? scope.MediaSource ?? scope.WebKitMediaSource;
};

/** Whether Media Source Extensions can carry an HLS stream on this engine. */
const mseUsable = (): boolean => {
  const mediaSource = getMediaSourceCtor();
  if (!mediaSource || typeof mediaSource.isTypeSupported !== 'function') return false;
  const isTypeSupported = mediaSource.isTypeSupported.bind(mediaSource);
  return MSE_CODEC_PROBES.some((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  });
};

/**
 * Attach an HLS stream to a `<video>`, however this engine can manage it.
 *
 * Bluesky serves every video as an m3u8 playlist (`playlist` on
 * `app.bsky.embed.video#view`), which is not a file a media element can be
 * pointed at unless it happens to demux HLS itself. Where it cannot, hls.js
 * does the demuxing over Media Source Extensions. It is loaded by dynamic
 * import, because a user who never opens a Bluesky video should not pay ~80 kB
 * gzipped for the possibility — and the probe above is what keeps that import
 * from being fetched on an engine that could not use it anyway.
 *
 * **MSE is preferred over the engine's own HLS support, and that ordering is
 * the whole point of this file.** It used to be the other way round, guarded by
 * `canPlayType('application/vnd.apple.mpegurl')` on the assumption that only
 * Safari answers to that. It is not a Safari test. Measured in Chromium 150
 * (24.08.2026): `canPlayType` returns **`"maybe"`** for that type — and
 * `"maybe"` is truthy, so every Chromium-family engine, WebView2 included, took
 * the native branch and hls.js was never even fetched. An engine that answers
 * "maybe" and then cannot demux the playlist fires a plain `error` on the
 * element, which is indistinguishable from a dead URL: the reader is told the
 * video could not be loaded, nothing appears in the console, and the working
 * path was never tried. `canPlayType` is a hint, `MediaSource.isTypeSupported`
 * is a decision — so the hint is now only consulted where there is no MSE to
 * decide with (iOS and iPadOS WebViews, where native HLS is the real thing).
 *
 * Neither answer is trusted to be final. Whichever path is chosen, a failure
 * falls through to the other one before the reader is told anything, so an
 * engine that lies in either direction still plays the video.
 *
 * Lifted out of `UrlPreviewCard`'s `HlsVideo` so the media feed can play the
 * same streams full-screen with its own chrome instead of growing a second,
 * subtly different copy of this.
 *
 * @returns an error message once every available path has failed, else null.
 */
export const useHlsPlayback = (
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | undefined,
  enabled: boolean = true,
): string | null => {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
    const element = videoRef.current;
    if (!enabled || !element || !src) return undefined;
    // Bound after the guard so the two mutually-recursive attempts below close
    // over non-nullable values: a hoisted function declaration is outside the
    // narrowing the guard performs, and one of them has to be hoisted for the
    // other to call it.
    const video: HTMLVideoElement = element;
    const streamUrl: string = src;

    let cancelled = false;
    let hlsInstance: any = null;
    let nativeErrorListener: (() => void) | null = null;
    let triedNative = false;
    let triedMse = false;

    const nativeClaimed = !!video.canPlayType(NATIVE_HLS_TYPE);
    const canUseMse = mseUsable();

    const detachNative = () => {
      if (nativeErrorListener) {
        video.removeEventListener('error', nativeErrorListener);
        nativeErrorListener = null;
      }
      // Leaving a playlist the engine could not demux on the element would have
      // it re-reported as an error the moment anything calls `load()` again.
      if (video.getAttribute('src') === streamUrl) {
        video.removeAttribute('src');
        video.load();
      }
    };

    const destroyHls = () => {
      try {
        hlsInstance?.destroy();
      } catch {
        // ignore
      }
      hlsInstance = null;
    };

    /** Hand the playlist to the engine and let it demux. */
    const playNative = () => {
      if (cancelled || triedNative) return;
      triedNative = true;
      destroyHls();
      console.info('[bsky/hls] native path', { canPlayType: video.canPlayType(NATIVE_HLS_TYPE) });

      nativeErrorListener = () => {
        const code = video.error?.code;
        const message = video.error?.message;
        console.warn('[bsky/hls] native playback failed', {
          code,
          message,
          networkState: video.networkState,
          readyState: video.readyState,
        });
        detachNative();
        if (cancelled) return;
        if (canUseMse && !triedMse) {
          // The engine said "maybe" and meant "no". Fall through to the path
          // that does not depend on its answer.
          playWithHlsJs();
          return;
        }
        setErrorMsg(
          `Video error: the player could not decode this stream${
            code ? ` (media error ${code})` : ''
          } — open in Bluesky to watch.`,
        );
      };
      video.addEventListener('error', nativeErrorListener);
      video.src = streamUrl;
      video.load();
    };

    /** Demux the playlist ourselves over Media Source Extensions. */
    function playWithHlsJs(): void {
      if (cancelled || triedMse) return;
      triedMse = true;
      detachNative();

      Promise.all([import('hls.js'), import('../../utils/tauri-hls-loader')])
        .then(([{ default: Hls }, { TauriHlsLoader }]) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            // The cheap probe said MSE was usable and hls.js disagrees — it
            // checks more than codecs. Its answer wins.
            if (nativeClaimed && !triedNative) {
              playNative();
              return;
            }
            setErrorMsg('Your browser does not support MSE — required for HLS playback.');
            return;
          }

          // Route every HLS fetch through Rust when we're inside Tauri. The
          // Rust IPC command (`fetch_remote_bytes`) is server-to-server, so it
          // bypasses CORS entirely and controls the User-Agent and Referer —
          // which is what a host that serves no CORS headers needs. Measured
          // 24.08.2026, `video.bsky.app` does send `access-control-allow-origin:
          // *`, so this is no longer what makes Bluesky video work; it is kept
          // for the hosts that do not.
          const loader: any =
            typeof window !== 'undefined' &&
            ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
              ? TauriHlsLoader
              : (Hls.DefaultConfig as any).loader;

          const hls = new Hls({
            enableWorker: false,
            loader,
          });
          hlsInstance = hls;

          hls.on(Hls.Events.ERROR, (_evt: unknown, data: any) => {
            if (data.fatal) {
              console.error('[bsky/hls] fatal', data.type, data.details, data);
              destroyHls();
              if (cancelled) return;
              if (nativeClaimed && !triedNative) {
                // hls.js is out of options; the engine claims it can play this
                // itself, so let it try before giving up on the video.
                playNative();
                return;
              }
              setErrorMsg(
                `Video error: ${data.details ?? data.type ?? 'unknown'} — open in Bluesky to watch.`,
              );
            } else {
              console.warn('[bsky/hls] non-fatal', data.details ?? data.type, data);
            }
          });

          try {
            console.info('[bsky/hls] mse path', {
              loader: loader === TauriHlsLoader ? 'tauri' : 'xhr',
            });
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
          } catch (err) {
            console.error('[bsky/hls] loadSource/attachMedia failed:', err);
            destroyHls();
            if (cancelled) return;
            if (nativeClaimed && !triedNative) {
              playNative();
              return;
            }
            setErrorMsg('Could not initialize HLS player.');
          }
        })
        .catch((err) => {
          console.error('[bsky/hls] dynamic import of hls.js failed:', err);
          if (cancelled) return;
          if (nativeClaimed && !triedNative) {
            playNative();
            return;
          }
          setErrorMsg('Failed to load video player.');
        });
    }

    if (canUseMse) playWithHlsJs();
    else if (nativeClaimed) playNative();
    else {
      console.warn('[bsky/hls] no HLS path on this engine', {
        canPlayType: video.canPlayType(NATIVE_HLS_TYPE),
        mediaSource: !!getMediaSourceCtor(),
      });
      setErrorMsg('This browser cannot play HLS video — open in Bluesky to watch.');
    }

    return () => {
      cancelled = true;
      detachNative();
      destroyHls();
    };
  }, [videoRef, src, enabled]);

  return errorMsg;
};
