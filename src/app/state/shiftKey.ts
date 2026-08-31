// Whether the Shift key is held right now, published to whoever is watching.
//
// The hover toolbar swaps its buttons for a second set while Shift is down, the
// way Discord's does. That needs a *state* rather than an event, and every
// message that renders a toolbar has to read the same one.
//
// Deliberately not a jotai atom, for the same reason `hoveredMessage` is not:
// an atom re-renders every subscriber in the timeline on every change, and for
// a modifier key that means re-rendering the whole room on every capital letter
// typed into the composer. Subscribers are counted instead, and the only thing
// that ever subscribes is the message currently under the pointer.

type Listener = () => void;

let shiftPressed = false;
const listeners = new Set<Listener>();

const setShiftPressed = (pressed: boolean) => {
  if (shiftPressed === pressed) return;
  shiftPressed = pressed;
  listeners.forEach((listener) => listener());
};

// `evt.shiftKey` is true throughout Shift's own keydown and false throughout
// its keyup, so one handler covers pressing it, releasing it, and releasing it
// while some other key is still down.
const handleKey = (evt: KeyboardEvent) => setShiftPressed(evt.shiftKey);

// Entering the window with Shift ALREADY held delivers no keydown — alt-tabbing
// back, or clicking in from another app. Every mouse event carries the current
// modifier state, so the first pointer movement resyncs us. Hovering a message
// requires moving the pointer, which makes this the path that gets it right in
// exactly the case the keyboard cannot.
const handlePointer = (evt: MouseEvent) => setShiftPressed(evt.shiftKey);

// Releasing Shift while the window is in the background delivers no keyup at
// all, which would otherwise leave the flag stuck on until the next keypress.
const handleRelease = () => setShiftPressed(false);

let listening = false;

/**
 * Attached on the first subscriber and never detached.
 *
 * Detaching on the last unsubscribe would be wrong, not just fussy: with no
 * listeners we miss the keyup, so the cached value goes stale, and the pointer
 * moving off one message and onto the next unsubscribes and resubscribes across
 * that gap. Both directions of staleness are visible as a flicker of the wrong
 * toolbar. Four listeners that do one boolean compare cost nothing next to the
 * per-message pointer handlers react-aria already installs.
 *
 * Capture phase for the key events: handlers deeper in the tree (the composer,
 * the emoji board) stop propagation of keys they consume, and a bubble-phase
 * listener on `window` would simply never see those.
 */
const startListening = () => {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', handleKey, { capture: true });
  window.addEventListener('keyup', handleKey, { capture: true });
  window.addEventListener('pointermove', handlePointer, { capture: true, passive: true });
  window.addEventListener('blur', handleRelease);
  document.addEventListener('visibilitychange', handleRelease);
};

export function subscribeShiftKey(listener: Listener): () => void {
  startListening();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function isShiftPressed(): boolean {
  return shiftPressed;
}
