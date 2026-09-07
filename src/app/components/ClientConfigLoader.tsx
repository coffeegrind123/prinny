import { ReactNode, useCallback, useEffect, useState } from 'react';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { ClientConfig } from '../hooks/useClientConfig';
import { trimTrailingSlash } from '../utils/common';

/**
 * Fetch `config.json`, and say specifically what went wrong when it is not
 * there or not JSON.
 *
 * `resp.json()` alone reports both failures as a `SyntaxError` about an
 * unexpected token, which names neither the file nor the cause — and both
 * failures are things a self-hoster hits while setting the app up, where the
 * error message is the only diagnostic they have:
 *
 *  - **A 404.** `dist/config.json` is deliberately untracked on the
 *    `webapp-release` branch so an operator's config can never conflict with a
 *    `git pull`, which means a fresh checkout does not have one; the shipped
 *    `nginx.conf` covers that with `try_files $uri /config.sample.json`, so a
 *    404 here means a server that is not doing the fallback.
 *  - **A 200 that is HTML.** The far more confusing one: a server whose SPA
 *    catch-all also swallows `/config.json` answers with `index.html`, which
 *    is a perfectly successful response containing the wrong thing.
 *
 * So the status is checked, and a body that does not parse is reported with
 * the first of what actually arrived rather than only with the parser's
 * complaint about it.
 */
const CONFIG_HINT =
  'Serve config.json from the app root — on the webapp-release branch, copy dist/config.sample.json to dist/config.json (or let nginx fall back to it).';

const getClientConfig = async (): Promise<ClientConfig> => {
  const url = `${trimTrailingSlash(import.meta.env.BASE_URL)}/config.json`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) {
    throw new Error(`GET ${url} → HTTP ${resp.status}. ${CONFIG_HINT}`);
  }
  const body = await resp.text();
  try {
    return JSON.parse(body) as ClientConfig;
  } catch {
    const head = body.slice(0, 80).replace(/\s+/g, ' ').trim();
    throw new Error(
      `GET ${url} → HTTP ${resp.status} but the body is not JSON: "${head}". ${CONFIG_HINT}`,
    );
  }
};

type ClientConfigLoaderProps = {
  fallback?: () => ReactNode;
  error?: (err: unknown, retry: () => void, ignore: () => void) => ReactNode;
  children: (config: ClientConfig) => ReactNode;
};
export function ClientConfigLoader({ fallback, error, children }: ClientConfigLoaderProps) {
  const [state, load] = useAsyncCallback(getClientConfig);
  const [ignoreError, setIgnoreError] = useState(false);

  const ignoreCallback = useCallback(() => setIgnoreError(true), []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === AsyncStatus.Idle || state.status === AsyncStatus.Loading) {
    return fallback?.();
  }

  if (!ignoreError && state.status === AsyncStatus.Error) {
    return error?.(state.error, load, ignoreCallback);
  }

  const config: ClientConfig = state.status === AsyncStatus.Success ? state.data : {};

  return children(config);
}
