import { MatrixEvent, MatrixEventEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMatrixClient } from './useMatrixClient';
import { useForceUpdate } from './useForceUpdate';
import { useRoomAccountData } from './useRoomAccountData';
import {
  BOT_KEYBOARD_ACCOUNT_DATA,
  BotContentKey,
  isForceReply,
  isReplyKeyboardMarkup,
  isReplyKeyboardRemove,
  sanitizeReplyMarkup,
  type ForceReply,
  type ReplyKeyboardMarkup,
} from '../../types/matrix/bot';
import {
  latestInstruction,
  parseStoredKeyboards,
  recordInstruction,
  setKeyboardFlag,
} from '../utils/botKeyboardStore';

/** The composer state a bot has most recently asked for in this room. */
export type BotComposerState =
  | { kind: 'none' }
  | {
      kind: 'keyboard';
      markup: ReplyKeyboardMarkup;
      botUserId: string;
      /** The message that set it — its id keys the one-time dismissal. */
      eventId: string;
    }
  | {
      kind: 'force_reply';
      markup: ForceReply;
      botUserId: string;
      eventId: string;
    };

/**
 * How far back the timeline is scanned. Older keyboards are still found, via
 * the room account data record (see `utils/botKeyboardStore.ts`).
 */
const SCAN_DEPTH = 200;

/** Whether a `selective` markup is meant for us. */
const mentionsUs = (event: MatrixEvent, userId: string | null): boolean => {
  if (!userId) return false;
  const mentions = event.getContent()['m.mentions'] as { user_ids?: string[] } | undefined;
  return Array.isArray(mentions?.user_ids) && mentions.user_ids.includes(userId);
};

type ScannedInstruction =
  | { kind: 'remove'; botUserId: string; eventId: string; ts: number }
  | {
      kind: 'keyboard';
      markup: ReplyKeyboardMarkup;
      botUserId: string;
      eventId: string;
      ts: number;
    }
  | { kind: 'force_reply'; markup: ForceReply; botUserId: string; eventId: string; ts: number };

/** The composer instruction one event carries for us, if any. */
const readInstruction = (
  event: MatrixEvent,
  userId: string | null,
): ScannedInstruction | undefined => {
  if (event.isRedacted()) return undefined;
  const sender = event.getSender();
  const eventId = event.getId();
  if (!sender || sender === userId || !eventId) return undefined;

  const markup = sanitizeReplyMarkup(event.getContent()[BotContentKey.ReplyMarkup]);
  if (!markup) return undefined;
  // An inline keyboard lives under its own message and says nothing about
  // the composer.
  if (!isReplyKeyboardMarkup(markup) && !isReplyKeyboardRemove(markup) && !isForceReply(markup)) {
    return undefined;
  }
  // `selective` narrows an instruction to the users the message mentions.
  // Anyone else carries on as though it had not been sent — so an unrelated
  // user's keyboard cannot clear theirs.
  if (markup.selective && !mentionsUs(event, userId)) return undefined;

  const ts = event.getTs();
  if (isReplyKeyboardRemove(markup)) return { kind: 'remove', botUserId: sender, eventId, ts };
  if (isForceReply(markup)) return { kind: 'force_reply', markup, botUserId: sender, eventId, ts };
  return { kind: 'keyboard', markup, botUserId: sender, eventId, ts };
};

/** The most recent instruction in the loaded timeline, whatever it is. */
const scanTimeline = (room: Room, userId: string | null): ScannedInstruction | undefined => {
  const timeline = room.getLiveTimeline().getEvents();
  const start = Math.max(0, timeline.length - SCAN_DEPTH);
  for (let i = timeline.length - 1; i >= start; i -= 1) {
    const event = timeline[i];
    const instruction = event ? readInstruction(event, userId) : undefined;
    if (instruction) return instruction;
  }
  return undefined;
};

export type BotReplyKeyboardState = {
  state: BotComposerState;
  /** Dismiss the current keyboard or prompt, on every device. */
  dismiss: () => void;
  /** Call after sending a key press, so `one_time_keyboard` can collapse. */
  noteUsed: () => void;
  /** True when a one-time keyboard has been used and is collapsed. */
  collapsed: boolean;
  /** Re-open a collapsed one-time keyboard. */
  expand: () => void;
};

/**
 * The reply keyboard or force-reply prompt in force for this room.
 *
 * The loaded timeline is scanned first. Every keyboard or removal it finds is
 * recorded, by reference only, in room account data, which is what keeps a
 * keyboard alive past the scan window or a sync gap and carries a dismissal
 * to the user's other devices. When the newest instruction is older than the
 * loaded timeline, its event is fetched (and decrypted) to read the markup
 * again. A force-reply prompt is a one-shot and is never recorded.
 */
export const useBotReplyKeyboard = (room: Room): BotReplyKeyboardState => {
  const mx = useMatrixClient();
  const userId = mx.getUserId();
  const [updateCount, forceUpdate] = useForceUpdate();
  const roomAccountData = useRoomAccountData(room);
  const storedContent = roomAccountData.get(BOT_KEYBOARD_ACCOUNT_DATA) as
    Record<string, unknown> | undefined;

  /** Instant local echo while the account data write is in flight. */
  const [localFlags, setLocalFlags] = useState<{ dismissed?: string; used?: string }>({});
  /** A collapsed one-time keyboard the user re-opened on this device. */
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  /** The markup of an instruction older than the loaded timeline. */
  const [fetched, setFetched] = useState<{ eventId: string; instruction?: ScannedInstruction }>();

  useEffect(() => {
    const handle = (event: MatrixEvent, eventRoom?: Room) => {
      if (eventRoom && eventRoom.roomId !== room.roomId) return;
      if (event.getRoomId() !== room.roomId) return;
      if (event.getContent()[BotContentKey.ReplyMarkup] === undefined) return;
      forceUpdate();
    };
    const handleDecrypted = (event: MatrixEvent) => handle(event);

    mx.on(RoomEvent.Timeline, handle);
    // In an encrypted room the markup is inside the ciphertext, so the event
    // is uninteresting until it decrypts.
    mx.on(MatrixEventEvent.Decrypted, handleDecrypted);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handle);
      mx.removeListener(MatrixEventEvent.Decrypted, handleDecrypted);
    };
  }, [mx, room.roomId, forceUpdate]);

  const scanned = useMemo(
    () => scanTimeline(room, userId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, userId, updateCount],
  );

  const stored = useMemo(() => parseStoredKeyboards(storedContent), [storedContent]);
  const latestStored = useMemo(() => latestInstruction(stored), [stored]);

  // Record what the timeline shows, so it outlives the scan window.
  useEffect(() => {
    if (!scanned || scanned.kind === 'force_reply') return;
    const next = recordInstruction(storedContent, scanned.botUserId, scanned);
    if (!next) return;
    mx.setRoomAccountData(room.roomId, BOT_KEYBOARD_ACCOUNT_DATA as never, next as never).catch(
      (e) => console.warn('[bot-keyboard] could not record the reply keyboard', e),
    );
  }, [mx, room.roomId, scanned, storedContent]);

  // The timeline's instruction wins unless the record holds a newer one,
  // which happens when the loaded timeline is older than the record.
  const fromRecord = !!latestStored && (!scanned || latestStored.ts > scanned.ts);
  const recordEventId = fromRecord ? latestStored?.eventId : undefined;
  const recordIsKeyboard = fromRecord && latestStored?.kind === 'keyboard';

  useEffect(() => {
    if (!recordIsKeyboard || !recordEventId || !latestStored) return undefined;
    if (fetched?.eventId === recordEventId) return undefined;

    let cancelled = false;
    const botUserId = latestStored.botUserId;
    const load = async (): Promise<ScannedInstruction | undefined> => {
      const local = room.findEventById(recordEventId);
      if (local) return readInstruction(local, userId);
      const raw = await mx.fetchRoomEvent(room.roomId, recordEventId);
      const event = new MatrixEvent(raw);
      await mx.decryptEventIfNeeded(event);
      return readInstruction(event, userId);
    };
    load()
      .then((instruction) => {
        if (cancelled) return;
        // The record names the bot; an event from anyone else is not its keyboard.
        const valid = instruction?.botUserId === botUserId ? instruction : undefined;
        setFetched({ eventId: recordEventId, instruction: valid });
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[bot-keyboard] could not load', recordEventId, e);
        setFetched({ eventId: recordEventId });
      });
    return () => {
      cancelled = true;
    };
  }, [mx, room, userId, recordIsKeyboard, recordEventId, latestStored, fetched]);

  const found = useMemo<BotComposerState>(() => {
    let instruction: ScannedInstruction | undefined = scanned;
    if (fromRecord) {
      instruction =
        recordIsKeyboard && fetched && fetched.eventId === recordEventId
          ? fetched.instruction
          : undefined;
    }
    if (!instruction || instruction.kind === 'remove') return { kind: 'none' };
    if (instruction.kind === 'keyboard') {
      const { markup, botUserId, eventId } = instruction;
      return { kind: 'keyboard', markup, botUserId, eventId };
    }
    const { markup, botUserId, eventId } = instruction;
    return { kind: 'force_reply', markup, botUserId, eventId };
  }, [scanned, fromRecord, recordIsKeyboard, recordEventId, fetched]);

  const flagged = (flag: 'dismissed' | 'used'): boolean => {
    if (found.kind === 'none') return false;
    if (localFlags[flag] === found.eventId) return true;
    const entry = stored[found.botUserId];
    return entry?.eventId === found.eventId && entry[flag];
  };
  const dismissed = flagged('dismissed');
  const used = flagged('used');

  // Memoised, not computed inline: the dismissed branch builds a fresh
  // `{ kind: 'none' }` every render, which would give the returned object a new
  // identity each time and re-render every consumer of this hook forever.
  const state = useMemo<BotComposerState>(
    () => (dismissed ? { kind: 'none' } : found),
    [found, dismissed],
  );

  const writeFlag = useCallback(
    (flag: 'dismissed' | 'used') => {
      if (found.kind === 'none') return;
      setLocalFlags((current) => ({ ...current, [flag]: found.eventId }));
      // A force-reply is never recorded, so its dismissal stays on this device.
      if (found.kind !== 'keyboard') return;
      const next = setKeyboardFlag(storedContent, found.botUserId, found.eventId, flag);
      if (!next) return;
      mx.setRoomAccountData(room.roomId, BOT_KEYBOARD_ACCOUNT_DATA as never, next as never).catch(
        (e) => console.warn('[bot-keyboard] could not save', flag, e),
      );
    },
    [mx, room.roomId, found, storedContent],
  );

  const dismiss = useCallback(() => writeFlag('dismissed'), [writeFlag]);

  const noteUsed = useCallback(() => {
    if (found.kind === 'keyboard' && found.markup.one_time_keyboard) {
      setExpandedEventId(null);
      writeFlag('used');
    }
  }, [found, writeFlag]);

  const expand = useCallback(() => {
    if (found.kind !== 'none') setExpandedEventId(found.eventId);
  }, [found]);

  const collapsed =
    state.kind === 'keyboard' &&
    state.markup.one_time_keyboard === true &&
    used &&
    state.eventId !== expandedEventId;

  return useMemo(
    () => ({ state, dismiss, noteUsed, collapsed, expand }),
    [state, dismiss, noteUsed, collapsed, expand],
  );
};
