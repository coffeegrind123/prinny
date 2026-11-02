import { Align, Menu, PopOut, Position, RectCords, toRem } from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { useCloseUserRoomProfile, useUserRoomProfileState } from '../state/hooks/userRoomProfile';
import { UserRoomProfile } from './user-profile';
import { isProfileNoteEditor } from './user-profile/UserNote';
import { UserRoomProfileState } from '../state/userRoomProfile';
import { useAllJoinedRoomsSet, useGetRoom } from '../hooks/useGetRoom';
import { stopPropagation } from '../utils/keyboard';
import { SpaceProvider } from '../hooks/useSpace';
import { RoomProvider } from '../hooks/useRoom';

// Tall enough for the card with a collapsed, maximum-length bio.
const RESERVED_CARD_HEIGHT = 520;

// PopOut measures its content once, when it opens, but the profile (and its
// bio) loads afterwards and grows the card, so a card placed from its first,
// small measurement could end up clipped by a screen edge. Pick the side and
// alignment from the space a full card needs instead, so it grows away from
// the nearest edge while staying attached to the anchor.
const getPlacement = (
  cords: RectCords,
  position: Position,
): { position: Position; align: Align } => {
  const above = cords.y;
  const below = window.innerHeight - (cords.y + cords.height);

  if (position === 'Left' || position === 'Right') {
    // Start-aligned, the card's top sits at the anchor's top and grows down;
    // End-aligned, its bottom sits at the anchor's bottom and grows up.
    const growDown = window.innerHeight - cords.y;
    const growUp = cords.y + cords.height;
    if (growDown >= RESERVED_CARD_HEIGHT) {
      return { position, align: 'Start' };
    }
    return { position, align: growUp > growDown ? 'End' : 'Start' };
  }

  if (position === 'Top' && above >= RESERVED_CARD_HEIGHT) {
    return { position: 'Top', align: 'Start' };
  }
  if (below >= RESERVED_CARD_HEIGHT) {
    return { position: 'Bottom', align: 'Start' };
  }
  if (above >= RESERVED_CARD_HEIGHT) {
    return { position: 'Top', align: 'Start' };
  }
  return { position: above > below ? 'Top' : 'Bottom', align: 'Start' };
};

function UserRoomProfileContextMenu({ state }: { state: UserRoomProfileState }) {
  const { roomId, spaceId, userId, cords, position } = state;
  const allJoinedRooms = useAllJoinedRoomsSet();
  const getRoom = useGetRoom(allJoinedRooms);
  const room = getRoom(roomId);
  const space = spaceId ? getRoom(spaceId) : undefined;

  const close = useCloseUserRoomProfile();

  if (!room) return null;

  const placement = getPlacement(cords, position ?? 'Top');

  return (
    <PopOut
      anchor={cords}
      position={placement.position}
      align={placement.align}
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: close,
            clickOutsideDeactivates: true,
            // Escape in the note editor discards the edit; it must not close the card.
            escapeDeactivates: (evt: KeyboardEvent) =>
              isProfileNoteEditor(evt.target) ? false : stopPropagation(evt),
          }}
        >
          <Menu style={{ width: toRem(340) }}>
            <SpaceProvider value={space ?? null}>
              <RoomProvider value={room}>
                <UserRoomProfile userId={userId} />
              </RoomProvider>
            </SpaceProvider>
          </Menu>
        </FocusTrap>
      }
    />
  );
}

export function UserRoomProfileRenderer() {
  const state = useUserRoomProfileState();

  if (!state) return null;
  return <UserRoomProfileContextMenu state={state} />;
}
