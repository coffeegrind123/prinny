import React, { useState } from 'react';
import { Room } from 'matrix-js-sdk';
import { RoomNavItem } from './RoomNavItem';
import { SortableNavItem } from './styles.css';
import { RoomNotificationMode } from '../../hooks/useRoomsNotificationPreferences';

export type RoomDropPosition = 'before' | 'after';

type SortableRoomNavItemProps = {
  room: Room;
  selected: boolean;
  linkPath: string;
  notificationMode?: RoomNotificationMode;
  showAvatar?: boolean;
  direct?: boolean;
  parentId: string;
  canReorder: boolean;
  onReorder: (
    parentId: string,
    fromRoomId: string,
    toRoomId: string,
    position: RoomDropPosition,
  ) => void;
};

type DragPayload = { roomId: string; parentId: string };

// Module-level slot for the active drag, readable during dragover (dataTransfer
// is not readable in dragover in all browsers).
let activeDrag: DragPayload | null = null;

// The nav list is virtualized, so the drag source can unmount mid-drag and its
// dragend never fires. Clear the active drag from window-level listeners too.
// `drop` is bubble phase, so it runs after the target's React handler has read
// `activeDrag`; `pointerdown` never fires during a native drag and precedes
// any new one.
const ACTIVE_DRAG_END_EVENTS = ['drop', 'dragend', 'pointerdown'] as const;
const clearActiveDrag = () => {
  activeDrag = null;
  ACTIVE_DRAG_END_EVENTS.forEach((type) => window.removeEventListener(type, clearActiveDrag));
};
const setActiveDrag = (payload: DragPayload) => {
  clearActiveDrag();
  activeDrag = payload;
  ACTIVE_DRAG_END_EVENTS.forEach((type) => window.addEventListener(type, clearActiveDrag));
};

const getDropPosition = (e: React.DragEvent<HTMLElement>): RoomDropPosition => {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
};

export function SortableRoomNavItem({
  room,
  selected,
  linkPath,
  notificationMode,
  showAvatar,
  direct,
  parentId,
  canReorder,
  onReorder,
}: SortableRoomNavItemProps) {
  const [dragging, setDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<RoomDropPosition>();

  const isValidDropTarget = () =>
    !!activeDrag && activeDrag.parentId === parentId && activeDrag.roomId !== room.roomId;

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    setActiveDrag({ roomId: room.roomId, parentId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', room.roomId);
    setDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isValidDropTarget()) {
      setDropPosition(undefined);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropPosition(getDropPosition(e));
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // dragleave also fires when crossing into our own children; ignore those.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDropPosition(undefined);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setDropPosition(undefined);
    if (!activeDrag || !isValidDropTarget()) return;
    e.preventDefault();
    onReorder(parentId, activeDrag.roomId, room.roomId, getDropPosition(e));
  };

  const handleDragEnd = () => {
    setDragging(false);
    setDropPosition(undefined);
    clearActiveDrag();
  };

  return (
    <div
      className={SortableNavItem}
      data-dragging={dragging}
      data-drop-target={dropPosition}
      draggable={canReorder}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    >
      <RoomNavItem
        room={room}
        selected={selected}
        showAvatar={showAvatar}
        direct={direct}
        linkPath={linkPath}
        notificationMode={notificationMode}
      />
    </div>
  );
}
