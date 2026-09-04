import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { useMatrixClient } from './useMatrixClient';
import { useForceUpdate } from './useForceUpdate';
import { useStateEventCallback } from './useStateEventCallback';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { allRoomsAtom } from '../state/room-list/roomList';
import { spaceRoomsAtom } from '../state/spaceRooms';
import { useOrphanSpaces, useSpaces } from '../state/hooks/roomList';
import { useSidebarItems } from './useSidebarItems';
import { roomToParentsAtom } from '../state/room/roomToParents';
import {
  Membership,
  MSpaceChildContent,
  SpaceAutoJoinContent,
  StateEvent,
} from '../../types/matrix/room';
import { getStateEvent, getStateEvents, isValidChild } from '../utils/room';
import { isRoomId, rateLimitedActions } from '../utils/matrix';

type RoomToJoin = {
  roomId: string;
  via: string[];
};

/**
 * Globally auto-joins the child rooms (and subspaces) of every space that has
 * auto-join enabled, whether via the per-space `app.prinny.space.auto_join`
 * state event or the user-wide "Auto Join Space Rooms" setting.
 *
 * Unlike the old lobby-only hook, this runs as soon as the auto-join data is
 * received from the server, without the user having to open the space lobby.
 *
 * Runs reactively: it re-scans whenever the relevant state changes, including
 * when a `SpaceAutoJoin` or `m.space.child` event arrives, when a room is
 * joined (so newly-joined subspaces are recursed into), or when the sidebar
 * pin list changes.
 *
 * Subspaces are joined too, unless they are pinned to the sidebar. Pinned
 * subspaces are skipped entirely (neither joined nor recursed into), leaving
 * them for the user to manage manually. Joining a subspace enables discovery
 * of its own children, which are picked up on the next scan.
 *
 * Already-attempted rooms are tracked for the lifetime of the hook so we don't
 * hammer the homeserver with duplicate join requests. Rooms that fail to join
 * (e.g. invite-only) stay attempted and can still be joined manually from the
 * lobby.
 */
export const useSpaceAutoJoinGlobal = () => {
  const mx = useMatrixClient();
  const [autoJoinSpaceRooms] = useSetting(settingsAtom, 'autoJoinSpaceRooms');
  const spaces = useSpaces(mx, allRoomsAtom);
  const spaceRooms = useAtomValue(spaceRoomsAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const orphanSpaces = useOrphanSpaces(mx, allRoomsAtom, roomToParents);
  const [sidebarItems] = useSidebarItems(orphanSpaces);
  const attemptedRef = useRef<Set<string>>(new Set());
  const [updateCount, forceUpdate] = useForceUpdate();

  // Re-scan when SpaceAutoJoin or m.space.child events arrive.
  useStateEventCallback(
    mx,
    useCallback(
      (event) => {
        const type = event.getType();
        if (type === StateEvent.SpaceAutoJoin || type === StateEvent.SpaceChild) {
          forceUpdate();
        }
      },
      [forceUpdate],
    ),
  );

  // Entry-point spaces whose children should be auto-joined: those with the
  // per-space auto-join event set, or all spaces when the user-wide setting
  // is on.
  const autoJoinSpaces = useMemo(() => {
    const set = new Set<string>();
    spaces.forEach((spaceId) => {
      const room = mx.getRoom(spaceId);
      if (!room) return;
      // The LOCAL setting is now required. Previously the remote state event
      // alone armed auto-join, so anyone with state-send power in a space (power
      // level 50 by default) could make every member's client silently join
      // rooms of their choosing, on servers of their choosing, via attacker-
      // supplied `via` entries - and it overrode this setting, which defaults to
      // false. Joining a room changes the user's exposure (profile disclosure,
      // content delivery, federation with the named servers), so it stays a
      // local decision; the room's event may only opt IN to a choice the user
      // already made, never make it for them.
      if (!autoJoinSpaceRooms) return;
      set.add(spaceId);
      const evt = getStateEvent(room, StateEvent.SpaceAutoJoin);
      if (evt?.getContent<SpaceAutoJoinContent>().auto_join === true) {
        set.add(spaceId);
      }
    });
    return set;
    // updateCount triggers recompute when state events arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, spaces, autoJoinSpaceRooms, updateCount]);

  // Spaces visible in the sidebar (pinned). Pinned subspaces are skipped so
  // the user can manage them manually.
  const pinnedSpaces = useMemo(() => {
    const set = new Set<string>();
    sidebarItems.forEach((item) => {
      if (typeof item === 'string') {
        set.add(item);
      } else {
        item.content.forEach((id) => set.add(id));
      }
    });
    return set;
  }, [sidebarItems]);

  useEffect(() => {
    if (autoJoinSpaces.size === 0) return;

    const roomsToJoin: RoomToJoin[] = [];
    const visited = new Set<string>();
    const attempted = attemptedRef.current;

    const collect = (spaceId: string) => {
      if (visited.has(spaceId)) return;
      visited.add(spaceId);

      const space = mx.getRoom(spaceId);
      if (!space) return;
      const childEvents = getStateEvents(space, StateEvent.SpaceChild);

      childEvents.forEach((childEvent) => {
        if (!isValidChild(childEvent)) return;
        const childId = childEvent.getStateKey();
        if (!childId || !isRoomId(childId)) return;

        const childRoom = mx.getRoom(childId);
        const joined = childRoom?.getMyMembership() === Membership.Join;
        const isSpace = childRoom?.isSpaceRoom() || spaceRooms.has(childId);

        if (isSpace) {
          // Skip pinned subspaces entirely: don't join them and don't recurse
          // into them, leaving them for the user to manage manually.
          if (pinnedSpaces.has(childId)) return;

          if (joined) {
            // Recurse into joined, non-pinned subspaces so their children
            // get joined too.
            collect(childId);
          } else if (!attempted.has(childId)) {
            const content = childEvent.getContent<MSpaceChildContent>();
            roomsToJoin.push({ roomId: childId, via: content.via });
            attempted.add(childId);
          }
          return;
        }

        // Regular room child.
        if (joined || attempted.has(childId)) return;
        const content = childEvent.getContent<MSpaceChildContent>();
        roomsToJoin.push({ roomId: childId, via: content.via });
        attempted.add(childId);
      });
    };

    autoJoinSpaces.forEach(collect);

    if (roomsToJoin.length === 0) return;

    rateLimitedActions(roomsToJoin, async (item) => {
      try {
        await mx.joinRoom(item.roomId, { viaServers: item.via });
      } catch {
        // Swallowed: rateLimitedActions only retries on 429.
        // The room stays in attemptedRef so we don't retry automatically.
        // Users can still join manually via the lobby Join button.
      }
    });
  }, [mx, autoJoinSpaces, spaceRooms, pinnedSpaces]);
};
