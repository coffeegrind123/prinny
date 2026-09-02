import { useEffect, useRef, useCallback, useState } from 'react';

interface SwipeGestureOptions {
  /** Which edge defines the inward direction */
  edge: 'left' | 'right';
  /**
   * How close to the edge (in px) the touch must start. Ignored when
   * `anywhere` is true.
   */
  edgeWidth?: number;
  /**
   * Allow the touch to start anywhere on the element instead of only at
   * the named edge. On Android, the system back-gesture region (typically
   * 24–48dp from each side in gesture-nav mode) consumes edge touches
   * before they reach the WebView — set this to true to keep the gesture
   * usable. Horizontal-dominance + threshold still gate false positives.
   */
  anywhere?: boolean;
  /** Minimum horizontal distance to trigger the swipe */
  threshold?: number;
  /** Called when a valid swipe completes. direction: 1 = inward from edge, -1 = outward toward edge */
  onSwipe: (info: { startY: number; direction: number }) => void;
  /**
   * Consulted at touchstart. If it returns false, the gesture never
   * engages — no visual feedback, no commit. Use this to prevent the
   * screen from following the finger when there is nowhere to navigate
   * to (e.g. an empty room list).
   */
  canSwipe?: () => boolean;
  /**
   * Optional element to translateX with the finger during the gesture so
   * the screen visibly follows the touch. Resets via a short CSS transition
   * if the swipe is cancelled. We mutate transform directly (ref-based)
   * rather than via React state to avoid re-rendering on every touchmove.
   */
  trackElement?: React.RefObject<HTMLElement | null>;
  /**
   * Slide-off distance in pixels on a committed swipe. When set (>0), the
   * tracked element animates fully off-screen in the inward direction
   * before navigation, instead of snapping back to 0. This makes the
   * gesture feel like a real page transition.
   */
  commitOffset?: number;
}

/**
 * Detects edge-swipe gestures on a ref'd element.
 *
 * Left edge: swipe right = inward (direction 1), swipe left = outward (-1)
 * Right edge: swipe left = inward (direction 1), swipe right = outward (-1)
 */
export function useSwipeGesture(
  ref: React.RefObject<HTMLElement | null>,
  {
    edge,
    edgeWidth = 32,
    anywhere = false,
    threshold = 80,
    onSwipe,
    canSwipe,
    trackElement,
    commitOffset = 0,
  }: SwipeGestureOptions,
): { isTracking: boolean } {
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  // Lock horizontal vs vertical intent on the first decisive move so a
  // scroll-then-swipe never gets reinterpreted as a swipe mid-gesture.
  const lockedAxis = useRef<'h' | 'v' | null>(null);
  const [isTracking, setIsTracking] = useState(false);

  // Apply translateX to the tracked element (inline-style mutation, no
  // React re-render per frame). `transitioning` toggles a smooth ease on
  // release while we settle back to 0.
  const setTrackTransform = useCallback(
    (px: number, transitioning: boolean) => {
      const el = trackElement?.current;
      if (!el) return;
      el.style.transition = transitioning ? 'transform 180ms ease-out' : 'none';
      el.style.transform = px === 0 ? '' : `translate3d(${px}px, 0, 0)`;
      el.style.willChange = px === 0 && !transitioning ? '' : 'transform';
    },
    [trackElement],
  );

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const atEdge = anywhere
        ? true
        : edge === 'left'
          ? touch.clientX <= edgeWidth
          : touch.clientX >= window.innerWidth - edgeWidth;

      if (atEdge) {
        // canSwipe guard: refuse to engage if the caller can't service
        // the resulting navigation (e.g. empty list, no fallback target).
        // This keeps the screen from following the finger when there is
        // nothing to slide to.
        if (canSwipe && !canSwipe()) return;
        startX.current = touch.clientX;
        startY.current = touch.clientY;
        tracking.current = true;
        lockedAxis.current = null;
        setIsTracking(true);
      }
    },
    [edge, edgeWidth, anywhere, canSwipe],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!tracking.current || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // Lock axis after ~10px of motion so a tap-then-scroll doesn't
      // jiggle the swipe surface.
      if (lockedAxis.current === null && (adx > 10 || ady > 10)) {
        lockedAxis.current = adx > ady ? 'h' : 'v';
      }
      if (lockedAxis.current !== 'h') return;

      // Only follow the finger in the inward direction (left-edge → right,
      // right-edge → left). Outward dragging stays at 0 — no visual
      // feedback for the wrong direction.
      const inwardDx = edge === 'left' ? Math.max(0, dx) : Math.min(0, dx);
      // Light rubber-band beyond the threshold so the screen doesn't slide
      // arbitrarily far on a fast flick.
      const max = 220;
      const clamped =
        Math.abs(inwardDx) <= max
          ? inwardDx
          : Math.sign(inwardDx) * (max + Math.log2(Math.abs(inwardDx) - max + 1) * 8);
      setTrackTransform(clamped, false);
    },
    [edge, setTrackTransform],
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!tracking.current) return;
      tracking.current = false;
      setIsTracking(false);

      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX.current;
      const dy = Math.abs(touch.clientY - startY.current);

      const horizDominant = Math.abs(dx) >= dy * 1.5;
      const passedThreshold = Math.abs(dx) >= threshold;
      const direction =
        edge === 'left'
          ? dx > 0
            ? 1
            : -1 // left edge: right = inward
          : dx < 0
            ? 1
            : -1; // right edge: left = inward

      const committed = horizDominant && passedThreshold && direction > 0;

      if (committed && commitOffset > 0) {
        // Slide the foreground fully off-screen in the inward direction
        // before navigating. The new route mounts at translateX(0), so
        // the user perceives the old view leaving and the new view
        // taking its place, rather than a snap-back.
        const offTarget = edge === 'left' ? commitOffset : -commitOffset;
        setTrackTransform(offTarget, true);
      } else {
        // Cancelled or no commitOffset configured — settle back to 0.
        setTrackTransform(0, true);
      }

      if (committed) {
        onSwipe({ startY: startY.current, direction });
      }
    },
    [edge, threshold, onSwipe, setTrackTransform, commitOffset],
  );

  const handleTouchCancel = useCallback(() => {
    if (!tracking.current) return;
    tracking.current = false;
    setIsTracking(false);
    setTrackTransform(0, true);
  }, [setTrackTransform]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [ref, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]);

  return { isTracking };
}
