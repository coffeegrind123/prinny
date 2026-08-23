import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { toRem } from 'folds';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

/**
 * Draggable layout columns.
 *
 * Sizes are carried through a CSS custom property rather than through React
 * state. A drag emits a pointermove per frame, and routing that through
 * `setState` would re-render the entire column — the room list is a virtualised
 * list of every room you are in, the member drawer a virtualised list of every
 * member — for a one-pixel change. Writing the variable directly keeps the drag
 * on the compositor's schedule instead of React's, and the only render is the
 * single commit when the pointer is released.
 *
 * The unit is design pixels (`toRem`'s input: 1/16rem), matching every other
 * width in this codebase. Storing CSS pixels instead would silently rescale
 * every saved pane the next time the page-zoom setting changed.
 */
export type PaneId = 'navPane' | 'membersPane' | 'threadPane' | 'callChatPane';

export type PaneSpec = {
  defaultSize: number;
  min: number;
  max: number;
  /**
   * Width the pane snaps to when dragged below `collapseAt`, in design pixels.
   *
   * Only the nav column has one. Squeezing a room list down to nothing is a
   * thing people actually want — a rail of avatars, no names — but that is a
   * different layout rather than a narrow version of the same one, so it is a
   * snap to one specific width instead of a continuous range in which the names
   * are half-truncated.
   */
  collapsedSize?: number;
  /** Drag below this and the pane snaps closed. Above it, `min` applies. */
  collapseAt?: number;
};

/**
 * Defaults match the fixed widths these columns had before they were
 * resizable, so an install that never touches a handle looks unchanged.
 *
 * The minimums are the point below which the column stops being usable rather
 * than merely cramped — a room list narrower than ~180 truncates every name to
 * an initial, a member list narrower than ~200 cannot fit an avatar beside a
 * display name and the filter chips wrap to three rows.
 */
export const PANE_SPECS: Record<PaneId, PaneSpec> = {
  // 64 fits a 24px avatar plus the row's own padding either side, which is the
  // whole point of the collapsed rail: the avatar, centred, and nothing else.
  navPane: { defaultSize: 256, min: 180, max: 520, collapsedSize: 64, collapseAt: 140 },
  membersPane: { defaultSize: 266, min: 200, max: 560 },
  threadPane: { defaultSize: 360, min: 280, max: 720 },
  callChatPane: { defaultSize: 456, min: 300, max: 720 },
};

export const paneSizeVar = (paneId: PaneId): string => `--pane-size-${paneId}`;

export const clampPaneSize = (size: number, spec: PaneSpec): number => {
  if (!Number.isFinite(size)) return spec.defaultSize;
  const rounded = Math.round(size);
  // Below the threshold there is no usable width to settle on, so the drag
  // resolves to the collapsed rail rather than to a list of truncated names.
  if (spec.collapsedSize !== undefined && spec.collapseAt !== undefined) {
    if (rounded < spec.collapseAt) return spec.collapsedSize;
  }
  return Math.min(spec.max, Math.max(spec.min, rounded));
};

/** True when a stored size is the pane's collapsed rail rather than a width. */
export const isPaneCollapsed = (size: number, spec: PaneSpec): boolean =>
  spec.collapsedSize !== undefined && size <= spec.collapsedSize;

/**
 * Ratio between the current root font size and the 16px `toRem` assumes.
 *
 * Pointer deltas arrive in CSS pixels but sizes are stored in design pixels,
 * and the two diverge as soon as the page-zoom setting moves the root font
 * size (`ClientNonUIFeatures` sets it to `calc(1em * zoom/100)`). Without this
 * conversion a drag at 125% zoom would move the edge 25% further than the
 * pointer, so the handle would visibly slide out from under the cursor.
 */
const remScale = (): number => {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (!Number.isFinite(rootFontSize) || rootFontSize <= 0) return 1;
  return rootFontSize / 16;
};

const readVar = (paneId: PaneId, spec: PaneSpec): number => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(paneSizeVar(paneId));
  // The property holds a rem length; convert back to design pixels.
  const rem = parseFloat(raw);
  if (!Number.isFinite(rem)) return spec.defaultSize;
  return clampPaneSize(rem * 16, spec);
};

const writeVar = (paneId: PaneId, size: number): void => {
  document.documentElement.style.setProperty(paneSizeVar(paneId), toRem(size));
};

export type ResizablePane = {
  /** Current committed size, in design pixels. */
  size: number;
  spec: PaneSpec;
  /** The pane is at its collapsed rail width — show icons, not labels. */
  collapsed: boolean;
  /**
   * Apply to the column being resized. The viewport cap is a hard safety net,
   * not a preference: these columns are `flex-shrink: 0`, so on a narrow
   * desktop window a pair of generously-sized panes would otherwise push the
   * timeline down to nothing with no way to recover except dragging back.
   */
  style: { width: string; maxWidth: string };
};

/**
 * Reads a pane's persisted width and keeps its CSS variable in sync.
 *
 * Call this from the column itself. The handle uses `useResizeHandle`, which
 * writes the same variable during a drag.
 */
export const useResizablePane = (paneId: PaneId): ResizablePane => {
  const [paneSizes] = useSetting(settingsAtom, 'paneSizes');
  const spec = PANE_SPECS[paneId];
  const size = clampPaneSize(paneSizes?.[paneId] ?? spec.defaultSize, spec);

  // Layout effect, not effect: the variable has to exist before the browser
  // paints, otherwise the column flashes at its fallback width on every mount.
  useLayoutEffect(() => {
    writeVar(paneId, size);
  }, [paneId, size]);

  const style = useMemo(
    () => ({
      width: `var(${paneSizeVar(paneId)}, ${toRem(spec.defaultSize)})`,
      // `max(default, 35vw)` rather than a bare `35vw`, and the difference is
      // not academic: at the desktop breakpoint 35vw is 394px, which is below
      // the call-chat column's own 456px default. A bare cap would therefore
      // have *narrowed* a column nobody had touched, turning a resize feature
      // into a silent layout change on every window under ~1300px. The floor
      // guarantees the cap can only ever restrain growth the user asked for.
      maxWidth: `min(${toRem(spec.max)}, max(${toRem(spec.defaultSize)}, 35vw))`,
    }),
    [paneId, spec.defaultSize, spec.max],
  );

  return { size, spec, style, collapsed: isPaneCollapsed(size, spec) };
};

/** Which side of the handle the resized column sits on. */
export type PaneSide = 'Before' | 'After';

export type ResizeHandleControls = {
  spec: PaneSpec;
  /** Live size for `aria-valuenow`; only refreshed on commit. */
  size: number;
  onPointerDown: (evt: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (evt: ReactKeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  reset: () => void;
};

const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_LARGE = 64;

export const useResizeHandle = (paneId: PaneId, side: PaneSide): ResizeHandleControls => {
  const [paneSizes, setPaneSizes] = useSetting(settingsAtom, 'paneSizes');
  const spec = PANE_SPECS[paneId];
  const size = clampPaneSize(paneSizes?.[paneId] ?? spec.defaultSize, spec);

  // A drag has to be able to read the size it started from without the hook
  // re-running, and the commit has to send the last painted value rather than
  // the value React knew about when the drag began.
  const liveSizeRef = useRef(size);
  liveSizeRef.current = size;

  // A drag mutates document-level state (the cursor and the selection lock) and
  // clears it on pointerup. If this component unmounts mid-drag — switching
  // rooms closes the member drawer, ending a call closes the chat column — that
  // pointerup never arrives, and the whole window is left uncloseably stuck on
  // `col-resize` with text selection disabled.
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      endDragRef.current?.();
    },
    [],
  );

  const commit = useCallback(
    (next: number) => {
      const clamped = clampPaneSize(next, spec);
      writeVar(paneId, clamped);
      setPaneSizes((prev) => {
        // Skip the write (and the re-render, and the localStorage round trip)
        // when a drag ends where it started — clicking a handle is common.
        if (prev?.[paneId] === clamped) return prev;
        return { ...prev, [paneId]: clamped };
      });
    },
    [paneId, spec, setPaneSizes],
  );

  const reset = useCallback(() => commit(spec.defaultSize), [commit, spec.defaultSize]);

  const onPointerDown = useCallback(
    (evt: ReactPointerEvent<HTMLElement>) => {
      // Ignore secondary buttons; a right-click on a separator is not a drag.
      if (evt.pointerType === 'mouse' && evt.button !== 0) return;
      const handle = evt.currentTarget;
      // Stops the drag from selecting text across the whole window, which is
      // what makes a hand-rolled splitter feel broken.
      evt.preventDefault();

      const startX = evt.clientX;
      const startSize = readVar(paneId, spec);
      const scale = remScale();
      const direction = side === 'Before' ? 1 : -1;

      let latest = startSize;

      const handleMove = (moveEvt: PointerEvent) => {
        const deltaDesignPx = ((moveEvt.clientX - startX) * direction) / scale;
        latest = clampPaneSize(startSize + deltaDesignPx, spec);
        // Straight to the DOM — see the note at the top of this file.
        writeVar(paneId, latest);
      };

      const teardown = () => {
        handle.removeEventListener('pointermove', handleMove);
        handle.removeEventListener('pointerup', handleUp);
        handle.removeEventListener('pointercancel', handleUp);
        handle.removeAttribute('data-dragging');
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        endDragRef.current = null;
      };

      function handleUp() {
        teardown();
        commit(latest);
      }

      // Unmount path: undo the document-level state, but do not commit — the
      // column that width belongs to is gone.
      endDragRef.current = teardown;

      // Pointer capture keeps the drag alive when the cursor outruns a 1px
      // handle, crosses an iframe (a widget, a YouTube embed) or leaves the
      // window entirely. Without it the pane sticks mid-drag and only
      // unsticks on the next click.
      try {
        handle.setPointerCapture(evt.pointerId);
      } catch {
        // Capture is best-effort; the listeners below still work without it.
      }
      // preventDefault above suppresses the focus a pointerdown would normally
      // give, so grab it explicitly — otherwise clicking a handle and then
      // pressing an arrow key does nothing, which reads as the keyboard
      // support being broken.
      handle.focus({ preventScroll: true });
      handle.setAttribute('data-dragging', 'true');
      // The cursor must not revert to `text`/`default` while the pointer is
      // over the panes either side of the handle.
      document.body.style.setProperty('cursor', 'col-resize');
      document.body.style.setProperty('user-select', 'none');

      handle.addEventListener('pointermove', handleMove);
      handle.addEventListener('pointerup', handleUp);
      handle.addEventListener('pointercancel', handleUp);
    },
    [paneId, side, spec, commit],
  );

  const onKeyDown = useCallback(
    (evt: ReactKeyboardEvent<HTMLElement>) => {
      const direction = side === 'Before' ? 1 : -1;
      const step = evt.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
      let next: number | undefined;

      // Home/End go all the way, and for a collapsible pane "all the way" is
      // the collapsed rail rather than its minimum usable width.
      const smallest = spec.collapsedSize ?? spec.min;

      if (evt.key === 'ArrowLeft') next = liveSizeRef.current - step * direction;
      else if (evt.key === 'ArrowRight') next = liveSizeRef.current + step * direction;
      else if (evt.key === 'Home') next = side === 'Before' ? smallest : spec.max;
      else if (evt.key === 'End') next = side === 'Before' ? spec.max : smallest;
      else if (evt.key === 'Enter' || evt.key === ' ') next = spec.defaultSize;

      if (next === undefined) return;
      evt.preventDefault();
      commit(next);
    },
    [side, spec, commit],
  );

  return { spec, size, onPointerDown, onKeyDown, onDoubleClick: reset, reset };
};
