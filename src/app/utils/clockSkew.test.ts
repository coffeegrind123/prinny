import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, MatrixClient, MatrixEvent, RoomEvent, SyncState } from 'matrix-js-sdk';
import { clockSkewMessage, trackClockSkew, verificationClockWarning } from './clockSkew';

const NOW = Date.UTC(2026, 10, 10, 7, 30, 0);
const DOMAIN = 'localhost';

/** A server event, as the SDK builds it: `localTimestamp = Date.now() - unsigned.age`. */
const serverEvent = (originServerTs: number, age: number, sender = `@bob:${DOMAIN}`) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: `$${originServerTs}-${age}-${sender}`,
    room_id: '!room:localhost',
    sender,
    origin_server_ts: originServerTs,
    content: { msgtype: 'm.text', body: 'hi' },
    unsigned: { age },
  });

type FakeClient = MatrixClient & {
  setSyncState: (state: SyncState) => void;
  deliver: (event: MatrixEvent, data?: { liveEvent?: boolean }, toStart?: boolean) => void;
};

/** Just enough of a MatrixClient for the skew check: rooms, sync state and timeline events. */
const fakeClient = (roomEvents: MatrixEvent[] = []): FakeClient => {
  const emitter = new EventEmitter();
  let syncState: SyncState | null = null;
  const room = { getLiveTimeline: () => ({ getEvents: () => roomEvents }) };
  const client = Object.assign(emitter, {
    getDomain: () => DOMAIN,
    getHomeserverUrl: () => '',
    getRooms: () => [room],
    getSyncState: () => syncState,
    setSyncState: (state: SyncState) => {
      const old = syncState;
      syncState = state;
      emitter.emit(ClientEvent.Sync, state, old);
    },
    deliver: (event: MatrixEvent, data = { liveEvent: true }, toStart = false) => {
      emitter.emit(RoomEvent.Timeline, event, room, toStart, false, data);
    },
  });
  return client as unknown as FakeClient;
};

describe('verificationClockWarning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not read the age of events the initial sync or the sync cache delivered as skew', async () => {
    // Measured on Conduit: every event carries `unsigned.age: 1`, however old it is. Events the
    // sync cache restores carry the age frozen when the cache was saved. Either way the clocks
    // agree, and these events are just 14 minutes old.
    const mx = fakeClient([serverEvent(NOW - 14 * 60_000, 1), serverEvent(NOW - 14 * 60_000, 1)]);
    trackClockSkew(mx);
    mx.setSyncState(SyncState.Prepared);

    expect(await verificationClockWarning(mx)).toBeUndefined();
  });

  it('warns when events that arrive live show this clock ahead of the server', async () => {
    const mx = fakeClient();
    trackClockSkew(mx);
    mx.setSyncState(SyncState.Prepared);
    mx.setSyncState(SyncState.Syncing);

    // The server stamped and aged these 10 minutes earlier than our clock says.
    mx.deliver(serverEvent(NOW - 10 * 60_000, 50));
    mx.deliver(serverEvent(NOW - 10 * 60_000, 120));

    expect(await verificationClockWarning(mx)).toMatch(/about 10 minutes ahead/);
  });

  it('warns when this clock is behind the server', async () => {
    const mx = fakeClient();
    trackClockSkew(mx);
    mx.setSyncState(SyncState.Prepared);
    mx.deliver(serverEvent(NOW + 12 * 60_000, 30));

    expect(await verificationClockWarning(mx)).toMatch(/about 12 minutes behind/);
  });

  it('trusts the smallest sample, since latency and a stale age only push a sample up', async () => {
    const mx = fakeClient();
    trackClockSkew(mx);
    mx.setSyncState(SyncState.Prepared);
    mx.deliver(serverEvent(NOW - 9 * 60_000, 1)); // a catch-up event with a bogus age
    mx.deliver(serverEvent(NOW - 2_000, 1)); // a fresh one

    expect(await verificationClockWarning(mx)).toBeUndefined();
  });

  it('ignores the initial sync, catch-up syncs, the cache, back-pagination and other servers', async () => {
    const mx = fakeClient();
    trackClockSkew(mx);
    const stale = NOW - 20 * 60_000;

    mx.deliver(serverEvent(stale, 1)); // initial sync: before the first Prepared
    mx.setSyncState(SyncState.Prepared);
    mx.deliver(serverEvent(stale, 1), { liveEvent: false }); // restored from the cache
    mx.deliver(serverEvent(stale, 1), { liveEvent: true }, true); // back-paginated
    mx.deliver(serverEvent(stale, 1, '@carol:elsewhere.org')); // another server's clock
    mx.setSyncState(SyncState.Catchup);
    mx.deliver(serverEvent(stale, 1)); // catching up after a dropped connection

    expect(await verificationClockWarning(mx)).toBeUndefined();
  });

  it('stops sampling once untracked', async () => {
    const mx = fakeClient();
    const untrack = trackClockSkew(mx);
    mx.setSyncState(SyncState.Prepared);
    untrack();
    mx.deliver(serverEvent(NOW - 10 * 60_000, 1));

    expect(await verificationClockWarning(mx)).toBeUndefined();
  });
});

describe('clockSkewMessage', () => {
  it('stays quiet inside the window the receiving device accepts', () => {
    expect(clockSkewMessage(0)).toBeUndefined();
    expect(clockSkewMessage(4 * 60)).toBeUndefined();
    expect(clockSkewMessage(-9 * 60)).toBeUndefined();
  });
});
