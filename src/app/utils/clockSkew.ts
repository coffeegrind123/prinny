import { MatrixClient, MatrixEvent } from 'matrix-js-sdk';

// The receiving device ignores a verification request whose timestamp is more than 5 minutes
// ahead of, or 10 minutes behind, its own clock (matrix-rust-sdk, per the spec's
// m.key.verification.request rules). The homeserver's clock stands in for the other device's.
const MAX_FUTURE_SECONDS = 5 * 60;
const MAX_PAST_SECONDS = 10 * 60;
const MARGIN_SECONDS = 30;

const SAMPLE_EVENTS = 20;
const EVENTS_PER_ROOM = 5;

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

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// For an event created on our own homeserver, origin_server_ts and the base of `unsigned.age`
// are the same server-clock instant, and the SDK records `localTimestamp = Date.now() - age`
// (kept across reloads by the sync accumulator). Their difference is this device's skew.
// Events from other servers carry the remote server's origin_server_ts, so they are skipped.
const skewFromEvents = (mx: MatrixClient): number | undefined => {
  const domain = mx.getDomain();
  if (!domain) return undefined;
  const suffix = `:${domain}`;

  const candidates: MatrixEvent[] = [];
  mx.getRooms().forEach((room) => {
    const events = room.getLiveTimeline().getEvents();
    let taken = 0;
    for (let i = events.length - 1; i >= 0 && taken < EVENTS_PER_ROOM; i -= 1) {
      const event = events[i];
      if (
        !event.status &&
        event.getAge() !== undefined &&
        event.getTs() > 0 &&
        event.getSender()?.endsWith(suffix)
      ) {
        candidates.push(event);
        taken += 1;
      }
    }
  });
  if (candidates.length === 0) return undefined;

  const newest = candidates.sort((a, b) => b.getTs() - a.getTs()).slice(0, SAMPLE_EVENTS);
  return Math.round(median(newest.map((event) => event.localTimestamp - event.getTs())) / 1000);
};

export const verificationClockWarning = async (mx: MatrixClient): Promise<string | undefined> => {
  const baseUrl = mx.getHomeserverUrl();
  const skew = (baseUrl ? await skewFromDateHeader(baseUrl) : undefined) ?? skewFromEvents(mx);
  if (skew === undefined) return undefined;
  return clockSkewMessage(skew);
};
