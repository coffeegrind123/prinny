import { isTauri } from './desktop-notifications';
import { sharedRequest } from './embedFetch';

// Fallback link-preview fetcher for the desktop/mobile app. When the
// homeserver's `preview_url` fails (commonly a 504 because the target site
// rejects Synapse's non-browser User-Agent), our Rust `fetch_og_preview`
// command fetches the page itself with a real Chrome UA — server-to-server,
// so CORS doesn't apply — and parses the OG/Twitter meta tags. The result is
// keyed exactly like a Matrix preview response (og:title, og:image, …) so the
// preview card renders it with no special-casing.
//
// The Rust side keeps full SSRF protection (private-IP rejection, DNS pinning,
// per-hop redirect re-vetting, response-size cap). This wrapper is only ever
// called when the user has opted into the fallback setting, which defaults to
// false (`clientPreviewFallback` in state/settings.ts) — and that default is
// load-bearing, not cosmetic. The residual risk once it is enabled is not
// SSRF but attribution: the target URL comes from a message someone else
// wrote, so enabling this lets a sender learn the viewer's IP address and
// observe roughly when the message was rendered. The returned metadata is
// likewise attacker-chosen; callers must validate anything they put in a
// `src`/`href` (see `isWebUrl` in utils/safeUrl.ts).
export async function fetchOgPreview(url: string): Promise<Record<string, string> | null> {
  if (!isTauri()) return null;
  try {
    // One request per URL per session. The card asks again every time it
    // mounts (switching rooms, scrolling a message back into view), so without
    // this a link that keeps failing kept costing a fresh fetch and parse in
    // the shell; that is how one bad page grew into several pinned cores.
    // A failure is not cached (sharedRequest evicts it), so it can be retried.
    const data = await sharedRequest(`og-preview:${url}`, async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<Record<string, string>>('fetch_og_preview', { url });
    });
    return data ?? null;
  } catch (err) {
    console.warn('[og-preview] fallback fetch failed for', url, err);
    return null;
  }
}
