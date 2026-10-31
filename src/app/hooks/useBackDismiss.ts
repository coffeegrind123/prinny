import { useEffect, useRef } from 'react';

/**
 * What the back handler did with the press.
 *
 * `consumed` — the dialog handled Back but is still open (e.g. a subpage
 * stepped back to its menu). A fresh sentinel is pushed so the next Back is
 * intercepted too.
 * `closed` — the dialog is gone; Back is handed back to the app.
 */
export type BackDismissResult = 'consumed' | 'closed';

/** Marks the synthetic history entry as ours, and says which instance owns it. */
const MARKER = '__prinnyBackDismiss';

let tokenSeq = 0;

/**
 * How many pops this hook has asked for itself and not seen arrive yet.
 *
 * `history.back()` is asynchronous, so a dialog closed and reopened in quick
 * succession can have the teardown pop of the first instance land after the
 * second has already pushed its sentinel. Unaccounted for that reads as a Back
 * press and shuts the dialog the user has just opened. Counted rather than
 * flagged so overlapping teardowns cancel one pop each.
 */
let pendingSelfPops = 0;

/**
 * Pops our own sentinel and books the pop it will produce.
 *
 * The booking is cleared by a listener of its own rather than by the instance
 * handler below, because by the time the pop lands the instance that asked for
 * it is unmounted and listening to nothing — a count only instances could
 * clear would leak, and a stale count swallows a real Back press later on.
 *
 * Clearing it is deferred a task past the pop instead of done in the listener:
 * this listener is registered during the *old* instance's teardown, so it runs
 * before a newly mounted instance's handler, and clearing inline would leave
 * that handler reading a count of zero and treating our teardown pop as a Back
 * press — closing the dialog the user has just reopened.
 *
 * The timer is a backstop for a pop that never arrives, which would otherwise
 * strand the count above zero forever.
 */
const popOwnSentinel = () => {
  pendingSelfPops += 1;

  let settled = false;
  let backstop = 0;
  let onPop = (): void => {};

  const settle = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener('popstate', onPop);
    window.clearTimeout(backstop);
    pendingSelfPops -= 1;
  };

  onPop = () => {
    window.setTimeout(settle, 0);
  };
  backstop = window.setTimeout(settle, 2000);
  window.addEventListener('popstate', onPop);
  window.history.back();
};

type HistoryStateWithMarker = Record<string, unknown> | null;

/**
 * Makes a dialog that is component state rather than a route dismissible with
 * the system Back gesture / button.
 *
 * On Android the WebView never sees a "back button" event: `MainActivity`
 * enables wry's back handling, so Back — including the left-edge swipe, which
 * in gesture-nav mode the system consumes before any touch reaches the page —
 * turns into `webView.goBack()`, i.e. a plain history pop. A dialog that isn't
 * a history entry therefore cannot be dismissed by it: Back navigates the route
 * *underneath* the dialog instead, and the dialog stays put looking like the
 * gesture did nothing.
 *
 * The fix is to give it an entry to pop. While mounted this pushes one
 * same-URL sentinel entry; popping it is what calls `onBack`. Because the URL
 * never changes, the router sees a POP to the location it is already on and
 * re-renders identically — nothing navigates.
 *
 * Same mechanism covers the desktop/browser Back button and mouse back
 * buttons, so the behaviour is one thing everywhere rather than an Android
 * special case.
 *
 * Mount the hook only while the dialog is open (these dialogs are already
 * rendered conditionally).
 *
 * @param onBack Invoked when our sentinel is popped. Runs off a ref, so it may
 *   close over changing state without re-pushing the entry on every render.
 */
export function useBackDismiss(onBack: () => BackDismissResult): void {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;

  useEffect(() => {
    tokenSeq += 1;
    const token = `${MARKER}-${tokenSeq}`;

    const isOurEntry = () => (window.history.state as HistoryStateWithMarker)?.[MARKER] === token;

    const push = () => {
      // Spread the existing state: react-router keeps its own bookkeeping
      // (`usr`, `key`, `idx`) in history.state and reads it back on popstate.
      // A bare pushState would drop it and leave the router guessing.
      //
      // The URL is passed explicitly rather than omitted so the entry is
      // unambiguously the current one under both the browser and the hash
      // router.
      window.history.pushState(
        { ...(window.history.state as HistoryStateWithMarker), [MARKER]: token },
        '',
        window.location.href,
      );
    };

    push();
    // Tracks whether our sentinel is still on the stack, so the cleanup below
    // knows if there is anything left to pop.
    let live = true;

    const handlePop = () => {
      // A pop we asked for ourselves (see popOwnSentinel), not a Back press.
      // Cleared there, not here.
      if (pendingSelfPops > 0) return;
      // Our entry is the top of the stack while `live`, so any pop that lands
      // somewhere else is the Back press we are here to intercept.
      if (!live || isOurEntry()) return;
      live = false;
      if (handlerRef.current() === 'consumed') {
        push();
        live = true;
      }
    };

    window.addEventListener('popstate', handlePop);
    return () => {
      window.removeEventListener('popstate', handlePop);
      // Closed by something other than Back (the X, Escape, a click outside).
      // The sentinel is still current, and leaving it there would make the
      // next Back press a no-op that only pops it. Guarded on it actually
      // being the current entry: if the app pushed a real navigation on top
      // (logging out, say), going back would undo that instead.
      if (live && isOurEntry()) popOwnSentinel();
    };
  }, []);
}

/**
 * useBackDismiss for a panel whose close never needs to step back in place:
 * render it next to the panel, under the same condition that shows it.
 */
export function BackDismiss({ onClose }: { onClose: () => void }): null {
  useBackDismiss(() => {
    onClose();
    return 'closed';
  });
  return null;
}
