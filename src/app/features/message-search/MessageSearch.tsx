import { RefObject, useEffect, useMemo, useRef } from 'react';
import { Text, Box, Icon, Icons, config, Spinner, IconButton, Line } from 'folds';
import { useAtomValue } from 'jotai';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollElement } from '../../hooks/useScrollElement';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SearchOrderBy } from 'matrix-js-sdk';
import { PageHero, PageHeroEmpty, PageHeroSection } from '../../components/page';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { _SearchPathSearchParams } from '../../pages/paths';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { ScrollTopContainer } from '../../components/scroll-top-container';
import { decodeSearchParamValueArray, encodeSearchParamValueArray } from '../../pages/pathUtils';
import { useRooms } from '../../state/hooks/roomList';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { mDirectAtom } from '../../state/mDirectList';
import { MessageSearchParams, useMessageSearch } from './useMessageSearch';
import {
  makeResultFilter,
  parseSearchQuery,
  resolveSearchQuery,
  ResolvedSearch,
  SearchLookup,
} from './searchQuery';
import { getStateEvent } from '../../utils/room';
import { StateEvent } from '../../../types/matrix/room';
import { SearchResultGroup } from './SearchResultGroup';
import { SearchInput } from './SearchInput';
import { SearchFilters } from './SearchFilters';
import { RankOrderNotice, SearchErrorNotice, SearchNotice } from './SearchNotice';
import { VirtualTile } from '../../components/virtualizer';
import {
  SearchProgressBar,
  SearchSkeleton,
  SearchStatus,
  formatCount,
  formatSearchDuration,
  useSearchTimer,
} from './SearchProgress';
import { stripOptionalText } from '../../utils/unsafeText';

// Twenty results a page: up to 200 searched before an all-filtered-out result
// is reported as no results.
const MAX_FILTERED_PAGES = 10;

/** What the search operators could not use, and the one thing /search cannot do. */
function SearchOperatorNotice({ query }: { query: ResolvedSearch }) {
  const problems = [
    ...query.unresolved.map(({ operator, value }) => `${operator}:${value} matched nothing`),
    ...query.invalid.map((token) => `${token.raw} is not understood`),
  ];
  if (query.text && problems.length === 0) return null;

  return (
    <SearchNotice variant="SurfaceVariant">
      {!query.text && (
        <Text size="T300">
          Add a word to search for. Homeservers cannot search by filters alone.
        </Text>
      )}
      {problems.length > 0 && (
        <Text size="T200" priority="300">
          {problems.join('; ')}.
        </Text>
      )}
    </SearchNotice>
  );
}

const useSearchPathSearchParams = (searchParams: URLSearchParams): _SearchPathSearchParams =>
  useMemo(
    () => ({
      global: searchParams.get('global') ?? undefined,
      term: searchParams.get('term') ?? undefined,
      order: searchParams.get('order') ?? undefined,
      rooms: searchParams.get('rooms') ?? undefined,
      senders: searchParams.get('senders') ?? undefined,
    }),
    [searchParams],
  );

type MessageSearchProps = {
  defaultRoomsFilterName: string;
  allowGlobal?: boolean;
  rooms: string[];
  senders?: string[];
  scrollRef: RefObject<HTMLDivElement | null>;
};
export function MessageSearch({
  defaultRoomsFilterName,
  allowGlobal,
  rooms,
  senders,
  scrollRef,
}: MessageSearchProps) {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const allRooms = useRooms(mx, allRoomsAtom, mDirects);
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollTopAnchorRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchPathSearchParams = useSearchPathSearchParams(searchParams);
  const { navigateRoom } = useRoomNavigate();

  const searchParamRooms = useMemo(() => {
    if (searchPathSearchParams.rooms) {
      const joinedRoomIds = decodeSearchParamValueArray(searchPathSearchParams.rooms).filter(
        (rId) => allRooms.includes(rId),
      );
      return joinedRoomIds;
    }
    return undefined;
  }, [allRooms, searchPathSearchParams.rooms]);
  const searchParamsSenders = useMemo(() => {
    if (searchPathSearchParams.senders) {
      return decodeSearchParamValueArray(searchPathSearchParams.senders);
    }
    return undefined;
  }, [searchPathSearchParams.senders]);

  const [searchOperators] = useSetting(settingsAtom, 'searchOperators');
  const isGlobal = searchPathSearchParams.global === 'true';
  const scopeRooms = searchParamRooms ?? (isGlobal ? undefined : rooms);

  // The term split into free text and operators, with names resolved to ids.
  // Undefined when the setting is off or the term has no operators at all.
  const resolvedQuery: ResolvedSearch | undefined = useMemo(() => {
    const { term } = searchPathSearchParams;
    if (!searchOperators || !term) return undefined;
    const parsed = parseSearchQuery(term);
    if (parsed.tokens.every((token) => token.kind === 'text')) return undefined;

    const lookup: SearchLookup = {
      rooms: allRooms.map((roomId) => ({
        roomId,
        name: stripOptionalText(mx.getRoom(roomId)?.name) ?? roomId,
      })),
      users: [],
    };
    // Members are only gathered when a from: or mentions: needs them: on a
    // global search that is every room's member list.
    if (parsed.from.length > 0 || parsed.mentions.length > 0) {
      const seen = new Map<string, string>();
      (scopeRooms ?? allRooms).forEach((roomId) => {
        mx.getRoom(roomId)
          ?.getJoinedMembers()
          .forEach((member) => {
            if (!seen.has(member.userId)) seen.set(member.userId, member.name);
          });
      });
      lookup.users = Array.from(seen, ([userId, name]) => ({ userId, name }));
    }

    return resolveSearchQuery(parsed, lookup, scopeRooms);
  }, [searchOperators, searchPathSearchParams, allRooms, scopeRooms, mx]);

  const msgSearchParams: MessageSearchParams = useMemo(() => {
    if (resolvedQuery) {
      return {
        term: resolvedQuery.text || undefined,
        order: searchPathSearchParams.order ?? SearchOrderBy.Recent,
        // An in: that matched nothing is an empty list, which searches no room
        // rather than every room.
        rooms: resolvedQuery.rooms,
        senders: resolvedQuery.senders ?? searchParamsSenders ?? senders,
        containsUrl: resolvedQuery.has.includes('link'),
      };
    }

    return {
      term: searchPathSearchParams.term,
      order: searchPathSearchParams.order ?? SearchOrderBy.Recent,
      rooms: scopeRooms,
      senders: searchParamsSenders ?? senders,
    };
  }, [resolvedQuery, searchPathSearchParams, scopeRooms, searchParamsSenders, senders]);

  const searchMessages = useMessageSearch(msgSearchParams);

  const { status, data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    enabled: !!msgSearchParams.term,
    queryKey: [
      'search',
      msgSearchParams.term,
      msgSearchParams.order,
      msgSearchParams.rooms,
      msgSearchParams.senders,
      msgSearchParams.containsUrl,
    ],
    queryFn: ({ pageParam, signal }) => searchMessages(pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextToken,
  });

  const resultFilter = useMemo(() => {
    if (!resolvedQuery?.needsClientFilter) return undefined;
    const pinned = new Map<string, ReadonlySet<string>>();
    const getPinned = (roomId: string): ReadonlySet<string> => {
      let ids = pinned.get(roomId);
      if (!ids) {
        const room = mx.getRoom(roomId);
        const content = room && getStateEvent(room, StateEvent.RoomPinnedEvents)?.getContent();
        ids = new Set(Array.isArray(content?.pinned) ? (content.pinned as string[]) : []);
        pinned.set(roomId, ids);
      }
      return ids;
    };
    return makeResultFilter(resolvedQuery, getPinned);
  }, [resolvedQuery, mx]);

  const groups = useMemo(() => {
    const all = data?.pages.flatMap((result) => result.groups) ?? [];
    if (!resultFilter) return all;
    return all
      .map((group) => ({ ...group, items: group.items.filter((item) => resultFilter(item.event)) }))
      .filter((group) => group.items.length > 0);
  }, [data, resultFilter]);
  const highlights = useMemo(() => {
    const mixed = data?.pages.flatMap((result) => result.highlights);
    return Array.from(new Set(mixed));
  }, [data]);
  // every page reports the same server-side total
  const totalCount = data?.pages[0]?.count;

  const rankOrder = msgSearchParams.order === SearchOrderBy.Rank;

  // A homeserver `/search` reports nothing while it runs, so the elapsed clock
  // is the only live signal there is — and it is what separates "still working"
  // from "finished a while ago and this is the answer".
  const searching = status === 'pending' && !!msgSearchParams.term;
  const loadingMore = isFetchingNextPage;
  const searchKey = [
    msgSearchParams.term ?? '',
    msgSearchParams.order ?? '',
    msgSearchParams.rooms?.join(',') ?? '',
    msgSearchParams.senders?.join(',') ?? '',
  ].join('|');
  // Only the first page's search is timed. Later pages are pulled minutes apart
  // as the user scrolls, and folding that into the number would turn "found in
  // 1.2s" into a report of how long they had the panel open.
  const elapsed = useSearchTimer(searching, searchKey);
  const loadedCount = useMemo(
    () => groups.reduce((total, group) => total + group.items.length, 0),
    [groups],
  );
  // Name what is being searched, so the line says which of the filters above is
  // in force rather than just that something is happening.
  const searchScopeName = (() => {
    if (searchParamRooms && searchParamRooms.length > 0) {
      return `${searchParamRooms.length} selected ${searchParamRooms.length === 1 ? 'room' : 'rooms'}`;
    }
    if (searchPathSearchParams.global === 'true') return 'all rooms';
    return defaultRoomsFilterName;
  })();

  const scrollElement = useScrollElement(scrollRef);

  const virtualizer = useVirtualizer({
    count: groups.length,
    // The scroll container is an ANCESTOR of this component, so its ref is
    // still null while these layout effects run. Pre-existing, and masked
    // until now because results only appear after a query is typed and that
    // re-render is what let the virtualizer resolve. See useScrollElement.
    getScrollElement: () => scrollElement,
    // result groups render as full message cards; a low estimate makes the
    // virtualizer believe every group is on screen and fetch every page at once
    estimateSize: () => 240,
    overscan: 1,
  });
  const vItems = virtualizer.getVirtualItems();

  const handleSearch = (term: string) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('term');
      newParams.append('term', term);
      return newParams;
    });
  };
  const handleSearchClear = () => {
    if (searchInputRef.current) {
      searchInputRef.current.value = '';
    }
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('term');
      return newParams;
    });
  };

  const handleSelectedRoomsChange = (selectedRooms?: string[]) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('rooms');
      if (selectedRooms && selectedRooms.length > 0) {
        newParams.append('rooms', encodeSearchParamValueArray(selectedRooms));
      }
      return newParams;
    });
  };
  const handleGlobalChange = (global?: boolean) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('global');
      if (global) {
        newParams.append('global', 'true');
      }
      return newParams;
    });
  };

  const handleOrderChange = (order?: string) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('order');
      if (order) {
        newParams.append('order', order);
      }
      return newParams;
    });
  };

  const lastVItem = vItems[vItems.length - 1];
  const lastVItemIndex: number | undefined = lastVItem?.index;
  const lastGroupIndex = groups.length - 1;
  useEffect(() => {
    if (
      lastGroupIndex > -1 &&
      lastGroupIndex === lastVItemIndex &&
      !isFetchingNextPage &&
      hasNextPage
    ) {
      fetchNextPage();
    }
  }, [lastVItemIndex, lastGroupIndex, fetchNextPage, isFetchingNextPage, hasNextPage]);

  // Client-side filters can empty whole pages, and an empty list has no last
  // row to trigger the next page. Keep paging for a while before saying none.
  const filteredPages = data?.pages.length ?? 0;
  useEffect(() => {
    if (!resultFilter || groups.length > 0 || status !== 'success') return;
    if (!hasNextPage || isFetchingNextPage || filteredPages >= MAX_FILTERED_PAGES) return;
    fetchNextPage();
  }, [
    resultFilter,
    groups.length,
    status,
    hasNextPage,
    isFetchingNextPage,
    filteredPages,
    fetchNextPage,
  ]);

  return (
    <Box direction="Column" gap="700">
      <ScrollTopContainer scrollRef={scrollRef} anchorRef={scrollTopAnchorRef}>
        <IconButton
          onClick={() => virtualizer.scrollToOffset(0)}
          variant="SurfaceVariant"
          radii="Pill"
          outlined
          size="300"
          aria-label="Scroll to Top"
        >
          <Icon src={Icons.ChevronTop} size="300" />
        </IconButton>
      </ScrollTopContainer>
      <Box ref={scrollTopAnchorRef} direction="Column" gap="300">
        <SearchInput
          active={!!msgSearchParams.term}
          loading={searching || loadingMore}
          searchInputRef={searchInputRef}
          onSearch={handleSearch}
          onReset={handleSearchClear}
        />
        <SearchFilters
          defaultRoomsFilterName={defaultRoomsFilterName}
          allowGlobal={allowGlobal}
          roomList={searchPathSearchParams.global === 'true' ? allRooms : rooms}
          selectedRooms={searchParamRooms}
          onSelectedRoomsChange={handleSelectedRoomsChange}
          global={searchPathSearchParams.global === 'true'}
          onGlobalChange={handleGlobalChange}
          order={msgSearchParams.order}
          onOrderChange={handleOrderChange}
        />
      </Box>

      {(searching || loadingMore) && (
        <Box direction="Column" gap="200">
          <SearchProgressBar />
          <SearchStatus
            searching
            message={searching ? `Searching ${searchScopeName}…` : 'Loading more results…'}
            detail={
              searching
                ? formatSearchDuration(elapsed)
                : `${formatCount(loadedCount)} loaded so far`
            }
          />
        </Box>
      )}

      {!msgSearchParams.term && status === 'pending' && (
        <PageHeroEmpty>
          <PageHeroSection>
            <PageHero
              icon={<Icon size="600" src={Icons.Message} />}
              title="Search Messages"
              subTitle="Find helpful messages in your community by searching with related keywords."
            />
          </PageHeroSection>
        </PageHeroEmpty>
      )}

      {resolvedQuery && <SearchOperatorNotice query={resolvedQuery} />}

      {msgSearchParams.term && rankOrder && (
        <RankOrderNotice exhausted={status === 'success' && !hasNextPage} />
      )}

      {msgSearchParams.term && groups.length === 0 && status === 'success' && (
        <SearchNotice>
          <Text size="T300">
            No results found for <b>{`"${msgSearchParams.term}"`}</b>
          </Text>
        </SearchNotice>
      )}

      {((msgSearchParams.term && status === 'pending') ||
        (groups.length > 0 && vItems.length === 0)) && (
        // Pulses only while the search is actually running. When these stand in
        // for results the virtualizer has not measured yet, the search is over
        // and a pulse would claim otherwise.
        <SearchSkeleton count={8} animated={status === 'pending'} />
      )}

      {vItems.length > 0 && (
        <Box direction="Column" gap="300">
          <Box direction="Column" gap="200">
            <Box alignItems="Baseline" gap="200">
              <Text size="H5">{`Results for "${msgSearchParams.term}"`}</Text>
              {typeof totalCount === 'number' && (
                <Text size="T200" priority="300">
                  {/* The spec only promises an approximate count. */}
                  {`~${formatCount(totalCount)} ${totalCount === 1 ? 'match' : 'matches'}`}
                </Text>
              )}
              {!searching && !loadingMore && (
                <Text size="T200" priority="300">
                  {`found in ${formatSearchDuration(elapsed)}`}
                </Text>
              )}
            </Box>
            <Line size="300" variant="Surface" />
          </Box>
          <div
            style={{
              position: 'relative',
              height: virtualizer.getTotalSize(),
            }}
          >
            {vItems.map((vItem) => {
              const group = groups[vItem.index];
              if (!group) return null;
              const groupRoom = mx.getRoom(group.roomId);
              if (!groupRoom) return null;

              return (
                <VirtualTile
                  virtualItem={vItem}
                  style={{ paddingBottom: config.space.S500 }}
                  ref={virtualizer.measureElement}
                  key={group.key}
                >
                  <SearchResultGroup
                    room={groupRoom}
                    highlights={highlights}
                    items={group.items}
                    mediaAutoLoad={mediaAutoLoad}
                    urlPreview={groupRoom.hasEncryptionStateEvent() ? encUrlPreview : urlPreview}
                    onOpen={navigateRoom}
                    legacyUsernameColor={legacyUsernameColor || mDirects.has(groupRoom.roomId)}
                    hour24Clock={hour24Clock}
                    dateFormatString={dateFormatString}
                  />
                </VirtualTile>
              );
            })}
          </div>
          {isFetchingNextPage && (
            <Box justifyContent="Center" alignItems="Center" gap="200">
              <Spinner size="400" variant="Secondary" />
              <Text size="T200" priority="300">
                Loading more results…
              </Text>
            </Box>
          )}
        </Box>
      )}

      {error && <SearchErrorNotice error={error} />}
    </Box>
  );
}
