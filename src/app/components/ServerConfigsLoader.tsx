import { ReactNode, useCallback, useMemo } from 'react';
import { Capabilities, isValidAuthMetadata, ValidatedAuthMetadata } from 'matrix-js-sdk';
import { AsyncStatus, useAsyncCallbackValue } from '../hooks/useAsyncCallback';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { MediaConfig } from '../hooks/useMediaConfig';
import { promiseFulfilledResult } from '../utils/common';
import { isWebUrl } from '../utils/safeUrl';
import { serverVersion } from '../cs-api';
import {
  identifyServerSoftware,
  ServerSoftwareInfo,
  UNKNOWN_SERVER_SOFTWARE,
} from '../hooks/useServerSoftware';

export type ServerConfigs = {
  capabilities?: Capabilities;
  mediaConfig?: MediaConfig;
  authMetadata?: ValidatedAuthMetadata;
  serverSoftware: ServerSoftwareInfo;
};

type ServerConfigsLoaderProps = {
  children: (configs: ServerConfigs) => ReactNode;
};
export function ServerConfigsLoader({ children }: ServerConfigsLoaderProps) {
  const mx = useMatrixClient();
  const fallbackConfigs = useMemo<ServerConfigs>(
    () => ({ serverSoftware: UNKNOWN_SERVER_SOFTWARE }),
    [],
  );

  const [configsState] = useAsyncCallbackValue<ServerConfigs, unknown>(
    useCallback(async () => {
      const result = await Promise.allSettled([
        mx.getCapabilities(),
        mx.getMediaConfig(),
        mx.getAuthMetadata(),
        serverVersion(fetch, mx.getHomeserverUrl()),
      ]);

      const capabilities = promiseFulfilledResult(result[0]);
      const mediaConfig = promiseFulfilledResult(result[1]);
      const authMetadata = promiseFulfilledResult(result[2]);
      const serverSoftware = identifyServerSoftware(promiseFulfilledResult(result[3]));
      let validatedAuthMetadata: ValidatedAuthMetadata | undefined;

      // A homeserver without MSC2965 simply 404s both discovery endpoints, so
      // `getAuthMetadata()` rejects and `authMetadata` is undefined. That is the
      // expected answer for most homeservers, not a fault, and logging it as an
      // error on every load made a normal startup look broken. Only a server
      // that DID return a document worth validating gets past here.
      try {
        // Nothing to validate, and nothing to report: the server said no.
        // `serverSoftware` still travels — it is probed independently of OIDC,
        // and most homeservers take this branch.
        if (authMetadata === undefined) return { capabilities, mediaConfig, serverSoftware };

        // matrix-js-sdk 42 replaced the throwing `validateAuthMetadata` with
        // `isValidAuthMetadata`, a type guard. An unusable document is now a
        // `false` return rather than an exception, so the "server answered but
        // the document does not validate" case is handled here rather than by
        // the catch below.
        if (!isValidAuthMetadata(authMetadata)) {
          console.warn('Ignoring unusable auth metadata: failed validation');
          return { capabilities, mediaConfig, serverSoftware };
        }
        validatedAuthMetadata = authMetadata;

        // `isValidAuthMetadata` checks the OIDC document's shape, not the
        // scheme of the URLs inside it. `account_management_uri` and `issuer`
        // are chosen by the homeserver and are later handed to `window.open()`
        // by the device-management and cross-signing screens; in the Tauri shell
        // that reaches the OS URL opener, so a non-web scheme would invoke a
        // local protocol handler. Drop anything that is not an absolute http(s)
        // URL here, once, rather than at each of the three call sites.
        if (validatedAuthMetadata) {
          if (!isWebUrl(validatedAuthMetadata.account_management_uri)) {
            validatedAuthMetadata = {
              ...validatedAuthMetadata,
              account_management_uri: undefined,
            };
          }
          if (!isWebUrl(validatedAuthMetadata.issuer)) {
            console.error('Discarding auth metadata: issuer is not an http(s) URL');
            validatedAuthMetadata = undefined;
          }
        }
      } catch (e) {
        // Reached only when the server DID return a document and it does not
        // validate. Worth saying, but it only costs the OIDC-backed screens.
        console.warn('Ignoring unusable auth metadata:', e);
      }

      return {
        capabilities,
        mediaConfig,
        authMetadata: validatedAuthMetadata,
        serverSoftware,
      };
    }, [mx]),
  );

  const configs: ServerConfigs =
    configsState.status === AsyncStatus.Success ? configsState.data : fallbackConfigs;

  return children(configs);
}
