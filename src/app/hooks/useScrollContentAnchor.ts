import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Within this many pixels of the bottom the view counts as following the live
 * end, and content growth is allowed to move it.
 */
const NEAR_BOTTOM_PX = 120;

/**
 * Keep the message under the top of the viewport where it is while content
 * above it changes size.
 *
 * **The bug this exists for.** A timeline message is not its final height when
 * it first renders. A link in it becomes a preview card a few hundred
 * milliseconds later — a Twitter or Bluesky post grows the message by a couple
 * of hundred pixels, an `og:image` card by less, an edit or a reaction by a
 * line. When that message is *above* the viewport, every pixel it gains pushes
 * everything below it down, and the user is reading a different part of the
 * conversation than they were a moment ago. It reads as the scroll position
 * jumping at random, because from the reader's side it is: nothing they did
 * caused it, and the thing that did is off-screen.
 *
 * The timeline already restores scroll around its *own* changes — the
 * paginator records an anchor before it changes the rendered range and puts the
 * view back afterwards. Nothing covered growth that the timeline did not
 * initiate, which is most of it.
 *
 * **Why not rely on the browser.** Scroll anchoring (`overflow-anchor`) is
 * supposed to do exactly this and is on by default in Chromium, but it is not
 * dependable here: WebKitGTK — the Linux desktop shell's engine — has never
 * shipped it at all, and even where it exists the browser picks its own anchor
 * and suppresses itself in cases it considers ambiguous. An explicit anchor is
 * the same idea with a known answer on every engine.
 *
 * **How it works.** Every scroll records the topmost item still crossing the
 * top edge, together with its `offsetTop` and the scroll position. When the
 * content box changes height, that item's `offsetTop` is read again: the
 * difference is exactly how much the content *above* it grew or shrank, and
 * adding it to the recorded scroll position puts the reader back on the same
 * pixel. Growth *below* the anchor moves nothing and is correctly ignored.
 *
 * @param getScrollElement the scroller
 * @param getContentElement the element whose height changes — the scroller's
 *   content box, not the scroller itself
 * @param itemSelector selector matching the anchorable items inside it
 * @param enabled false while the view is pinned to the live end, where a new
 *   message is *supposed* to move the view
 * @param invalidateKey changes whenever the caller re-renders a different set
 *   of items (a paginated range). The recorded anchor is dropped, because the
 *   caller is about to restore the scroll itself and two corrections for one
 *   change is one too many.
 * @param bottomFollowPx how close to the bottom counts as following the end,
 *   where growth is allowed to move the view. `NEAR_BOTTOM_PX` for a timeline
 *   that grows downward at the live end. Pass 0 for a list with no live end —
 *   the gallery grows downward as it walks back through history, and its bottom
 *   is the OLDEST media plus a loading sentinel, so a reader parked there is
 *   not following anything and still wants their place kept.
 */
export const useScrollContentAnchor = (
  getScrollElement: () => HTMLElement | null,
  getContentElement: () => HTMLElement | null,
  itemSelector: string,
  enabled: boolean,
  invalidateKey: unknown,
  bottomFollowPx: number = NEAR_BOTTOM_PX,
): void => {
  const anchorRef = useRef<{ el: HTMLElement; offsetTop: number; scrollTop: number } | undefined>(
    undefined,
  );
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const bottomFollowRef = useRef(bottomFollowPx);
  bottomFollowRef.current = bottomFollowPx;

  // Layout effect rather than effect: ResizeObserver callbacks are delivered
  // after layout effects have run for the same frame, so a range change clears
  // the anchor before the resize it causes could be compensated for.
  useLayoutEffect(() => {
    anchorRef.current = undefined;
  }, [invalidateKey]);

  useEffect(() => {
    const scrollEl = getScrollElement();
    const contentEl = getContentElement();
    if (!scrollEl || !contentEl) return undefined;

    let frame: number | undefined;

    const capture = () => {
      frame = undefined;
      if (!enabledRef.current) {
        anchorRef.current = undefined;
        return;
      }
      const { scrollTop } = scrollEl;
      const items = contentEl.querySelectorAll<HTMLElement>(itemSelector);
      // The topmost item whose bottom edge is still below the top of the
      // viewport: the first thing the reader can actually see, and therefore
      // the thing that must not move.
      //
      // Measured against the scroller's own rect rather than by comparing
      // `offsetTop` to `scrollTop`. Those two are only in the same coordinate
      // space when the items' `offsetParent` IS the scroller, and folds' Scroll
      // sets no `position`, so the offsets are usually counted from somewhere up
      // the page instead and every comparison is out by wherever the scroller
      // sits in it. Measured in the browser: a scroller 628px down the page
      // picked the item 15 rows above the one actually at the top edge. Growth
      // between that stale pick and the reader is then invisible — the anchor
      // does not move, so nothing is corrected, which is the jump this exists to
      // stop. Rects are viewport-relative and always comparable.
      const viewportTop = scrollEl.getBoundingClientRect().top;
      for (let i = 0; i < items.length; i += 1) {
        const el = items[i];
        if (el.getBoundingClientRect().bottom > viewportTop) {
          // `offsetTop` is still the right thing to *record*: it is a layout
          // position, so it does not move when the view scrolls, and the
          // difference between two readings of it is exactly how much the
          // content above this item grew. A constant parent offset cancels.
          anchorRef.current = { el, offsetTop: el.offsetTop, scrollTop };
          return;
        }
      }
      anchorRef.current = undefined;
    };

    const onScroll = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(capture);
    };

    const observer = new ResizeObserver(() => {
      const anchor = anchorRef.current;
      if (!enabledRef.current || !anchor) return;
      // `enabled` comes from state that is deliberately debounced by its owner,
      // so it can still say "not at the bottom" for a moment after the view has
      // reached it. Measuring here is not redundant: without it a compensation
      // fired during that window would drag the view back off the live end and
      // look like new messages no longer scrolling into view.
      const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      // Strictly less than, so a caller passing 0 is exempting nothing at all —
      // sitting exactly at the bottom still gets its place kept.
      if (distanceFromBottom < bottomFollowRef.current) {
        anchorRef.current = undefined;
        return;
      }
      // The anchor was unmounted (the range moved, a message was redacted).
      // There is nothing to measure against, so leave the scroll alone.
      if (!anchor.el.isConnected) {
        anchorRef.current = undefined;
        return;
      }
      const delta = anchor.el.offsetTop - anchor.offsetTop;
      if (delta === 0) return;
      const nextTop = anchor.scrollTop + delta;
      // Writing scrollTop fires a scroll event, which would re-capture through
      // `onScroll` on the next frame; update the record now so a second resize
      // in the same frame measures against what we just did.
      anchorRef.current = { el: anchor.el, offsetTop: anchor.el.offsetTop, scrollTop: nextTop };
      scrollEl.scrollTop = nextTop;
    });

    observer.observe(contentEl);
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    capture();

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      scrollEl.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [getScrollElement, getContentElement, itemSelector]);
};
