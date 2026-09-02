import { MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useCallback, useSyncExternalStore } from 'react';
import { subscribeToStateEvents } from './useStateEventCallback';
import { getStateEvents } from '../utils/room';
import { MessageEvent, StateEvent } from '../../types/matrix/room';
import { sanitizeBotInfo, type BotInfo } from '../../types/matrix/bot';

/** Bots that have advertised themselves in a room, keyed by MXID. */
export type RoomBots = Map<string, BotInfo>;

/**
 * How far back to look for a timeline-form advertisement.
 *
 * Bounded on purpose. A bot with power to set state does not need this path at
 * all, and one without it is expected to re-advertise on join — so scanning
 * the entire loaded timeline would cost more than it could ever find.
 */
const TIMELINE_SCAN_DEPTH = 200;

const collectBots = (room: Room): RoomBots => {
  const bots: RoomBots = new Map();

  // The state event is authoritative. A bot may only advertise under its own
  // MXID, so an event whose state key is somebody else is either a mistake or
  // an attempt to put words in another user's mouth; either way, ignore it.
  getStateEvents(room, StateEvent.BotInfo).forEach((event) => {
    const sender = event.getSender();
    const stateKey = event.getStateKey();
    if (!sender || stateKey !== sender) return;
    const info = sanitizeBotInfo(event.getContent());
    if (info) bots.set(sender, info);
  });

  // Timeline fallback, for bots without power level 50. Newest wins, and a
  // state event always beats it.
  const timeline = room.getLiveTimeline().getEvents();
  const start = Math.max(0, timeline.length - TIMELINE_SCAN_DEPTH);
  for (let i = timeline.length - 1; i >= start; i -= 1) {
    const event = timeline[i];
    if (!event || event.getType() !== MessageEvent.BotInfo) continue;
    const sender = event.getSender();
    if (!sender || bots.has(sender)) continue;
    const info = sanitizeBotInfo(event.getContent());
    if (info) bots.set(sender, info);
  }

  return bots;
};

/**
 * Whether a recompute actually changed anything.
 *
 * `useSyncExternalStore` compares snapshots by identity, and `collectBots`
 * builds a fresh Map of freshly sanitized objects every time, so without this
 * every timeline event would re-render every badge on screen. The values are
 * sanitized JSON with a fixed key order, so serializing them is a sound
 * comparison and not a shortcut.
 */
const sameBots = (a: RoomBots, b: RoomBots): boolean => {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [userId, info] of a) {
    const other = b.get(userId);
    if (!other) return false;
    if (JSON.stringify(info) !== JSON.stringify(other)) return false;
  }
  return true;
};

type BotsStore = {
  snapshot: RoomBots;
  subscribers: Set<() => void>;
  detach?: () => void;
};

/**
 * ONE subscription and ONE `collectBots` per room, shared by every caller.
 *
 * `BotBadge` calls `useIsBot`, and a badge renders in the header of every
 * group-leading message, so there is a caller per message on screen.
 * Subscribing per component put a `Room.timeline` listener on the emitter for
 * each of them and tripped matrix-js-sdk's own `MaxListenersExceededWarning:
 * 51 Room.timeline listeners added` — and, worse, ran `collectBots` (a room
 * state read plus a 200-event timeline scan) once per badge for a single
 * incoming event. Which bots have advertised in a room does not depend on
 * which message asks, so it is computed once and handed to all of them.
 *
 * Same shape as `useElementReadReceipts`, which was fixed for the same reason.
 */
const storeByRoom = new WeakMap<Room, BotsStore>();

const getStore = (room: Room): BotsStore => {
  const existing = storeByRoom.get(room);
  if (existing) return existing;

  const store: BotsStore = {
    snapshot: collectBots(room),
    subscribers: new Set(),
  };
  storeByRoom.set(room, store);
  return store;
};

const refresh = (room: Room, store: BotsStore): void => {
  const next = collectBots(room);
  if (sameBots(store.snapshot, next)) return;
  store.snapshot = next;
  store.subscribers.forEach((notify) => notify());
};

const subscribeToBots = (room: Room, onChange: () => void): (() => void) => {
  const store = getStore(room);
  store.subscribers.add(onChange);

  if (!store.detach) {
    // Bound to the Room rather than the client, so the handler only runs for
    // this room's timeline and no roomId guard is needed.
    const handleTimeline = (event: MatrixEvent) => {
      if (event.getType() !== MessageEvent.BotInfo) return;
      refresh(room, store);
    };
    const handleStateEvent = (event: MatrixEvent) => {
      if (event.getRoomId() !== room.roomId) return;
      if (event.getType() !== StateEvent.BotInfo) return;
      refresh(room, store);
    };

    room.on(RoomEvent.Timeline, handleTimeline);
    const detachStateEvents = subscribeToStateEvents(room.client, handleStateEvent);
    store.detach = () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
      detachStateEvents();
    };

    // Anything that landed between the snapshot getStore took and the listeners
    // going on is invisible otherwise.
    refresh(room, store);
  }

  return () => {
    store.subscribers.delete(onChange);
    if (store.subscribers.size > 0) return;
    store.detach?.();
    store.detach = undefined;
    storeByRoom.delete(room);
  };
};

/**
 * Every bot advertising itself in this room.
 *
 * This is the client half of Telegram's `setMyCommands`: Matrix has no
 * server-side command registry, so a bot's commands only exist where the bot
 * has written them, and this is where the client reads them back.
 */
export const useRoomBots = (room: Room): RoomBots => {
  const subscribe = useCallback((onChange: () => void) => subscribeToBots(room, onChange), [room]);
  const getSnapshot = useCallback(() => getStore(room).snapshot, [room]);

  return useSyncExternalStore(subscribe, getSnapshot);
};

/** The advertisement for one user in a room, if they published one. */
export const useBotInfo = (room: Room, userId: string): BotInfo | undefined => {
  const bots = useRoomBots(room);
  return bots.get(userId);
};

/**
 * Whether a user should carry a BOT badge in this room.
 *
 * Two independent signals, either of which is enough: a published
 * advertisement, or a `m.room.member` flag the user set on themselves. Both
 * are self-asserted — this is a hint about how an account behaves, not a
 * verified identity claim, and it should never be presented as one.
 */
export const useIsBot = (room: Room, userId: string): boolean => {
  const bots = useRoomBots(room);
  if (bots.has(userId)) return true;
  const member = room.getMember(userId);
  return member?.events?.member?.getContent()['app.prinny.bot'] === true;
};
