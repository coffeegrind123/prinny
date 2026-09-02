import { RefObject, useEffect, useState } from 'react';

/**
 * Resolve a scroll container ref owned by an ANCESTOR into state.
 *
 * React attaches a host element's ref during the layout phase, walking the tree
 * children-first — so a component rendered *inside* the scroll container runs
 * its own layout effects while that container's ref is still null. Reading
 * `scrollRef.current` there is not "not ready yet", it is null by construction,
 * every time.
 *
 * That matters because `useVirtualizer` resolves its scroll element in a layout
 * effect and only re-resolves on a later render. Handed a null it sets up no
 * observers and reports no items, so the list renders empty and stays that way
 * until something unrelated happens to re-render it. On a busy account that is
 * fast enough to look like nothing is wrong; on a quiet one — a client that has
 * just finished its first sync and gone idle — nothing re-renders and the list
 * simply stays blank until the page is reloaded.
 *
 * A passive effect runs after the whole commit, refs included, so reading it
 * there gets the element and the resulting state change re-renders the consumer
 * with it.
 *
 * Running once per mount is enough, and that is not an assumption about how
 * often the container changes: the consumer is rendered INSIDE the container,
 * so it cannot outlive one being swapped for another. When the owner switches
 * between an empty state and a list, both go together and this mounts again
 * with it. The identity guard is belt-and-braces for a re-run that returns the
 * same node.
 */
export const useScrollElement = <T extends HTMLElement>(
  scrollRef: RefObject<T | null>,
): T | null => {
  const [element, setElement] = useState<T | null>(() => scrollRef.current);

  useEffect(() => {
    setElement((current) => (current === scrollRef.current ? current : scrollRef.current));
  }, [scrollRef]);

  return element;
};
