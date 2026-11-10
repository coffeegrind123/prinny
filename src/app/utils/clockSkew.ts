import {
  ClientEvent,
  IRoomTimelineData,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';

// The receiving device ignores a verification request whose timestamp is more than 5 minutes
// ahead of, or 10 minutes behind, its own clock (matrix-rust-sdk, per the spec's
// m.key.verification.request rules). The homeserver's clock stands in for the other device's.
const MAX_FUTURE_SECONDS = 5 * 60;
const MAX_PAST_SECONDS = 10 * 60;
const MARGIN_SECONDS = 30;

const MAX_SAMPLES = 50;

/** Positive when this device's clock is ahead of the server's. */
export const clockSkewMessage = (skewSeconds: number): string | undefined => {
  const minutes = Math.max(1, Math.round(Math.abs(skewSeconds) / 60));
  if (skewSeconds > MAX_FUTURE_SECONDS - MARGIN_SECONDS) {
    return `This device's clock is about ${minutes} minutes ahead of the server. The other device would ignore the verification request. Fix the clock, then try again.`;
  }
  if (-skewSeconds > MAX_PAST_SECONDS - MARGIN_SECONDS) {
    return `This device's clock is about ${minutes} minutes behind the server. The other device would ignore the verification request. Fix the clock, then try again.`;
  }
  return undefined;
};

// Only readable same-origin or when the server lists Date in Access-Control-Expose-Headers;
// Synapse exposes only Synapse-Trace-Id and Server, so cross-origin this usually yields nothing.
const skewFromDateHeader = async (baseUrl: string): Promise<number | undefined> => {
  try {
    const sentAt = Date.now();
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/_matrix/client/versions`, {
      method: 'GET',
      cache: 'no-store',
    });
    const receivedAt = Date.now();
    const date = response.headers.get('date');
    if (!date) return undefined;
    const serverTime = Date.parse(date);
    if (Number.isNaN(serverTime)) return undefined;
    return Math.round(((sentAt + receivedAt) / 2 - serverTime) / 1000);
  } catch {
    return undefined;
  }
};

/**
 * Skew samples, in milliseconds, from events that reached this client live.
 *
 * For an event created on our own homeserver, `origin_server_ts` and the base of `unsigned.age`
 * are the same server-clock instant, and the SDK records `localTimestamp = Date.now() - age`, so
 * `localTimestamp - origin_server_ts` is this device's skew plus the delivery latency. That only
 * holds for an event whose age the server computed just now, which rules out two sources that
 * used to make "Verify with Device" refuse with "clock is about N minutes ahead" while the clocks
 * agreed to the second:
 *
 * - Events restored from the sync cache keep the age they had when the cache was saved, so the
 *   sample is the cache's age. Measured after a reload: 200-648 s "ahead", every age `92365`.
 * - Conduit sends `unsigned.age: 1` on every event however old it is, so the initial sync's
 *   events read as their real age. Measured on a fresh login: 14 minutes "ahead".
 *
 * So only live events from syncs after the first `Prepared` are sampled, and not catch-up syncs,
 * which deliver old events in bulk.
 */
const samplesByClient = new WeakMap<MatrixClient, number[]>();

const sampleFromEvent = (event: MatrixEvent, domainSuffix: string): number | undefined => {
  if (event.status || event.getAge() === undefined || event.getTs() <= 0) return undefined;
  // Another server stamps its own events, with its own clock.
  if (!event.getSender()?.endsWith(domainSuffix)) return undefined;
  return event.localTimestamp - event.getTs();
};

/** Start collecting skew samples. Call before `startClient`; returns the unsubscribe. */
export const trackClockSkew = (mx: MatrixClient): (() => void) => {
  const samples: number[] = [];
  samplesByClient.set(mx, samples);
  let prepared = false;

  const onSync = (state: SyncState) => {
    if (state === SyncState.Prepared) prepared = true;
  };

  const onTimeline = (
    event: MatrixEvent,
    _room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    removed: boolean,
    data: IRoomTimelineData,
  ) => {
    if (!prepared || toStartOfTimeline || removed || !data?.liveEvent) return;
    const state = mx.getSyncState();
    if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;

    const domain = mx.getDomain();
    if (!domain) return;
    const sample = sampleFromEvent(event, `:${domain}`);
    if (sample === undefined) return;

    samples.push(sample);
    if (samples.length > MAX_SAMPLES) samples.shift();
  };

  mx.on(ClientEvent.Sync, onSync);
  mx.on(RoomEvent.Timeline, onTimeline);
  return () => {
    mx.removeListener(ClientEvent.Sync, onSync);
    mx.removeListener(RoomEvent.Timeline, onTimeline);
    samplesByClient.delete(mx);
  };
};

// Latency, a stale age and an under-reported age all make a sample larger than the real skew,
// never smaller, so the smallest sample is the closest to it. With no samples there is no
// measurement, and no warning: a wrong one blocks verification outright.
const skewFromEvents = (mx: MatrixClient): number | undefined => {
  const samples = samplesByClient.get(mx);
  if (!samples || samples.length === 0) return undefined;
  return Math.round(Math.min(...samples) / 1000);
};

export const verificationClockWarning = async (mx: MatrixClient): Promise<string | undefined> => {
  const baseUrl = mx.getHomeserverUrl();
  const skew = (baseUrl ? await skewFromDateHeader(baseUrl) : undefined) ?? skewFromEvents(mx);
  if (skew === undefined) return undefined;
  return clockSkewMessage(skew);
};
