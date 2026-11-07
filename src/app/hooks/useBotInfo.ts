import { EventTimeline, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useCallback, useSyncExternalStore } from 'react';
import { subscribeToStateEvents } from './useStateEventCallback';
import { getStateEvents } from '../utils/room';
import { MessageEvent, StateEvent } from '../../types/matrix/room';
import { Msc4391, sanitizeBotInfo, type BotInfo } from '../../types/matrix/bot';
import { hasBotMemberFlag, withoutDepartedBots } from '../utils/botPresence';
import { collectDescriptions, type BotDescriptions } from '../utils/botInvocation';

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

/**
 * MSC4391 command descriptions in the room's state, per sender. Read straight
 * from state with `getStateEvents`' raw type, since the enum is ours.
 */
const collectRoomDescriptions = (room: Room): BotDescriptions =>
  collectDescriptions(
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(Msc4391.CommandDescription) ?? [],
  );

/** Same comparison as `sameBots`, for sanitized descriptions. */
const sameDescriptions = (a: BotDescriptions, b: BotDescriptions): boolean => {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [userId, list] of a) {
    const other = b.get(userId);
    if (!other || JSON.stringify(list) !== JSON.stringify(other)) return false;
  }
  return true;
};

type BotsStore = {
  /** Every bot that advertised, joined or not: badges on their old messages. */
  snapshot: RoomBots;
  /** Only those still joined: what the `/` menu and bot menu may offer. */
  joined: RoomBots;
  /** MSC4391 descriptions, per sender, joined or not. */
  descriptions: BotDescriptions;
  /** MSC4391 descriptions of senders still joined (the proposal hides the rest). */
  joinedDescriptions: BotDescriptions;
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

const joinedBots = <T>(room: Room, bots: Map<string, T>): Map<string, T> =>
  withoutDepartedBots(bots, (userId) => room.getMember(userId)?.membership);

const getStore = (room: Room): BotsStore => {
  const existing = storeByRoom.get(room);
  if (existing) return existing;

  const snapshot = collectBots(room);
  const descriptions = collectRoomDescriptions(room);
  const store: BotsStore = {
    snapshot,
    joined: joinedBots(room, snapshot),
    descriptions,
    joinedDescriptions: joinedBots(room, descriptions),
    subscribers: new Set(),
  };
  storeByRoom.set(room, store);
  return store;
};

const refresh = (room: Room, store: BotsStore): void => {
  const next = collectBots(room);
  const nextJoined = joinedBots(room, next);
  const nextDescriptions = collectRoomDescriptions(room);
  const nextJoinedDescriptions = joinedBots(room, nextDescriptions);
  const sameAll = sameBots(store.snapshot, next);
  const sameJoined = sameBots(store.joined, nextJoined);
  const sameAllDescriptions = sameDescriptions(store.descriptions, nextDescriptions);
  const sameJoinedDescriptions = sameDescriptions(store.joinedDescriptions, nextJoinedDescriptions);
  if (sameAll && sameJoined && sameAllDescriptions && sameJoinedDescriptions) return;
  if (!sameAll) store.snapshot = next;
  if (!sameJoined) store.joined = nextJoined;
  if (!sameAllDescriptions) store.descriptions = nextDescriptions;
  if (!sameJoinedDescriptions) store.joinedDescriptions = nextJoinedDescriptions;
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
      const type = event.getType();
      if (type === StateEvent.BotInfo || type === Msc4391.CommandDescription) {
        refresh(room, store);
        return;
      }
      // A bot leaving or rejoining changes the joined list. Other members'
      // churn cannot, and is far more common, so it never triggers a rescan.
      const stateKey = event.getStateKey();
      if (
        type === StateEvent.RoomMember &&
        stateKey &&
        (store.snapshot.has(stateKey) || store.descriptions.has(stateKey))
      ) {
        refresh(room, store);
      }
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

/**
 * Bots advertising in this room that are still joined. Use this for anything
 * that offers a bot's commands: one that left will not answer them.
 */
export const useJoinedRoomBots = (room: Room): RoomBots => {
  const subscribe = useCallback((onChange: () => void) => subscribeToBots(room, onChange), [room]);
  const getSnapshot = useCallback(() => getStore(room).joined, [room]);

  return useSyncExternalStore(subscribe, getSnapshot);
};

/**
 * MSC4391 command descriptions of senders still joined. Commands from a
 * sender that left are hidden, as the proposal requires.
 */
export const useJoinedBotDescriptions = (room: Room): BotDescriptions => {
  const subscribe = useCallback((onChange: () => void) => subscribeToBots(room, onChange), [room]);
  const getSnapshot = useCallback(() => getStore(room).joinedDescriptions, [room]);

  return useSyncExternalStore(subscribe, getSnapshot);
};

const useRoomBotDescriptions = (room: Room): BotDescriptions => {
  const subscribe = useCallback((onChange: () => void) => subscribeToBots(room, onChange), [room]);
  const getSnapshot = useCallback(() => getStore(room).descriptions, [room]);

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
 * Independent signals, any of which is enough: a published advertisement
 * (`app.prinny.bot.info`, or an MSC4391 command description), or a
 * `m.room.member` flag the user set on themselves. All are self-asserted —
 * this is a hint about how an account behaves, not a verified identity claim,
 * and it should never be presented as one.
 */
export const useIsBot = (room: Room, userId: string): boolean => {
  const bots = useRoomBots(room);
  const descriptions = useRoomBotDescriptions(room);
  if (bots.has(userId) || descriptions.has(userId)) return true;
  return hasBotMemberFlag(room.getMember(userId)?.events?.member?.getContent());
};
