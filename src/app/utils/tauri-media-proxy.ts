import { isTauri } from './desktop-notifications';

// Fetch a cross-origin media URL via our Rust `fetch_remote_bytes` command
// and return a blob: URL the WebView can pass to <video src=...> /
// <img src=...>.
//
// We don't use @tauri-apps/plugin-http here because its guest-js layer wraps
// headers in a browser `Headers` object, which silently strips forbidden
// headers (User-Agent, Referer). The request then reaches Rust reqwest with
// the default `reqwest/x.x` UA and twimg.com 403s it. Our Rust command sets
// a real Chrome UA and sends no Referer (twimg serves when Referer is empty).

// Hosts the frontend is allowed to proxy through `fetch_remote_bytes`
// (Twitter/X CDN via vxtwitter, Bluesky image/video CDN). Suffix-matched, so
// every subdomain (video.twimg.com, pbs.twimg.com, video.bsky.app, …) is
// covered.
//
// MUST STAY IN SYNC WITH `ALLOWED_MEDIA_HOSTS` in the Tauri shell's
// `src-tauri/src/lib.rs`. The native side enforces the real boundary, but the
// URLs that reach this command come from third-party API JSON (vxtwitter,
// public.api.bsky.app) — i.e. attacker-influenced data — and every caller here
// used to hand them to the IPC with zero JS-side checking. Duplicating the
// contract locally makes the coupling explicit instead of leaving the only
// copy of it in a different repository, and stops obviously-out-of-scope URLs
// (other hosts, non-https schemes, `file:`) from ever crossing the IPC.
export const ALLOWED_MEDIA_HOSTS: readonly string[] = ['twimg.com', 'bsky.app'];

// Upper bound on a proxied media response. `fetch_remote_bytes` hands us the
// whole body as one buffer, so without a cap a hostile (or merely broken) CDN
// response can be turned into unbounded renderer memory by anyone who can post
// a link. 64 MiB comfortably covers Twitter/Bluesky video and images.
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

/** True when `value` is an https URL on an allowlisted media host. */
export function isAllowedMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.replace(/\.$/, '').toLowerCase();
  return ALLOWED_MEDIA_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Validated wrapper around the `fetch_remote_bytes` IPC command.
 *
 * Rejects before invoking when the URL is not an https URL on an allowlisted
 * media host, and rejects after the fact when the response exceeds
 * `MAX_MEDIA_BYTES`. Every proxied-media path (blob URLs for <img>/<video>,
 * the HLS loader) goes through here so the check cannot be bypassed by adding
 * a new call site.
 */
export async function fetchRemoteMediaBytes(url: string): Promise<ArrayBuffer> {
  if (!isAllowedMediaUrl(url)) {
    throw new Error(`[media-proxy] refusing to proxy non-allowlisted URL: ${url}`);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<ArrayBuffer | Uint8Array>('fetch_remote_bytes', { url });

  // tauri::ipc::Response → JS comes through as ArrayBuffer in most Tauri 2
  // builds, but defensively handle Uint8Array too.
  const buffer: ArrayBuffer =
    result instanceof ArrayBuffer
      ? result
      : ((result as Uint8Array).buffer.slice(
          (result as Uint8Array).byteOffset,
          (result as Uint8Array).byteOffset + (result as Uint8Array).byteLength,
          // .buffer is typed ArrayBufferLike (the SharedArrayBuffer arm can
          // never occur for an IPC response), and slice() preserves that.
        ) as ArrayBuffer);

  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(
      `[media-proxy] response too large (${buffer.byteLength} > ${MAX_MEDIA_BYTES}): ${url}`,
    );
  }
  return buffer;
}

/**
 * Proxy `url` through Rust and return a `blob:` URL for it.
 *
 * `mimeType` is not cosmetic. `fetch_remote_bytes` returns raw bytes with no
 * content type, and a `Blob` built without one produces a `blob:` URL that the
 * engine sees as having no MIME type at all. `<img>` tolerates that by
 * sniffing; media elements largely do not — WebKitGTK (the Linux desktop
 * WebView) and Android's WebView both refuse to decode a typed-less blob, which
 * is one of the ways a proxied Twitter GIF renders as a blank box with no
 * error. Callers should pass `mimeTypeFromUrl(url)`.
 */
export async function fetchAsBlobUrl(url: string, mimeType?: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const bytes = await fetchRemoteMediaBytes(url);
    const blob = mimeType ? new Blob([bytes], { type: mimeType }) : new Blob([bytes]);
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn('[media-proxy] fetch failed for', url, err);
    return null;
  }
}

/**
 * Fetch an allowlisted media URL from the page with the `Referer` stripped, and
 * return a `blob:` URL for the bytes. Works in any browser — no Tauri needed.
 *
 * **This is not a nicety, it is the only way a media element can suppress a
 * referrer.** `referrerpolicy` is a content attribute on `<img>`, `<iframe>`,
 * `<link>`, `<script>` and `<a>` — the HTML spec defines nothing of the sort on
 * `<video>`, `<audio>` or `<source>`. Writing it on a `<video>` parses as an
 * unknown attribute and changes nothing; `'referrerPolicy' in
 * HTMLVideoElement.prototype` is `false`. The element therefore inherits the
 * document policy (`strict-origin-when-cross-origin`) and sends
 * `Referer: <our origin>`, and `video.twimg.com` answers **403** to any request
 * carrying a cross-origin Referer.
 *
 * That is the whole reason Twitter GIFs and videos were dead in the browser
 * build while ordinary GIF links played: a GIF link renders as an `<img>`,
 * where the attribute *is* honoured. Measured in Chromium at
 * `https://prinny.app`, same URL, same session:
 *
 * | request                                            | result                      |
 * |----------------------------------------------------|-----------------------------|
 * | `<video referrerpolicy="no-referrer" src=…mp4>`     | 403, `MediaError code 4`    |
 * | `fetch(…, { referrerPolicy: 'no-referrer' })`       | 200, `video/mp4`, plays     |
 *
 * `fetch()` honours `referrerPolicy`, and twimg does serve CORS (it reflects
 * `Origin` on the GET and answers the preflight), so pulling the bytes here and
 * handing the element a blob is the working path. No custom headers are sent,
 * so this stays a simple request and never triggers a preflight.
 */
export async function fetchNoReferrerBlobUrl(
  url: string,
  mimeType?: string,
): Promise<string | null> {
  if (!isAllowedMediaUrl(url)) {
    console.warn('[media-proxy] refusing to fetch non-allowlisted URL:', url);
    return null;
  }
  try {
    const res = await fetch(url, {
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      credentials: 'omit',
    });
    if (!res.ok) {
      console.warn('[media-proxy] no-referrer fetch failed', res.status, url);
      return null;
    }
    // Cheap pre-check so an oversized body is refused before it is buffered.
    // Absent or unparseable Content-Length just falls through to the real check
    // on the materialised blob below.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) {
      console.warn('[media-proxy] response too large (declared)', declared, url);
      return null;
    }
    const blob = await res.blob();
    if (blob.size > MAX_MEDIA_BYTES) {
      console.warn('[media-proxy] response too large', blob.size, url);
      return null;
    }
    // A blob with an empty `type` has no content type at all, and the stricter
    // engines refuse to decode one — same trap as the native path above. The
    // response's own Content-Type is preferred; `mimeType` is the fallback.
    const typed = blob.type ? blob : new Blob([blob], { type: mimeType ?? '' });
    return URL.createObjectURL(typed);
  } catch (err) {
    console.warn('[media-proxy] no-referrer fetch threw for', url, err);
    return null;
  }
}

/**
 * Fetch a remote media URL as a `Blob`, for saving to disk under a chosen name.
 *
 * The blob-URL helpers above exist to feed an element a `src`; a download needs
 * the bytes plus a filename, and `FileSaver` sets the name itself. Same two
 * paths in the same order — the native proxy inside the shell, the in-page
 * no-referrer fetch otherwise — because a Twitter CDN URL answers 403 to a
 * plain cross-origin GET exactly as it does for a media element.
 *
 * Throws rather than returning null: a download is something the user asked
 * for, so a failure has to reach the button's error state instead of silently
 * saving nothing.
 */
export async function downloadRemoteMedia(url: string, mimeType?: string): Promise<Blob> {
  if (isTauri() && isAllowedMediaUrl(url)) {
    try {
      const bytes = await fetchRemoteMediaBytes(url);
      return new Blob([bytes], { type: mimeType ?? '' });
    } catch (err) {
      console.warn('[media-proxy] native download failed, falling back for', url, err);
    }
  }

  const res = await fetch(url, {
    referrerPolicy: 'no-referrer',
    mode: 'cors',
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`[media-proxy] download HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) {
    throw new Error(`[media-proxy] response too large (declared ${declared})`);
  }
  const blob = await res.blob();
  if (blob.size > MAX_MEDIA_BYTES) {
    throw new Error(`[media-proxy] response too large (${blob.size})`);
  }
  return blob.type ? blob : new Blob([blob], { type: mimeType ?? '' });
}
