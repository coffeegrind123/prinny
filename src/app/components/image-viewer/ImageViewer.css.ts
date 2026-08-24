import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

export const ImageViewer = style([
  DefaultReset,
  {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
]);

export const ImageViewerBarGroup = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S200,
    padding: `6px ${config.space.S300}`,
    backgroundColor: color.Surface.Container,
    color: color.Surface.OnContainer,
    borderRadius: config.radii.R400,
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
    border: `1px solid ${color.Surface.ContainerLine}`,
    pointerEvents: 'auto',
    overflow: 'hidden',
  },
]);

// Rendered inline rather than through folds' PopOut, which portals to
// document.body — outside the focus trap the viewer lives in. `fixed` puts it
// at viewport coordinates all the same; nothing between here and the viewport
// carries a transform to make it a containing block.
export const ImageViewerMenu = style([
  DefaultReset,
  {
    position: 'fixed',
    zIndex: 4,
    pointerEvents: 'auto',
  },
]);

export const ImageViewerMenuGroup = style([
  DefaultReset,
  {
    padding: config.space.S100,
  },
]);

// Sits above the image, below the tool bars. A failed save used to be
// completely silent, which read as "right-click save does nothing".
export const ImageViewerError = style([
  DefaultReset,
  {
    position: 'fixed',
    bottom: `calc(${config.space.S400} + env(safe-area-inset-bottom))`,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 3,
    maxWidth: 'min(90vw, 520px)',
    padding: `${config.space.S100} ${config.space.S200}`,
    backgroundColor: color.Critical.Container,
    color: color.Critical.OnContainer,
    border: `1px solid ${color.Critical.ContainerLine}`,
    borderRadius: config.radii.R400,
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
    pointerEvents: 'auto',
  },
]);

export const ImageViewerImg = style([
  DefaultReset,
  {
    display: 'block',
    maxWidth: '80vw',
    maxHeight: '80vh',
    transition: 'transform 100ms linear',
    cursor: 'zoom-in',
    userSelect: 'none',
  },
]);
