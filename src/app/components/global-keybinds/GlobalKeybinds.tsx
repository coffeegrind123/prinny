import { useCallback, useEffect } from 'react';
import { isKeyHotkey } from '../../utils/is-hotkey';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { useKeybind } from '../../hooks/useKeybind';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useSelectedSpace } from '../../hooks/router/useSelectedSpace';
import { useDirectSelected } from '../../hooks/router/useDirectSelected';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { settingsAtom } from '../../state/settings';
import { useSetSetting, useSetting } from '../../state/hooks/settings';
import { keyboardShortcutsAtom } from '../../state/keybinds';
import { searchModalAtom } from '../../state/searchModal';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { mDirectAtom } from '../../state/mDirectList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useSpaces } from '../../state/hooks/roomList';
import { useNavRoomOrder } from '../../state/hooks/navRoomOrder';
import { markAsRead } from '../../utils/notifications';
import { isSpace } from '../../utils/room';

// True when an editable element is focused (text input, textarea, or any
// contenteditable). Used to suppress global keybinds that would otherwise
// hijack typing (e.g. Escape, PageUp/Down with no modifier).
function isEditableElementFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

// Roll over to the other end of the list when reaching the boundary so
// power-users can keep tapping the same key without thinking about wrap.
function step<T>(list: readonly T[], current: T | undefined, dir: 1 | -1): T | undefined {
  if (list.length === 0) return undefined;
  const idx = current === undefined ? -1 : list.indexOf(current);
  if (idx < 0) return list[dir === 1 ? 0 : list.length - 1];
  const next = (idx + dir + list.length) % list.length;
  return list[next];
}

export function GlobalKeybinds() {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const selectedRoomId = useSelectedRoom();
  const selectedSpaceId = useSelectedSpace();
  const directSelected = useDirectSelected();
  const { navigateRoom, navigateSpace } = useRoomNavigate();

  const setKeyboardShortcutsOpen = useSetAtom(keyboardShortcutsAtom);
  const setSearchOpen = useSetAtom(searchModalAtom);
  const setSettings = useSetSetting(settingsAtom, 'isPeopleDrawer');
  const [hideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');
  const allRooms = useAtomValue(allRoomsAtom);
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const spaces = useSpaces(mx, allRoomsAtom);

  // ── Member-list drawer (Mod+Shift+M) ─────────────────────────
  useKeybind('toggle-member-list', () => {
    setSettings((prev) => !prev);
  });

  // ── Shortcuts panel (Mod+/) ──────────────────────────────────
  // Toggle — the same hotkey should close the modal it just opened. The
  // KeyboardShortcutsRenderer in Router.tsx used to mirror this binding
  // with its own window-level `setOpen(v => !v)`, but having two window
  // listeners both react to mod+/ produced a (true → toggled-false) race
  // inside a single keydown tick and the modal silently closed itself.
  // Source of truth is here so user rebinds in settings still apply.
  useKeybind('keyboard-shortcuts', () => {
    setKeyboardShortcutsOpen((v) => !v);
  });

  // Discord parity — Ctrl+? (i.e. Ctrl+Shift+/) also toggles the shortcuts
  // panel, in addition to the rebindable `mod+/` above. Fixed (not in the
  // keybind registry) so it stays available regardless of rebinds; `mod`
  // covers Cmd+Shift+/ on macOS.
  useEffect(() => {
    const onKey = (evt: KeyboardEvent) => {
      if (isKeyHotkey('ctrl+shift+/', evt) || isKeyHotkey('mod+shift+/', evt)) {
        evt.preventDefault();
        setKeyboardShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setKeyboardShortcutsOpen]);

  // ── Quick switcher (Mod+K) ───────────────────────────────────
  // Source of truth for the binding; Search.tsx no longer has a listener of
  // its own. Closes when open; opens only when nothing else is on top —
  // a room switcher summoned over a dialog would land behind it.
  useKeybind('quick-switcher', () => {
    setSearchOpen((prev) => {
      if (prev) return false;
      const portalContainer = document.getElementById('portalContainer');
      if (portalContainer && portalContainer.children.length > 0) return prev;
      return true;
    });
  });

  // ── History back / forward (Alt+Left / Alt+Right) ────────────
  useKeybind('nav-history-back', () => {
    navigate(-1);
  });
  useKeybind('nav-history-forward', () => {
    navigate(1);
  });

  // ── Sibling rooms within the current view ────────────────────
  // The room lists publish what they render (see navRoomOrderAtom), and that
  // is what these keys step through: the same sequence, top to bottom, that
  // the sidebar is showing — pinned chats first, sorted by activity or A-Z as
  // that list sorts, filtered by "show unread only", and inside a space in
  // hierarchy order with collapsed categories left out.
  //
  // Deriving it here instead was the bug: filtering the room list by "is a DM"
  // gives the right rooms in the wrong order, because the visible order is not
  // a property of the rooms — it is pins, a sort mode and a filter that only
  // the list knows about. Alt+Up/Down therefore landed on whichever DM
  // happened to sit next in an internal list rather than the one below the
  // current chat on screen.
  //
  // The derivation stays as a fallback for a screen with no room list mounted
  // at all (Explore, the inbox), where there is nothing to publish and no
  // visible order to honour. A list that is mounted and empty is NOT that
  // case — it means the sidebar is showing nothing, so neither key moves:
  //   • inside a space  → that space's rooms
  //   • Direct Messages → DMs only
  //   • Home            → orphan rooms (non-space, non-DM, no parent space)
  const navRoomOrder = useNavRoomOrder();

  const visibleRoomIds = useCallback((): string[] => {
    if (navRoomOrder !== undefined) return navRoomOrder;
    if (selectedSpaceId) {
      return allRooms.filter((rid) => {
        const room = mx.getRoom(rid);
        if (!room || isSpace(room)) return false;
        const parents = roomToParents.get(rid);
        return parents?.has(selectedSpaceId) ?? false;
      });
    }
    if (directSelected) {
      return allRooms.filter((rid) => mDirects.has(rid));
    }
    return allRooms.filter((rid) => {
      const room = mx.getRoom(rid);
      if (!room || isSpace(room)) return false;
      if (mDirects.has(rid)) return false;
      return !roomToParents.has(rid);
    });
  }, [navRoomOrder, allRooms, mx, roomToParents, selectedSpaceId, directSelected, mDirects]);

  useKeybind('nav-channels-up', () => {
    const list = visibleRoomIds();
    const next = step(list, selectedRoomId, -1);
    if (next) navigateRoom(next);
  });
  useKeybind('nav-channels-down', () => {
    const list = visibleRoomIds();
    const next = step(list, selectedRoomId, 1);
    if (next) navigateRoom(next);
  });

  // ── Space switching (Mod+Alt+Up / Mod+Alt+Down) ──────────────
  useKeybind('nav-servers-up', () => {
    const next = step(spaces, selectedSpaceId, -1);
    if (next) navigateSpace(next);
  });
  useKeybind('nav-servers-down', () => {
    const next = step(spaces, selectedSpaceId, 1);
    if (next) navigateSpace(next);
  });

  // ── Unread / unread-mention navigation ───────────────────────
  // Filtered lists are computed at keypress time, not memoized, because
  // they're cheap and the underlying unread map changes constantly.
  useKeybind('nav-unread-up', () => {
    const list = allRooms.filter((rid) => (roomToUnread.get(rid)?.total ?? 0) > 0);
    const next = step(list, selectedRoomId, -1);
    if (next) navigateRoom(next);
  });
  useKeybind('nav-unread-down', () => {
    const list = allRooms.filter((rid) => (roomToUnread.get(rid)?.total ?? 0) > 0);
    const next = step(list, selectedRoomId, 1);
    if (next) navigateRoom(next);
  });
  useKeybind('nav-unread-mentions-up', () => {
    const list = allRooms.filter((rid) => (roomToUnread.get(rid)?.highlight ?? 0) > 0);
    const next = step(list, selectedRoomId, -1);
    if (next) navigateRoom(next);
  });
  useKeybind('nav-unread-mentions-down', () => {
    const list = allRooms.filter((rid) => (roomToUnread.get(rid)?.highlight ?? 0) > 0);
    const next = step(list, selectedRoomId, 1);
    if (next) navigateRoom(next);
  });

  // ── Mark current room / current space as read ────────────────
  // Escape is also bound to mark-channel-read; suppress when an
  // editable element has focus so the composer's escape (clear reply)
  // and modal escapes win.
  useKeybind('mark-channel-read', () => {
    if (isEditableElementFocused()) return;
    if (selectedRoomId) {
      markAsRead(mx, selectedRoomId, hideReadReceipts);
    }
  });
  useKeybind('mark-server-read', () => {
    if (isEditableElementFocused()) return;
    if (selectedSpaceId) {
      // Only rooms whose parents include the current space.
      allRooms.forEach((rid) => {
        const room = mx.getRoom(rid);
        if (!room || isSpace(room)) return;
        const parents = roomToParents.get(rid);
        if (!parents?.has(selectedSpaceId)) return;
        markAsRead(mx, rid, hideReadReceipts);
      });
    } else {
      // Top-level Home: clear every non-space room + DMs.
      allRooms.forEach((rid) => {
        const room = mx.getRoom(rid);
        if (!room || isSpace(room)) return;
        if (mDirects.has(rid) || !roomToParents.has(rid)) {
          markAsRead(mx, rid, hideReadReceipts);
        }
      });
    }
  });

  // ── Jump to oldest unread in current room ────────────────────
  useKeybind('jump-oldest-unread', () => {
    if (!selectedRoomId) return;
    const room = mx.getRoom(selectedRoomId);
    if (!room) return;
    const userId = mx.getUserId();
    if (!userId) return;
    const readUpTo = room.getEventReadUpTo(userId);
    if (readUpTo) {
      navigateRoom(selectedRoomId, readUpTo);
    }
  });

  // ── Scroll the active timeline ───────────────────────────────
  // The RoomTimeline registers its scroll container via the global
  // ref below (see setTimelineScroll). We dispatch synthetic
  // scroll-by-page operations to that element.
  const scrollActiveTimeline = (dir: 1 | -1, factor = 0.9) => {
    if (isEditableElementFocused()) return;
    const el = getActiveTimelineScrollContainer();
    if (!el) return;
    const page = el.clientHeight * factor;
    el.scrollBy({ top: dir * page, behavior: 'smooth' });
  };
  useKeybind('scroll-chat-up', () => scrollActiveTimeline(-1));
  useKeybind('scroll-chat-down', () => scrollActiveTimeline(1));

  return null;
}

// ── Active-timeline scroll registration ─────────────────────────
// The room timeline component registers its scroll container here on
// mount. The global PageUp/PageDown keybind walks this ref to scroll
// the current room without needing a context plumbed through the tree.
let activeTimelineScrollEl: HTMLElement | null = null;
export function setActiveTimelineScrollContainer(el: HTMLElement | null) {
  activeTimelineScrollEl = el;
}
export function getActiveTimelineScrollContainer(): HTMLElement | null {
  return activeTimelineScrollEl;
}
