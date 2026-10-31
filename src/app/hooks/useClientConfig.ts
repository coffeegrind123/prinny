import { createContext, useContext } from 'react';
import type { GifApiKeys } from '../utils/klipy';

export type HashRouterConfig = {
  enabled?: boolean;
  basename?: string;
};

export type ClientConfig = {
  defaultHomeserver?: number;
  homeserverList?: string[];
  allowCustomHomeservers?: boolean;

  featuredCommunities?: {
    openAsDefault?: boolean;
    spaces?: string[];
    rooms?: string[];
    servers?: string[];
  };

  // Combined public homeserver directory, merged daily from asra.gr,
  // joinmatrix.org and privacydev.net. Backs the homeserver autocomplete on
  // the login/register screen and the server browser in Explore.
  //
  // Must be a URL that sends `Access-Control-Allow-Origin` — the three
  // upstream lists do not, which is exactly why this indirection exists.
  // Unset uses the default hosted at https://prinny.app/api/servers.json.
  publicServersUrl?: string;

  hashRouter?: HashRouterConfig;

  // Web Push (background notifications when the tab is closed). Both
  // fields are required for registration — leaving either unset disables
  // background push and falls back to foreground-only notifications.
  // pushGateway:        Sygnal-compatible push gateway URL
  //                     (e.g. https://sygnal.example.org/_matrix/push/v1/notify)
  // pushVapidPublicKey: base64url-encoded VAPID public key matching the
  //                     private key configured on the gateway
  pushGateway?: string;
  pushVapidPublicKey?: string;

  // MapLibre style URL used to draw location messages and pick a location to
  // send. Consulted only when the homeserver publishes no `m.tile_server` in
  // its well-known, which most do not.
  //
  // Whoever serves this URL sees an IP and a viewport for every map drawn, so
  // maps stay off until the user turns them on even when this is set.
  mapStyleUrl?: string;

  // API keys for the optional GIF providers (Settings → General → GIF
  // Provider). Klipy ships with a key; Tenor and Giphy are offered only when
  // a key is set here or at build time (VITE_TENOR_API_KEY / VITE_GIPHY_API_KEY).
  gifApiKeys?: GifApiKeys;
};

const ClientConfigContext = createContext<ClientConfig | null>(null);

export const ClientConfigProvider = ClientConfigContext.Provider;

export function useClientConfig(): ClientConfig {
  const config = useContext(ClientConfigContext);
  if (!config) throw new Error('Client config are not provided!');
  return config;
}

export const clientDefaultServer = (clientConfig: ClientConfig): string =>
  clientConfig.homeserverList?.[clientConfig.defaultHomeserver ?? 0] ?? 'matrix.org';

export const clientAllowedServer = (clientConfig: ClientConfig, server: string): boolean => {
  const { homeserverList, allowCustomHomeservers } = clientConfig;

  if (allowCustomHomeservers) return true;

  return homeserverList?.includes(server) === true;
};
