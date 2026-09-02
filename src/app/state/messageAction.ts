import { RectCords } from 'folds';

/**
 * A one-shot request from a global keybind to the `Message` under the cursor.
 *
 * The message keybinds that only need matrix-js-sdk — edit, delete, pin, reply,
 * copy, mark-unread — are handled entirely inside `MessageKeybinds`, which is
 * why they work from a single global keydown listener. Two of them cannot be:
 * "add reaction" and "forward" open a popover and a modal that live inside a
 * particular `Message`, along with the state that positions them. A global
 * handler has no way to reach into one component instance.
 *
 * Hence this channel. `MessageKeybinds` publishes to the hovered event id, the
 * `Message` rendering that id picks it up and opens its own UI. It is the same
 * shape as `hoveredMessage` — module-level and deliberately not a jotai atom,
 * because an atom here would re-render every message in the timeline on every
 * keypress.
 *
 * Subscriptions are keyed by event id rather than broadcast, so a keypress
 * wakes exactly one component. Messages appear in more than one place at once
 * (the timeline, a pinned list, search results), so an id maps to a SET of
 * listeners, not one — with a single slot the last one to mount would silently
 * steal the binding from the timeline.
 */
export type MessageActionRequest =
  { type: 'add-reaction'; anchor: RectCords } | { type: 'forward' };

type Listener = (request: MessageActionRequest) => void;

const listenersByEventId = new Map<string, Set<Listener>>();

export function subscribeMessageAction(eventId: string, listener: Listener): () => void {
  let listeners = listenersByEventId.get(eventId);
  if (!listeners) {
    listeners = new Set();
    listenersByEventId.set(eventId, listeners);
  }
  listeners.add(listener);

  return () => {
    const current = listenersByEventId.get(eventId);
    if (!current) return;
    current.delete(listener);
    // Drop the bucket with its last listener. This map is keyed by event id and
    // a long-lived session scrolls through a lot of them; leaving empty Sets
    // behind would make it grow for the lifetime of the tab.
    if (current.size === 0) listenersByEventId.delete(eventId);
  };
}

export function requestMessageAction(eventId: string, request: MessageActionRequest): void {
  const listeners = listenersByEventId.get(eventId);
  if (!listeners) return;
  // Copy before iterating: a listener may unsubscribe (or mount something that
  // subscribes) while being notified, and mutating the live Set mid-iteration
  // would skip or double-call its neighbours.
  Array.from(listeners).forEach((listener) => listener(request));
}

/**
 * Whether anything is listening for this event id.
 *
 * Lets a keybind fall through to the browser when the hovered message is not
 * rendered by a component that can service the action, rather than swallowing
 * the key and doing nothing.
 */
export function hasMessageActionListener(eventId: string): boolean {
  return (listenersByEventId.get(eventId)?.size ?? 0) > 0;
}
