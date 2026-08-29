import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Within this many pixels of the bottom the view counts as following the live
 * end, and content growth is allowed to move it.
 */
const NEAR_BOTTOM_PX = 120;

/** Sub-pixel drift from fractional rects is not worth a scroll write. */
const MIN_CORRECTION_PX = 0.5;

/**
 * How far into a message the anchor may descend. Deep enough to land on the
 * paragraph or card the reader is actually looking at, shallow enough that the
 * walk costs nothing.
 */
const MAX_ANCHOR_DEPTH = 8;

type Anchor = {
  /** The `itemSelector` element the anchor was found in. */
  item: Element;
  /** `item`'s position in the scroller's content, at `scrollTop`. */
  itemTop: number;
  /** The deepest element inside `item` still crossing the top edge. */
  el: Element;
  /** `el`'s position in the scroller's content, at `scrollTop`. */
  elTop: number;
  /** The scroll position both readings were taken at. */
  scrollTop: number;
};

/**
 * An element's top in the scroller's *content* coordinates — the same space
 * `scrollTop` is in, and what `offsetTop` would give if the scroller were every
 * item's `offsetParent`.
 *
 * Rects rather than `offsetTop` because the anchor is not always a direct child
 * of anything in particular: it can be several levels into a message, under any
 * number of positioned ancestors, and `offsetTop` would then be counted from
 * whichever of them happens to be positioned — a different origin per anchor,
 * and one that can change under us when a card mounts. Rects are
 * viewport-relative for every element alike, and adding `scrollTop` takes the
 * scroll back out, so the result only moves when layout does.
 */
const contentTop = (el: Element, scrollTop: number, viewportTop: number): number =>
  scrollTop + el.getBoundingClientRect().top - viewportTop;

/**
 * Out-of-flow boxes are skipped when descending: the hover toolbar is pinned
 * 30px above its own message, so in document order it is the first thing under
 * the top edge while being neither where the reader is looking nor something
 * that survives the pointer leaving.
 */
const inFlow = (el: Element): boolean => {
  const { position } = getComputedStyle(el);
  return position === 'static' || position === 'relative';
};

/**
 * The deepest descendant of `item` that still crosses the viewport's top edge.
 *
 * Anchoring on the message alone is too coarse for the thing this hook exists
 * to correct. A message is not one block that grows at its end: it can hold a
 * picture that gets its intrinsic size late, several preview cards stacked one
 * above another, an edit, a reactions row. When the reader's top edge sits
 * *below* one of those and it grows, the message's own top has not moved — so a
 * message-level anchor measures no change and corrects nothing, while
 * everything the reader can see has just been pushed down by it. Descending
 * gives the anchor the same granularity as the growth.
 */
const deepestAnchorIn = (item: Element, viewportTop: number): Element => {
  let el: Element = item;

  for (let depth = 0; depth < MAX_ANCHOR_DEPTH; depth += 1) {
    let next: Element | undefined;

    for (let i = 0; i < el.children.length; i += 1) {
      const child = el.children[i];
      const rect = child.getBoundingClientRect();
      // Not laid out (display: none, or a `display: contents` wrapper whose own
      // box does not exist): it cannot be the thing at the top edge, and
      // descending into it would measure a box that is not there.
      if (rect.width === 0 && rect.height === 0) continue;
      // Entirely above the reader — whatever crosses the edge is further down.
      if (rect.bottom <= viewportTop) continue;
      if (!inFlow(child)) continue;
      next = child;
      break;
    }

    if (!next) break;
    el = next;
  }

  return el;
};

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
 * **How it works.** The topmost element still crossing the top edge is recorded
 * along with its layout position and the scroll position. When the content box
 * changes height, that element's layout position is read again: the difference
 * is exactly how much the content *above* it grew or shrank, and adding it to
 * the recorded scroll position puts the reader back on the same pixel. Growth
 * *below* the anchor moves nothing and is correctly ignored.
 *
 * **There is always an anchor.** The first version recorded one only from the
 * scroll handler, and only while `enabled` said so — and that is how the jump
 * survived the fix. `enabled` is fed by state its owner debounces by a second,
 * so for a second after the reader scrolls up off the live end it still says
 * "following the end", and every capture in that window threw the anchor away.
 * Nothing re-captured when it flipped, because nothing had scrolled since — so
 * a reader who scrolled up and *stopped*, which is what reading is, sat there
 * with no anchor at all and every preview that landed afterwards moved them.
 * Capturing is unconditional now, and repeated after every resize and every
 * range change; whether to *correct* is decided at the moment of the resize,
 * from the live distance to the bottom, which cannot be stale.
 *
 * @param getScrollElement the scroller
 * @param getContentElement the element whose height changes — the scroller's
 *   content box, not the scroller itself
 * @param itemSelector selector matching the anchorable items inside it
 * @param enabled the caller's own reason to hold off entirely (the gallery
 *   parked at its top, where content arriving above is what the reader is
 *   waiting for). Following the live end is NOT such a reason and must not be
 *   passed here — it is measured below, per resize. Anchors are still recorded
 *   while this is false, so switching it back on needs no scroll to arm it.
 * @param invalidateKey changes whenever the caller re-renders a different set
 *   of items (a paginated range). The anchor is re-taken, because the caller
 *   restores the scroll itself around that change and the old reading belongs
 *   to a layout that no longer exists.
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
  const anchorRef = useRef<Anchor | undefined>(undefined);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const bottomFollowRef = useRef(bottomFollowPx);
  bottomFollowRef.current = bottomFollowPx;

  const capture = useCallback((): Anchor | undefined => {
    const scrollEl = getScrollElement();
    const contentEl = getContentElement();
    if (!scrollEl || !contentEl) return undefined;

    const { scrollTop } = scrollEl;
    // The scroller's own top edge in viewport coordinates. Everything below is
    // measured against it rather than against `scrollTop`, because item offsets
    // and `scrollTop` only share a coordinate space when the items'
    // `offsetParent` IS the scroller, and folds' Scroll sets no `position`, so
    // they usually do not. Measured in the browser: a scroller 628px down the
    // page picked the item 15 rows above the one actually at the top edge, and
    // growth between that stale pick and the reader then moved the view without
    // moving the anchor — the jump this exists to stop.
    const viewportTop = scrollEl.getBoundingClientRect().top;
    const items = contentEl.querySelectorAll<HTMLElement>(itemSelector);

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      // The topmost item whose bottom edge is still below the top of the
      // viewport: the first thing the reader can actually see, and therefore
      // the thing that must not move.
      if (item.getBoundingClientRect().bottom > viewportTop) {
        const el = deepestAnchorIn(item, viewportTop);
        return {
          item,
          itemTop: contentTop(item, scrollTop, viewportTop),
          el,
          elTop: contentTop(el, scrollTop, viewportTop),
          scrollTop,
        };
      }
    }

    return undefined;
  }, [getScrollElement, getContentElement, itemSelector]);

  const captureRef = useRef(capture);
  captureRef.current = capture;

  // Layout effect rather than effect: ResizeObserver callbacks are delivered
  // after layout effects have run for the same frame, so the anchor is re-taken
  // before any resize the range change causes could be measured against it.
  // Taken *after* the caller's own restore, which runs earlier for the same
  // reason — the paginator's scroll restore is a layout effect declared before
  // this hook is called.
  useLayoutEffect(() => {
    anchorRef.current = captureRef.current();
  }, [invalidateKey]);

  useEffect(() => {
    const scrollEl = getScrollElement();
    const contentEl = getContentElement();
    if (!scrollEl || !contentEl) return undefined;

    let frame: number | undefined;

    const recapture = () => {
      anchorRef.current = captureRef.current();
    };

    const onScroll = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        recapture();
      });
    };

    const observer = new ResizeObserver(() => {
      const anchor = anchorRef.current;
      // Nothing recorded yet, or the caller is holding off: still take a
      // reading, so the next resize has one to work from.
      if (!anchor || !enabledRef.current) {
        recapture();
        return;
      }

      // Whether the reader is following the live end is measured here rather
      // than taken from `enabled`, which its owner debounces and which is
      // therefore wrong in both directions for up to a second: it says
      // "following" just after the reader scrolls up (so the previews that land
      // in that second would move them), and "not following" just after they
      // arrive back at the bottom (so a compensation would drag them back off
      // it, and new messages would stop scrolling into view).
      const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      // Strictly less than, so a caller passing 0 is exempting nothing at all —
      // sitting exactly at the bottom still gets its place kept.
      if (distanceFromBottom < bottomFollowRef.current) {
        recapture();
        return;
      }

      // The reader moved between the reading and this resize — a scroll whose
      // event has not been through the animation frame yet, or a programmatic
      // scroll by the caller. Correcting would put back a position they have
      // already left, so take a fresh reading and let the next resize use it.
      if (scrollEl.scrollTop !== anchor.scrollTop) {
        recapture();
        return;
      }

      // The deep anchor can be replaced by the very growth being measured — a
      // loading placeholder swapped for the card that replaces it — so the
      // message it was found in is kept as a coarser fallback rather than
      // giving up on the correction.
      let el: Element | undefined;
      let recorded = 0;
      if (anchor.el.isConnected) {
        el = anchor.el;
        recorded = anchor.elTop;
      } else if (anchor.item.isConnected) {
        el = anchor.item;
        recorded = anchor.itemTop;
      }
      // Both gone (the range moved, the message was redacted). There is nothing
      // to measure against, so leave the scroll alone.
      if (!el) {
        recapture();
        return;
      }

      const viewportTop = scrollEl.getBoundingClientRect().top;
      const delta = contentTop(el, anchor.scrollTop, viewportTop) - recorded;
      if (Math.abs(delta) < MIN_CORRECTION_PX) return;

      scrollEl.scrollTop = anchor.scrollTop + delta;
      // Record where that actually landed — the write is clamped to the
      // scrollable range — so a second resize in the same frame measures
      // against what we just did rather than against what we asked for.
      recapture();
    });

    observer.observe(contentEl);
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    recapture();

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      scrollEl.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [getScrollElement, getContentElement, itemSelector]);
};
