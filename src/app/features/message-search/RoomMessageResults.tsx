import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Icon, Icons, Spinner, Text, config } from 'folds';
import { useAtomValue } from 'jotai';
import { Room, SearchOrderBy } from 'matrix-js-sdk';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { mDirectAtom } from '../../state/mDirectList';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { MessageSearchParams, useMessageSearch } from './useMessageSearch';
import { ClientScanProgress, useClientRoomSearch } from './useClientRoomSearch';
import { SearchResultGroup } from './SearchResultGroup';
import {
  SearchProgressBar,
  SearchSkeleton,
  SearchStatus,
  formatCount,
  formatSearchDuration,
  useSearchTimer,
} from './SearchProgress';

// Upper bound on pages the "keep looking" loop below will pull on its own.
//
// Why bounded: this component is rendered from the members drawer against a
// live, debounced search box. Each auto-fetched page of the encrypted-room path
// costs up to MAX_PAGINATIONS_PER_PAGE `/messages` round-trips and decrypts
// every event it walks, so an unbounded loop turns a single typed term into
// hundreds of server requests and tens of thousands of megolm decryptions —
// enough to stall the client and to look like abuse from the homeserver's side.
// Past this point the user drives it with the explicit "Search older messages"
// button, which is unbounded by design because it is a deliberate action.
// Raised from 5 alongside the drop in back-paginations per page (8 -> 2 in
// useClientRoomSearch), so the ceiling on total work is unchanged — the same
// budget is just spent in smaller instalments that each render as they land.
const MAX_AUTO_SEARCH_PAGES = 20;

// Keep auto-pulling until the list looks like a list. Stopping at the first
// match, as this used to, meant one stray hit from recent history froze the
// results there and everything older only appeared if the user happened to
// scroll — which reads as search having finished when it has barely started.
const MIN_RESULTS_BEFORE_PAUSE = 20;

type RoomMessageResultsProps = {
  room: Room;
  /** Debounced search term. Empty/undefined renders nothing. */
  term?: string;
  onOpen: (roomId: string, eventId: string) => void;
  /**
   * Raised whenever the search starts or stops. These results can sit well below
   * the fold, so the drawer uses this to show the same state up at the search
   * box the user is typing into.
   */
  onSearchingChange?: (searching: boolean) => void;
};

/**
 * Headerless message-search results for a single room, rendered inline (e.g. in
 * the members drawer below the people list). Encrypted rooms use the local
 * client-side scan; others use the homeserver `/search`. Both expose the same
 * paginated shape, so a single infinite-query drives either.
 */
export function RoomMessageResults({
  room,
  term,
  onOpen,
  onSearchingChange,
}: RoomMessageResultsProps) {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);

  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const encrypted = room.hasEncryptionStateEvent();

  const msgSearchParams: MessageSearchParams = useMemo(
    () => ({
      term,
      order: SearchOrderBy.Recent,
      rooms: [room.roomId],
    }),
    [term, room.roomId],
  );

  // How far the local scan has walked. Only the encrypted path produces this —
  // a server `/search` reports nothing until it answers — and it is what turns
  // "something is happening" into "3,412 messages read so far".
  const [scanProgress, setScanProgress] = useState<ClientScanProgress>({
    scanned: 0,
    matches: 0,
    exhausted: false,
  });
  const handleScanProgress = useCallback((progress: ClientScanProgress) => {
    setScanProgress(progress);
  }, []);

  const serverSearchMessages = useMessageSearch(msgSearchParams);
  const clientSearchMessages = useClientRoomSearch(room, term, handleScanProgress);
  const searchMessages = encrypted ? clientSearchMessages : serverSearchMessages;

  const { status, data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    enabled: !!term,
    queryKey: ['room-search', room.roomId, encrypted ? 'client' : 'server', term],
    // Consume `signal` so query-core aborts the in-flight scan when this query
    // loses its observer — the term changing (new queryKey) or the drawer
    // closing (unmount). Previously the loop ran to completion in the
    // background for every superseded keystroke.
    queryFn: ({ pageParam, signal }) => searchMessages(pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextToken,
  });

  const groups = useMemo(() => data?.pages.flatMap((result) => result.groups) ?? [], [data]);
  const highlights = useMemo(() => {
    const mixed = data?.pages.flatMap((result) => result.highlights);
    return Array.from(new Set(mixed));
  }, [data]);

  // Each page scans only a bounded slice of history (so typing stays snappy), so
  // a page can legitimately come back empty while older history is still
  // unscanned. Keep pulling pages until a match surfaces or the room is fully
  // walked, rather than prematurely reporting "no messages" — but only up to
  // MAX_AUTO_SEARCH_PAGES, after which the user must ask for more explicitly.
  const autoPagesRef = useRef(0);
  const searchGeneration = `${room.roomId}|${encrypted}|${term ?? ''}`;
  const generationRef = useRef(searchGeneration);
  if (generationRef.current !== searchGeneration) {
    // New term (or room) = fresh budget. Reset in render rather than in an
    // effect: an effect lands a render too late, and the stale exhausted budget
    // would suppress the first page of the new search with nothing to re-trigger
    // it (a ref write does not re-render).
    generationRef.current = searchGeneration;
    autoPagesRef.current = 0;
    // Same reason as the budget: a new term must not inherit the old scan's
    // counts, and an effect would land a render too late — long enough for the
    // status line to claim the previous search's totals for this one.
    setScanProgress({ scanned: 0, matches: 0, exhausted: false });
  }

  const autoBudgetLeft = autoPagesRef.current < MAX_AUTO_SEARCH_PAGES;
  const resultCount = useMemo(
    () => groups.reduce((total, group) => total + group.items.length, 0),
    [groups],
  );
  const stillScanning = resultCount < MIN_RESULTS_BEFORE_PAUSE && hasNextPage && autoBudgetLeft;
  useEffect(() => {
    if (stillScanning && !isFetchingNextPage && status === 'success') {
      autoPagesRef.current += 1;
      fetchNextPage();
    }
  }, [stillScanning, isFetchingNextPage, status, fetchNextPage]);

  // Anything in flight, including a page the user asked for with the button
  // below. `showSkeleton` is narrower: placeholder cards only make sense while
  // the list itself is still filling, not while a later page appends to it.
  const searching = status === 'pending' || stillScanning || isFetchingNextPage;
  const showSkeleton = status === 'pending' || stillScanning;
  const elapsed = useSearchTimer(searching, searchGeneration);

  // While the local scan runs it knows about matches the rendered pages have not
  // caught up with yet, so the live count comes from it rather than from what is
  // on screen. The server path has no such figure and falls back to the pages.
  const foundSoFar = encrypted ? Math.max(scanProgress.matches, resultCount) : resultCount;
  const busyDetail = [
    encrypted && scanProgress.scanned > 0
      ? `${formatCount(scanProgress.scanned)} read`
      : undefined,
    foundSoFar > 0 ? `${formatCount(foundSoFar)} found` : undefined,
    formatSearchDuration(elapsed),
  ]
    .filter((part): part is string => !!part)
    .join(' · ');
  const doneDetail = [
    encrypted && scanProgress.scanned > 0
      ? `${formatCount(scanProgress.scanned)} messages read`
      : undefined,
    `in ${formatSearchDuration(elapsed)}`,
  ]
    .filter((part): part is string => !!part)
    .join(' · ');

  // Kept in a ref so a caller passing an inline closure does not re-fire the
  // notification on every one of its own renders.
  const onSearchingChangeRef = useRef(onSearchingChange);
  useEffect(() => {
    onSearchingChangeRef.current = onSearchingChange;
  }, [onSearchingChange]);
  useEffect(() => {
    onSearchingChangeRef.current?.(searching);
  }, [searching]);
  useEffect(
    () => () => {
      // Unmounting (the term was cleared, or the drawer closed) aborts the scan,
      // so whoever is showing the busy state has to be told it is over.
      onSearchingChangeRef.current?.(false);
    },
    [],
  );

  if (!term) return null;

  return (
    <Box direction="Column" gap="200">
      <Text size="L400">Messages</Text>

      {searching && <SearchProgressBar />}

      {searching && (
        <SearchStatus
          searching
          message={encrypted ? 'Searching this room…' : 'Searching messages…'}
          detail={busyDetail}
        />
      )}

      {!searching && status === 'success' && resultCount > 0 && (
        <SearchStatus
          searching={false}
          message={`Found ${formatCount(resultCount)} ${resultCount === 1 ? 'match' : 'matches'}`}
          detail={doneDetail}
        />
      )}

      {status === 'success' && groups.length === 0 && !searching && (
        <Box
          className={ContainerColor({ variant: 'Surface' })}
          style={{ padding: config.space.S300, borderRadius: config.radii.R400 }}
          alignItems="Start"
          gap="200"
        >
          <Icon style={{ flexShrink: 0 }} size="200" src={Icons.Info} />
          <Box direction="Column" gap="100">
            <Text size="T300">
              {hasNextPage
                ? // Auto-scan budget spent, history not exhausted. Say so instead
                  // of claiming "no match", which would be untrue.
                  'No matches in recent history.'
                : 'No messages match.'}
            </Text>
            {/* The search is over — say what it covered, so an empty list reads
                as a finished answer rather than one that never started. */}
            <Text size="T200" priority="300">
              {doneDetail}
            </Text>
          </Box>
        </Box>
      )}

      {groups.map((group, index) => {
        const groupRoom = mx.getRoom(group.roomId);
        if (!groupRoom) return null;
        return (
          <SearchResultGroup
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            room={groupRoom}
            highlights={highlights}
            items={group.items}
            mediaAutoLoad={mediaAutoLoad}
            urlPreview={urlPreview}
            onOpen={onOpen}
            legacyUsernameColor={legacyUsernameColor || mDirects.has(groupRoom.roomId)}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );
      })}

      {showSkeleton && <SearchSkeleton count={3} minHeight={64} />}

      {hasNextPage && !stillScanning && status === 'success' && (
        <Button
          variant="Secondary"
          fill="Soft"
          size="300"
          radii="400"
          outlined
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
          before={isFetchingNextPage ? <Spinner size="100" variant="Secondary" /> : undefined}
        >
          <Text size="B300">{isFetchingNextPage ? 'Searching…' : 'Search older messages'}</Text>
        </Button>
      )}

      {error && (
        <Box
          className={ContainerColor({ variant: 'Critical' })}
          style={{ padding: config.space.S300, borderRadius: config.radii.R400 }}
          direction="Column"
          gap="200"
        >
          <Text size="L400">{error.name}</Text>
          <Text size="T300">{error.message}</Text>
        </Box>
      )}
    </Box>
  );
}
