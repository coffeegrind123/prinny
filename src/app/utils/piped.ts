import { useEffect, useState } from 'react';

// Curated Piped instances (origins only; the embed path is appended per video).
//
// Both entries are real domains with valid TLS, so both load in the web app and
// in the desktop shell alike. The bare-IP and http:// instances this list used
// to carry are gone: none of them could ever be embedded from the hosted web
// app — http is blocked as mixed content and no CA issues certificates for a
// bare IP — so they were desktop-only entries that mostly served to make the
// picker look longer than it was.
//
// Order matters: the first entry is {@link DEFAULT_INSTANCE}, which is both the
// value used before the probe answers and the fallback when every probe fails.
export const PIPED_INSTANCES: string[] = [
  'https://piped.gmach.online', // = 87.184.81.212 (cert SAN); embed + API verified
  'https://piped.private.coffee',
];

const DEFAULT_INSTANCE = PIPED_INSTANCES[0];

/**
 * Where each instance serves its JSON API.
 *
 * Not derivable from the frontend origin, which is why this is a table and not
 * a rule: gmach puts the API on `pipedapi.<domain>` and private.coffee on
 * `api.piped.<domain>`. Both were checked against the live hosts — the frontend
 * origin answers `/streams/<id>` with the SPA's `text/html`, so asking it for
 * metadata gets a 200 that is not JSON, which is the failure mode a derived
 * guess would have produced silently.
 *
 * Every entry here is CORS-open (`access-control-allow-origin: *`), so this is
 * readable from the web app as well as the shells.
 */
const PIPED_API_ORIGINS: Record<string, string> = {
  'https://piped.gmach.online': 'https://pipedapi.gmach.online',
  'https://piped.private.coffee': 'https://api.piped.private.coffee',
};

/**
 * Origins this context can even attempt.
 *
 * A no-op against the current list, which is all https and all real domains —
 * and kept precisely so it stays that way. On an https page the browser blocks
 * an http subresource outright and reports a "Mixed Content ... has been
 * blocked" console error before the request leaves; a bare-IP https origin dies
 * on a cert error instead, since no CA issues certificates for a bare IP. Both
 * used to be in this list, and probing them was not "degrading gracefully" — it
 * was a guaranteed console error per candidate on every load that touched a
 * YouTube link, for origins the web app could never have embedded.
 *
 * Re-adding such an origin therefore costs nothing here: it is filtered out on
 * the web and kept in the desktop shell, which is not on https and accepts it.
 */
const BARE_IP_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;
const reachableInstances = (): string[] => {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') {
    return PIPED_INSTANCES;
  }
  return PIPED_INSTANCES.filter((origin) => {
    if (!origin.startsWith('https://')) return false;
    try {
      return !BARE_IP_HOST.test(new URL(origin).hostname);
    } catch {
      return false;
    }
  });
};

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

export const pipedEmbedUrl = (origin: string, videoId: string): string =>
  `${trimSlash(origin)}/embed/${videoId}`;

/**
 * The metadata endpoint for a video on `origin`'s instance, or undefined when
 * that instance has no API host on file. Undefined means "do not ask" — never
 * fall back to the frontend origin, which answers with HTML.
 */
export const pipedStreamsUrl = (origin: string, videoId: string): string | undefined => {
  const api = PIPED_API_ORIGINS[trimSlash(origin)];
  if (!api) return undefined;
  return `${api}/streams/${encodeURIComponent(videoId)}`;
};

// A reachability probe. `no-cors` means we can't read the response status, but an
// opaque resolve still tells us the host answered and — for https — that its
// certificate was accepted, which is exactly the bar for "can this be embedded
// from here". A mixed-content-blocked http origin, a self-signed cert, or an
// unreachable host rejects, and we pass over it.
const probe = (origin: string, timeoutMs = 4000): Promise<string> =>
  new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, timeoutMs);
    fetch(trimSlash(origin), { mode: 'no-cors', signal: controller.signal }).then(
      () => {
        clearTimeout(timer);
        resolve(origin);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

// First origin to answer wins — the fastest reachable one — else DEFAULT_INSTANCE
// once every probe has rejected. Hand-rolled rather than Promise.any() because
// the tsconfig lib is ES2020 (Promise.any is ES2021); a Promise settles once, so
// the later resolves are harmless no-ops.
const firstReachable = (origins: string[]): Promise<string> =>
  new Promise((resolve) => {
    let pending = origins.length;
    if (pending === 0) {
      resolve(DEFAULT_INSTANCE);
      return;
    }
    origins.forEach((origin) => {
      probe(origin).then(
        (reachable) => resolve(reachable),
        () => {
          pending -= 1;
          if (pending === 0) resolve(DEFAULT_INSTANCE);
        },
      );
    });
  });

let cached: string | undefined;
let probing: Promise<string> | undefined;

const resolveAuto = (): Promise<string> => {
  if (cached) return Promise.resolve(cached);
  if (!probing) {
    probing = firstReachable(reachableInstances()).then((origin) => {
      cached = origin;
      return origin;
    });
  }
  return probing;
};

/**
 * Resolve which Piped instance to embed from.
 *
 * @param preferred an explicit user pick. Honoured when reachable; if it is
 *   down we fall back to the auto-probe so a stale choice never leaves a blank
 *   player. Anything not in {@link PIPED_INSTANCES} is ignored (treated as auto).
 */
export const resolvePipedInstance = (preferred?: string): Promise<string> => {
  // An explicit pick the current context cannot load (an http instance chosen
  // in the desktop app, then opened in the web app) goes straight to auto
  // rather than through a probe that the browser refuses to send.
  if (preferred && !reachableInstances().includes(preferred)) return resolveAuto();
  if (preferred && PIPED_INSTANCES.includes(preferred)) {
    return probe(preferred).then(
      () => preferred,
      () => resolveAuto(),
    );
  }
  return resolveAuto();
};

/**
 * React binding for {@link resolvePipedInstance}. Returns the resolved instance,
 * defaulting to the first entry while the probe is in flight so the iframe
 * always has a usable src. Pass '' (or an unknown value) for automatic pick.
 */
export const usePipedInstance = (preferred: string): string => {
  const [instance, setInstance] = useState<string>(cached ?? DEFAULT_INSTANCE);
  useEffect(() => {
    let active = true;
    resolvePipedInstance(preferred || undefined).then((origin) => {
      if (active) setInstance(origin);
    });
    return () => {
      active = false;
    };
  }, [preferred]);
  return instance;
};
