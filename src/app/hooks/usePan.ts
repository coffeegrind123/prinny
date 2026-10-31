import { MouseEventHandler, useEffect, useRef, useState } from 'react';

export type Pan = {
  translateX: number;
  translateY: number;
};

const INITIAL_PAN = {
  translateX: 0,
  translateY: 0,
};

export const usePan = (active: boolean) => {
  const [pan, setPan] = useState<Pan>(INITIAL_PAN);
  const [cursor, setCursor] = useState<'grab' | 'grabbing' | 'initial'>(
    active ? 'grab' : 'initial',
  );

  useEffect(() => {
    setCursor(active ? 'grab' : 'initial');
  }, [active]);

  // Detaches the drag in progress, if any.
  const stopDragRef = useRef<(() => void) | undefined>(undefined);

  const handleMouseMove = (evt: MouseEvent) => {
    // Primary button no longer held: the mouseup was lost (released over an
    // iframe or outside the window), and the image would otherwise keep
    // following the pointer with no button down.
    if (evt.buttons % 2 === 0) {
      stopDragRef.current?.();
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();

    setPan((p) => {
      const { translateX, translateY } = p;
      const mX = translateX + evt.movementX;
      const mY = translateY + evt.movementY;

      return { translateX: mX, translateY: mY };
    });
  };

  const handleMouseUp = (evt: MouseEvent) => {
    evt.preventDefault();
    stopDragRef.current?.();
  };

  const handleMouseDown: MouseEventHandler<HTMLElement> = (evt) => {
    if (!active) return;
    // Primary button only. Panning used to start on any button, so a
    // right-click on a zoomed image began a drag and swallowed the event
    // before it could open a context menu.
    if (evt.button !== 0) return;
    evt.preventDefault();
    stopDragRef.current?.();
    setCursor('grabbing');

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    stopDragRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      stopDragRef.current = undefined;
      setCursor('grab');
    };
  };

  // A viewer closed mid-drag must not leave document listeners behind.
  useEffect(() => () => stopDragRef.current?.(), []);

  useEffect(() => {
    if (!active) setPan(INITIAL_PAN);
  }, [active]);

  return {
    pan,
    cursor,
    onMouseDown: handleMouseDown,
  };
};
