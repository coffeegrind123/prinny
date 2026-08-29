import { WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from './utils/atomWithLocalStorage';

const STORE_KEY = 'dismissedUrlPreviews';

/**
 * How many dismissals are remembered.
 *
 * Oldest go first once the cap is reached. A dismissal is worth a few dozen
 * bytes and only ever accumulates, so something has to bound it; a few hundred
 * covers every card anyone is going to scroll back to, and the entries that
 * fall off are ones whose messages left the visible history long ago.
 */
const MAX_ENTRIES = 500;

/**
 * The identity of one dismissed preview: the link, in the message it was sent
 * in.
 *
 * Keyed by event as well as URL because dismissing a card is a judgement about
 * *this* message — the same link posted again later is a new thing to look at,
 * and hiding it too would be a surprise. Cards rendered without an event id
 * (nothing in the timeline does that today) collapse to the URL alone, which
 * keeps the key stable rather than making dismissal silently ineffective.
 */
export const dismissedUrlPreviewKey = (url: string, eventId?: string): string =>
  `${eventId ?? ''}|${url}`;

const sanitize = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Dismissed URL preview cards, oldest first.
 *
 * Persisted, and deliberately so: the X on a card means "I do not want to see
 * this", and a state that only survives until the room is switched away from —
 * which unmounts the whole timeline — makes the button look broken. localStorage
 * rather than account data because it is a per-device viewing preference about
 * cards this client draws, not something another client could act on.
 */
const baseDismissedUrlPreviewsAtom = atomWithLocalStorage<string[]>(
  STORE_KEY,
  (key) => sanitize(getLocalStorageItem<unknown>(key, [])).slice(-MAX_ENTRIES),
  (key, value) => setLocalStorageItem(key, value),
);

export type DismissedUrlPreviewsAction = {
  type: 'PUT';
  key: string;
};

export type DismissedUrlPreviewsAtom = WritableAtom<
  Set<string>,
  [DismissedUrlPreviewsAction],
  undefined
>;

const dismissedSetAtom = atom<Set<string>>((get) => new Set(get(baseDismissedUrlPreviewsAtom)));

export const dismissedUrlPreviewsAtom: DismissedUrlPreviewsAtom = atom<
  Set<string>,
  [DismissedUrlPreviewsAction],
  undefined
>(
  (get) => get(dismissedSetAtom),
  (get, set, action) => {
    if (action.type === 'PUT') {
      const current = get(baseDismissedUrlPreviewsAtom);
      if (current.includes(action.key)) return undefined;
      const next = [...current, action.key];
      set(
        baseDismissedUrlPreviewsAtom,
        next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next,
      );
    }
    return undefined;
  },
);
