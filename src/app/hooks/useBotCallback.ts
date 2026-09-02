import { MatrixEvent, MatrixEventEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatrixClient } from './useMatrixClient';
import { MessageEvent } from '../../types/matrix/room';
import {
  BotRelType,
  CALLBACK_ANSWER_TIMEOUT_MS,
  sanitizeCallbackAnswer,
  type CallbackAnswerContent,
} from '../../types/matrix/bot';

export type BotCallbackAnswer = Omit<CallbackAnswerContent, 'm.relates_to'>;

/** `row:col`, identifying which button is mid-flight. */
export type ButtonKey = string;

export const buttonKey = (row: number, col: number): ButtonKey => `${row}:${col}`;

export type BotCallbackState = {
  /** Press a button. No-op while another press on this message is in flight. */
  press: (data: string, row: number, col: number) => void;
  /** The button awaiting an answer, or null. */
  pending: ButtonKey | null;
  /** The most recent answer, for display. */
  answer: BotCallbackAnswer | null;
  /** True when the bot never answered. */
  timedOut: boolean;
  /** Local failure — the callback event could not be sent at all. */
  error: string | null;
  dismiss: () => void;
};

/**
 * Send button presses for one message and wait for the bot's answer.
 *
 * The spinner on a pressed button is the user's only evidence that anything
 * happened, so this tracks the round trip explicitly rather than firing and
 * forgetting: press, wait for `app.prinny.bot.callback_answer` carrying the
 * same `id`, and give up after 15 seconds with a visible "no response" rather
 * than a button that spins forever.
 */
export const useBotCallback = (room: Room, mEvent: MatrixEvent): BotCallbackState => {
  const mx = useMatrixClient();
  const [pending, setPending] = useState<ButtonKey | null>(null);
  const [answer, setAnswer] = useState<BotCallbackAnswer | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** id of the callback we are waiting on, and the event that carried it. */
  const waiting = useRef<{ id: string; eventId?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = useCallback(() => {
    waiting.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPending(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    // Only listen while a press is actually in flight.
    //
    // This hook runs once per message carrying a keyboard, so attaching
    // unconditionally would put two client listeners on every such message in
    // the room — enough to trip EventEmitter's max-listener warning in a room
    // with an active bot, for listeners that have nothing to do.
    if (pending === null) return undefined;

    const handle = (event: MatrixEvent, eventRoom?: Room) => {
      if (eventRoom && eventRoom.roomId !== room.roomId) return;
      if (event.getRoomId() !== room.roomId) return;
      if (event.getType() !== MessageEvent.BotCallbackAnswer) return;

      const expecting = waiting.current;
      if (!expecting) return;

      // Only the sender of the message the keyboard hangs off may answer for
      // it. Otherwise any room member could pop an alert that appears to come
      // from the bot.
      if (event.getSender() !== mEvent.getSender()) return;

      const content = event.getContent() as Record<string, unknown>;
      const relation = content['m.relates_to'] as
        { rel_type?: string; event_id?: string } | undefined;
      if (relation?.rel_type !== BotRelType.CallbackAnswer) return;
      if (expecting.eventId && relation.event_id !== expecting.eventId) return;

      const parsed = sanitizeCallbackAnswer(content);
      if (!parsed || parsed.id !== expecting.id) return;

      settle();
      setTimedOut(false);
      // An answer with no text just clears the spinner, which is the common
      // case and deliberately shows nothing.
      setAnswer(parsed.text || parsed.url ? parsed : null);
    };

    const handleDecrypted = (event: MatrixEvent) => handle(event);

    mx.on(RoomEvent.Timeline, handle);
    // In an encrypted room the answer arrives as m.room.encrypted and only
    // becomes readable later; RoomEvent.Timeline does not fire again for it.
    mx.on(MatrixEventEvent.Decrypted, handleDecrypted);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handle);
      mx.removeListener(MatrixEventEvent.Decrypted, handleDecrypted);
    };
  }, [mx, room.roomId, mEvent, settle, pending]);

  const press = useCallback(
    (data: string, row: number, col: number) => {
      // Debounce: a held or double-clicked button must produce one callback.
      if (waiting.current) return;

      const targetId = mEvent.getId();
      if (!targetId) return;

      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      waiting.current = { id };
      setPending(buttonKey(row, col));
      setAnswer(null);
      setTimedOut(false);
      setError(null);

      timer.current = setTimeout(() => {
        // Do not retry. A bot that did not answer in fifteen seconds is not
        // helped by a second identical press, and the user may well have been
        // asking it to do something exactly once.
        settle();
        setTimedOut(true);
      }, CALLBACK_ANSWER_TIMEOUT_MS);

      mx.sendEvent(
        room.roomId,
        MessageEvent.BotCallback as never,
        {
          'm.relates_to': { rel_type: BotRelType.Callback, event_id: targetId },
          id,
          data,
          button: [row, col],
        } as never,
      )
        .then((result) => {
          if (waiting.current?.id === id) waiting.current.eventId = result.event_id;
        })
        .catch((err: unknown) => {
          settle();
          setError(err instanceof Error ? err.message : 'Could not send');
        });
    },
    [mx, room.roomId, mEvent, settle],
  );

  const dismiss = useCallback(() => {
    setAnswer(null);
    setTimedOut(false);
    setError(null);
  }, []);

  return useMemo(
    () => ({ press, pending, answer, timedOut, error, dismiss }),
    [press, pending, answer, timedOut, error, dismiss],
  );
};
