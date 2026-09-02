import { createContext, useContext } from 'react';
import { ServerVersion } from '../cs-api';

/**
 * Known homeserver implementations.
 *
 * The Matrix spec fixes the wire format of most APIs but leaves the behaviour
 * behind them to each implementation, so features whose quality depends on the
 * server (search ranking, pagination, indexing) can gate on this. Prefer a real
 * capability check where the spec offers one; use this only when it does not.
 */
export enum ServerSoftware {
  Synapse = 'synapse',
  Dendrite = 'dendrite',
  Conduit = 'conduit',
  Conduwuit = 'conduwuit',
  Continuwuity = 'continuwuity',
  Tuwunel = 'tuwunel',
  Unknown = 'unknown',
}

export type ServerSoftwareInfo = {
  software: ServerSoftware;
  /** raw name as reported; absent when the probe could not run */
  name?: string;
  version?: string;
};

export const UNKNOWN_SERVER_SOFTWARE: ServerSoftwareInfo = {
  software: ServerSoftware.Unknown,
};

// no current name is a substring of another, so order is not load-bearing today;
// longer fork names are listed first to keep it safe if one ever is
const SOFTWARE_MATCHERS: ReadonlyArray<readonly [ServerSoftware, RegExp]> = [
  [ServerSoftware.Synapse, /synapse/],
  [ServerSoftware.Dendrite, /dendrite/],
  [ServerSoftware.Continuwuity, /continuwuity/],
  [ServerSoftware.Conduwuit, /conduwuit/],
  [ServerSoftware.Tuwunel, /tuwunel/],
  [ServerSoftware.Conduit, /conduit/],
];

export const identifyServerSoftware = (
  serverVersion: ServerVersion | undefined,
): ServerSoftwareInfo => {
  if (!serverVersion) return UNKNOWN_SERVER_SOFTWARE;

  const name = serverVersion.name.toLowerCase();
  const matched = SOFTWARE_MATCHERS.find(([, pattern]) => pattern.test(name));

  return {
    software: matched ? matched[0] : ServerSoftware.Unknown,
    name: serverVersion.name,
    version: serverVersion.version,
  };
};

const ServerSoftwareContext = createContext<ServerSoftwareInfo | null>(null);

export const ServerSoftwareProvider = ServerSoftwareContext.Provider;

export function useServerSoftware(): ServerSoftwareInfo {
  const info = useContext(ServerSoftwareContext);
  if (!info) throw new Error('Server software info is not provided!');
  return info;
}
