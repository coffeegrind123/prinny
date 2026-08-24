import { MouseEventHandler, useEffect, useState } from 'react';

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
    active ? 'grab' : 'initial'
  );

  useEffect(() => {
    setCursor(active ? 'grab' : 'initial');
  }, [active]);

  const handleMouseMove = (evt: MouseEvent) => {
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
    setCursor('grab');

    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const handleMouseDown: MouseEventHandler<HTMLElement> = (evt) => {
    if (!active) return;
    // Primary button only. Panning used to start on any button, so a
    // right-click on a zoomed image began a drag and swallowed the event
    // before it could open a context menu.
    if (evt.button !== 0) return;
    evt.preventDefault();
    setCursor('grabbing');

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    if (!active) setPan(INITIAL_PAN);
  }, [active]);

  return {
    pan,
    cursor,
    onMouseDown: handleMouseDown,
  };
};
