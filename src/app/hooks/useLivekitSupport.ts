import { useEffect, useState } from 'react';
import { AutoDiscoveryInfo } from '../cs-api';
import { useAutoDiscoveryInfo } from './useAutoDiscoveryInfo';
import { useMatrixClient } from './useMatrixClient';

type TransportLike = { type: string; livekit_service_url?: unknown };

const isLivekit = (transport: TransportLike): boolean =>
  transport.type === 'livekit' && typeof transport.livekit_service_url === 'string';

/**
 * Whether the homeserver advertises a LiveKit focus, from either place the
 * call driver (`CallWidgetDriver.getRtcTransports`) looks: the MSC4143
 * `/rtc/transports` endpoint, or `org.matrix.msc4143.rtc_foci` in the client
 * `.well-known`. Checking only the latter greyed out the call buttons on
 * servers that advertise through the endpoint alone (Synapse's `matrix_rtc`
 * config), where calls would have connected.
 */
export const livekitSupport = (
  autoDiscoveryInfo: AutoDiscoveryInfo,
  rtcTransports?: readonly TransportLike[],
): boolean => {
  if (rtcTransports?.some(isLivekit)) return true;

  const rtcFoci = autoDiscoveryInfo['org.matrix.msc4143.rtc_foci'];
  return (
    Array.isArray(rtcFoci) && rtcFoci.some((info) => typeof info.livekit_service_url === 'string')
  );
};

/** The homeserver's MSC4143 transports, as the client has cached them. */
export const useRtcTransports = (): readonly TransportLike[] | undefined => {
  const mx = useMatrixClient();
  const [transports, setTransports] = useState(() => mx.cachedRtcTransports.get());

  useEffect(() => {
    let cancelled = false;
    mx.cachedRtcTransports
      .wait()
      .then((value) => {
        if (!cancelled) setTransports(value);
      })
      // No endpoint, or not logged in yet: the .well-known decides.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mx]);

  return transports;
};

export const useLivekitSupport = (): boolean => {
  const autoDiscoveryInfo = useAutoDiscoveryInfo();
  const rtcTransports = useRtcTransports();

  return livekitSupport(autoDiscoveryInfo, rtcTransports);
};
