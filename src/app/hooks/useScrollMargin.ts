import { RefObject, useLayoutEffect, useState } from 'react';

/**
 * Distance from the top of a scroll container to the top of one list inside it.
 *
 * A virtualizer measures the scroll offset against the container it scrolls,
 * not against the element the items are drawn in. That is invisible while a
 * page has one list — the two tops coincide, near enough — and wrong the moment
 * it has two: the second list still believes it starts at scroll offset zero,
 * so it renders the wrong window and leaves a blank band where its rows should
 * be. `scrollMargin` is what tells it otherwise, and this measures the value.
 *
 * The offset moves whenever anything above the list changes height, which
 * includes the first list measuring its own rows, so it is observed rather than
 * read once on mount.
 */
export const useScrollMargin = (
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
): number => {
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    let frame = 0;
    let resizeObserver: ResizeObserver | undefined;
    let mutationObserver: MutationObserver | undefined;

    const setup = () => {
      const scrollElement = scrollRef.current;
      const contentElement = contentRef.current;

      if (!scrollElement || !contentElement) {
        // NOT a "nothing to do" case, which is what returning here used to
        // treat it as. The scroll container is an ANCESTOR of this list, and
        // React attaches a host element's ref only after the layout effects of
        // everything below it have already run — so on the first mount this
        // hook cannot see it yet, every time, by construction. The deps are ref
        // objects and never change, so bailing out meant the effect never ran
        // again and the margin stayed 0 for the life of the list.
        frame = requestAnimationFrame(setup);
        return;
      }

      const measure = () => {
        const offset =
          contentElement.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top +
          scrollElement.scrollTop;

        // Sub-pixel churn would re-render on every scroll frame for nothing.
        setScrollMargin((current) => (Math.abs(current - offset) < 0.5 ? current : offset));
      };

      measure();

      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(scrollElement);

      // What moves this list is anything above it growing, and that is the
      // scroll container's children rather than the container itself, whose
      // size is fixed by the viewport. Observing each child covers the first
      // list measuring its own rows; re-deriving them on a childList change
      // covers the child being replaced rather than resized, which observing
      // `firstElementChild` once could not — it would sit watching a detached
      // node and never fire again.
      const observeChildren = () => {
        Array.from(scrollElement.children).forEach((child) => resizeObserver?.observe(child));
      };
      observeChildren();

      mutationObserver = new MutationObserver(() => {
        observeChildren();
        measure();
      });
      mutationObserver.observe(scrollElement, { childList: true });
    };

    setup();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [scrollRef, contentRef]);

  return scrollMargin;
};
