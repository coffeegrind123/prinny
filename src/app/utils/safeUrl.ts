/**
 * Scheme validation for URLs that originate outside the client.
 *
 * Why this exists: a URL that reaches an `href`, a `src`, or `window.open()` is
 * not just a navigation. In the Tauri desktop and Android shell the same bundle
 * runs inside a native window whose new-window handler forwards the target to
 * the operating system's URL opener, so an unexpected scheme becomes an
 * invocation of whatever local application is registered for it. React blocks a
 * literal `javascript:` href, but it does not filter `file:`, `data:`, UNC
 * paths, or application protocol schemes, and `window.open()` is not filtered at
 * all.
 *
 * Homeserver-supplied values are the main source: UIA terms policy URLs, OIDC
 * `account_management_uri` and `issuer`, SSO fallback URLs, and preview metadata
 * are all chosen by a party the threat model treats as untrusted.
 */

const WEB_SCHEMES = new Set(['http:', 'https:']);

/**
 * Schemes permitted on links inside message content, shared by the HTML
 * sanitizer and the plain-text linkifier so the two cannot drift apart.
 *
 * `ftp` and `magnet` were previously allowed. Both hand the URL to a local
 * application through the OS opener in the desktop shell — a torrent client for
 * `magnet` — on a link authored by any federated user. Neither is needed by this
 * product, so neither is allowed. `mailto` stays: it is ubiquitous in chat and
 * composing a message is not a privileged action.
 *
 * `matrix` is allowed for a different reason than the others: it never reaches
 * the OS opener at all. MatrixLinkHandler intercepts clicks on `matrix:` links
 * and resolves them to a room or user inside the app, and the desktop shell's
 * new-window handler refuses every scheme except http(s) anyway. Without it here
 * the sanitizer stripped the href, so links other clients send routinely — the
 * MSC2312 form of a room or user reference — arrived as plain unclickable text.
 */
export const MESSAGE_LINK_SCHEMES = ['https', 'http', 'mailto', 'matrix'] as const;

/**
 * True when `value` parses as an absolute URL with an http(s) scheme.
 *
 * Relative URLs are rejected: every caller here handles a value supplied by a
 * remote party, where a relative reference is never the intended shape and
 * resolving one against the app origin is its own hazard.
 */
export const isWebUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return WEB_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
};

/**
 * Returns `value` when it is a safe http(s) URL, otherwise `undefined`.
 * Use at the point of consumption, so the check cannot be separated from the
 * sink it protects.
 */
export const webUrlOrUndefined = (value: unknown): string | undefined =>
  isWebUrl(value) ? value : undefined;

/**
 * The host of a safe http(s) URL — `bsky.app` — or `undefined`.
 *
 * For labelling a link in the UI when nothing better is known about it. Goes
 * through the same http(s) check as everything else here, so a value that is
 * not a web URL cannot reach a label either.
 */
export const hostnameOrUndefined = (value: unknown): string | undefined => {
  if (!isWebUrl(value)) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
};

/**
 * `window.open()` restricted to http(s), with `noopener,noreferrer` applied.
 *
 * Without `noopener` the opened document keeps a `window.opener` handle and can
 * navigate this window — reverse tabnabbing, which matters most during an
 * authentication flow, exactly where these URLs appear. Returns `false` when the
 * URL was rejected so callers can surface an error instead of failing silently.
 */
export const openWebUrl = (value: unknown): boolean => {
  if (!isWebUrl(value)) return false;
  window.open(value, '_blank', 'noopener,noreferrer');
  return true;
};
