type DragEventTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>;
type ProtectedFrame = Pick<HTMLIFrameElement, 'style'>;

// While anything is dragged in the app (room reorder, file upload), the call
// iframe must not hit-test: a drag that crosses it is delivered to the frame's
// document instead of ours, so our drop targets and drag monitors lose it
// mid-flight.
//
// Events that only fire while a drag is actually in progress over the parent document.
// `dragstart` is deliberately not used: it can be cancelled (e.g. pragmatic-drag-and-drop
// cancels it when grabbing outside a drag handle), and a cancelled drag never fires `dragend`.
const DRAG_ACTIVE_EVENTS = ['dragenter', 'dragover'] as const;

// Events that mean the drag is over. Pointer events are suppressed for the duration of a
// native drag, so any pointer activity is a reliable fallback for when `dragend` never
// reaches the document (e.g. the drag source was removed from the DOM mid-drag).
const DRAG_FINISHED_EVENTS = ['dragend', 'drop', 'pointermove', 'pointerdown'] as const;

export const protectFrameFromParentDrag = (
  eventTarget: DragEventTarget,
  frame: ProtectedFrame,
): (() => void) => {
  const frameStyle = frame.style;
  let dragActive = false;
  let previousPointerEvents = '';

  const disableFrameHitTesting = () => {
    if (dragActive) return;

    dragActive = true;
    previousPointerEvents = frameStyle.pointerEvents;
    frameStyle.pointerEvents = 'none';
  };

  const restoreFrameHitTesting = () => {
    if (!dragActive) return;

    dragActive = false;
    frameStyle.pointerEvents = previousPointerEvents;
  };

  const captureOptions = { capture: true };
  DRAG_ACTIVE_EVENTS.forEach((type) =>
    eventTarget.addEventListener(type, disableFrameHitTesting, captureOptions),
  );
  DRAG_FINISHED_EVENTS.forEach((type) =>
    eventTarget.addEventListener(type, restoreFrameHitTesting, captureOptions),
  );

  return () => {
    restoreFrameHitTesting();
    DRAG_ACTIVE_EVENTS.forEach((type) =>
      eventTarget.removeEventListener(type, disableFrameHitTesting, captureOptions),
    );
    DRAG_FINISHED_EVENTS.forEach((type) =>
      eventTarget.removeEventListener(type, restoreFrameHitTesting, captureOptions),
    );
  };
};
