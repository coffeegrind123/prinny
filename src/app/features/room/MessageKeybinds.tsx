import { useSetAtom } from 'jotai';
import { MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { useKeybind } from '../../hooks/useKeybind';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getHoveredMessageEventId } from '../../state/hoveredMessage';
import { roomIdToReplyDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { copyToClipboard } from '../../utils/dom';
import { markAsUnread } from '../../utils/notifications';
import { MessageEvent, StateEvent } from '../../../types/matrix/room';
import { canEditEvent, getEditedEvent } from '../../utils/room';
import { isEmptyEditor } from '../../components/editor/utils';
import { hasMessageActionListener, requestMessageAction } from '../../state/messageAction';

type Props = {
  room: Room;
  onSetEditId: (id: string | undefined) => void;
  /**
   * The composer. `edit-last-message` and `delete-last-message` need it, to
   * tell "the composer is empty so the key means act on my last message" from
   * "the caret is in text so the key means move or delete text".
   */
  editor: Editor;
  /**
   * Whether this user may redact the event — the timeline's own answer, which
   * folds together the room's redact power and the send-redaction permission
   * for one's own messages.
   */
  canDelete: (mEvent: MatrixEvent) => boolean;
};

/**
 * Event types the Del key counts as "a message of mine". Reactions, edits and
 * redactions are relations to a message rather than messages, and deleting the
 * newest of those instead of the message under it is never what was meant.
 */
const DELETABLE_TYPES = new Set<string>([
  MessageEvent.RoomMessage,
  MessageEvent.Sticker,
  MessageEvent.RoomMessageEncrypted,
]);

/**
 * The newest event this user may delete with `delete-last-message`.
 *
 * Walks back from the live end, like `edit-last-message`, because the last
 * event in a timeline is usually somebody else's message or a membership
 * change and the useful answer is the last message YOU sent. Skips edits
 * (`m.replace`): an edit is a separate event that displays merged into its
 * target, and redacting the edit alone would only revert the text.
 */
const getLatestDeletableEvt = (
  room: Room,
  userId: string,
  canDelete: (mEvent: MatrixEvent) => boolean,
): MatrixEvent | undefined => {
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (!ev || ev.isRedacted() || ev.isState()) continue;
    if (ev.getSender() !== userId) continue;
    if (!DELETABLE_TYPES.has(ev.getType())) continue;
    if (ev.getRelation()?.rel_type === RelationType.Replace) continue;
    if (!canDelete(ev)) continue;
    return ev;
  }
  return undefined;
};

/** True while a modal, popover or menu is mounted over the room. */
const overlayOpen = (): boolean => {
  const portalContainer = document.getElementById('portalContainer');
  return !!portalContainer && portalContainer.children.length > 0;
};

// Bindings keyed to the message currently under the cursor. Mounted once
// inside RoomTimeline so the room context here matches the visible
// timeline. All bindings are no-ops when no message is hovered (or the
// hovered event is no longer in this room's timeline).
export function MessageKeybinds({ room, onSetEditId, editor, canDelete }: Props) {
  const mx = useMatrixClient();
  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const pinnedEvents = useRoomPinnedEvents(room);

  /**
   * Run `cb` against the hovered message, and give the key back when there is
   * nothing to act on.
   *
   * `false` is what tells `useKeybind` not to `preventDefault`. Returning
   * nothing instead swallowed the key: these are bare letters (`e`, `p`, `r`,
   * `f`), and typing with focus outside the composer — straight after clicking
   * a room in the list, say — hands the keystroke to the composer from
   * RoomView's window listener. A cancelled keydown inserts no text, so
   * "foobar" arrived as "oobar", "pear" as "ear" and "rest" as "est".
   */
  const withHoveredEvent = (cb: (eventId: string) => void | false) => (): void | false => {
    const id = getHoveredMessageEventId();
    if (!id) return false;
    const ev = room.findEventById(id);
    if (!ev) return false;
    return cb(id);
  };

  // Edit own messages only — the server rejects edits from other senders
  // and the existing menu item is gated the same way.
  useKeybind(
    'edit-message',
    withHoveredEvent((id) => {
      const ev = room.findEventById(id);
      if (!ev) return false;
      if (ev.getSender() !== mx.getUserId()) return false;
      onSetEditId(id);
      return undefined;
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
      if (!userId) return false;
      // Toggle: unpin if already pinned, otherwise pin.
      const isPinned = pinnedEvents.includes(id);
      const next = isPinned ? pinnedEvents.filter((p) => p !== id) : [...pinnedEvents, id];
      mx.sendStateEvent(room.roomId, StateEvent.RoomPinnedEvents as any, { pinned: next }).catch(
        (err) => {
          console.error('[keybind] pin sendStateEvent failed:', err);
        },
      );
      return undefined;
    }),
  );

  useKeybind(
    'reply-message',
    withHoveredEvent((id) => {
      const replyEvt = room.findEventById(id);
      if (!replyEvt) return false;
      const editedReply = getEditedEvent(id, replyEvt, room.getUnfilteredTimelineSet());
      const content = editedReply?.getContent()['m.new_content'] ?? replyEvt.getContent();
      const body = content.body as string | undefined;
      const formattedBody = content.formatted_body as string | undefined;
      const relation = (replyEvt.getWireContent() as any)['m.relates_to'];
      const senderId = replyEvt.getSender();
      if (!senderId || typeof body !== 'string') return false;
      setReplyDraft({
        userId: senderId,
        eventId: id,
        body,
        formattedBody,
        relation,
      });
      return undefined;
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
      if (!hasMessageActionListener(id)) return false;
      const row = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      if (!row) return false;
      requestMessageAction(id, build(row));
      return undefined;
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

  /**
   * Del deletes your newest message in this room — no confirmation, no reason.
   *
   * The point is speed: send, notice the typo, Del, retype. A dialog in that
   * loop is the thing being removed, so there is none, and the binding is
   * rebindable for anyone who wants it further from their fingers.
   *
   * `allowInEditable` for the same reason as `edit-last-message`: the composer
   * is where this is pressed. The guard is the same too — only when the
   * composer has focus AND is empty, or when nothing editable is focused at
   * all — so Del in text is still forward-delete, and Del in the search box or
   * a message's edit box touches nothing. Nor does it fire under an open
   * overlay, where Del belongs to whatever dialog is up.
   */
  useKeybind(
    'delete-last-message',
    () => {
      if (overlayOpen()) return false;
      const active = document.activeElement as HTMLElement | null;
      const inEditable =
        !!active &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (inEditable) {
        if (!ReactEditor.isFocused(editor)) return false;
        if (!isEmptyEditor(editor)) return false;
      }
      const userId = mx.getUserId();
      if (!userId) return false;
      const target = getLatestDeletableEvt(room, userId, canDelete);
      const id = target?.getId();
      if (!id) return false;
      mx.redactEvent(room.roomId, id).catch((err) => {
        console.error('[keybind] delete-last-message redactEvent failed:', err);
      });
      return undefined;
    },
    { allowInEditable: true },
  );

  return null;
}
