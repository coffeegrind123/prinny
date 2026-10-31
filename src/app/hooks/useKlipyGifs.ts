import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTrendingGifs, GifSource, KlipyGif, searchGifs } from '../utils/klipy';

export type GifFetchStatus = 'idle' | 'loading' | 'success' | 'error';

export type UseKlipyGifs = {
  gifs: KlipyGif[];
  status: GifFetchStatus;
  error: string | undefined;
  hasMore: boolean;
  /** The query whose results are currently displayed. Changes only on a
   *  fresh (non-append) fetch, so it can be used as a dependency to react
   *  to new search results (e.g. resetting scroll position). */
  query: string;
  loadMore: () => void;
  search: (query: string) => void;
  resetSearch: () => void;
};

// A hook that fetches trending GIFs by default and switches to search results
// when a query is provided. Supports cursor-based pagination via loadMore().
export const useKlipyGifs = (source: GifSource): UseKlipyGifs => {
  const [gifs, setGifs] = useState<KlipyGif[]>([]);
  const [status, setStatus] = useState<GifFetchStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [resultQuery, setResultQuery] = useState('');

  const queryRef = useRef<string>('');
  const nextCursorRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  // Read at request time. The provider is chosen in Settings, a separate
  // dialog, so it does not change under an open picker.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const run = useCallback(async (query: string, pos: string | undefined, append: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');

    try {
      const page = query
        ? await searchGifs(sourceRef.current, query, pos, controller.signal)
        : await fetchTrendingGifs(sourceRef.current, pos, controller.signal);
      if (controller.signal.aborted) return;

      nextCursorRef.current = page.next;
      setGifs((prev) => (append ? [...prev, ...page.gifs] : page.gifs));
      setStatus('success');
      setError(undefined);
      // Track the query whose results are now displayed. Only updated on a
      // fresh fetch (not on loadMore append) so callers can detect new result
      // sets, e.g. to reset scroll position.
      if (!append) setResultQuery(query);
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to load GIFs');
    }
  }, []);

  // Load trending GIFs on mount.
  useEffect(() => {
    run('', undefined, false);
    return () => abortRef.current?.abort();
  }, [run]);

  const search = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (trimmed === queryRef.current) return;
      queryRef.current = trimmed;
      nextCursorRef.current = undefined;
      run(trimmed, undefined, false);
    },
    [run],
  );

  const resetSearch = useCallback(() => {
    if (queryRef.current === '') return;
    queryRef.current = '';
    nextCursorRef.current = undefined;
    run('', undefined, false);
  }, [run]);

  const loadMore = useCallback(() => {
    if (status === 'loading') return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    // Stale append results are discarded automatically: any new search or
    // reset aborts the in-flight request via the abort controller in `run`.
    run(queryRef.current, cursor, true);
  }, [status, run]);

  return {
    gifs,
    status,
    error,
    query: resultQuery,
    hasMore: nextCursorRef.current !== undefined,
    loadMore,
    search,
    resetSearch,
  };
};
