/**
 * The request layer every inline post embed shares.
 *
 * Lifted out of `socialEmbed` when a third provider (Rule34) arrived and would
 * otherwise have carried a second copy of the same retry policy and the same
 * in-flight cache, drifting from the first the moment either was touched. The
 * reasoning for each piece is unchanged and is recorded below, because all of
 * it was paid for in real reports of "it seems to not be doing that sometimes".
 *
 * Only the *transport* lives here. What a provider's response means — which
 * field is the media, which shape is an error, what counts as "no such post" —
 * belongs with that provider, because those answers are what differ.
 */

/**
 * How many times an endpoint is asked before the answer is "no".
 *
 * A Bluesky card is built from two chained requests (`resolveHandle`, then
 * `getPostThread`) and nothing else — the homeserver's own preview of a
 * `bsky.app` link is a separate race that plenty of homeservers do not run at
 * all. So a single dropped connection used to be the whole difference between
 * a rendered post and a message with no card under it, with nothing logged and
 * nothing retried.
 */
export const FETCH_ATTEMPTS = 3;
/** Backoff between attempts, multiplied by the attempt number. */
const RETRY_BASE_MS = 600;

/** An HTTP status a provider decided against, kept so retries can read it. */
export class ProviderHttpError extends Error {
  readonly status: number;

  constructor(endpoint: string, status: number) {
    super(`${endpoint} HTTP ${status}`);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

/**
 * A provider that answered, but with something this client cannot use — a
 * deleted post, an empty body, an error object served with a 200.
 *
 * Distinct from `ProviderHttpError` because it is an *answer*: retrying it just
 * asks a host the message sender chose to repeat itself. Several of these APIs
 * report "no such post" with a 200 (Hacker News with a literal `null`, Rule34
 * with a zero-length body), so this is not an edge case — it is the ordinary
 * shape of a dead link.
 */
export class ProviderContentError extends Error {
  constructor(endpoint: string, detail: string) {
    super(`${endpoint}: ${detail}`);
    this.name = 'ProviderContentError';
  }
}

/**
 * Whether a failure is the kind that might not happen again.
 *
 * A rate limit and a 5xx are the server having a moment; a `TypeError` from
 * `fetch` is the network having one (offline, DNS, TLS, a WebView tearing the
 * request down). A 400 or a 404 is an answer — the post is gone or the handle
 * does not exist — and asking again is just noise aimed at a host the message
 * *sender* chose. So is anything `ProviderContentError` covers.
 */
const worthRetrying = (err: unknown): boolean => {
  if (err instanceof ProviderContentError) return false;
  if (err instanceof ProviderHttpError) return err.status === 429 || err.status >= 500;
  return true;
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Query parameters whose *values* must never reach a log.
 *
 * Not hypothetical: rule34's dapi takes `api_key` and `user_id` in the query
 * string (it has no keyless mode at all), so the one line this module logs on
 * a failed fetch would otherwise print the app's credentials into the console
 * of every client that ever failed to load a rule34 embed — and a console log
 * is the single most-pasted artefact in a bug report. The list is deliberately
 * broader than what is used today so a provider added later is covered without
 * anyone having to remember this.
 */
const REDACTED_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'api_key',
  'apikey',
  'user_id',
  'userid',
  'key',
  'token',
  'access_token',
  'auth',
  'password',
  'secret',
  'signature',
]);

/** `url` with any credential-bearing parameter value replaced, for logging. */
export const redactUrl = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not parseable, so it cannot be picked apart safely — and it is not a URL
    // this module ever requested. Say so rather than printing it verbatim.
    return '(unparseable url)';
  }
  // Matched case-insensitively but rewritten under the name the URL actually
  // used, so `API_KEY` is redacted rather than left beside a new lower-case
  // key that redacts nothing. Snapshot the names first — `set` mutates the
  // collection being read.
  const sensitive = Array.from(parsed.searchParams.keys()).filter((name) =>
    REDACTED_QUERY_PARAMS.has(name.toLowerCase()),
  );
  sensitive.forEach((name) => parsed.searchParams.set(name, 'REDACTED'));
  return parsed.toString();
};

/**
 * GET `url`, read it with `read`, retry per the policy above, and log one line
 * if it never works.
 *
 * `read` runs inside the retry loop on purpose: for several of these providers
 * the failure is *in the body* rather than in the status, so a parse that
 * rejects has to be able to end the attempt — and, when it throws a
 * `ProviderContentError`, to end the whole call without asking again.
 */
const fetchWithRetry = async <T>(
  endpoint: string,
  url: string,
  read: (resp: Response) => Promise<T>,
): Promise<T> => {
  let lastErr: unknown;
  // The attempt that actually failed last, so the log below reports what was
  // spent rather than the budget. They differ for every content error — those
  // are answers and are never retried — and a log line claiming three attempts
  // where one was made sends whoever reads it looking for a network problem.
  let spent = 0;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    spent = attempt;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new ProviderHttpError(endpoint, resp.status);
      return await read(resp);
    } catch (err) {
      lastErr = err;
      if (!worthRetrying(err) || attempt === FETCH_ATTEMPTS) break;
      await delay(RETRY_BASE_MS * attempt);
    }
  }
  // Every one of these used to be swallowed by a bare `.catch()` in the card,
  // so a link with no preview looked identical whether the post was deleted,
  // the API refused, or the machine was briefly offline.
  console.warn('[embed-fetch] fetch failed', {
    endpoint,
    url: redactUrl(url),
    attempts: spent,
    budget: FETCH_ATTEMPTS,
    error: String(lastErr),
  });
  throw lastErr;
};

/** GET some JSON, with the retry policy above. */
export const fetchEmbedJson = (endpoint: string, url: string): Promise<any> =>
  fetchWithRetry(endpoint, url, (resp) => resp.json());

/**
 * GET, and read the response with a reader of the caller's own.
 *
 * For a provider whose failures live in the body rather than in the status —
 * see `rule34.ts`, where a missing post is a 200 with zero bytes and a missing
 * API key is a 200 whose body is a JSON string. Handing either to
 * `resp.json()` is wrong in opposite directions: the first throws a
 * `SyntaxError`, which `worthRetrying` reads as a flaky network and asks twice
 * more for, and the second parses cleanly into a value that is not a post.
 *
 * Reading inside the loop is the point. It is what lets a genuine 500 whose
 * body happens to be an HTML error page still be retried, while a
 * `ProviderContentError` — an answer — ends the call immediately.
 */
export const fetchEmbedWith = fetchWithRetry;

/**
 * One in-flight-or-successful request per key, shared by every caller.
 *
 * The timeline card and the room's media scan ask for exactly the same posts,
 * and a timeline can hold the same link several times over — each of which used
 * to be its own set of requests to a third-party API. **Failures are
 * deliberately not kept**: the whole point of the retry above is that these are
 * recoverable, and a cached rejection would make the first bad moment permanent
 * for the rest of the session.
 *
 * Keys are provider-namespaced (`bsky:post:…`, `rule34:post:…`) so one map can
 * serve every provider without two of them colliding on a bare id.
 */
const requestCache = new Map<string, Promise<any>>();

export const sharedRequest = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const cached = requestCache.get(key) as Promise<T> | undefined;
  if (cached) return cached;
  const pending = run().catch((err) => {
    requestCache.delete(key);
    throw err;
  });
  requestCache.set(key, pending);
  return pending;
};
