import {
  ChangeEventHandler,
  RefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Icon, Icons, Input, Scroll, Spinner, Text, config } from 'folds';
import classNames from 'classnames';
import { useDebounce } from '../../hooks/useDebounce';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import { useKlipyGifs } from '../../hooks/useKlipyGifs';
import { GIF_PROVIDERS, getGifPreview, isGifVideo, resolveGifSource } from '../../utils/klipy';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { useClientConfig } from '../../hooks/useClientConfig';
import { mobileOrTablet } from '../../utils/user-agent';
import * as css from './components/styles.css';
import { preventScrollWithArrowKey } from '../../utils/keyboard';
import {
  FavoriteGif,
  getFavoriteGifId,
  useGifFavorites,
  useToggleGifFavorite,
} from '../../state/gifFavorites';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { decryptFile, downloadEncryptedMedia, mxcUrlToHttp } from '../../utils/matrix';

type GifPickerProps = {
  onGifSelect?: (fav: FavoriteGif) => void;
  requestClose: () => void;
};

type Category = 'favourites' | 'trending';

const getFavoriteTitle = (fav: FavoriteGif): string => {
  if (fav.kind === 'klipy') return fav.gif.title;
  if (fav.kind === 'mxc') return fav.body;
  return fav.title;
};

// Resolve a preview `src` for any favourite kind. Encrypted mxc GIFs are
// downloaded and decrypted into an object URL.
const useFavoriteGifPreview = (
  fav: FavoriteGif,
): { src?: string; aspect?: string; video?: boolean } => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [decryptedSrc, setDecryptedSrc] = useState<string>();

  const encInfo = fav.kind === 'mxc' ? fav.encInfo : undefined;
  const mxc = fav.kind === 'mxc' ? fav.mxc : undefined;
  const mimeType = fav.kind === 'mxc' ? fav.info?.mimetype : undefined;

  useEffect(() => {
    if (!encInfo || !mxc) return undefined;
    const mediaUrl = mxcUrlToHttp(mx, mxc, useAuthentication);
    if (!mediaUrl) return undefined;
    let disposed = false;
    let objectUrl: string | undefined;
    downloadEncryptedMedia(mediaUrl, (encBuf) =>
      decryptFile(encBuf, mimeType ?? 'image/gif', encInfo),
    )
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (disposed) URL.revokeObjectURL(objectUrl);
        else setDecryptedSrc(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mx, useAuthentication, encInfo, mxc, mimeType]);

  if (fav.kind === 'klipy') {
    const preview = getGifPreview(fav.gif);
    const dims = preview?.dims;
    return {
      src: preview?.url,
      aspect: dims?.[0] && dims?.[1] ? `${dims[0]} / ${dims[1]}` : undefined,
      video: preview ? isGifVideo(preview) : false,
    };
  }
  if (fav.kind === 'mxc') {
    const { info } = fav;
    return {
      src: fav.encInfo ? decryptedSrc : (mxcUrlToHttp(mx, fav.mxc, useAuthentication) ?? undefined),
      aspect: info?.w && info?.h ? `${info.w} / ${info.h}` : undefined,
      video: fav.video,
    };
  }
  return { src: fav.videoUrl, video: true };
};

// One IntersectionObserver for the whole grid. Tiles register here and only
// mount their media while near the visible part of the scroller, so a long
// scroll doesn't leave hundreds of looping videos decoding at once.
type VisibilityObserver = {
  observe: (el: Element, onChange: (visible: boolean) => void) => () => void;
};
const GifVisibilityContext = createContext<VisibilityObserver | undefined>(undefined);

const useGifVisibilityObserver = (rootRef: RefObject<HTMLElement | null>): VisibilityObserver => {
  const callbacks = useRef(new Map<Element, (visible: boolean) => void>());
  const observerRef = useRef<IntersectionObserver | undefined>(undefined);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => callbacks.current.get(entry.target)?.(entry.isIntersecting));
      },
      { root: rootRef.current, rootMargin: '200px 0px' },
    );
    observerRef.current = observer;
    callbacks.current.forEach((_, el) => observer.observe(el));
    return () => {
      observer.disconnect();
      observerRef.current = undefined;
    };
  }, [rootRef]);

  return useMemo(
    () => ({
      observe: (el, onChange) => {
        callbacks.current.set(el, onChange);
        observerRef.current?.observe(el);
        return () => {
          callbacks.current.delete(el);
          observerRef.current?.unobserve(el);
        };
      },
    }),
    [],
  );
};

type GifTileVisibility = {
  visible: boolean;
  // Height the tile had when it last scrolled out, so a tile without known
  // dimensions keeps its size instead of shifting the grid.
  hiddenHeight?: number;
};

// `mounted` re-runs registration once a tile whose src was pending renders its element.
const useGifTileVisible = (
  ref: RefObject<HTMLElement | null>,
  mounted: boolean,
): GifTileVisibility => {
  const observer = useContext(GifVisibilityContext);
  const [visibility, setVisibility] = useState<GifTileVisibility>({ visible: false });
  useEffect(() => {
    const el = ref.current;
    if (!observer || !el) {
      return undefined;
    }
    return observer.observe(el, (visible) =>
      setVisibility((current) => {
        if (visible) {
          return { ...current, visible };
        }
        return { visible, hiddenHeight: el.getBoundingClientRect().height || undefined };
      }),
    );
  }, [observer, ref, mounted]);
  return visibility;
};

type GifTileProps = {
  fav: FavoriteGif;
  onClick: (fav: FavoriteGif) => void;
  isFavorited: boolean;
  onToggleFavorite: (fav: FavoriteGif) => void;
};

function GifTile({ fav, onClick, isFavorited, onToggleFavorite }: GifTileProps) {
  const title = getFavoriteTitle(fav);
  const { src, aspect, video } = useFavoriteGifPreview(fav);
  const [hovered, setHovered] = useState(false);
  const tileRef = useRef<HTMLDivElement>(null);
  const { visible, hiddenHeight } = useGifTileVisible(tileRef, !!src);
  if (!src) return null;

  const mediaStyle = aspect ? { aspectRatio: aspect } : undefined;

  let media: React.ReactNode;
  if (!visible) {
    // Keeps the tile's size while its media is unmounted.
    const placeholderStyle = hiddenHeight
      ? { height: hiddenHeight }
      : { aspectRatio: aspect ?? '1 / 1' };
    media = <div className={css.GifTileImg} style={placeholderStyle} />;
  } else if (video) {
    media = (
      <video
        className={css.GifTileImg}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        title={title}
        src={src}
        style={mediaStyle}
      />
    );
  } else {
    media = (
      <img className={css.GifTileImg} loading="lazy" alt={title} src={src} style={mediaStyle} />
    );
  }

  return (
    <Box
      as="div"
      ref={tileRef}
      className={css.GifTile}
      title={title}
      aria-label={title || 'GIF'}
      onClick={() => onClick(fav)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={classNames(
          css.GifFavBtn,
          (isFavorited || hovered) && css.GifFavBtnVisible,
          isFavorited && css.GifFavBtnActive,
        )}
        aria-label={isFavorited ? 'Remove from favourites' : 'Add to favourites'}
        aria-pressed={isFavorited}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(fav);
        }}
      >
        <Icon src={Icons.Star} size="200" filled={isFavorited} />
      </button>
      {media}
    </Box>
  );
}

function GifStatus({ children }: { children: React.ReactNode }) {
  return (
    <Box
      className={css.GifStatus}
      direction="Column"
      alignItems="Center"
      justifyContent="Center"
      gap="200"
    >
      {children}
    </Box>
  );
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'favourites', label: 'Favourites' },
  { id: 'trending', label: 'Trending' },
];

export function GifPicker({ onGifSelect, requestClose }: GifPickerProps) {
  const [gifProvider] = useSetting(settingsAtom, 'gifProvider');
  const { gifApiKeys } = useClientConfig();
  const source = useMemo(
    () => resolveGifSource(gifProvider, gifApiKeys),
    [gifProvider, gifApiKeys],
  );
  const { gifs, status, error, query, hasMore, loadMore, search, resetSearch } =
    useKlipyGifs(source);
  // Tenor and Giphy ask to be named where their search is offered.
  const providerPlaceholder =
    source.id === 'klipy'
      ? 'Search GIFs'
      : `Search ${GIF_PROVIDERS.find((p) => p.id === source.id)?.label ?? 'GIFs'}`;
  const favorites = useGifFavorites();
  const toggleFavorite = useToggleGifFavorite();

  const [category, setCategory] = useState<Category>('trending');
  const [searchTerm, setSearchTerm] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const visibilityObserver = useGifVisibilityObserver(scrollRef);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const runSearch = useDebounce(
    useCallback(
      (term: string) => {
        if (term.trim()) search(term);
        else resetSearch();
      },
      [search, resetSearch],
    ),
    { wait: 350 },
  );

  const handleSearchChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (evt) => {
      const { value } = evt.target;
      setSearchTerm(value);
      runSearch(value);
    },
    [runSearch],
  );

  const handleCategoryChange = useCallback(
    (cat: Category) => {
      setCategory(cat);
      setSearchTerm('');
      if (cat === 'trending') {
        resetSearch();
      }
      // favourites: no search needed, uses local favorites
    },
    [resetSearch],
  );

  const handleGifClick = useCallback(
    (fav: FavoriteGif) => {
      onGifSelect?.(fav);
      requestClose();
    },
    [onGifSelect, requestClose],
  );

  const handleToggleFavorite = useCallback(
    (fav: FavoriteGif) => {
      toggleFavorite(fav);
    },
    [toggleFavorite],
  );

  // Infinite scroll: when the sentinel at the bottom of the grid scrolls into
  // view, fetch the next page.
  useIntersectionObserver(
    useCallback(
      (entries) => {
        if (!sentinelRef.current) return;
        const entry = getIntersectionObserverEntry(sentinelRef.current, entries);
        if (entry?.isIntersecting && hasMore && status !== 'loading') loadMore();
      },
      [hasMore, status, loadMore],
    ),
    useCallback(() => ({ root: scrollRef.current, rootMargin: '300px' }), []),
    useCallback(() => sentinelRef.current, []),
  );

  // Reset scroll to the top whenever a fresh set of results arrives (new search
  // query or reset back to trending). `query` from the hook only changes on a
  // non-append fetch, so paginating with loadMore does not trigger this.
  // useLayoutEffect lands the scroll before paint to avoid a flash of the
  // previous scroll position over the new results.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  const isFavouritesTab = category === 'favourites';
  const favoriteGifs = useMemo(() => favorites.map((f) => f.fav), [favorites]);
  const trendingGifs = useMemo(
    () => gifs.map((gif): FavoriteGif => ({ kind: 'klipy', gif })),
    [gifs],
  );

  const showInitialLoading = !isFavouritesTab && status === 'loading' && gifs.length === 0;
  const showError = !isFavouritesTab && status === 'error' && gifs.length === 0;
  const showEmpty =
    (isFavouritesTab && favoriteGifs.length === 0) ||
    (!isFavouritesTab && status === 'success' && gifs.length === 0);
  const loadingMore = status === 'loading' && gifs.length > 0;

  const displayGifs = isFavouritesTab ? favoriteGifs : trendingGifs;

  return (
    <Box className={css.GifPicker} direction="Column" grow="Yes">
      <Box className={css.GifSearch} direction="Column" shrink="No">
        <Input
          variant="SurfaceVariant"
          size="400"
          placeholder={isFavouritesTab ? 'Search favourites' : providerPlaceholder}
          maxLength={50}
          after={<Icon src={Icons.Search} size="50" />}
          onChange={handleSearchChange}
          autoFocus={!mobileOrTablet()}
          value={searchTerm}
          disabled={isFavouritesTab}
        />
      </Box>
      <Box className={css.GifCategories} shrink="No">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={classNames(
              css.GifCategoryTab,
              category === cat.id && css.GifCategoryTabActive,
            )}
            onClick={() => handleCategoryChange(cat.id)}
          >
            {cat.id === 'favourites' && (
              <Icon src={Icons.Star} size="100" filled={category === cat.id} />
            )}
            <span>{cat.label}</span>
          </button>
        ))}
      </Box>
      <Box className={css.GifScrollWrap} grow="Yes">
        <Scroll
          ref={scrollRef}
          size="400"
          hideTrack
          direction="Vertical"
          onKeyDown={preventScrollWithArrowKey}
        >
          {showInitialLoading && (
            <GifStatus>
              <Spinner variant="Secondary" size="600" />
            </GifStatus>
          )}
          {showError && (
            <GifStatus>
              <Icon src={Icons.Warning} size="600" />
              <Text align="Center" size="T300">
                {error ?? 'Failed to load GIFs'}
              </Text>
            </GifStatus>
          )}
          {showEmpty && (
            <GifStatus>
              {isFavouritesTab ? (
                <>
                  <Icon src={Icons.Star} size="600" />
                  <Text align="Center" size="T300">
                    No favourite GIFs yet. Tap the star on any GIF to save it here.
                  </Text>
                </>
              ) : (
                <>
                  <Icon src={Icons.Search} size="600" />
                  <Text align="Center" size="T300">
                    No GIFs found
                  </Text>
                </>
              )}
            </GifStatus>
          )}
          {displayGifs.length > 0 && (
            <GifVisibilityContext.Provider value={visibilityObserver}>
              <div className={css.GifGrid}>
                {displayGifs.map((fav) => {
                  const id = getFavoriteGifId(fav);
                  return (
                    <GifTile
                      key={id}
                      fav={fav}
                      onClick={handleGifClick}
                      isFavorited={favoriteIds.has(id)}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  );
                })}
              </div>
            </GifVisibilityContext.Provider>
          )}
          {!isFavouritesTab && loadingMore && (
            <Box
              direction="Column"
              alignItems="Center"
              justifyContent="Center"
              style={{ padding: config.space.S300 }}
            >
              <Spinner variant="Secondary" size="400" />
            </Box>
          )}
          {!isFavouritesTab && <div ref={sentinelRef} style={{ height: 1 }} />}
        </Scroll>
      </Box>
    </Box>
  );
}
