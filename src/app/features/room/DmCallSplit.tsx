import { PointerEventHandler, ReactNode, useCallback, useRef, useState } from 'react';
import { Box, color, config, toRem } from 'folds';

const STORAGE_KEY = 'prinny.dmCallPaneHeight';
const MIN_CALL_HEIGHT = 200;
const MIN_CHAT_HEIGHT = 160;
const DEFAULT_CALL_HEIGHT = 320;

const loadHeight = (): number => {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored >= MIN_CALL_HEIGHT ? stored : DEFAULT_CALL_HEIGHT;
  } catch {
    return DEFAULT_CALL_HEIGHT;
  }
};

type DmCallSplitProps = {
  call: ReactNode;
  chat: ReactNode;
};

/** DM layout: call on top, chat below, draggable divider between them. */
export function DmCallSplit({ call, chat }: DmCallSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(loadHeight);
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback((value: number) => {
    const total = containerRef.current?.clientHeight ?? Infinity;
    return Math.max(MIN_CALL_HEIGHT, Math.min(value, total - MIN_CHAT_HEIGHT));
  }, []);

  const handlePointerDown: PointerEventHandler<HTMLDivElement> = (evt) => {
    evt.currentTarget.setPointerCapture(evt.pointerId);
    setDragging(true);
  };

  const handlePointerMove: PointerEventHandler<HTMLDivElement> = (evt) => {
    const container = containerRef.current;
    if (!dragging || !container) return;
    setHeight(clamp(evt.clientY - container.getBoundingClientRect().top));
  };

  const handlePointerUp: PointerEventHandler<HTMLDivElement> = (evt) => {
    evt.currentTarget.releasePointerCapture(evt.pointerId);
    setDragging(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(height)));
    } catch {
      // persisting the split position is a convenience only
    }
  };

  return (
    <Box ref={containerRef} grow="Yes" direction="Column" style={{ minHeight: 0 }}>
      <Box
        shrink="No"
        direction="Column"
        // Measured from clientY, so CSS pixels rather than toRem's design pixels.
        style={{ height: `${height}px`, maxHeight: `calc(100% - ${MIN_CHAT_HEIGHT}px)` }}
      >
        <Box grow="Yes" style={{ minHeight: 0 }}>
          {call}
        </Box>
      </Box>
      {/* Pointer capture keeps the drag on the divider even where it crosses
          the call iframe, which floats above the call pane. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize call"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          flexShrink: 0,
          height: toRem(6),
          marginBlock: toRem(-3),
          position: 'relative',
          zIndex: 1,
          cursor: 'row-resize',
          touchAction: 'none',
          background: dragging ? color.Primary.Main : 'transparent',
          borderRadius: config.radii.R300,
        }}
      />
      {/* Positioned so the chat's mobile thread and search overlays cover the
          chat pane, as they cover the room column outside a call. */}
      <Box grow="Yes" direction="Column" style={{ minHeight: 0, position: 'relative' }}>
        {chat}
      </Box>
    </Box>
  );
}
