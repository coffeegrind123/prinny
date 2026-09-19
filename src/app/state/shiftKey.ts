import { isMacOS } from '../utils/user-agent';

// Whether the Shift key — and the platform's primary modifier, Ctrl or Cmd —
// is held right now, published to whoever is watching.
//
// The hover toolbar swaps its buttons for a second set while Shift is down, the
// way Discord's does, and its Delete button turns into "Delete Message Now"
// while Ctrl is down on top. Both need a *state* rather than an event, and
// every message that renders a toolbar has to read the same one.
//
// Deliberately not a jotai atom, for the same reason `hoveredMessage` is not:
// an atom re-renders every subscriber in the timeline on every change, and for
// a modifier key that means re-rendering the whole room on every capital letter
// typed into the composer. Subscribers are counted instead, and the only thing
// that ever subscribes is the message currently under the pointer.

type Listener = () => void;

const IS_MAC = isMacOS();

let shiftPressed = false;
let modPressed = false;
const listeners = new Set<Listener>();

const notify = () => listeners.forEach((listener) => listener());

const setPressed = (shift: boolean, mod: boolean) => {
  if (shiftPressed === shift && modPressed === mod) return;
  shiftPressed = shift;
  modPressed = mod;
  notify();
};

// `mod` is whichever modifier the keybinds call `mod`: Cmd on a Mac, Ctrl
// elsewhere. Reading both flags rather than picking one keeps a Mac's Ctrl-click
// (a right-click) from counting.
const modOf = (evt: KeyboardEvent | MouseEvent): boolean => (IS_MAC ? evt.metaKey : evt.ctrlKey);

// `evt.shiftKey` is true throughout Shift's own keydown and false throughout
// its keyup, so one handler covers pressing it, releasing it, and releasing it
// while some other key is still down. The same holds for `ctrlKey`/`metaKey`.
const handleKey = (evt: KeyboardEvent) => setPressed(evt.shiftKey, modOf(evt));

// Entering the window with Shift ALREADY held delivers no keydown — alt-tabbing
// back, or clicking in from another app. Every mouse event carries the current
// modifier state, so the first pointer movement resyncs us. Hovering a message
// requires moving the pointer, which makes this the path that gets it right in
// exactly the case the keyboard cannot.
const handlePointer = (evt: MouseEvent) => setPressed(evt.shiftKey, modOf(evt));

// Releasing a modifier while the window is in the background delivers no keyup
// at all, which would otherwise leave the flag stuck on until the next keypress.
const handleRelease = () => setPressed(false, false);

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

export function isModPressed(): boolean {
  return modPressed;
}
