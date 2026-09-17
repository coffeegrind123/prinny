import {
  ChangeEventHandler,
  FocusEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactNode,
  RefObject,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Icons, Scroll, Spinner } from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { isKeyHotkey } from '../../utils/is-hotkey';
import { Room } from 'matrix-js-sdk';
import { atom, PrimitiveAtom, useAtom, useSetAtom } from 'jotai';
import { defaultRangeExtractor, Range, useVirtualizer } from '@tanstack/react-virtual';
import { IEmoji } from '../../plugins/emoji';
import { useEmojiGroupLabels } from './useEmojiGroupLabels';
import { useEmojiGroupIcons } from './useEmojiGroupIcons';
import { preventScrollWithArrowKey, stopPropagation } from '../../utils/keyboard';
import { useRelevantImagePacks } from '../../hooks/useImagePacks';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRecentEmoji } from '../../hooks/useRecentEmoji';
import { isUserId, mxcUrlToHttp } from '../../utils/matrix';
import { editableActiveElement, targetFromEvent } from '../../utils/dom';
import { useAsyncSearch, UseAsyncSearchOptions } from '../../hooks/useAsyncSearch';
import { useDebounce } from '../../hooks/useDebounce';
import { useThrottle } from '../../hooks/useThrottle';
import { addRecentEmoji } from '../../plugins/recent-emoji';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ImagePack, ImageUsage, PackImageReader } from '../../plugins/custom-emoji';
import { getEmoticonSearchStr } from '../../plugins/utils';
import {
  SearchInput,
  EmojiBoardTabs,
  SidebarStack,
  SidebarDivider,
  Sidebar,
  NoStickerPacks,
  createPreviewDataAtom,
  Preview,
  PreviewData,
  EmojiItem,
  StickerItem,
  CustomEmojiItem,
  ImageGroupIcon,
  GroupIcon,
  getEmojiItemInfo,
  EmojiGroupLabelRow,
  EmojiItemRow,
  EmojiBoardLayout,
} from './components';
import {
  getSupportedEmojiGroups,
  getSupportedEmojis,
  warmEmojiSupport,
} from '../../plugins/emojiSupport';
import { EmojiBoardTab, EmojiItemInfo, EmojiType } from './types';
import { VirtualTile } from '../virtualizer';
import { GifPicker } from './GifPicker';
import { FavoriteGif } from '../../state/gifFavorites';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import * as css from './components/styles.css';

// The mashup tab carries ~233 KB of inlined Twemoji parts. Loading it with the
// board would make every emoji picker pay for a tab most openings never touch,
// so it arrives on first use instead.
const MashupPicker = lazy(() => import('./MashupPicker'));

// Deciding which emoji the platform can draw is ~1,950 canvas measurements, and
// it used to happen inside the click that opened the picker. It is the same
// answer every time, so it is taken here instead — in idle slices, once the
// fonts have settled, as soon as the room UI that owns a picker is loaded.
warmEmojiSupport();

const RECENT_GROUP_ID = 'recent_group';
const SEARCH_GROUP_ID = 'search_group';

type EmojiGroupItem = {
  id: string;
  name: string;
  items: Array<IEmoji | PackImageReader>;
};
type StickerGroupItem = {
  id: string;
  name: string;
  items: Array<PackImageReader>;
};

const useGroups = (
  tab: EmojiBoardTab,
  imagePacks: ImagePack[],
): [EmojiGroupItem[], StickerGroupItem[]] => {
  const mx = useMatrixClient();

  const recentEmojis = useRecentEmoji(mx, 21);
  const labels = useEmojiGroupLabels();

  const emojiGroupItems = useMemo(() => {
    const g: EmojiGroupItem[] = [];
    if (tab !== EmojiBoardTab.Emoji) return g;

    g.push({
      id: RECENT_GROUP_ID,
      name: 'Recent',
      items: recentEmojis,
    });

    imagePacks.forEach((pack) => {
      let label = pack.meta.name;
      if (!label) label = isUserId(pack.id) ? 'Personal Set' : mx.getRoom(pack.id)?.name;

      g.push({
        id: pack.id,
        name: label ?? 'Unknown',
        // `getImages` hands back the pack's own memoized array, so sorting it
        // directly reorders the pack for everyone. `getAvatarUrl` reads
        // `images[0].url`, so that silently changed a pack's sidebar icon to
        // its alphabetically-first emoji the moment a board had been opened
        // once. Sort a copy.
        items: pack
          .getImages(ImageUsage.Emoticon)
          .slice()
          .sort((a, b) => a.shortcode.localeCompare(b.shortcode)),
      });
    });

    // Anything the platform's font cannot draw is dropped rather than offered
    // as an empty box — see plugins/emojiSupport. `emojibase-data` is pinned at
    // Unicode 17 and the fonts trail it, so a handful of the newest emoji
    // (orca, distorted face, fingerprint, face with bags under eyes, …) had no
    // glyph anywhere and were pickable regardless. The filtering is memoized in
    // that module: it is the same answer for every board that ever opens, and
    // recomputing it here cost a measurable chunk of every open.
    getSupportedEmojiGroups().forEach((group) => {
      g.push({
        id: group.id,
        name: labels[group.id],
        items: group.emojis,
      });
    });

    return g;
  }, [mx, recentEmojis, labels, imagePacks, tab]);

  const stickerGroupItems = useMemo(() => {
    const g: StickerGroupItem[] = [];
    if (tab !== EmojiBoardTab.Sticker) return g;

    imagePacks.forEach((pack) => {
      let label = pack.meta.name;
      if (!label) label = isUserId(pack.id) ? 'Personal Set' : mx.getRoom(pack.id)?.name;

      g.push({
        id: pack.id,
        name: label ?? 'Unknown',
        items: pack
          .getImages(ImageUsage.Sticker)
          .slice()
          .sort((a, b) => a.shortcode.localeCompare(b.shortcode)),
      });
    });

    return g;
  }, [mx, imagePacks, tab]);

  return [emojiGroupItems, stickerGroupItems];
};

const useItemRenderer = (tab: EmojiBoardTab) => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const renderItem = (emoji: IEmoji | PackImageReader, index: number, selected: boolean) => {
    if ('unicode' in emoji) {
      return <EmojiItem key={emoji.unicode + index} emoji={emoji} selected={selected} />;
    }
    if (tab === EmojiBoardTab.Sticker) {
      return (
        <StickerItem
          key={emoji.shortcode + index}
          mx={mx}
          useAuthentication={useAuthentication}
          image={emoji}
          selected={selected}
        />
      );
    }
    return (
      <CustomEmojiItem
        key={emoji.shortcode + index}
        mx={mx}
        useAuthentication={useAuthentication}
        image={emoji}
        selected={selected}
      />
    );
  };

  return renderItem;
};

type EmojiSidebarProps = {
  activeGroupAtom: PrimitiveAtom<string | undefined>;
  packs: ImagePack[];
  onScrollToGroup: (groupId: string) => void;
};
function EmojiSidebar({ activeGroupAtom, packs, onScrollToGroup }: EmojiSidebarProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const [activeGroupId, setActiveGroupId] = useAtom(activeGroupAtom);
  const usage = ImageUsage.Emoticon;
  const labels = useEmojiGroupLabels();
  const icons = useEmojiGroupIcons();

  const handleScrollToGroup = (groupId: string) => {
    setActiveGroupId(groupId);
    onScrollToGroup(groupId);
  };

  return (
    <Sidebar>
      <SidebarStack>
        <GroupIcon
          active={activeGroupId === RECENT_GROUP_ID}
          id={RECENT_GROUP_ID}
          label="Recent"
          icon={Icons.RecentClock}
          onClick={handleScrollToGroup}
        />
      </SidebarStack>
      {packs.length > 0 && (
        <SidebarStack>
          <SidebarDivider />
          {packs.map((pack) => {
            let label = pack.meta.name;
            if (!label) label = isUserId(pack.id) ? 'Personal Set' : mx.getRoom(pack.id)?.name;

            const url =
              mxcUrlToHttp(mx, pack.getAvatarUrl(usage) ?? '', useAuthentication) ?? undefined;

            return (
              <ImageGroupIcon
                key={pack.id}
                active={activeGroupId === pack.id}
                id={pack.id}
                label={label ?? 'Unknown Set'}
                url={url}
                onClick={handleScrollToGroup}
              />
            );
          })}
        </SidebarStack>
      )}
      <SidebarStack
        style={{
          position: 'sticky',
          bottom: '-67%',
          zIndex: 1,
        }}
      >
        <SidebarDivider />
        {getSupportedEmojiGroups().map((group) => (
          <GroupIcon
            key={group.id}
            active={activeGroupId === group.id}
            id={group.id}
            label={labels[group.id]}
            icon={icons[group.id]}
            onClick={handleScrollToGroup}
          />
        ))}
      </SidebarStack>
    </Sidebar>
  );
}

type StickerSidebarProps = {
  activeGroupAtom: PrimitiveAtom<string | undefined>;
  packs: ImagePack[];
  onScrollToGroup: (groupId: string) => void;
};
function StickerSidebar({ activeGroupAtom, packs, onScrollToGroup }: StickerSidebarProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const [activeGroupId, setActiveGroupId] = useAtom(activeGroupAtom);
  const usage = ImageUsage.Sticker;

  const handleScrollToGroup = (groupId: string) => {
    setActiveGroupId(groupId);
    onScrollToGroup(groupId);
  };

  return (
    <Sidebar>
      <SidebarStack>
        {packs.map((pack) => {
          let label = pack.meta.name;
          if (!label) label = isUserId(pack.id) ? 'Personal Set' : mx.getRoom(pack.id)?.name;

          const url =
            mxcUrlToHttp(mx, pack.getAvatarUrl(usage) ?? '', useAuthentication) ?? undefined;

          return (
            <ImageGroupIcon
              key={pack.id}
              active={activeGroupId === pack.id}
              id={pack.id}
              label={label ?? 'Unknown Set'}
              url={url}
              onClick={handleScrollToGroup}
            />
          );
        })}
      </SidebarStack>
    </Sidebar>
  );
}

type EmojiGroupHolderProps = {
  contentScrollRef: RefObject<HTMLDivElement | null>;
  previewAtom: PrimitiveAtom<PreviewData | undefined>;
  children?: ReactNode;
  onGroupItemClick: MouseEventHandler;
  /**
   * An item the pointer has moved onto, or that has taken focus. Both move the
   * board's keyboard selection there, so the arrow keys and Enter carry on from
   * wherever the mouse left off.
   */
  onItemPointed?: (element: HTMLButtonElement) => void;
};
function EmojiGroupHolder({
  contentScrollRef,
  previewAtom,
  onGroupItemClick,
  onItemPointed,
  children,
}: EmojiGroupHolderProps) {
  const setPreviewData = useSetAtom(previewAtom);

  const handleEmojiPreview = useCallback(
    (element: HTMLButtonElement) => {
      const emojiInfo = getEmojiItemInfo(element);
      if (!emojiInfo) return;

      setPreviewData({
        key: emojiInfo.data,
        shortcode: emojiInfo.shortcode,
      });
    },
    [setPreviewData],
  );

  const throttleEmojiHover = useThrottle(handleEmojiPreview, {
    wait: 200,
    immediate: true,
  });

  const handleEmojiHover: MouseEventHandler = (evt) => {
    const targetEl = targetFromEvent(evt.nativeEvent, 'button') as HTMLButtonElement | undefined;
    if (!targetEl) return;
    throttleEmojiHover(targetEl);
    onItemPointed?.(targetEl);
  };

  const handleEmojiFocus: FocusEventHandler = (evt) => {
    const targetEl = evt.target as HTMLButtonElement;
    handleEmojiPreview(targetEl);
    if (getEmojiItemInfo(targetEl)) onItemPointed?.(targetEl);
  };

  return (
    <Scroll ref={contentScrollRef} size="400" onKeyDown={preventScrollWithArrowKey} hideTrack>
      <Box
        onClick={onGroupItemClick}
        onMouseMove={handleEmojiHover}
        onFocus={handleEmojiFocus}
        direction="Column"
      >
        {children}
      </Box>
    </Scroll>
  );
}

const DefaultEmojiPreview: PreviewData = { key: '🙂', shortcode: 'slight_smile' };

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  limit: 1000,
  matchOptions: {
    contain: true,
  },
};

/**
 * Four rows of runway rather than two.
 *
 * A row is ~8 buttons, so this is cheap — and it is what keyboard navigation
 * walks on. Arrow keys move focus button by button through the mounted grid;
 * focusing a button below the fold scrolls it into view, which mounts the next
 * rows, which is what lets the whole list be walked. The overscan is the buffer
 * that keeps that chain from running dry at a row boundary.
 */
const VIRTUAL_OVER_SCAN = 4;

/**
 * The board virtualizes ROWS, not groups.
 *
 * It used to virtualize groups, with `estimateSize: () => 40` — an estimate off
 * by two orders of magnitude, since "Smileys & People" alone is 559 emoji and
 * some 3,300px tall. The virtualizer sized the whole list from that estimate,
 * decided every group was on screen, and mounted them all; only once
 * `measureElement` reported the real heights did the range collapse back to one
 * or two. Measured in a headless Chromium with Noto Color Emoji installed, one
 * open mounted 841 emoji buttons where about 60 are visible — and every one of
 * those buttons is a distinct glyph the font has to rasterize, plus, for custom
 * emoji, an `<img>` with a request behind it.
 *
 * A row is a fixed, knowable height, so the estimate is right the first time
 * and the range is right the first time.
 */

/** `toRem(48)` / `toRem(112)` on `EmojiItem` / `StickerItem`, in rem. */
const EMOJI_ITEM_REM = 3;
const STICKER_ITEM_REM = 7;
/** `EmojiItemRow`'s `padding: 0 S200`, both sides together, in rem. */
const ROW_INLINE_PADDING_REM = 1;
/**
 * A heading row before it is measured: S300 + S200 of padding around a pill of
 * roughly one line. Only ever used for the frame before `measureElement`
 * reports the real height.
 */
const LABEL_ROW_ESTIMATE_REM = 2.75;
/**
 * The board's own content width, for the single frame before the scroller
 * exists to be measured. `Base` is 498px wide minus a 54px sidebar.
 */
const FALLBACK_CONTENT_WIDTH = 444;

type RowItem = IEmoji | PackImageReader;

type BoardRow =
  | { kind: 'label'; groupId: string; label: string }
  | { kind: 'items'; groupId: string; items: RowItem[] };
type ItemsRow = Extract<BoardRow, { kind: 'items' }>;

/**
 * The keyboard selection: one item, by its row in `rows` and its column in
 * that row. Rows are what the arrow keys move through — Up and Down go to the
 * items row above or below, Left and Right run along a row and wrap onto the
 * next — so the selection is stored in the grid's own terms rather than as a
 * flat index that would have to be re-derived from `perRow` at every step.
 *
 * It is a selection, not focus. Discord's picker is the model: focus stays in
 * the search box, typing keeps filtering, the highlight moves with the arrows,
 * and Enter picks — the same as clicking. Focus only follows the selection
 * when the user had Tabbed onto an item button before pressing an arrow.
 */
type Selection = { row: number; col: number };
type ArrowDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_KEYS: Record<ArrowDirection, string> = {
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
};

const arrowDirection = (evt: Parameters<KeyboardEventHandler>[0]): ArrowDirection | undefined =>
  (Object.keys(ARROW_KEYS) as ArrowDirection[]).find((dir) => isKeyHotkey(ARROW_KEYS[dir], evt));

const isItemsRow = (row: BoardRow | undefined): row is ItemsRow => row?.kind === 'items';

/** The nearest items row from `from` in `step` direction, or -1 when there is none. */
const findItemsRow = (rows: BoardRow[], from: number, step: 1 | -1): number => {
  for (let i = from + step; i >= 0 && i < rows.length; i += step) {
    if (isItemsRow(rows[i])) return i;
  }
  return -1;
};

const itemInfo = (item: RowItem, tab: EmojiBoardTab): EmojiItemInfo => {
  if ('unicode' in item) {
    return {
      type: EmojiType.Emoji,
      data: item.unicode,
      shortcode: item.shortcode,
      label: item.label,
    };
  }
  return {
    type: tab === EmojiBoardTab.Sticker ? EmojiType.Sticker : EmojiType.CustomEmoji,
    data: item.url,
    shortcode: item.shortcode,
    label: item.body || item.shortcode,
  };
};

const previewOf = (item: RowItem): PreviewData =>
  'unicode' in item
    ? { key: item.unicode, shortcode: item.shortcode }
    : { key: item.url, shortcode: item.shortcode };

/**
 * Where a button sits in the grid, read back from the DOM: its row is the
 * virtual tile's `data-index`, its column its position among the row's
 * buttons. This is how the mouse hands the selection over to the keyboard
 * without every button carrying its coordinates as attributes.
 */
const selectionFromElement = (element: HTMLElement): Selection | undefined => {
  const rowEl = element.closest<HTMLElement>('[data-index]');
  if (!rowEl) return undefined;
  const row = Number(rowEl.dataset.index);
  if (!Number.isInteger(row)) return undefined;
  const col = Array.prototype.indexOf.call(
    rowEl.querySelectorAll('button[data-emoji-type]'),
    element,
  );
  if (col < 0) return undefined;
  return { row, col };
};

const sameSelection = (a: Selection | undefined, b: Selection | undefined): boolean =>
  a === b || (!!a && !!b && a.row === b.row && a.col === b.col);

const rootFontSize = (): number => {
  if (typeof document === 'undefined') return 16;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
};

/**
 * The scroller's inner width, measured rather than assumed.
 *
 * How many items fit on a row decides where the rows fall, so it has to match
 * what the browser would have wrapped to — and the board is not a fixed width
 * (`Base` is `calc(100vw - 2 * S400)` up to 498px, so on a phone it is
 * whatever the phone is). Measured in a layout effect so the first paint is
 * already right, and observed afterwards for orientation changes and window
 * resizes.
 *
 * `token` re-runs the effect when the scroller is a different element —
 * `EmojiGroupHolder` is keyed by tab, so switching tabs replaces it.
 */
const useScrollerWidth = (
  scrollRef: RefObject<HTMLDivElement | null>,
  token: EmojiBoardTab,
): number => {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    setWidth(element.clientWidth);

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef, token]);

  return width;
};

type EmojiBoardProps = {
  tab?: EmojiBoardTab;
  onTabChange?: (tab: EmojiBoardTab) => void;
  imagePackRooms: Room[];
  requestClose: () => void;
  returnFocusOnDeactivate?: boolean;
  onEmojiSelect?: (unicode: string, shortcode: string) => void;
  onCustomEmojiSelect?: (mxc: string, shortcode: string) => void;
  onStickerSelect?: (mxc: string, shortcode: string, label: string) => void;
  onGifSelect?: (fav: FavoriteGif) => void;
  allowTextCustomEmoji?: boolean;
  addToRecentEmoji?: boolean;
  /**
   * Offer the Mashup tab. Opt-in per board rather than global: a mashup is a
   * custom emoji, so it belongs anywhere one can be sent or reacted with, but
   * not in the pickers that choose an icon for something else.
   */
  allowMashup?: boolean;
};

export function EmojiBoard({
  tab = EmojiBoardTab.Emoji,
  onTabChange,
  imagePackRooms,
  requestClose,
  returnFocusOnDeactivate,
  onEmojiSelect,
  onCustomEmojiSelect,
  onStickerSelect,
  onGifSelect,
  allowTextCustomEmoji,
  addToRecentEmoji = true,
  allowMashup,
}: EmojiBoardProps) {
  const mx = useMatrixClient();
  const [gifPicker] = useSetting(settingsAtom, 'gifPicker');
  const [emojiMashup] = useSetting(settingsAtom, 'emojiMashup');

  // Boards opened for a single purpose — the reaction picker, the gallery —
  // pass no `onTabChange` and so have no tab state of their own. They still
  // need somewhere to put the mashup tab, so the board keeps its own when it
  // is not being driven from outside.
  const [uncontrolledTab, setUncontrolledTab] = useState(tab);
  const controlled = onTabChange !== undefined;
  const handleTabChange = controlled ? onTabChange : setUncontrolledTab;

  const tabs = useMemo(() => {
    const list: EmojiBoardTab[] = [];
    if (controlled) list.push(EmojiBoardTab.Sticker);
    list.push(EmojiBoardTab.Emoji);
    if (controlled && gifPicker) list.push(EmojiBoardTab.Gif);
    if (allowMashup && emojiMashup) list.push(EmojiBoardTab.Mashup);
    return list;
  }, [controlled, gifPicker, allowMashup, emojiMashup]);

  // A tab that has been switched off mid-session — or one a caller asks for
  // that this board does not offer — falls back rather than rendering nothing.
  const requestedTab = controlled ? tab : uncontrolledTab;
  const activeTab = tabs.includes(requestedTab) ? requestedTab : EmojiBoardTab.Emoji;

  const emojiTab = activeTab === EmojiBoardTab.Emoji;
  const gifTab = activeTab === EmojiBoardTab.Gif;
  const mashupTab = activeTab === EmojiBoardTab.Mashup;
  const listTab = !gifTab && !mashupTab;
  const usage = emojiTab ? ImageUsage.Emoticon : ImageUsage.Sticker;

  const previewAtom = useMemo(
    () => createPreviewDataAtom(emojiTab ? DefaultEmojiPreview : undefined),
    [emojiTab],
  );
  const setPreviewData = useSetAtom(previewAtom);
  const activeGroupIdAtom = useMemo(() => atom<string | undefined>(undefined), []);
  const setActiveGroupId = useSetAtom(activeGroupIdAtom);
  const imagePacks = useRelevantImagePacks(usage, imagePackRooms);
  const [emojiGroupItems, stickerGroupItems] = useGroups(activeTab, imagePacks);
  const groups = emojiTab ? emojiGroupItems : stickerGroupItems;
  const renderItem = useItemRenderer(activeTab);

  const searchList = useMemo(() => {
    let list: Array<PackImageReader | IEmoji> = [];
    list = list.concat(imagePacks.flatMap((pack) => pack.getImages(usage)));
    // The same filter on the search index: searching "orca" should not turn up
    // a box either.
    if (emojiTab) list = list.concat(getSupportedEmojis());
    return list;
  }, [emojiTab, usage, imagePacks]);

  const [result, search, resetSearch] = useAsyncSearch(
    searchList,
    getEmoticonSearchStr,
    SEARCH_OPTIONS,
  );

  const searchedItems = useMemo(() => result?.items.slice(0, 100), [result]);

  const handleOnChange: ChangeEventHandler<HTMLInputElement> = useDebounce(
    useCallback(
      (evt) => {
        const term = evt.target.value;
        if (term) search(term);
        else resetSearch();
      },
      [search, resetSearch],
    ),
    { wait: 200 },
  );

  const contentScrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollerWidth = useScrollerWidth(contentScrollRef, activeTab);
  const rem = useMemo(rootFontSize, []);
  const itemSize = (emojiTab ? EMOJI_ITEM_REM : STICKER_ITEM_REM) * rem;
  const perRow = useMemo(() => {
    const available = (scrollerWidth || FALLBACK_CONTENT_WIDTH) - ROW_INLINE_PADDING_REM * rem;
    return Math.max(1, Math.floor(available / itemSize));
  }, [scrollerWidth, itemSize, rem]);

  const rows = useMemo(() => {
    const list: BoardRow[] = [];

    const pushGroup = (groupId: string, label: string, items: RowItem[]) => {
      list.push({ kind: 'label', groupId, label });
      for (let i = 0; i < items.length; i += perRow) {
        list.push({ kind: 'items', groupId, items: items.slice(i, i + perRow) });
      }
    };

    // Results sit above the full list, as they did when they were a group of
    // their own outside the virtualizer — the difference is that they are now
    // virtualized too, so a hundred hits cost the same as none.
    if (searchedItems) {
      pushGroup(
        SEARCH_GROUP_ID,
        searchedItems.length ? 'Search Results' : 'No Results found',
        searchedItems,
      );
    }
    groups.forEach((group) => pushGroup(group.id, group.name, group.items));

    return list;
  }, [groups, perRow, searchedItems]);

  /**
   * Which rows are headings, and which heading is currently pinned.
   *
   * A heading used to be sticky for free: it lived inside its group's element,
   * so `position: sticky` had that element as its containing block. Rows have
   * no such element, and the virtualizer positions them absolutely, which
   * `sticky` cannot apply to at all. So the board picks the heading itself —
   * the last one at or above the top of the range — renders that one in flow so
   * it can stick, and keeps it in the rendered range after it has scrolled out
   * of it. Nothing else changes: the same pill, in the same place.
   */
  const labelIndexes = useMemo(
    () =>
      rows.reduce<number[]>((indexes, row, index) => {
        if (row.kind === 'label') indexes.push(index);
        return indexes;
      }, []),
    [rows],
  );
  const stickyIndexRef = useRef(-1);

  const rangeExtractor = useCallback(
    (range: Range) => {
      let sticky = -1;
      for (let i = 0; i < labelIndexes.length; i += 1) {
        if (labelIndexes[i] > range.startIndex) break;
        sticky = labelIndexes[i];
      }
      stickyIndexRef.current = sticky;

      const indexes = new Set(defaultRangeExtractor(range));
      if (sticky >= 0) indexes.add(sticky);
      return Array.from(indexes).sort((a, b) => a - b);
    },
    [labelIndexes],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => contentScrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === 'label' ? LABEL_ROW_ESTIMATE_REM * rem : itemSize,
    overscan: VIRTUAL_OVER_SCAN,
    rangeExtractor,
  });
  // Read after `getVirtualItems()`, which is what runs `rangeExtractor`.
  const vItems = virtualizer.getVirtualItems();
  const stickyIndex = stickyIndexRef.current;

  /**
   * The selection is keyed to the `rows` it was made in. Rows are rebuilt on
   * every keystroke in the search box, on a tab change and on a resize, and a
   * `{ row, col }` from the old grid means nothing in the new one — so rather
   * than an effect that clears it a frame late, a selection made against other
   * rows is simply not the selection any more. What stands in for it is the
   * first search result when there is one: type "thumbs", press Enter, done.
   */
  const [selectionState, setSelectionState] = useState<{
    rows: BoardRow[];
    selection: Selection | undefined;
  }>();
  const firstResult: Selection | undefined =
    searchedItems && searchedItems.length > 0 ? { row: 1, col: 0 } : undefined;
  const selection = selectionState?.rows === rows ? selectionState.selection : firstResult;
  const setSelection = useCallback(
    (next: Selection | undefined) => setSelectionState({ rows, selection: next }),
    [rows],
  );
  const selectedItem: RowItem | undefined = (() => {
    if (!selection) return undefined;
    const row = rows[selection.row];
    return isItemsRow(row) ? row.items[selection.col] : undefined;
  })();
  /**
   * Set when an arrow key was pressed with focus on an item button rather than
   * in the search box: focus is then expected to land on the newly selected
   * button, which may not be mounted until the scroller has caught up.
   */
  const focusSelectionRef = useRef(false);

  const handleTextCustomEmojiSelect = (textEmoji: string) => {
    onCustomEmojiSelect?.(textEmoji, textEmoji);
    requestClose();
  };

  const pickItem = (emojiInfo: EmojiItemInfo, keepOpen: boolean) => {
    if (emojiInfo.type === EmojiType.Emoji) {
      onEmojiSelect?.(emojiInfo.data, emojiInfo.shortcode);
      if (!keepOpen && addToRecentEmoji) {
        addRecentEmoji(mx, emojiInfo.data);
      }
    }
    if (emojiInfo.type === EmojiType.CustomEmoji) {
      onCustomEmojiSelect?.(emojiInfo.data, emojiInfo.shortcode);
    }
    if (emojiInfo.type === EmojiType.Sticker) {
      onStickerSelect?.(emojiInfo.data, emojiInfo.shortcode, emojiInfo.label);
    }
    if (!keepOpen) requestClose();
  };

  const handleGroupItemClick: MouseEventHandler = (evt) => {
    const targetEl = targetFromEvent(evt.nativeEvent, 'button');
    const emojiInfo = targetEl && getEmojiItemInfo(targetEl);
    if (!emojiInfo) return;
    pickItem(emojiInfo, evt.altKey || evt.shiftKey);
  };

  const handleItemPointed = (element: HTMLButtonElement) => {
    const pointed = selectionFromElement(element);
    if (pointed && !sameSelection(pointed, selection)) setSelection(pointed);
  };

  /**
   * The pinned heading covers the top of the scroller, so "in view" starts
   * below it: a row scrolled to the very top would sit under the heading.
   * Every heading is the same height, so the first one's measurement serves
   * for all of them.
   */
  const pinnedHeadingHeight = (): number => {
    const labelIndex = labelIndexes[0];
    const measured =
      labelIndex === undefined ? undefined : virtualizer.measurementsCache[labelIndex]?.size;
    return measured ?? LABEL_ROW_ESTIMATE_REM * rem;
  };

  /** Scroll just far enough that `rowIndex` is fully visible, heading included. */
  const revealRow = (rowIndex: number) => {
    const scrollElement = contentScrollRef.current;
    const measurement = virtualizer.measurementsCache[rowIndex];
    if (!scrollElement || !measurement) return;

    const viewTop = scrollElement.scrollTop;
    const viewHeight = scrollElement.clientHeight;
    const coveredTop = viewTop + pinnedHeadingHeight();

    if (measurement.start < coveredTop) {
      virtualizer.scrollToOffset(measurement.start - pinnedHeadingHeight());
    } else if (measurement.end > viewTop + viewHeight) {
      virtualizer.scrollToOffset(measurement.end - viewHeight);
    }
  };

  /** With nothing selected, an arrow lands on the first item the user can see. */
  const firstVisibleItem = (): Selection | undefined => {
    const coveredTop = (contentScrollRef.current?.scrollTop ?? 0) + pinnedHeadingHeight();
    const visible = vItems.find((vItem) => isItemsRow(rows[vItem.index]) && vItem.end > coveredTop);
    if (visible) return { row: visible.index, col: 0 };
    const first = findItemsRow(rows, -1, 1);
    return first < 0 ? undefined : { row: first, col: 0 };
  };

  const moveSelection = (direction: ArrowDirection): Selection | undefined => {
    if (!selection) return firstVisibleItem();
    const { row, col } = selection;
    const current = rows[row];
    if (!isItemsRow(current)) return firstVisibleItem();

    const lastColumn = (index: number) => (rows[index] as ItemsRow).items.length - 1;

    switch (direction) {
      case 'right': {
        if (col < current.items.length - 1) return { row, col: col + 1 };
        const next = findItemsRow(rows, row, 1);
        return next < 0 ? selection : { row: next, col: 0 };
      }
      case 'left': {
        if (col > 0) return { row, col: col - 1 };
        const prev = findItemsRow(rows, row, -1);
        return prev < 0 ? selection : { row: prev, col: lastColumn(prev) };
      }
      case 'down': {
        const next = findItemsRow(rows, row, 1);
        return next < 0 ? selection : { row: next, col: Math.min(col, lastColumn(next)) };
      }
      case 'up': {
        const prev = findItemsRow(rows, row, -1);
        return prev < 0 ? selection : { row: prev, col: Math.min(col, lastColumn(prev)) };
      }
      default:
        return selection;
    }
  };

  /**
   * Keyboard selection, Discord-style, for the emoji and sticker tabs.
   *
   * Handled here, at the board's root, so it applies with focus in the search
   * box as well as on an item button. It deliberately does not apply with
   * focus on the tab strip or the sidebar: there the arrows keep walking the
   * focusable controls one by one, as they always have (see the FocusTrap's
   * `isKeyForward`/`isKeyBackward`, which stand aside for the same two places
   * this handler claims).
   */
  const handleKeyDown: KeyboardEventHandler = (evt) => {
    if (!listTab) return;
    // Mid-composition (an IME building a character) Enter and the arrows
    // belong to the IME, not to the board.
    if (evt.nativeEvent.isComposing) return;
    const active = document.activeElement;
    const inGrid = !!active && !!contentScrollRef.current?.contains(active);
    const inSearch = !!active && active === searchInputRef.current;
    if (!inGrid && !inSearch) return;

    const direction = arrowDirection(evt);
    if (direction) {
      evt.preventDefault();
      evt.stopPropagation();
      const next = moveSelection(direction);
      if (!next || !isItemsRow(rows[next.row])) return;

      if (inGrid) {
        // The button that has focus may be about to leave the mounted range.
        // Park focus in the search box so it never falls out of the trap, and
        // move it onto the selected button once that has rendered.
        focusSelectionRef.current = true;
        searchInputRef.current?.focus({ preventScroll: true });
      }
      setSelection(next);
      revealRow(next.row);
      const item = (rows[next.row] as ItemsRow).items[next.col];
      if (item) setPreviewData(previewOf(item));
      return;
    }

    if (isKeyHotkey(['enter', 'shift+enter', 'alt+enter'], evt)) {
      // A focused button already turns Enter into a click on its own; that
      // click goes through `handleGroupItemClick` like any other.
      if (inGrid) return;

      if (selectedItem) {
        evt.preventDefault();
        evt.stopPropagation();
        pickItem(itemInfo(selectedItem, activeTab), evt.altKey || evt.shiftKey);
        return;
      }

      // Nothing to select but something typed: Enter does what the "React"
      // chip beside the search box does, so a text reaction needs no mouse.
      const text = searchInputRef.current?.value.trim();
      if (allowTextCustomEmoji && text && searchedItems?.length === 0) {
        evt.preventDefault();
        evt.stopPropagation();
        handleTextCustomEmojiSelect(text);
      }
    }
  };

  // Focus follows the selection only when the arrows were pressed on an item
  // button. The selected button may mount a frame later than the selection is
  // made — after the scroller has moved — so this re-runs as rows mount.
  useEffect(() => {
    if (!focusSelectionRef.current || !selection) return;
    const selected = contentScrollRef.current?.querySelector<HTMLElement>(
      'button[data-selected="true"]',
    );
    if (!selected) return;
    focusSelectionRef.current = false;
    selected.focus({ preventScroll: true });
  }, [selection, vItems]);

  // The first search result is selected as soon as it exists — so the preview
  // shows what Enter would pick, as it does for a hovered or arrowed-to item.
  useEffect(() => {
    const first = searchedItems?.[0];
    if (first) setPreviewData(previewOf(first));
  }, [searchedItems, setPreviewData]);

  // A mashup is a custom emoji that did not exist until a moment ago. Once
  // uploaded it is an `mxc://` like any other, so it goes out through the same
  // callback — which is what lets a caller react with one, or insert one in
  // the composer, without knowing mashups exist.
  const handleMashupSelect = useCallback(
    (mxc: string, shortcode: string) => {
      onCustomEmojiSelect?.(mxc, shortcode);
    },
    [onCustomEmojiSelect],
  );

  const handleScrollToGroup = (groupId: string) => {
    const rowIndex = rows.findIndex((row) => row.kind === 'label' && row.groupId === groupId);
    if (rowIndex < 0) return;
    virtualizer.scrollToIndex(rowIndex, { align: 'start' });
  };

  // sync active sidebar tab with scroll — the pinned heading IS the group the
  // reader is in, so there is nothing left to work out here.
  useEffect(() => {
    const stickyRow = stickyIndex >= 0 ? rows[stickyIndex] : undefined;
    setActiveGroupId(stickyRow?.groupId);
  }, [vItems, rows, stickyIndex, setActiveGroupId]);

  // reset scroll position on search
  useEffect(() => {
    const scrollElement = contentScrollRef.current;
    if (scrollElement) {
      scrollElement.scrollTo({ top: 0 });
    }
  }, [result?.query]);

  // reset scroll position on tab change
  useEffect(() => {
    if (groups.length > 0) {
      virtualizer.scrollToIndex(0, { align: 'start' });
    }
  }, [activeTab, virtualizer, groups]);

  let sidebar: ReactNode;
  if (!listTab) {
    sidebar = undefined;
  } else if (emojiTab) {
    sidebar = (
      <EmojiSidebar
        activeGroupAtom={activeGroupIdAtom}
        packs={imagePacks}
        onScrollToGroup={handleScrollToGroup}
      />
    );
  } else {
    sidebar = (
      <StickerSidebar
        activeGroupAtom={activeGroupIdAtom}
        packs={imagePacks}
        onScrollToGroup={handleScrollToGroup}
      />
    );
  }

  return (
    <FocusTrap
      focusTrapOptions={{
        returnFocusOnDeactivate,
        initialFocus: false,
        onDeactivate: requestClose,
        clickOutsideDeactivates: true,
        allowOutsideClick: true,
        // Arrows walk the focusable controls — except in the search box and
        // on the grid, where `handleKeyDown` moves the selection instead. The
        // trap reads these at creation, so they consult the DOM, not state.
        isKeyForward: (evt: KeyboardEvent) =>
          !editableActiveElement() &&
          !contentScrollRef.current?.contains(document.activeElement) &&
          isKeyHotkey(['arrowdown', 'arrowright'], evt),
        isKeyBackward: (evt: KeyboardEvent) =>
          !editableActiveElement() &&
          !contentScrollRef.current?.contains(document.activeElement) &&
          isKeyHotkey(['arrowup', 'arrowleft'], evt),
        escapeDeactivates: stopPropagation,
      }}
    >
      <EmojiBoardLayout
        onKeyDown={handleKeyDown}
        header={
          <Box direction="Column" gap="200">
            {tabs.length > 1 && (
              <EmojiBoardTabs tab={activeTab} tabs={tabs} onTabChange={handleTabChange} />
            )}
            {listTab && (
              <SearchInput
                key={activeTab}
                inputRef={searchInputRef}
                query={result?.query}
                onChange={handleOnChange}
                allowTextCustomEmoji={allowTextCustomEmoji}
                onTextCustomEmojiSelect={handleTextCustomEmojiSelect}
              />
            )}
          </Box>
        }
        sidebar={sidebar}
      >
        {gifTab && <GifPicker onGifSelect={onGifSelect} requestClose={requestClose} />}
        {mashupTab && (
          <Suspense
            fallback={
              <Box grow="Yes" alignItems="Center" justifyContent="Center">
                <Spinner variant="Secondary" size="400" />
              </Box>
            }
          >
            <MashupPicker
              previewAtom={previewAtom}
              onMashupSelect={handleMashupSelect}
              requestClose={requestClose}
            />
          </Suspense>
        )}
        {listTab && (
          <Box grow="Yes">
            <EmojiGroupHolder
              key={activeTab}
              contentScrollRef={contentScrollRef}
              previewAtom={previewAtom}
              onGroupItemClick={handleGroupItemClick}
              onItemPointed={handleItemPointed}
            >
              <div
                style={{
                  position: 'relative',
                  height: virtualizer.getTotalSize(),
                }}
              >
                {vItems.map((vItem) => {
                  const row = rows[vItem.index];
                  if (!row) return null;

                  const content =
                    row.kind === 'label' ? (
                      <EmojiGroupLabelRow id={row.groupId} label={row.label} />
                    ) : (
                      <EmojiItemRow groupId={row.groupId}>
                        {row.items.map((item, col) =>
                          renderItem(
                            item,
                            col,
                            selection?.row === vItem.index && selection.col === col,
                          ),
                        )}
                      </EmojiItemRow>
                    );

                  // The pinned heading is the one row left in normal flow, so
                  // that `position: sticky` has a scrollport to stick to.
                  if (vItem.index === stickyIndex) {
                    return (
                      <div
                        key={vItem.key}
                        className={css.StickyRow}
                        data-index={vItem.index}
                        ref={virtualizer.measureElement}
                      >
                        {content}
                      </div>
                    );
                  }

                  return (
                    <VirtualTile
                      virtualItem={vItem}
                      ref={virtualizer.measureElement}
                      key={vItem.key}
                    >
                      {content}
                    </VirtualTile>
                  );
                })}
              </div>
              {activeTab === EmojiBoardTab.Sticker && groups.length === 0 && <NoStickerPacks />}
            </EmojiGroupHolder>
          </Box>
        )}
        {!gifTab && <Preview previewAtom={previewAtom} />}
      </EmojiBoardLayout>
    </FocusTrap>
  );
}
