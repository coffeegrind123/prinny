import React, { useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import { ContainerColor } from '../styles/ContainerColor.css';
import { ScreenSize, useScreenSizeContext } from '../hooks/useScreenSize';
import { useSelectedRoom } from '../hooks/router/useSelectedRoom';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { mDirectAtom } from '../state/mDirectList';
import { getCanonicalAliasOrRoomId } from '../utils/matrix';
import { getHomeRoomPath, getDirectRoomPath } from './pathUtils';
import { getLastOpenedRoomId, setLastOpenedRoomId } from '../state/lastOpenedRoom';
import { SidebarNav } from './client/SidebarNav';

/**
 * Wraps room/channel nav list with a right-edge swipe gesture.
 * On right-to-left swipe, navigates to the currently selected room
 * (Discord-style: opens the active chat instead of hit-testing touch position).
 * Highlights the selected room during the swipe gesture for visual feedback.
 *
 * Target resolution order:
 *   1. currently-selected room (URL)
 *   2. last-selected room (per-session memory, for back-and-forth toggles)
 *   3. first rendered room link in the nav (DOM-queried at gesture start —
 *      "first" matches the visible list order, which is sorted by activity,
 *      so this is effectively the most-recent conversation)
 *
 * If none of those resolve, the gesture refuses to engage at all — no
 * visual translate-with-finger, no commit — so an empty nav (e.g. Home
 * with no rooms) doesn't have a phantom swipe surface.
 */

export function MobileSwipeOpen({ children }: { children: React.ReactNode }) {
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const ref = useRef<HTMLDivElement>(null);

  const selectedRoomId = useSelectedRoom();
  const mDirects = useAtomValue(mDirectAtom);

  // Remember the last room the user was in. After a back-swipe out, the URL
  // no longer has a roomId, so `selectedRoomId` is undefined and a fresh
  // forward-swipe would have nowhere to navigate to. Persisting the last
  // value (module-scoped, see above) lets the user toggle in/out of the same
  // conversation via swipe even though this component remounts each transition.
  useEffect(() => {
    if (selectedRoomId) setLastOpenedRoomId(selectedRoomId);
  }, [selectedRoomId]);

  // Resolve the target path. selectedRoomId / lastOpenedRoomId are resolved
  // here; the first-rendered-link fallback is deferred to gesture time
  // because it depends on DOM state that only exists after render.
  const resolveTargetPath = useCallback((): string | null => {
    const target = selectedRoomId ?? getLastOpenedRoomId();
    if (target) {
      const room = mx.getRoom(target);
      if (room) {
        const aliasOrId = getCanonicalAliasOrRoomId(mx, target);
        const isDM = Array.from(mDirects.values()).some((roomIds) => roomIds.includes(target));
        return isDM ? getDirectRoomPath(aliasOrId) : getHomeRoomPath(aliasOrId);
      }
    }
    // Fallback: pick the first rendered room link inside the swipe surface.
    // The nav list is sorted by activity (most-recent first), so this is the
    // latest conversation. Room links route to /home/<id>/, /direct/<id>/ or
    // /<space>/<id>/ where the id is a percent-encoded Matrix id (`!` → %21)
    // or alias (`#` → %23) — match those to skip non-room links like
    // create/join/search. We query href because we don't know whether the
    // page is Home, Direct or Space without threading a prop through.
    const el = ref.current;
    if (!el) return null;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const link = links.find((a) => /%21|%23/.test(a.getAttribute('href') ?? ''));
    if (!link) return null;
    // Anchors come with absolute URLs; strip the origin so navigate()
    // treats it as a router path. If parsing fails, fall back to href.
    try {
      const url = new URL(link.href, window.location.origin);
      return url.pathname + url.search + url.hash;
    } catch {
      return link.getAttribute('href');
    }
  }, [selectedRoomId, mx, mDirects]);

  const canSwipe = useCallback(() => resolveTargetPath() !== null, [resolveTargetPath]);

  const handleSwipe = useCallback(() => {
    const path = resolveTargetPath();
    if (!path) return;
    navigate(path);
  }, [resolveTargetPath, navigate]);

  const { isTracking } = useSwipeGesture(ref, {
    edge: 'right',
    anywhere: true,
    threshold: 80,
    onSwipe: handleSwipe,
    canSwipe,
    trackElement: ref,
    commitOffset: typeof window !== 'undefined' ? window.innerWidth : 0,
  });

  if (screenSize !== ScreenSize.Mobile) {
    return <>{children}</>;
  }

  return (
    <>
      {isTracking && (
        <style>{`
          [data-mobile-swipe-open] [aria-selected="true"] {
            background: var(--folds-color-primary-container) !important;
            box-shadow: inset 4px 0 0 var(--folds-color-primary) !important;
          }
        `}</style>
      )}
      <div
        ref={ref}
        // Opaque, for the same reason MobileSwipeBack is. The page background
        // is painted by PageRoot, a parent of this element — so translating
        // this one slid the nav's contents off their own backdrop, leaving the
        // room list see-through with only the individual name chips carrying a
        // background of their own. Painting the layer that actually moves
        // keeps it looking like one solid page sliding across.
        className={ContainerColor({ variant: 'Background' })}
        // Positioned with an explicit z-index so it stacks above
        // MobileRoomBackdrop, which renders the last-opened room at z-index 0
        // for this swipe to uncover. Without `position` this element is static,
        // and a positioned backdrop would paint over it no matter that it comes
        // first in the document.
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          touchAction: 'pan-y',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/*
          The client rail lives INSIDE the swiping layer on these three
          screens, so it slides out with the room list as one piece and the
          chat arrives at full width. Rendered from ClientLayout it sat outside
          the animation entirely: the chat was uncovered beside it and then
          jumped 66px left when the rail unmounted on arrival.
          MobileFriendlyClientNav stands down on mobile here to avoid a second
          copy; Explore and Inbox, which have no swipe surface, still get theirs
          from ClientLayout.
        */}
        <div style={{ flexShrink: 0, display: 'flex' }}>
          <SidebarNav />
        </div>
        <div
          // The tracking highlight is scoped to the list, not the rail, so the
          // rail's own active-tab marker is left alone mid-gesture.
          data-mobile-swipe-open={isTracking ? 'true' : undefined}
          style={{ flexGrow: 1, minWidth: 0, display: 'flex' }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
