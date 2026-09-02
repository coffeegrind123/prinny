import { FocusTrap } from 'focus-trap-react';
import { as, Modal, Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { ReactNode } from 'react';
import { ModalWide } from '../styles/Modal.css';
import { stopPropagation } from '../utils/keyboard';

// When the overlay closes via `clickOutsideDeactivates`, focus-trap-react
// fires onDeactivate but the original touch/mousedown that triggered it
// also keeps bubbling — on mobile that means the underlying image
// receives the tap and immediately reopens the viewer. Plant a
// transparent full-screen layer that swallows the next pointerdown/
// click for ~350ms so the original gesture finishes harmlessly.
function swallowNextTap(): void {
  const blocker = document.createElement('div');
  blocker.style.cssText =
    'position:fixed;inset:0;z-index:2147483646;background:transparent;touch-action:none;';
  const cleanup = () => {
    blocker.remove();
  };
  blocker.addEventListener(
    'pointerdown',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    },
    { capture: true, once: true },
  );
  blocker.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true, once: true },
  );
  document.body.appendChild(blocker);
  // Fallback cleanup if no tap arrives within the window (e.g. the close
  // was triggered by the X button rather than an outside click).
  setTimeout(cleanup, 350);
}

export type RenderViewerProps = {
  src: string;
  alt: string;
  requestClose: () => void;
  // When set, the "open in browser" button opens this URL instead of `src`.
  // Used by embed previews so opening the gallery image opens the source
  // tweet/post/page instead of the raw pbs.twimg.com / blob: media URL.
  externalUrl?: string;
};

type ImageOverlayProps = RenderViewerProps & {
  viewer: boolean;
  renderViewer: (props: RenderViewerProps) => ReactNode;
};

export const ImageOverlay = as<'div', ImageOverlayProps>(
  ({ src, alt, viewer, requestClose, renderViewer, externalUrl, ...props }, ref) => (
    <Overlay {...props} ref={ref} open={viewer} backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: () => {
              swallowNextTap();
              requestClose();
            },
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Modal
            className={ModalWide}
            size="500"
            onContextMenu={(evt: any) => evt.stopPropagation()}
          >
            {renderViewer({
              src,
              alt,
              requestClose,
              externalUrl,
            })}
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  ),
);
