import { EventTimeline, EventType, IEventWithRoomId, MatrixEvent, Room } from 'matrix-js-sdk';
import { useCallback, useEffect, useRef } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ResultGroup, ResultItem, SearchResult } from './useMessageSearch';

// Server-side `/search` can't read end-to-end encrypted messages because the
// homeserver only holds ciphertext. For encrypted rooms we instead search the
// timeline the client has locally — back-paginating (and decrypting) history
// until we've scanned the room or hit a safety cap. Results are cached per term
// so the infinite-query pages slice an already-built list.

const PAGE_SIZE = 20;
// Hard ceiling on how many events a single search will walk. Individual chats
// (the common case) are far smaller; this only guards pathological rooms from
// hanging the UI with thousands of back-pagination round-trips.
const MAX_SCANNED_EVENTS = 50000;
// Events fetched per back-pagination request.
const PAGINATION_LIMIT = 100;
// Back-pagination round-trips a single page() call will make before returning
// what it has. This keeps live, as-you-type search responsive: each keystroke's
// first page resolves from synced history plus a few hundred older events rather
// than walking the whole room. Deeper history is reached by fetching more pages
// (the cursor resumes pagination), so coverage still grows on demand.
//
// Deliberately small. A page returns only once it finishes, so this number is
// also how long the user stares at an empty list before ANY match appears — at
// 8 a sparse term meant eight sequential round-trips of silence. Returning
// early and letting the caller pull more pages turns the same total work into
// results that arrive a few at a time. RoomMessageResults raises its own page
// budget to match, so overall coverage is unchanged.
const MAX_PAGINATIONS_PER_PAGE = 2;

/**
 * Live progress of a client-side scan, reported as it walks history. The UI has
 * nothing else to show for this path: the scan is a local loop over decrypted
 * events, so there is no request whose duration stands in for "still working".
 */
export type ClientScanProgress = {
  /** Events walked so far. */
  scanned: number;
  /** Matches found so far — may exceed what the current page renders. */
  matches: number;
  /** True once history is fully walked (or the scan cap is hit). */
  exhausted: boolean;
};

type ClientSearchCursor = {
  term: string;
  /** Live timeline we walk backwards; pagination state lives on it. */
  timeline: EventTimeline;
  /** Event ids already scanned, so re-scans after pagination skip them. */
  seen: Set<string>;
  /** All matches found so far, newest-first. Pages slice into this. */
  matches: MatrixEvent[];
  /** Total events walked — bounded by {@link MAX_SCANNED_EVENTS}. */
  scanned: number;
  /** True once history is fully walked (or the cap is hit): no more to find. */
  exhausted: boolean;
};

const toEventWithRoomId = (mEvent: MatrixEvent, roomId: string): IEventWithRoomId =>
  ({
    ...mEvent.getEffectiveEvent(),
    room_id: roomId,
  }) as IEventWithRoomId;

const groupMatches = (events: MatrixEvent[], roomId: string): ResultGroup[] => {
  if (events.length === 0) return [];

  const items: ResultItem[] = events.map((mEvent, index) => ({
    // Higher rank = more relevant. Preserve newest-first ordering.
    rank: events.length - index,
    event: toEventWithRoomId(mEvent, roomId),
    context: {
      events_before: [],
      events_after: [],
      profile_info: {},
    },
  }));

  // Same key scheme as the server-side path: roomId plus the first event id.
  // A client-side search covers one room, so there is only ever one group and
  // no interleaving to disambiguate — but the key still has to be stable across
  // re-renders, and unique if these groups are ever rendered beside others.
  return [{ key: `${roomId}/${items[0]?.event.event_id ?? 'empty'}`, roomId, items }];
};

const eventMatches = (mEvent: MatrixEvent, needle: string, words: string[]): boolean => {
  if (mEvent.getType() !== EventType.RoomMessage) return false;
  if (mEvent.isRedacted()) return false;

  const content = mEvent.getContent();
  const body = typeof content.body === 'string' ? content.body.toLowerCase() : '';
  if (!body) return false;

  // Phrase match first, then fall back to all-words-present (AND) so multi-word
  // queries behave like the server's term search rather than requiring the exact
  // adjacency.
  if (body.includes(needle)) return true;
  return words.length > 1 && words.every((word) => body.includes(word));
};

/**
 * Client-side message search for a single (typically encrypted) room.
 * Mirrors the shape returned by {@link useMessageSearch} so the drawer's message results can use
 * either interchangeably behind the same infinite-query.
 *
 * `onProgress` is called as the scan walks, so the caller can say how far it has
 * got rather than only that it is busy.
 */
export const useClientRoomSearch = (
  room: Room,
  term?: string,
  onProgress?: (progress: ClientScanProgress) => void,
) => {
  const mx = useMatrixClient();
  const cursorRef = useRef<ClientSearchCursor | null>(null);

  // Held in a ref, and deliberately NOT a dependency of the callback below: the
  // caller's handler is usually an inline closure over its own state, so
  // depending on it would give this search function a new identity on every
  // render of the caller — including the renders its own progress reports cause.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // `signal` is TanStack Query's per-fetch AbortSignal — see useMessageSearch
  // for why it must be consumed. It matters far more here: this scan issues
  // real `/messages` round-trips and decrypts every event it walks, so an
  // orphaned loop from a superseded keystroke burns the user's bandwidth and
  // CPU (and the homeserver's) for as long as it takes to finish. Checked
  // before every pagination and before every decrypt batch.
  return useCallback(
    async (nextBatch?: string, signal?: AbortSignal): Promise<SearchResult> => {
      const needle = term?.toLowerCase().trim();
      if (!term || !needle) {
        return { highlights: [], groups: [] };
      }
      const words = needle.split(/\s+/).filter(Boolean);

      // (Re)initialize the scan cursor when the term changes. The cursor carries
      // pagination progress across pages so we never rescan covered history.
      if (!cursorRef.current || cursorRef.current.term !== term) {
        cursorRef.current = {
          term,
          timeline: room.getLiveTimeline(),
          seen: new Set<string>(),
          matches: [],
          scanned: 0,
          exhausted: false,
        };
      }
      const cursor = cursorRef.current;
      const { timeline, seen } = cursor;

      // Cancelled scans stay silent: a superseded term must not keep writing
      // its counts over the ones the current search is reporting.
      const reportProgress = () => {
        if (signal?.aborted) return;
        onProgressRef.current?.({
          scanned: cursor.scanned,
          matches: cursor.matches.length,
          exhausted: cursor.exhausted,
        });
      };

      const scanLoaded = async () => {
        if (signal?.aborted) return;
        const events = timeline.getEvents();
        // Collect not-yet-seen events newest -> oldest so `matches` stays in
        // Recent order. Newly back-paginated (older) events are prepended to the
        // timeline; the `seen` set keeps us from rescanning covered history.
        const fresh: MatrixEvent[] = [];
        for (let i = events.length - 1; i >= 0; i -= 1) {
          const mEvent = events[i];
          const id = mEvent.getId();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          cursor.scanned += 1;
          fresh.push(mEvent);
        }

        // Decrypt freshly back-paginated encrypted events in parallel rather
        // than serially awaiting each — decryption is the per-event cost that
        // made search feel slow. Already-decrypted events (the common case, e.g.
        // synced recent history) report their clear type and are skipped.
        await Promise.all(
          fresh.map((mEvent) =>
            mEvent.isEncrypted() &&
            mEvent.getType() === EventType.RoomMessageEncrypted &&
            !mEvent.isDecryptionFailure()
              ? mx.decryptEventIfNeeded(mEvent).catch(() => undefined)
              : undefined,
          ),
        );

        for (let i = 0; i < fresh.length; i += 1) {
          if (eventMatches(fresh[i], needle, words)) {
            cursor.matches.push(fresh[i]);
          }
        }

        reportProgress();
      };

      const offset = nextBatch ? parseInt(nextBatch, 10) || 0 : 0;
      // We only need enough matches to fill the page being requested. Crucially
      // we DON'T exhaust the whole room before returning — we paginate just far
      // enough to satisfy this page, then stop. Dense terms return almost
      // instantly; further pages resume back-pagination on demand as the user
      // scrolls.
      const target = offset + PAGE_SIZE;

      // Pick up anything already loaded (the synced recent history) first.
      await scanLoaded();

      let paginations = 0;
      while (
        !signal?.aborted &&
        cursor.matches.length < target &&
        !cursor.exhausted &&
        cursor.scanned < MAX_SCANNED_EVENTS &&
        paginations < MAX_PAGINATIONS_PER_PAGE
      ) {
        const token = timeline.getPaginationToken(EventTimeline.BACKWARDS);
        if (!token) {
          cursor.exhausted = true;
          break;
        }
        paginations += 1;
        let ok: boolean;
        try {
          // eslint-disable-next-line no-await-in-loop
          ok = await mx.paginateEventTimeline(timeline, {
            backwards: true,
            limit: PAGINATION_LIMIT,
          });
        } catch {
          ok = false;
        }
        if (!ok) {
          cursor.exhausted = true;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        await scanLoaded();
      }
      if (cursor.scanned >= MAX_SCANNED_EVENTS) cursor.exhausted = true;
      reportProgress();

      // Cancelled mid-scan: reject rather than return a half-built page, so no
      // partial result for a stale term can land in the cache.
      if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');

      const pageEvents = cursor.matches.slice(offset, offset + PAGE_SIZE);
      const nextOffset = offset + pageEvents.length;
      // Offer another page when we already hold further matches, or when there's
      // still unscanned history that could contain some. When the room is fully
      // exhausted and we've returned everything, drop the token so the UI can
      // settle on a final "no results"/end state instead of spinning.
      const hasMore = cursor.matches.length > nextOffset || !cursor.exhausted;

      return {
        highlights: words,
        groups: groupMatches(pageEvents, room.roomId),
        nextToken: hasMore ? String(nextOffset) : undefined,
      };
    },
    [mx, room, term],
  );
};
