import { useCallback, useEffect, useState } from 'react';
import {
  MicPermissionState,
  MicrophoneRequestResult,
  observeMicrophonePermission,
  readCachedMicrophoneGranted,
  requestMicrophonePermission,
} from '../utils/microphone';

export type MicrophonePermission = {
  state: MicPermissionState;
  /** True while the platform prompt is up. */
  requesting: boolean;
  /** Last failure worth showing, cleared by the next request. */
  error?: string;
  request: () => Promise<MicrophoneRequestResult>;
};

/**
 * The app's microphone permission, as a live value.
 *
 * Starts from the cached hint so a returning user is not offered a permission
 * they already granted, then defers to the platform as soon as it answers.
 * Where the platform will not answer (`unknown`) the hint is all there is, and
 * the caller should treat "unknown" as "worth asking" rather than as "denied".
 */
export function useMicrophonePermission(): MicrophonePermission {
  const [state, setState] = useState<MicPermissionState>(() =>
    readCachedMicrophoneGranted() ? 'granted' : 'unknown',
  );
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => observeMicrophonePermission(setState), []);

  const request = useCallback(async () => {
    setRequesting(true);
    setError(undefined);
    try {
      const result = await requestMicrophonePermission();
      // `unknown` here means the failure was not about permission (no device,
      // device busy). Keeping the previous state avoids relabelling a working
      // grant as unknown because the mic happened to be in use.
      if (result.state !== 'unknown') setState(result.state);
      if (result.error) setError(result.error);
      return result;
    } finally {
      setRequesting(false);
    }
  }, []);

  return { state, requesting, error, request };
}
