import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Scroll,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  config,
} from 'folds';
import { useSetAtom } from 'jotai';
import { MediaItem } from '../../../hooks/useRoomMedia';
import { useRoomMediaContext } from './RoomMediaProvider';
import { useMediaThumbnail } from './useMediaThumbnail';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../../utils/matrix';
import { millisecondsToMinutesAndSeconds } from '../../../utils/common';
import { inSameDay, timeDayMonthYear, today, yesterday } from '../../../utils/time';
import { BlurhashCanvas } from '../../../components/BlurhashCanvas';
import { mediaFeedRequestAtom, roomGalleryOpenAtom } from '../../../state/roomGallery';
import { useScrollContentAnchor } from '../../../hooks/useScrollContentAnchor';
import * as css from './RoomGallery.css';

type MediaFilter = 'all' | 'image' | 'video';

/** Rounds of history a filter with no matches will dig through on its own. */
const AUTO_DIG_ROUNDS = 3;

type GalleryTileProps = {
  item: MediaItem;
  onOpen: (item: MediaItem) => void;
};

function GalleryTile({ item, onOpen }: GalleryTileProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const tileRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  // Tiles fetch nothing until they are close to the viewport. In an encrypted
  // room every still costs a download and a decrypt, so a screenful of tiles
  // must not mean a whole room's worth of them.
  useEffect(() => {
    const el = tileRef.current;
    if (!el || visible) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  const thumbnail = useMediaThumbnail(item, visible);
  // Swapped in by the `<img>`'s own error handler — see `fallbackSrc`.
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => setThumbnailFailed(false), [thumbnail.src]);
  const tileSrc = thumbnailFailed ? thumbnail.fallbackSrc : thumbnail.src;
  // A still that failed with nothing to fall back on — an embed whose provider
  // CDN refused the request is the case that reaches here. Without this the
  // tile kept a `src` that had already failed, so it drew a broken image with
  // no play badge, no warning and nothing to say what happened.
  const tileFailed = thumbnailFailed && !thumbnail.fallbackSrc;

  // An unencrypted video with no sender thumbnail still has a first frame, and
  // `preload="metadata"` is enough to draw it without fetching the file. Only
  // an attachment can be drawn this way: embed video is either an HLS playlist
  // or a cross-origin file that answers 403 without a stripped referrer, and
  // both would draw an empty box instead of a frame.
  const videoPosterUrl =
    (!thumbnail.src || tileFailed) &&
    item.type === 'video' &&
    item.source === 'attachment' &&
    item.mxcUrl &&
    !item.encInfo &&
    visible
      ? (mxcUrlToHttp(mx, item.mxcUrl, useAuthentication) ?? undefined)
      : undefined;

  const duration =
    item.type === 'video' && typeof item.duration === 'number' && item.duration > 0
      ? millisecondsToMinutesAndSeconds(item.duration)
      : undefined;

  const label = `${item.type === 'video' ? 'Video' : 'Photo'}: ${item.filename}`;

  return (
    <button
      type="button"
      className={css.GalleryTile}
      ref={tileRef}
      data-gallery-item=""
      onClick={() => onOpen(item)}
      aria-label={label}
      title={item.caption || item.filename}
    >
      {typeof item.blurHash === 'string' && (!tileSrc || tileFailed) && (
        <BlurhashCanvas
          style={{ width: '100%', height: '100%' }}
          width={32}
          height={32}
          hash={item.blurHash}
          punch={1}
        />
      )}
      {tileSrc && !tileFailed && (
        <img
          className={`${css.GalleryTileMedia}${item.spoiler ? ` ${css.GalleryTileBlur}` : ''}`}
          src={tileSrc}
          alt={item.filename}
          loading="lazy"
          draggable={false}
          onError={() => {
            if (thumbnailFailed) return;
            console.warn('[gallery] still failed to load', {
              eventId: item.eventId,
              source: item.source,
              type: item.type,
              thumbnail: thumbnail.src,
              fallback: thumbnail.fallbackSrc,
            });
            setThumbnailFailed(true);
          }}
          // `pbs.twimg.com` answers 403 to a request carrying a cross-origin
          // referrer. Unlike `<video>`, an `<img>` does honour this attribute,
          // which is why embed stills need no proxy here.
          referrerPolicy={item.source === 'embed' ? 'no-referrer' : undefined}
        />
      )}
      {(!tileSrc || tileFailed) && videoPosterUrl && (
        <video
          className={`${css.GalleryTileMedia}${item.spoiler ? ` ${css.GalleryTileBlur}` : ''}`}
          src={videoPosterUrl}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
        />
      )}
      {!tileSrc && !videoPosterUrl && thumbnail.loading && (
        <Box className={css.GalleryTileCenter}>
          <Spinner variant="Secondary" size="300" />
        </Box>
      )}
      {/* A still that cannot be fetched used to leave a plain grey square,
          indistinguishable from one that had not started loading yet. Say so —
          the tile still opens, and the feed fetches the full attachment by a
          different path that may well work. */}
      {(!tileSrc || tileFailed) &&
        !videoPosterUrl &&
        !thumbnail.loading &&
        (thumbnail.unavailable || tileFailed) && (
          <Box className={css.GalleryTileCenter}>
            <Icon size="300" src={Icons.Warning} style={{ opacity: 0.5 }} />
          </Box>
        )}
      {item.type === 'video' && (
        <Box className={css.GalleryTileCenter}>
          <Icon size="400" src={Icons.Play} filled style={{ color: 'white', opacity: 0.9 }} />
        </Box>
      )}
      {item.spoiler && (
        <Box className={css.GalleryTileCenter}>
          <span className={css.GalleryTilePill}>
            <Icon size="50" src={Icons.EyeBlind} />
            <Text as="span" size="L400">
              Spoiler
            </Text>
          </span>
        </Box>
      )}
      {item.gif && (
        <Box className={css.GalleryTileHeader}>
          <span className={css.GalleryTilePill}>
            <Text as="span" size="L400">
              GIF
            </Text>
          </span>
        </Box>
      )}
      {duration && (
        <Box className={css.GalleryTileFooter} justifyContent="End">
          <span className={css.GalleryTilePill}>
            <Text as="span" size="L400">
              {duration}
            </Text>
          </span>
        </Box>
      )}
    </button>
  );
}

const dayLabel = (ts: number): string => {
  if (today(ts)) return 'Today';
  if (yesterday(ts)) return 'Yesterday';
  return timeDayMonthYear(ts);
};

type DayGroup = {
  ts: number;
  items: MediaItem[];
};

const groupByDay = (items: MediaItem[]): DayGroup[] => {
  const groups: DayGroup[] = [];
  items.forEach((item) => {
    const last = groups[groups.length - 1];
    if (last && inSameDay(last.ts, item.ts)) {
      last.items.push(item);
      return;
    }
    groups.push({ ts: item.ts, items: [item] });
  });
  return groups;
};

/**
 * The conversation as a wall of its own photos and videos, newest first.
 *
 * Takes the place of the timeline rather than opening over it: "turn this
 * conversation into a gallery" is a mode, not a dialog. The composer goes with
 * the timeline — a message box under a wall of photos has no conversation
 * on screen to send into, and the room header's own toggle is the way back.
 *
 * Grouped by day, because the question people actually arrive with is "that
 * photo from Tuesday", and because it gives the scan something to show the
 * moment the first page of history lands rather than after all of it does.
 */
export function RoomGallery() {
  const media = useRoomMediaContext();
  const setGalleryOpen = useSetAtom(roomGalleryOpenAtom);
  const setFeedRequest = useSetAtom(mediaFeedRequestAtom);
  const [filter, setFilter] = useState<MediaFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { items, loading, hasMore, loadMore, scanned } = media;

  /**
   * Whether the grid has been scrolled away from the top.
   *
   * At the very top, newly found media appearing above what is on screen is the
   * point — the gallery is newest-first, so that is where a photo that has just
   * arrived belongs. Anywhere else it is an interruption, and the anchor below
   * takes over.
   */
  const [scrolledDown, setScrolledDown] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const handleScroll = () => setScrolledDown(el.scrollTop > 8);
    handleScroll();
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  /**
   * Keep the reader's place while the grid fills in around them.
   *
   * The gallery does not finish assembling itself when it opens: the history
   * walk keeps finding older media, and — the part that actually moves things —
   * linked posts resolve over the network afterwards and are merged into the
   * list *by timestamp*, so a picture from a tweet somebody posted an hour ago
   * arrives minutes later and is inserted near the TOP, above whatever the
   * reader has scrolled down to. Everything below it slides, and the scroll
   * position appears to jump up on its own, repeatedly, exactly as reported.
   *
   * Same fix as the timeline's, and the same reason for not leaving it to the
   * browser's own scroll anchoring — see `useScrollContentAnchor`. `0` for the
   * bottom exemption: the bottom of the gallery is the oldest media, not a live
   * end, so there is nothing down there worth being dragged toward.
   */
  useScrollContentAnchor(
    useCallback(() => scrollRef.current, []),
    useCallback(() => (scrollRef.current?.firstElementChild as HTMLElement) ?? null, []),
    '[data-gallery-item]',
    scrolledDown,
    filter,
    0,
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      image: items.filter((item) => item.type === 'image').length,
      video: items.filter((item) => item.type === 'video').length,
    }),
    [items],
  );

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.type === filter)),
    [items, filter],
  );

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  // Walk further back as the bottom of the grid comes into view. The sentinel
  // sits inside the scroller, so this is the grid's own end rather than the
  // window's.
  //
  // `loading` is a dependency because a round that finds nothing is the case
  // this has to survive: one `loadMore` reads up to six pages of history, and
  // a room whose photos are further back than that leaves the grid exactly as
  // it was. IntersectionObserver reports *changes* in intersection, so a
  // sentinel that was already visible and stayed visible never fires again —
  // the walk stopped after a single round and the gallery looked like it had
  // found everything there was. Re-arming per round makes it keep going while
  // the end of the grid is still on screen.
  const digRoundsRef = useRef(0);
  const digCountRef = useRef(-1);
  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !hasMore || loading) return undefined;

    // Rounds that found something are free — the grid grew, so the user is
    // being shown progress. Only fruitless ones are counted, and after a few
    // of those the "Load older media" button takes over rather than reading a
    // years-old room to its start behind the user's back.
    if (filtered.length !== digCountRef.current) {
      digCountRef.current = filtered.length;
      digRoundsRef.current = 0;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (digRoundsRef.current >= AUTO_DIG_ROUNDS) return;
        digRoundsRef.current += 1;
        loadMore();
      },
      { root: root ?? null, rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore, filtered.length]);

  /** Asking for more by hand earns another run of automatic rounds. */
  const digMore = useCallback(() => {
    digRoundsRef.current = 0;
    loadMore();
  }, [loadMore]);

  // A filter that hides everything found so far is not an answer — keep
  // reading history until it has something to show. Bounded, because "no
  // videos in this room" is a perfectly ordinary answer and chasing it to the
  // start of a years-old room is not something to do behind the user's back:
  // after a few rounds the "Load older media" button takes over.
  const autoDigRef = useRef(0);
  useEffect(() => {
    autoDigRef.current = 0;
  }, [filter]);
  useEffect(() => {
    if (filter === 'all') return;
    if (filtered.length > 0 || !hasMore || loading) return;
    if (autoDigRef.current >= AUTO_DIG_ROUNDS) return;
    autoDigRef.current += 1;
    loadMore();
  }, [filter, filtered.length, hasMore, loading, loadMore]);

  const openItem = useCallback(
    (item: MediaItem) => {
      setFeedRequest({ roomId: item.roomId, eventId: item.eventId, itemKey: item.key });
    },
    [setFeedRequest],
  );

  const filterChip = (value: MediaFilter, label: string, count: number) => (
    <Chip
      variant={filter === value ? 'Primary' : 'SurfaceVariant'}
      fill="Soft"
      radii="Pill"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
    >
      <Text size="B300">{`${label}${count > 0 ? ` · ${count}` : ''}`}</Text>
    </Chip>
  );

  return (
    <Box grow="Yes" direction="Column">
      <Box className={css.GalleryBar} shrink="No" direction="Column" gap="200">
        <Box alignItems="Center" gap="200">
          <Icon size="100" src={Icons.Photo} />
          <Text size="H4">Gallery</Text>
          <Box grow="Yes" />
          {loading && <Spinner variant="Secondary" size="100" />}
          <TooltipProvider
            position="Bottom"
            align="End"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>Back to conversation</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                size="300"
                radii="300"
                ref={triggerRef}
                onClick={() => setGalleryOpen(false)}
                aria-label="Back to conversation"
              >
                <Icon size="100" src={Icons.Cross} />
              </IconButton>
            )}
          </TooltipProvider>
        </Box>
        <Box alignItems="Center" gap="200" wrap="Wrap">
          {filterChip('all', 'All', counts.all)}
          {filterChip('image', 'Photos', counts.image)}
          {filterChip('video', 'Videos', counts.video)}
        </Box>
      </Box>

      <Box grow="Yes">
        <Scroll
          ref={scrollRef}
          className={css.GalleryScroll}
          size="300"
          hideTrack
          visibility="Hover"
        >
          <Box className={css.GalleryContent} direction="Column" gap="400">
            {groups.map((group) => (
              <Box key={group.ts} direction="Column" gap="200">
                <Box className={css.GalleryDateHeader}>
                  <Text size="L400" priority="300">
                    {dayLabel(group.ts)}
                  </Text>
                </Box>
                <div className={css.GalleryGrid}>
                  {group.items.map((item) => (
                    <GalleryTile key={item.key} item={item} onOpen={openItem} />
                  ))}
                </div>
              </Box>
            ))}

            {filtered.length === 0 && (
              <Box
                direction="Column"
                alignItems="Center"
                justifyContent="Center"
                gap="300"
                style={{ padding: config.space.S700 }}
              >
                {loading ? (
                  <>
                    <Spinner variant="Secondary" size="400" />
                    <Text size="T300" priority="300">
                      {`Reading back through the conversation… ${scanned} messages so far.`}
                    </Text>
                  </>
                ) : (
                  <>
                    <Icon size="600" src={Icons.Photo} />
                    <Text size="T300" priority="300" align="Center">
                      {hasMore
                        ? 'Nothing here yet in the part of the conversation that has been read.'
                        : 'No photos or videos have been sent in this conversation.'}
                    </Text>
                    {hasMore && (
                      <Chip variant="Primary" radii="Pill" onClick={digMore}>
                        <Text size="B300">Look further back</Text>
                      </Chip>
                    )}
                  </>
                )}
              </Box>
            )}

            <Box
              className={css.GallerySentinel}
              direction="Column"
              alignItems="Center"
              justifyContent="Center"
              gap="200"
            >
              <div ref={sentinelRef} />
              {filtered.length > 0 && loading && <Spinner variant="Secondary" size="300" />}
              {filtered.length > 0 && !loading && hasMore && (
                <Chip variant="SurfaceVariant" radii="Pill" outlined onClick={digMore}>
                  <Text size="B300">Load older media</Text>
                </Chip>
              )}
              {filtered.length > 0 && !hasMore && !loading && (
                <Text size="T200" priority="300" align="Center">
                  {`${counts.all} attachment${counts.all === 1 ? '' : 's'} · that is everything`}
                </Text>
              )}
            </Box>
          </Box>
        </Scroll>
      </Box>
    </Box>
  );
}
