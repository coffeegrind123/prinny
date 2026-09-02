import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { isWebUrl } from '../utils/safeUrl';

// Combined public Matrix homeserver directory.
//
// Replaces the matrixrooms.info (MRS) room directory that used to back the
// Explore page. The data is merged and deduplicated daily from three
// independent lists — asra.gr's federation crawl, joinmatrix.org's curated
// list, and privacydev.net's privacy survey — by
// https://github.com/coffeegrind123/prinny.app (scripts/build-servers.mjs).
//
// WHY A MIDDLEMAN AND NOT THE THREE SOURCES DIRECTLY
// None of the three upstreams send an `Access-Control-Allow-Origin` header, so
// the browser build simply cannot fetch them — verified with a GET carrying an
// Origin, against a control (api.matrixrooms.info, which does send `*`). The
// Tauri builds could bypass CORS, but that would leave the web build and every
// self-hoster with a broken page and two code paths to maintain. GitHub Pages
// does send `*`, so one prebuilt file serves desktop, Android and web alike.
//
// SECURITY: this is an unauthenticated fetch to a third party, and its output
// is rendered as clickable homeserver/registration targets. Everything it
// returns is untrusted input. Nothing from the response is used before
// parseServer() below has validated it — in particular `name` becomes a
// homeserver the user may be handed to the login flow, and `homepage` /
// `registration.link` become hrefs.
const DEFAULT_SERVERS_URL = 'https://prinny.app/api/servers.json';

export interface PublicServerRegistration {
  open: boolean;
  method: string;
  link: string;
  captcha: boolean | null;
  captchaNote: string;
  emailRequired: boolean | null;
}

export interface PublicServerPrivacy {
  torFriendly: boolean | null;
  cloudflare: boolean | null;
}

export interface PublicServerInfo {
  description: string;
  homepage: string;
  rules: string;
  privacyPolicy: string;
  isp: string;
  jurisdiction: string;
  languages: string[];
  features: string[];
}

export interface PublicServer {
  name: string;
  clientDomain: string;
  software: string;
  version: string;
  lastCheck: string;
  registration: PublicServerRegistration;
  privacy: PublicServerPrivacy;
  info: PublicServerInfo;
  sources: string[];
}

export interface PublicServerDirectory {
  generatedAt: string;
  servers: PublicServer[];
  /** True when any upstream was unreachable on the last refresh. */
  degraded: boolean;
}

// A homeserver name is a DNS name. Deliberately strict: this value can be
// handed to the login flow as a homeserver, so a malformed one is dropped
// outright rather than passed along.
const HOSTNAME_REG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const MAX_SHORT_TEXT = 120;
const MAX_DESC = 400;
const MAX_LIST_ITEMS = 12;
// Ceiling on entries accepted from one response, independent of what the file
// claims. The generator emits ~1150; 5000 leaves room to grow without letting
// a hostile or broken file exhaust memory.
const MAX_ENTRIES = 5000;

const asText = (value: unknown, maxLen: number): string =>
  typeof value === 'string' ? value.slice(0, maxLen) : '';

/** Tri-state: true / false / null for "the sources do not know". */
const asTriBool = (value: unknown): boolean | null =>
  value === true || value === false ? value : null;

const asStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string')
        .slice(0, MAX_LIST_ITEMS)
        .map((v) => v.slice(0, MAX_SHORT_TEXT))
    : [];

/** Only http(s) URLs survive — these become hrefs. */
const asUrl = (value: unknown): string => (isWebUrl(value) ? (value as string) : '');

const parseServer = (raw: unknown): PublicServer | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;

  // The name is the server identity and the thing we would log in to. No valid
  // name, no entry.
  const name = typeof r.name === 'string' ? r.name.toLowerCase() : '';
  if (!name || name.length > 253 || !HOSTNAME_REG.test(name)) return undefined;

  const clientDomainRaw = typeof r.client_domain === 'string' ? r.client_domain.toLowerCase() : '';
  const clientDomain =
    clientDomainRaw && clientDomainRaw.length <= 253 && HOSTNAME_REG.test(clientDomainRaw)
      ? clientDomainRaw
      : '';

  const reg = (
    typeof r.registration === 'object' && r.registration !== null ? r.registration : {}
  ) as Record<string, unknown>;
  const priv = (typeof r.privacy === 'object' && r.privacy !== null ? r.privacy : {}) as Record<
    string,
    unknown
  >;
  const info = (typeof r.info === 'object' && r.info !== null ? r.info : {}) as Record<
    string,
    unknown
  >;

  return {
    name,
    clientDomain,
    software: asText(r.software, MAX_SHORT_TEXT),
    version: asText(r.version, MAX_SHORT_TEXT),
    lastCheck: asText(r.last_check, 40),
    registration: {
      // Absent means unknown; the generator prunes nulls but keeps real
      // `false`. Treating unknown as closed would hide most of the list, so
      // only an explicit `false` closes it.
      open: reg.open !== false,
      method: asText(reg.method, MAX_SHORT_TEXT),
      link: asUrl(reg.link),
      captcha: asTriBool(reg.captcha),
      captchaNote: asText(reg.captcha_note, MAX_SHORT_TEXT),
      emailRequired: asTriBool(reg.email_required),
    },
    privacy: {
      torFriendly: asTriBool(priv.tor_friendly),
      cloudflare: asTriBool(priv.cloudflare),
    },
    info: {
      description: asText(info.description, MAX_DESC),
      homepage: asUrl(info.homepage),
      rules: asUrl(info.rules),
      privacyPolicy: asUrl(info.privacy_policy),
      isp: asText(info.isp, MAX_SHORT_TEXT),
      jurisdiction: asText(info.jurisdiction, MAX_SHORT_TEXT),
      languages: asStringList(info.languages),
      features: asStringList(info.features),
    },
    sources: asStringList(r.sources),
  };
};

async function fetchPublicServers(url: string): Promise<PublicServerDirectory> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Server directory: HTTP ${response.status}`);

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Server directory: unexpected response shape');
  }
  const doc = body as Record<string, unknown>;
  if (!Array.isArray(doc.servers)) {
    throw new Error('Server directory: missing servers array');
  }

  const servers: PublicServer[] = [];
  const seen = new Set<string>();
  for (const entry of doc.servers.slice(0, MAX_ENTRIES)) {
    const server = parseServer(entry);
    // Defend against a duplicate slipping through the generator's dedupe —
    // two rows with the same name would collide as React keys.
    if (server && !seen.has(server.name)) {
      seen.add(server.name);
      servers.push(server);
    }
  }

  const sources = Array.isArray(doc.sources) ? doc.sources : [];
  const degraded = sources.some(
    (s) => typeof s === 'object' && s !== null && (s as Record<string, unknown>).stale === true,
  );

  return {
    generatedAt: asText(doc.generated_at, 40),
    servers,
    degraded,
  };
}

/**
 * Fetch the merged public server directory.
 *
 * Cached hard: the upstream file is regenerated once a day, so re-fetching it
 * within a session is pure waste.
 */
export function usePublicServers(url: string = DEFAULT_SERVERS_URL) {
  return useQuery<PublicServerDirectory, Error>({
    queryKey: ['public-servers', url],
    queryFn: () => fetchPublicServers(url),
    staleTime: 1000 * 60 * 60 * 6, // 6 hours
    gcTime: 1000 * 60 * 60 * 24, // 1 day
    retry: 1,
  });
}

/**
 * Server names only, for the login/register homeserver dropdown.
 *
 * Ordered by how much we actually know about a server rather than
 * alphabetically: an entry corroborated by the curated list, with
 * registration open and no captcha, is a far better default suggestion than
 * the alphabetically-first result out of eleven hundred autogenerated rows.
 */
export function usePublicServerNames(url?: string, limit = 200): string[] {
  const { data } = usePublicServers(url);

  return useMemo(() => {
    if (!data) return [];
    const score = (s: PublicServer): number => {
      let n = 0;
      if (s.sources.includes('joinmatrix')) n += 8; // hand-curated
      if (s.sources.includes('privacydev')) n += 2;
      if (s.sources.length > 1) n += 2;
      if (s.registration.captcha === false) n += 2;
      if (s.registration.emailRequired === false) n += 2;
      if (s.privacy.torFriendly === true) n += 1;
      if (s.info.description) n += 1;
      // Prefer servers seen recently by the crawl.
      if (s.lastCheck) {
        const age = Date.now() - new Date(s.lastCheck).getTime();
        if (Number.isFinite(age) && age < 1000 * 60 * 60 * 24 * 7) n += 3;
      }
      return n;
    };

    return data.servers
      .filter((s) => s.registration.open)
      .map((s) => ({ s, score: score(s) }))
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
      .slice(0, limit)
      .map(({ s }) => s.name);
  }, [data, limit]);
}
