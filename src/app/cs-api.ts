import to from './utils/await-to';
import { trimTrailingSlash } from './utils/common';

export enum AutoDiscoveryAction {
  PROMPT = 'PROMPT',
  IGNORE = 'IGNORE',
  FAIL_PROMPT = 'FAIL_PROMPT',
  FAIL_ERROR = 'FAIL_ERROR',
}

export type AutoDiscoveryError = {
  host: string;
  action: AutoDiscoveryAction;
};

export type AutoDiscoveryInfo = Record<string, unknown> & {
  'm.homeserver': {
    base_url: string;
  };
  'm.identity_server'?: {
    base_url: string;
  };
  'org.matrix.msc2965.authentication'?: {
    account?: string;
    issuer?: string;
  };
  'org.matrix.msc4143.rtc_foci'?: [
    {
      livekit_service_url: string;
      type: 'livekit';
    },
  ];
};

export const autoDiscovery = async (
  request: typeof fetch,
  server: string,
): Promise<[AutoDiscoveryError, undefined] | [undefined, AutoDiscoveryInfo]> => {
  // Force https. This used to preserve whatever scheme the caller already had,
  // so an `http://` prefix survived all the way to the credential-bearing login
  // request. The server string reaches here from the `/login/:server` route
  // parameter, so a crafted deep link was enough to send a username and password
  // in cleartext to a host of the link author's choosing — and the Android shell
  // permits cleartext, so the platform would not have blocked it either.
  const bareServer = server.replace(/^https?:\/\//i, '');
  const host = trimTrailingSlash(`https://${bareServer}`);
  const autoDiscoveryUrl = `${host}/.well-known/matrix/client`;

  const [err, response] = await to(request(autoDiscoveryUrl, { method: 'GET' }));

  if (err || response.status === 404) {
    // AutoDiscoveryAction.IGNORE
    // We will use default value for IGNORE action
    return [
      undefined,
      {
        'm.homeserver': {
          base_url: host,
        },
      },
    ];
  }
  if (response.status !== 200) {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_PROMPT,
      },
      undefined,
    ];
  }

  const [contentErr, content] = await to<AutoDiscoveryInfo>(response.json());

  if (contentErr || typeof content !== 'object') {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_PROMPT,
      },
      undefined,
    ];
  }

  const baseUrl = content['m.homeserver']?.base_url;
  if (typeof baseUrl !== 'string') {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_PROMPT,
      },
      undefined,
    ];
  }

  if (/^https?:\/\//.test(baseUrl) === false) {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_ERROR,
      },
      undefined,
    ];
  }

  content['m.homeserver'].base_url = trimTrailingSlash(baseUrl);
  if (content['m.identity_server']) {
    content['m.identity_server'].base_url = trimTrailingSlash(
      content['m.identity_server'].base_url,
    );
  }

  return [undefined, content];
};

export type SpecVersions = {
  versions: string[];
  unstable_features?: Record<string, boolean>;
};
export const specVersions = async (
  request: typeof fetch,
  baseUrl: string,
): Promise<SpecVersions> => {
  const res = await request(`${trimTrailingSlash(baseUrl)}/_matrix/client/versions`);

  const data = (await res.json()) as unknown;

  if (data && typeof data === 'object' && 'versions' in data && Array.isArray(data.versions)) {
    return data as SpecVersions;
  }
  throw new Error('Homeserver URL does not appear to be a valid Matrix homeserver');
};

export type ServerVersion = {
  name: string;
  version?: string;
};
const SERVER_VERSION_TIMEOUT = 5000;

/**
 * Homeserver implementation name and version, from the federation API.
 *
 * Best effort only. Federation is commonly served from a different host or port
 * than the client API, so a 404, a blocked cross-origin request or a network
 * failure is expected and must never surface as an error; the browser may log a
 * CORS warning for it, which is harmless. Runs against a timeout because this
 * shares a `Promise.allSettled` that gates app startup.
 *
 * Resolves to `undefined` whenever the implementation cannot be determined.
 */
export const serverVersion = async (
  request: typeof fetch,
  baseUrl: string,
): Promise<ServerVersion | undefined> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), SERVER_VERSION_TIMEOUT);

  const [err, res] = await to(
    request(`${trimTrailingSlash(baseUrl)}/_matrix/federation/v1/version`, {
      signal: abortController.signal,
    }),
  );

  if (err || !res.ok) {
    clearTimeout(timeoutId);
    return undefined;
  }

  // keep the timeout armed across the body read; aborting rejects it too
  const [parseErr, data] = await to<unknown>(res.json());
  clearTimeout(timeoutId);

  if (parseErr || !data || typeof data !== 'object') return undefined;

  const { server } = data as { server?: unknown };
  if (!server || typeof server !== 'object') return undefined;

  const { name, version } = server as { name?: unknown; version?: unknown };
  if (typeof name !== 'string' || name.length === 0) return undefined;

  return {
    name,
    version: typeof version === 'string' ? version : undefined,
  };
};
