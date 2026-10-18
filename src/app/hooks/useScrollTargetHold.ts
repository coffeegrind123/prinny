import { useCallback, useEffect, useRef } from 'react';

/**
 * Keeps a jump's target where the jump put it while the timeline settles.
 *
 * A jump (a reply, a permalink, the read marker) computes one scroll position
 * from the layout at the moment it starts, and two things routinely move the
 * target after that:
 *
 * - **Pagination cancels a smooth scroll.** A target near the start of the
 *   rendered range brings the back anchor into view on the way there; the
 *   paginator prepends history and restores the position with an instant
 *   `scrollTo`, which ends the smooth scroll wherever it had got to. Measured on
 *   a live client: the scroll stopped at 211px of a run toward the target and
 *   the target settled 225px above centre, every time.
 * - **Content grows after landing.** Images without stored dimensions, previews
 *   and embeds size themselves once loaded. `useScrollContentAnchor` pins the
 *   message at the top of the view, which is right for reading but moves the
 *   jumped-to message, further down, by however much grew between the two.
 *
 * While a hold is active, `reassert` re-runs the jump's scroll; the caller
 * invokes it after a range change, and this hook invokes it on every resize of
 * the content. The hold ends at the reader's first input — pointer, wheel,
 * touch or key, anywhere — since from then on the reader decides where the view
 * is, or after HOLD_MS.
 */

const HOLD_MS = 5000;

const RELEASE_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;

type Hold = {
  reassert: () => void;
  until: number;
};

export type ScrollTargetHold = {
  hold: (reassert: () => void) => void;
  reassert: () => void;
};

export const useScrollTargetHold = (
  getContentElement: () => HTMLElement | null,
): ScrollTargetHold => {
  const holdRef = useRef<Hold | undefined>(undefined);

  const hold = useCallback((reassert: () => void) => {
    holdRef.current = { reassert, until: performance.now() + HOLD_MS };
  }, []);

  const reassert = useCallback(() => {
    const current = holdRef.current;
    if (!current) {
      return;
    }
    if (performance.now() > current.until) {
      holdRef.current = undefined;
      return;
    }
    current.reassert();
  }, []);

  useEffect(() => {
    const release = () => {
      holdRef.current = undefined;
    };

    // Capture phase on window: the timeline's own handlers (and the global
    // keybind layer) must not be able to stop the reader's input from ending
    // the hold. A click that starts a new jump is no problem — its pointerdown
    // releases the old hold before its click handler sets the new one.
    RELEASE_EVENTS.forEach((type) =>
      window.addEventListener(type, release, { capture: true, passive: true }),
    );

    const contentEl = getContentElement();
    const observer = new ResizeObserver(reassert);
    if (contentEl) {
      observer.observe(contentEl);
    }

    return () => {
      RELEASE_EVENTS.forEach((type) =>
        window.removeEventListener(type, release, { capture: true }),
      );
      observer.disconnect();
    };
  }, [getContentElement, reassert]);

  return { hold, reassert };
};
