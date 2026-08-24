import React, { MouseEventHandler, useCallback, useEffect, useRef, useState } from 'react';
import FileSaver from '../../utils/save-file';
import classNames from 'classnames';
import { Box, Chip, Icon, IconButton, Icons, Menu, MenuItem, Text, as, config } from 'folds';
import * as css from './ImageViewer.css';
import { useZoom } from '../../hooks/useZoom';
import { usePan } from '../../hooks/usePan';
import { downloadMedia } from '../../utils/matrix';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { webUrlOrUndefined } from '../../utils/safeUrl';

/** Roughly the menu's footprint, used only to keep it inside the viewport. */
const MENU_WIDTH = 200;
const MENU_HEIGHT = 148;
const MENU_EDGE_GAP = 8;

/**
 * Whether this browser can be handed an image on the clipboard.
 *
 * Needs a secure context for `navigator.clipboard`, so it is absent on a
 * plain-HTTP deployment rather than merely failing when used.
 */
const clipboardCanHoldImages = (): boolean =>
  typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

/**
 * `ClipboardItem` is only dependable for PNG, so anything else is redrawn as
 * one. An animated GIF is flattened to its first frame by this — a still of the
 * right picture beats a copy that silently does nothing.
 */
const asPngBlob = async (blob: Blob): Promise<Blob> => {
  if (blob.type === 'image/png') return blob;

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d canvas context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('Could not convert the image');
  return png;
};

export type ImageViewerProps = {
  alt: string;
  src: string;
  requestClose: () => void;
  // Preferred target for the "open in browser" button. When the viewer is
  // showing an embed preview image, `src` is the raw media URL (often a
  // blob: or pbs.twimg.com URL the browser can't usefully open in a tab),
  // so we open the original page/post instead.
  externalUrl?: string;
};

export const ImageViewer = as<'div', ImageViewerProps>(
  ({ className, alt, src, requestClose, externalUrl, ...props }, ref) => {
    const { zoom, zoomIn, zoomOut, setZoom } = useZoom(0.2);
    const { pan, onMouseDown } = usePan(zoom !== 1);
    const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
    // Pinch-zoom state for touch devices. Tracks the initial distance and
    // zoom level at the start of a two-finger gesture so subsequent
    // touchmove deltas scale relative to the gesture origin.
    const pinchRef = React.useRef<{ baseDist: number; baseZoom: number } | null>(null);

    const [menuPos, setMenuPos] = useState<{ x: number; y: number }>();
    const [error, setError] = useState<string>();
    const menuRef = useRef<HTMLDivElement>(null);

    const closeMenu = useCallback(() => setMenuPos(undefined), []);

    /**
     * Dismissal, while the menu is open.
     *
     * `mousedown` rather than `click`, so the menu is gone before a click
     * lands anywhere else — but only for a press that started outside it.
     * Closing on a press *inside* would unmount the item between mousedown and
     * click, and the action would never run.
     */
    useEffect(() => {
      if (!menuPos) return undefined;

      const onPointerDown = (evt: MouseEvent) => {
        if (menuRef.current?.contains(evt.target as Node)) return;
        closeMenu();
      };
      const onKeyDown = (evt: KeyboardEvent) => {
        if (evt.key !== 'Escape') return;
        // The focus trap around the viewer registered its own capture-phase
        // Escape handler first, so it wins and the whole viewer closes. That
        // is a fine outcome; this only makes sure the menu never outlives it.
        closeMenu();
      };

      document.addEventListener('mousedown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      return () => {
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
      };
    }, [menuPos, closeMenu]);

    const reportFailure = (err: unknown, fallback: string) =>
      setError(err instanceof Error ? err.message : fallback);

    /**
     * Fetches the bytes the way the rest of the app does.
     *
     * Not the same thing as what the browser would do on its own. For
     * unencrypted media the `<img src>` is an authenticated
     * `/_matrix/client/v1/media/download/…` URL that renders only because the
     * service worker attaches the access token — and a download started by the
     * browser does not pass through the worker, so it comes back 401. This
     * carries the header itself, which is why the Download button has always
     * worked where a plain "Save image as…" would not.
     */
    const fetchImage = useCallback(() => downloadMedia(src), [src]);

    const handleDownload = async () => {
      closeMenu();
      setError(undefined);
      try {
        FileSaver.saveAs(await fetchImage(), alt);
      } catch (err) {
        // Previously this rejection went nowhere: the download simply never
        // happened and nothing said so.
        reportFailure(err, 'Could not download this image.');
      }
    };

    const handleCopy = async () => {
      closeMenu();
      setError(undefined);
      try {
        const png = await asPngBlob(await fetchImage());
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      } catch (err) {
        reportFailure(err, 'Could not copy this image.');
      }
    };

    /**
     * Right-clicking the image opens our own menu rather than the browser's.
     *
     * The browser's menu looks right and its "Save image as…" does not work
     * here — see {@link fetchImage} — and in the desktop shell a `blob:` image
     * has no meaning to the OS either. Both of those are silent failures, so
     * the gesture is served by a menu whose actions go through the paths that
     * do work, and which can name the file properly.
     */
    const handleContextMenu: MouseEventHandler<HTMLImageElement> = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      setMenuPos({
        // Kept inside the viewport by hand. The menu is rendered inline rather
        // than through folds' PopOut, which portals to `document.body` — and
        // the viewer sits inside a focus trap with `clickOutsideDeactivates`,
        // so a portaled menu counts as outside and clicking "Save image"
        // would close the viewer out from under the click.
        x: Math.min(evt.clientX, window.innerWidth - MENU_WIDTH - MENU_EDGE_GAP),
        y: Math.min(evt.clientY, window.innerHeight - MENU_HEIGHT - MENU_EDGE_GAP),
      });
    };

    // Click/tap zoom is desktop-only. On mobile the same gesture
    // double-fires (tap → click → tap) and the explicit +/- buttons +
    // pinch handle zoom intent without ambiguity.
    const handleImageClick = isMobile ? undefined : () => setZoom(zoom === 1 ? 2 : 1);

    const handleTouchStart = (e: React.TouchEvent<HTMLImageElement>) => {
      if (e.touches.length !== 2) return;
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      pinchRef.current = { baseDist: Math.hypot(dx, dy), baseZoom: zoom };
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLImageElement>) => {
      if (!pinchRef.current || e.touches.length !== 2) return;
      // preventDefault to suppress the browser's native page pinch-zoom.
      e.preventDefault();
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchRef.current.baseDist;
      const next = pinchRef.current.baseZoom * ratio;
      // Mirror useZoom's bounds (min 0.1, max 5).
      setZoom(Math.max(0.1, Math.min(5, next)));
    };

    const handleTouchEnd = (e: React.TouchEvent<HTMLImageElement>) => {
      if (e.touches.length < 2) {
        pinchRef.current = null;
      }
    };

    const handleOpenExternal = () => {
      // `externalUrl` is a link lifted out of message content, so it is chosen
      // by the sender: reject anything that is not http(s) before it reaches
      // window.open, which the native shell forwards to the OS URL opener.
      // `src` stays as-is — it is our own blob:/media URL, never remote input.
      window.open(webUrlOrUndefined(externalUrl) ?? src, '_blank', 'noopener,noreferrer');
    };

    const zoomCursor = zoom === 1 ? 'zoom-in' : 'zoom-out';

    // On mobile, both control rows go full-width — controls (zoom/download)
    // stay at the top, title/back/external moves to the bottom for thumb
    // reachability.
    const navBarPos = isMobile
      ? {
          position: 'fixed' as const,
          bottom: `calc(${config.space.S200} + env(safe-area-inset-bottom))`,
          left: `calc(${config.space.S200} + env(safe-area-inset-left))`,
          right: `calc(${config.space.S200} + env(safe-area-inset-right))`,
          zIndex: 2,
        }
      : {
          position: 'fixed' as const,
          top: `calc(${config.space.S200} + env(safe-area-inset-top))`,
          left: `calc(${config.space.S200} + env(safe-area-inset-left))`,
          zIndex: 2,
        };
    const toolsBarPos = isMobile
      ? {
          position: 'fixed' as const,
          top: `calc(${config.space.S200} + env(safe-area-inset-top))`,
          left: `calc(${config.space.S200} + env(safe-area-inset-left))`,
          right: `calc(${config.space.S200} + env(safe-area-inset-right))`,
          zIndex: 2,
        }
      : {
          position: 'fixed' as const,
          top: `calc(${config.space.S200} + env(safe-area-inset-top))`,
          right: `calc(${config.space.S200} + env(safe-area-inset-right))`,
          zIndex: 2,
        };

    return (
      <Box className={classNames(css.ImageViewer, className)} {...props} ref={ref}>
        <Box style={navBarPos}>
          <Box
            className={css.ImageViewerBarGroup}
            alignItems="Center"
            gap="100"
            justifyContent={isMobile ? 'SpaceBetween' : undefined}
            style={isMobile ? { width: '100%' } : { maxWidth: 'min(60vw, 600px)' }}
          >
            <IconButton size="300" radii="300" onClick={requestClose}>
              <Icon size="50" src={Icons.ArrowLeft} />
            </IconButton>
            <Text size="T300" truncate style={{ flex: 1, minWidth: 0 }}>
              {alt}
            </Text>
            <IconButton
              size="300"
              radii="300"
              onClick={handleOpenExternal}
              aria-label="Open in browser"
            >
              <Icon size="50" src={Icons.External} />
            </IconButton>
          </Box>
        </Box>
        <Box style={toolsBarPos}>
          <Box
            className={css.ImageViewerBarGroup}
            alignItems="Center"
            gap="100"
            justifyContent={isMobile ? 'SpaceBetween' : undefined}
            style={isMobile ? { width: '100%' } : undefined}
          >
            <IconButton
              variant={zoom < 1 ? 'Success' : 'SurfaceVariant'}
              outlined={zoom < 1}
              size="300"
              radii="Pill"
              onClick={zoomOut}
              aria-label="Zoom Out"
            >
              <Icon size="50" src={Icons.Minus} />
            </IconButton>
            <Chip variant="SurfaceVariant" radii="Pill" onClick={handleImageClick}>
              <Text size="B300">{Math.round(zoom * 100)}%</Text>
            </Chip>
            <IconButton
              variant={zoom > 1 ? 'Success' : 'SurfaceVariant'}
              outlined={zoom > 1}
              size="300"
              radii="Pill"
              onClick={zoomIn}
              aria-label="Zoom In"
            >
              <Icon size="50" src={Icons.Plus} />
            </IconButton>
            <Chip
              variant="Primary"
              onClick={handleDownload}
              radii="300"
              before={<Icon size="50" src={Icons.Download} />}
            >
              <Text size="B300">Download</Text>
            </Chip>
          </Box>
        </Box>
        {menuPos && (
          <div
            ref={menuRef}
            className={css.ImageViewerMenu}
            style={{
              left: Math.max(MENU_EDGE_GAP, menuPos.x),
              top: Math.max(MENU_EDGE_GAP, menuPos.y),
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" className={css.ImageViewerMenuGroup}>
                <MenuItem
                  size="300"
                  radii="300"
                  after={<Icon size="100" src={Icons.Download} />}
                  onClick={handleDownload}
                >
                  <Text as="span" size="T300" truncate>
                    Save image
                  </Text>
                </MenuItem>
                {clipboardCanHoldImages() && (
                  <MenuItem
                    size="300"
                    radii="300"
                    after={<Icon size="100" src={Icons.Photo} />}
                    onClick={handleCopy}
                  >
                    <Text as="span" size="T300" truncate>
                      Copy image
                    </Text>
                  </MenuItem>
                )}
                <MenuItem
                  size="300"
                  radii="300"
                  after={<Icon size="100" src={Icons.External} />}
                  onClick={() => {
                    closeMenu();
                    handleOpenExternal();
                  }}
                >
                  <Text as="span" size="T300" truncate>
                    Open in browser
                  </Text>
                </MenuItem>
              </Box>
            </Menu>
          </div>
        )}
        {error && (
          <Box className={css.ImageViewerError} alignItems="Center" gap="200">
            <Text size="T200">{error}</Text>
            <IconButton
              size="300"
              radii="300"
              onClick={() => setError(undefined)}
              aria-label="Dismiss"
            >
              <Icon size="50" src={Icons.Cross} />
            </IconButton>
          </Box>
        )}
        {/*
          Every interaction on the image is a pointer shortcut for something
          the toolbar above already offers to the keyboard: click zooms (the
          +/-/percentage controls), drag pans, right-click saves or copies
          (the Download and Open buttons). So the image itself is left as a
          plain, non-focusable image rather than being announced as a button
          it is not, and these two rules are answered by the toolbar.
        */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
        <img
          className={css.ImageViewerImg}
          style={{
            cursor: zoomCursor,
            transform: `scale(${zoom}) translate(${pan.translateX}px, ${pan.translateY}px)`,
            // Disable browser's native double-tap-zoom + pinch-zoom so our
            // gesture handlers own the interaction on touch devices.
            touchAction: isMobile ? 'none' : undefined,
          }}
          src={src}
          alt={alt}
          onClick={handleImageClick}
          onContextMenu={handleContextMenu}
          onMouseDown={onMouseDown}
          onTouchStart={isMobile ? handleTouchStart : undefined}
          onTouchMove={isMobile ? handleTouchMove : undefined}
          onTouchEnd={isMobile ? handleTouchEnd : undefined}
          onTouchCancel={isMobile ? handleTouchEnd : undefined}
        />
      </Box>
    );
  },
);
