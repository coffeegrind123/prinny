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

/**
 * True for a host that names the user's own machine or private network.
 *
 * Tests the ADDRESS, not its spelling. A textual denylist misses `127.1`,
 * `2130706433`, `0x7f000001`, `[::ffff:127.0.0.1]`, `fc00::/7`, link-local
 * (including the `169.254.169.254` cloud-metadata address) and CGNAT space,
 * which are all the same destinations written differently. Mirrors
 * `is_disallowed_ip` in the Tauri shell, which is the enforcing copy for
 * anything that leaves the page.
 *
 * A hostname that only RESOLVES to a private address cannot be caught here -
 * that needs resolution, which the page cannot do.
 */
export const isPrivateHost = (rawHost: string): boolean => {
  const host = rawHost.trim().replace(/\.$/, '').toLowerCase();
  if (!host) return true;

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  // Bracketed or bare IPv6.
  const v6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (v6.includes(':')) {
    if (v6 === '::1' || v6 === '::') return true;
    // Unwrap any IPv4 embedded in an IPv6 form and re-test it.
    const embedded = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v6);
    if (embedded?.[1]) return isPrivateHost(embedded[1]);
    const head = parseInt(v6.split(':')[0] || '0', 16);
    if (Number.isFinite(head)) {
      if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
      if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
      if (head === 0x2002) return true; // 6to4
    }
    if (v6.startsWith('64:ff9b')) return true; // NAT64
    return false;
  }

  // IPv4 in dotted, shorthand, decimal or hex form.
  const octets = ipv4Octets(v6);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  return false;
};

/** Parse the dotted, shorthand (`127.1`), decimal or hex forms of an IPv4 host. */
const ipv4Octets = (host: string): [number, number, number, number] | null => {
  const parts = host.split('.');
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (part === '') return null;
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) n = parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
    else if (/^\d+$/.test(part)) n = parseInt(part, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  // `a.b` and `a` are legal shorthand: the final part fills the remaining bytes.
  const last = nums.pop();
  if (last === undefined || last > 0xffffffff) return null;
  const fill = 4 - nums.length;
  const bytes = [...nums];
  for (let i = fill - 1; i >= 0; i -= 1) bytes.push((last >>> (i * 8)) & 0xff);
  if (bytes.length !== 4 || bytes.some((n) => n > 255)) return null;
  return bytes as [number, number, number, number];
};
