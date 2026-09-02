import React, { useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { ContainerColor } from '../../styles/ContainerColor.css';

/**
 * Wraps room content with a left-edge swipe gesture that navigates back
 * to the room list (Discord-style back gesture on mobile).
 *
 * Layered design: this wrapper is `position: absolute` and covers the
 * parent route area, with the page-nav rendered behind it on mobile
 * (see MobileFriendlyPageNav). As the layer translates right during the
 * swipe, the page-nav is revealed underneath — so the user sees "the main
 * view sliding to view" instead of empty space.
 *
 * On commit the wrapper slides fully off-screen right before `navigate(-1)`,
 * making the gesture feel like a real page transition rather than a snap-back.
 */
export function MobileSwipeBack({ children }: { children: React.ReactNode }) {
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const handleSwipe = useCallback(() => {
    navigate(-1 as any);
  }, [navigate]);

  useSwipeGesture(ref, {
    edge: 'left',
    anywhere: true,
    threshold: 80,
    onSwipe: handleSwipe,
    trackElement: ref,
    commitOffset: typeof window !== 'undefined' ? window.innerWidth : 0,
  });

  if (screenSize !== ScreenSize.Mobile) {
    return <>{children}</>;
  }

  // Absolute-positioned layer covers the full parent route area. The
  // explicit Background container color keeps the layer opaque during the
  // gesture so the page-nav behind only shows once we translate away.
  return (
    <div
      ref={ref}
      className={ContainerColor({ variant: 'Background' })}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        minWidth: 0,
        minHeight: 0,
        zIndex: 1,
        touchAction: 'pan-y',
      }}
    >
      {children}
    </div>
  );
}
