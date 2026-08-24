/*
 * jsx-a11y classes `separator` as non-interactive, which is only true of the
 * *decorative* one. ARIA defines two: a non-focusable separator is a structure
 * role, and a focusable one is a widget — the window splitter, which is the
 * only form that takes aria-valuenow/min/max at all. This file renders that
 * second form, so the tabIndex and the key handler are required by the role
 * rather than in tension with it. Disabled at file scope because the two rules
 * report on different lines of the same element.
 */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import classNames from 'classnames';
import * as css from './ResizeHandle.css';
import { PaneId, PaneSide, useResizeHandle } from '../../hooks/useResizablePane';

export type ResizeHandleProps = {
  paneId: PaneId;
  /** Which side of the handle the column being resized is on. */
  side: PaneSide;
  /** Names the column, not the handle: "Room list", "Member list". */
  label: string;
  /**
   * Let a drag past the collapse threshold snap the column shut. Off unless the
   * page asks for it — see `effectiveSpec` in useResizablePane.
   */
  allowCollapse?: boolean;
  className?: string;
};

/**
 * Draggable replacement for the fixed `<Line direction="Vertical">` between two
 * layout columns.
 *
 * Exposed as a real `separator` widget rather than a decorated `div`: a
 * splitter that only responds to a pointer is unusable without one, and the
 * ARIA separator role comes with a defined keyboard contract that costs
 * nothing to honour — arrows nudge, Shift+arrows jump, Home/End go to the
 * extremes, Enter restores the default. Double-click also restores the
 * default, which is where most people look first.
 */
export function ResizeHandle({ paneId, side, label, allowCollapse, className }: ResizeHandleProps) {
  const { spec, size, onPointerDown, onKeyDown, onDoubleClick } = useResizeHandle(
    paneId,
    side,
    allowCollapse,
  );

  return (
    <div
      className={classNames(css.ResizeHandle, className)}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={size}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      title={`Drag to resize ${label} · double-click to reset`}
    />
  );
}
