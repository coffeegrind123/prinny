import { fetchRemoteMediaBytes } from './tauri-media-proxy';

// Custom hls.js Loader that routes every HLS HTTP request — manifest,
// playlists, media segments — through our Rust `fetch_remote_bytes` IPC
// command instead of the browser's XHR stack.
//
// Every request goes through `fetchRemoteMediaBytes` rather than `invoke`
// directly: hls.js follows URLs out of the manifest body, so the segment URLs
// this loader is asked to fetch are chosen by whatever served the playlist,
// not by us. The shared helper enforces the https + allowlisted-host contract
// and the response size cap on each one.
//
// Originally written because Bluesky's video CDN (`video.bsky.app`) was said
// not to return Access-Control-Allow-Origin, which would have the browser block
// hls.js's default XHR loader (the app is served over http://localhost:44548 by
// tauri-plugin-localhost, a normal HTTP origin as far as the WebView is
// concerned). Going through Rust bypasses CORS entirely — the server does not
// know a browser is involved.
//
// **That premise no longer holds, measured 24.08.2026:** a live
// `video.bsky.app` playlist answers with `access-control-allow-origin: *` and
// `access-control-expose-headers` including `Range`. So this loader is not what
// makes Bluesky video work any more, and if it ever misbehaves again, dropping
// back to `Hls.DefaultConfig.loader` for that host is a legitimate fix rather
// than a regression. It is kept because it is still the only path that works
// for a host that does *not* send CORS, and because the Rust side is where the
// User-Agent and Referer are controlled.
//
// This is the same approach the Twitter video path uses (see
// `fetchAsBlobUrl` in tauri-media-proxy.ts).

type Stats = {
  aborted: boolean;
  loading: { start: number; first: number; end: number };
  parsing: { start: number; end: number };
  buffering: { start: number; first: number; end: number };
  total: number;
  loaded: number;
  retry: number;
  chunkCount: number;
  bwEstimate: number;
};

function makeStats(): Stats {
  return {
    aborted: false,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
    total: 0,
    loaded: 0,
    retry: 0,
    chunkCount: 0,
    bwEstimate: 0,
  };
}

// Zero the stats IN PLACE. Replacing the object is not equivalent, and the
// difference is a video that never plays.
//
// hls.js takes a *reference* to `loader.stats` before it calls `load()` —
// literally, at hls.js/dist/hls.js:6418, `frag.stats = loader.stats;` under the
// comment "Assign frag stats to the loader's stats reference" (and again at
// :6516 for parts). Every later reader goes through that reference. This loader
// used to do `this.stats = makeStats()` on each `load()`, so from that moment
// hls.js was holding an object nothing would ever write to again.
//
// What that does, following its own ABR code (hls.js:4035-4110): `timeLoading =
// now - stats.loading.start` with a frozen `loading.start` of 0 is `now` — tens
// of seconds — which clears the "don't judge a fragment until half its duration
// has passed" gate immediately. `stats.loaded` frozen at 0 makes `loadRate` 0,
// so the estimated time to finish the fragment is compared against an empty
// buffer and always loses, and the check falls through to
// FRAG_LOAD_EMERGENCY_ABORTED. The first media fragment is therefore abandoned
// the instant it starts, over and over, with no fatal error ever raised — so
// the player reports nothing, no frame is ever produced, and the only symptom
// is a stage that sits there until something else times out.
//
// It needs a multi-variant playlist to bite (a single-rendition one returns
// early at `loadingFragForLevel <= minAutoLevel` before any of this), which is
// exactly what Bluesky serves: 360p and 720p.
function resetStats(stats: Stats): void {
  stats.aborted = false;
  stats.loading.start = stats.loading.first = stats.loading.end = 0;
  stats.parsing.start = stats.parsing.end = 0;
  stats.buffering.start = stats.buffering.first = stats.buffering.end = 0;
  stats.total = 0;
  stats.loaded = 0;
  stats.retry = 0;
  stats.chunkCount = 0;
  stats.bwEstimate = 0;
}

export class TauriHlsLoader {
  context: any = null;

  /**
   * Created once per loader and never reassigned — see `resetStats`. hls.js
   * holds this exact object.
   */
  readonly stats: Stats = makeStats();

  private abortRequested = false;

  destroy(): void {
    this.abort();
  }

  abort(): void {
    this.abortRequested = true;
    this.stats.aborted = true;
  }

  load(context: any, _config: any, callbacks: any): void {
    this.context = context;
    this.abortRequested = false;
    resetStats(this.stats);
    this.stats.loading.start = performance.now();

    const { url } = context;

    // `fetch_remote_bytes` returns whole responses; it cannot do a Range
    // request. Serving the entire file where hls.js asked for a byte range
    // would hand the demuxer bytes that do not mean what it thinks they mean,
    // and it would fail somewhere else entirely with a decode error. Say what
    // actually happened instead. (Bluesky's playlists carry no EXT-X-BYTERANGE,
    // so this is a guard against a format we do not handle, not a live path.)
    if (
      typeof context.rangeStart === 'number' &&
      typeof context.rangeEnd === 'number' &&
      context.rangeEnd > context.rangeStart
    ) {
      callbacks.onError(
        { code: 0, text: 'tauri hls loader cannot serve a byte-range request' },
        context,
        null,
        this.stats,
      );
      return;
    }

    fetchRemoteMediaBytes(url)
      .then((buffer) => {
        if (this.abortRequested) return;

        // `first` is the moment the first byte landed and `end` the moment the
        // last one did; hls.js measures throughput as `end - first` and samples
        // TTFB as `first - start`. An IPC call hands over the whole body at
        // once, so there is no real "first byte" instant to report — but
        // reporting the same timestamp for both makes that throughput sample a
        // division by zero, and an infinite bandwidth estimate is exactly what
        // talks the level chooser into a rendition this connection cannot
        // sustain. Counting the whole round trip as transfer time is the honest
        // reading of what we actually know, and it errs low, which is the safe
        // direction for ABR.
        this.stats.loading.first = this.stats.loading.start;
        this.stats.loading.end = performance.now();
        this.stats.total = this.stats.loaded = buffer.byteLength;

        // hls.js asks for `arraybuffer` for media segments and leaves
        // responseType unset/'text' for manifests + playlists.
        const responseType = (context.responseType ?? 'text') as 'text' | 'arraybuffer';
        const data: string | ArrayBuffer =
          responseType === 'arraybuffer' ? buffer : new TextDecoder().decode(buffer);

        callbacks.onSuccess({ url, data }, this.stats, context, null);
      })
      .catch((err) => {
        if (this.abortRequested) return;
        const now = performance.now();
        this.stats.loading.end = now;
        callbacks.onError(
          { code: 0, text: `tauri fetch_remote_bytes failed: ${String(err)}` },
          context,
          null,
          this.stats,
        );
      });
  }

  // Not all hls.js versions call these — provide stubs.
  getResponseHeader(_name: string): string | null {
    return null;
  }

  getCacheAge(): number | null {
    return null;
  }
}
