import { RefObject, useEffect, useState } from 'react';

/**
 * Attach an HLS stream to a `<video>`, however this engine can manage it.
 *
 * Bluesky serves every video as an m3u8 playlist (`playlist` on
 * `app.bsky.embed.video#view`) and only Safari plays those natively, so
 * everything else needs hls.js. It is loaded by dynamic import, because a user
 * who never opens a Bluesky video should not pay ~80 kB gzipped for the
 * possibility.
 *
 * Lifted out of `UrlPreviewCard`'s `HlsVideo` so the media feed can play the
 * same streams full-screen with its own chrome instead of growing a second,
 * subtly different copy of this.
 *
 * @returns an error message once playback has definitively failed, else null.
 */
export const useHlsPlayback = (
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | undefined,
  enabled: boolean = true,
): string | null => {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
    const video = videoRef.current;
    if (!enabled || !video || !src) return undefined;

    // Native HLS (Safari + iOS WebView).
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return undefined;
    }

    let cancelled = false;
    let hlsInstance: any = null;

    Promise.all([import('hls.js'), import('../../utils/tauri-hls-loader')])
      .then(([{ default: Hls }, { TauriHlsLoader }]) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setErrorMsg('Your browser does not support MSE — required for HLS playback.');
          return;
        }

        // Route every HLS fetch through Rust when we're inside Tauri. bsky's
        // video CDN doesn't return Access-Control-Allow-Origin, so the
        // browser-default XHR loader is blocked by CORS the moment hls.js asks
        // for the playlist. The Rust IPC command (`fetch_remote_bytes`) is
        // server-to-server and bypasses CORS.
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
            setErrorMsg(
              `Video error: ${data.details ?? data.type ?? 'unknown'} — open in Bluesky to watch.`,
            );
            try {
              hls.destroy();
            } catch {
              // ignore
            }
          } else {
            console.warn('[bsky/hls] non-fatal', data.details ?? data.type, data);
          }
        });

        try {
          hls.loadSource(src);
          hls.attachMedia(video);
        } catch (err) {
          console.error('[bsky/hls] loadSource/attachMedia failed:', err);
          setErrorMsg('Could not initialize HLS player.');
        }
      })
      .catch((err) => {
        console.error('[bsky/hls] dynamic import of hls.js failed:', err);
        if (!cancelled) setErrorMsg('Failed to load video player.');
      });

    return () => {
      cancelled = true;
      try {
        hlsInstance?.destroy();
      } catch {
        // ignore
      }
    };
  }, [videoRef, src, enabled]);

  return errorMsg;
};
