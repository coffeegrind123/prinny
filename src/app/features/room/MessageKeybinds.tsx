import { useSetAtom } from 'jotai';
import { Room } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { useKeybind } from '../../hooks/useKeybind';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getHoveredMessageEventId } from '../../state/hoveredMessage';
import { roomIdToReplyDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { copyToClipboard } from '../../utils/dom';
import { markAsUnread } from '../../utils/notifications';
import { StateEvent } from '../../../types/matrix/room';
import { canEditEvent, getEditedEvent } from '../../utils/room';
import { isEmptyEditor } from '../../components/editor/utils';
import { hasMessageActionListener, requestMessageAction } from '../../state/messageAction';

type Props = {
  room: Room;
  onSetEditId: (id: string | undefined) => void;
  /**
   * The composer. Only `edit-last-message` needs it, to tell "the composer is
   * empty so Up means edit" from "the caret is in text so Up means move".
   */
  editor: Editor;
};

// Bindings keyed to the message currently under the cursor. Mounted once
// inside RoomTimeline so the room context here matches the visible
// timeline. All bindings are no-ops when no message is hovered (or the
// hovered event is no longer in this room's timeline).
export function MessageKeybinds({ room, onSetEditId, editor }: Props) {
  const mx = useMatrixClient();
  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const pinnedEvents = useRoomPinnedEvents(room);

  const withHoveredEvent = (cb: (eventId: string) => void) => () => {
    const id = getHoveredMessageEventId();
    if (!id) return;
    const ev = room.findEventById(id);
    if (!ev) return;
    cb(id);
  };

  // Edit own messages only — the server rejects edits from other senders
  // and the existing menu item is gated the same way.
  useKeybind(
    'edit-message',
    withHoveredEvent((id) => {
      const ev = room.findEventById(id);
      if (!ev) return;
      if (ev.getSender() !== mx.getUserId()) return;
      onSetEditId(id);
    }),
  );

  useKeybind(
    'delete-message',
    withHoveredEvent((id) => {
      // Confirm via OS prompt so accidental Backspace doesn't nuke a
      // message. Native confirm is OK here — same UX shape as Delete in
      // the right-click menu.
      // eslint-disable-next-line no-alert
      if (!window.confirm('Delete this message?')) return;
      mx.redactEvent(room.roomId, id).catch((err) => {
        console.error('[keybind] redactEvent failed:', err);
      });
    }),
  );

  useKeybind(
    'pin-message',
    withHoveredEvent((id) => {
      const userId = mx.getUserId();
      if (!userId) return;
      // Toggle: unpin if already pinned, otherwise pin.
      const isPinned = pinnedEvents.includes(id);
      const next = isPinned ? pinnedEvents.filter((p) => p !== id) : [...pinnedEvents, id];
      mx.sendStateEvent(room.roomId, StateEvent.RoomPinnedEvents as any, { pinned: next }).catch(
        (err) => {
          console.error('[keybind] pin sendStateEvent failed:', err);
        },
      );
    }),
  );

  useKeybind(
    'reply-message',
    withHoveredEvent((id) => {
      const replyEvt = room.findEventById(id);
      if (!replyEvt) return;
      const editedReply = getEditedEvent(id, replyEvt, room.getUnfilteredTimelineSet());
      const content = editedReply?.getContent()['m.new_content'] ?? replyEvt.getContent();
      const body = content.body as string | undefined;
      const formattedBody = content.formatted_body as string | undefined;
      const relation = (replyEvt.getWireContent() as any)['m.relates_to'];
      const senderId = replyEvt.getSender();
      if (!senderId || typeof body !== 'string') return;
      setReplyDraft({
        userId: senderId,
        eventId: id,
        body,
        formattedBody,
        relation,
      });
    }),
  );

  useKeybind(
    'copy-text',
    () => {
      // Browser's default Mod+C wins if the user has an active selection.
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return false;
      const id = getHoveredMessageEventId();
      if (!id) return false;
      const ev = room.findEventById(id);
      if (!ev) return false;
      const edited = getEditedEvent(id, ev, room.getUnfilteredTimelineSet());
      const content = edited?.getContent()['m.new_content'] ?? ev.getContent();
      const text = (content?.body as string | undefined) ?? '';
      if (!text) return false;
      copyToClipboard(text);
      return undefined;
    },
    { allowInEditable: true }, // Mod+C is a modifier binding; let users copy from inputs too
  );

  useKeybind(
    'mark-unread',
    withHoveredEvent((id) => {
      markAsUnread(mx, room.roomId, id);
    }),
  );

  /**
   * Reaction and forward go through `messageAction` rather than being done
   * here, because both open UI that belongs to a single `Message` instance —
   * a popover anchored to that row, and a modal with its own state. Nothing a
   * global keydown listener can reach directly.
   *
   * The anchor is read off the row's `data-message-id`, which `RoomTimeline`
   * already puts on every message and already queries this way when it scrolls
   * to an edit. Reading it here means the emoji board opens against the message
   * the user is pointing at, without threading a ref out of every Message.
   */
  const requestOnHovered = (build: (row: Element) => Parameters<typeof requestMessageAction>[1]) =>
    withHoveredEvent((id) => {
      if (!hasMessageActionListener(id)) return;
      const row = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      if (!row) return;
      requestMessageAction(id, build(row));
    });

  useKeybind(
    'add-reaction',
    requestOnHovered((row) => ({
      type: 'add-reaction',
      anchor: row.getBoundingClientRect(),
    })),
  );

  useKeybind(
    'forward-message',
    requestOnHovered(() => ({ type: 'forward' })),
  );

  /**
   * Up in an EMPTY composer edits your last message.
   *
   * `allowInEditable` because the composer is exactly where this is pressed —
   * the default guard in `useKeybind` suppresses unmodified bindings while an
   * editable has focus, which would make this one unreachable. The emptiness
   * check is what keeps Up meaning "move the caret" the rest of the time, so
   * this can never eat a cursor movement in a message being written.
   *
   * Searches back from the newest event for one this user may edit, rather than
   * taking the last event and testing it: the last thing in the timeline is
   * frequently somebody else's message, or a membership change, and the useful
   * answer is the last message YOU sent.
   */
  useKeybind(
    'edit-last-message',
    () => {
      // Only when the COMPOSER itself has focus. `allowInEditable` lets this
      // binding through in any editable, so without this an Up press in the
      // room search field — or in another message's inline edit box — would
      // open an edit here as long as the composer happened to be empty.
      if (!ReactEditor.isFocused(editor)) return false;
      if (!isEmptyEditor(editor)) return false;
      const events = room.getLiveTimeline().getEvents();
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i];
        if (ev && !ev.isRedacted() && canEditEvent(mx, ev)) {
          const id = ev.getId();
          if (id) {
            onSetEditId(id);
            return undefined;
          }
        }
      }
      return false;
    },
    { allowInEditable: true },
  );

  return null;
}
