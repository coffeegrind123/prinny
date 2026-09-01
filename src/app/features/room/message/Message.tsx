import {
  Avatar,
  Badge,
  Box,
  Button,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  IconSrc,
  Input,
  Line,
  Menu,
  MenuItem,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  RectCords,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  as,
  color,
  config,
} from 'folds';
import {
  FormEventHandler,
  MouseEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { FocusTrap } from 'focus-trap-react';
import { useHover, useFocusWithin } from 'react-aria';
import { EventStatus, MatrixEvent, MsgType, Room } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import classNames from 'classnames';
import { RoomPinnedEventsEventContent } from 'matrix-js-sdk/lib/types';
import {
  AvatarBase,
  BubbleLayout,
  CompactLayout,
  MessageBase,
  MessageTrailingContext,
  ModernLayout,
  SenderTime,
  Username,
  UsernameBold,
} from '../../../components/message';
import { BotBadge } from '../../../components/BotBadge';
import {
  canEditEvent,
  getEventEdits,
  getMemberAvatarMxc,
  getMemberDisplayName,
} from '../../../utils/room';
import {
  getMxIdLocalPart,
  mxcUrlToHttp,
} from '../../../utils/matrix';
import { markAsUnread } from '../../../utils/notifications';
import { getWebhookIdentity } from '../../../utils/webhook';
import { ForwardPrompt } from './ForwardPrompt';
import { EditHistoryPrompt } from './EditHistoryPrompt';
import {
  clearHoveredMessageEventId,
  setHoveredMessageEventId,
} from '../../../state/hoveredMessage';
import {
  clearHoveredMessageGroup,
  setHoveredMessageGroup,
} from '../../../state/hoveredMessageGroup';
import { useHoveredMessageGroup } from '../../../hooks/useHoveredMessageGroup';
import { useShiftKey } from '../../../hooks/useShiftKey';
import { subscribeMessageAction } from '../../../state/messageAction';
import { useElementReadReceipts } from '../../../hooks/useElementReadReceipts';
import { ReadReceiptAvatars } from '../../../components/read-receipt-avatars/ReadReceiptAvatars';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { MessageLayout, MessageSpacing } from '../../../state/settings';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useRecentEmoji } from '../../../hooks/useRecentEmoji';
import * as css from './styles.css';
import { EventReaders } from '../../../components/event-readers';
import { TextViewer } from '../../../components/text-viewer';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { EmojiBoard } from '../../../components/emoji-board';
import { ReactionViewer } from '../reaction-viewer';
import { MessageEditor } from './MessageEditor';
import { UserAvatar } from '../../../components/user-avatar';
import { AvatarPresence, PresenceBadge } from '../../../components/presence';
import { useUserPresence } from '../../../hooks/useUserPresence';
import { copyToClipboard } from '../../../utils/dom';
import { stopPropagation } from '../../../utils/keyboard';
import { getMatrixToRoomEvent } from '../../../plugins/matrix-to';
import { getViaServers } from '../../../plugins/via-servers';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useRoomPinnedEvents } from '../../../hooks/useRoomPinnedEvents';
import { MemberPowerTag, StateEvent } from '../../../../types/matrix/room';
import { PowerIcon } from '../../../components/power';
import colorMXID from '../../../../util/colorMXID';
import { getPowerTagIconSrc } from '../../../hooks/useMemberPowerTag';

export type ReactionHandler = (keyOrMxc: string, shortcode: string) => void;

/**
 * Stop a press on the hover options bar from starting a text selection.
 *
 * The bar floats 30px above its own row, which puts it over the blank
 * right-hand end of the message ABOVE it. Pressing there and dragging left is
 * an ordinary way to select a message, and it landed on a `<button>` — which
 * cannot hold a text caret, so the browser anchored the selection at the start
 * of the block instead and the highlight painted from the left of the message
 * rather than following the pointer. A one-line message is shorter than the
 * bar is tall, so its whole right-hand end sits under the bar and it failed
 * every time; a multi-line message only lost its first line, to the ~6px the
 * bar reaches back down into its own row.
 *
 * `preventDefault` on mousedown cancels precisely that default — beginning a
 * selection, and moving focus — and nothing else. `click` still fires, so
 * every button in the bar keeps working.
 *
 * This was arrived at by reproducing the bug in a standalone page and testing
 * candidates against it, NOT by reasoning about the CSS. Two earlier attempts
 * (2f11ee87, d883df63) moved the reserved gutter between margin and padding on
 * the theory that the bar was covering text; both cost layout width and
 * neither fixed it. Moving the bar after the text in DOM order and marking it
 * `user-select: none` were both tried in that harness too, and changed
 * nothing — the anchor comes from the block containing the button, not from
 * the button's own position or selectability.
 *
 * It hangs on the `Menu` rather than the positioning wrapper around it. The
 * wrapper is absolutely positioned with no size of its own, so it shrink-wraps
 * to exactly the Menu and the two cover the same pixels; but a mouse handler on
 * a bare `<div>` reads as an undeclared interactive element, which is a real
 * a11y complaint and not one worth silencing for a box that only exists to
 * position another one.
 *
 * **The containment test is not redundant.** React bubbles events through the
 * React tree, not the DOM tree, and both the emoji board and the message menu
 * are `PopOut`s rendered as children of this bar — folds portals their DOM to
 * `document.body`, but their events still arrive here. So does everything those
 * menus open in turn: the "View Source" viewer, Read Receipts, the edit-history
 * and forward dialogs. Every mousedown inside any of them was being
 * default-prevented by a handler meant for a toolbar 400px away, which is why
 * the source-view popup's text could not be selected — the same cancelled
 * default, doing the same thing it was asked to do, to the wrong element.
 * `currentTarget.contains(target)` is false for exactly the portalled ones,
 * since the portal's DOM is not inside the bar.
 */
const preventSelectionAnchor: MouseEventHandler<HTMLDivElement> = (evt) => {
  if (!evt.currentTarget.contains(evt.target as Node)) return;
  evt.preventDefault();
};

type MessageQuickReactionsProps = {
  onReaction: ReactionHandler;
};
export const MessageQuickReactions = as<'div', MessageQuickReactionsProps>(
  ({ onReaction, ...props }, ref) => {
    const mx = useMatrixClient();
    const recentEmojis = useRecentEmoji(mx, 4);

    if (recentEmojis.length === 0) return <span />;
    return (
      <>
        <Box
          style={{ padding: config.space.S200 }}
          alignItems="Center"
          justifyContent="Center"
          gap="200"
          {...props}
          ref={ref}
        >
          {recentEmojis.map((emoji) => (
            <IconButton
              key={emoji.unicode}
              className={css.MessageQuickReaction}
              size="300"
              variant="SurfaceVariant"
              radii="Pill"
              title={emoji.shortcode}
              aria-label={emoji.shortcode}
              onClick={() => onReaction(emoji.unicode, emoji.shortcode)}
            >
              <Text size="T500">{emoji.unicode}</Text>
            </IconButton>
          ))}
        </Box>
        <Line size="300" />
      </>
    );
  }
);

export const MessageAllReactionItem = as<
  'button',
  {
    room: Room;
    relations: Relations;
    onClose?: () => void;
  }
>(({ room, relations, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay
        onContextMenu={(evt: any) => {
          evt.stopPropagation();
        }}
        open={open}
        backdrop={<OverlayBackdrop />}
      >
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => handleClose(),
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Modal variant="Surface" size="300" flexHeight>
              <ReactionViewer
                room={room}
                relations={relations}
                requestClose={() => setOpen(false)}
              />
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.Smile} />}
        radii="300"
        onClick={() => setOpen(true)}
        {...props}
        ref={ref}
        aria-pressed={open}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          View Reactions
        </Text>
      </MenuItem>
    </>
  );
});

export const MessageReadReceiptItem = as<
  'button',
  {
    room: Room;
    eventId: string;
    onClose?: () => void;
  }
>(({ room, eventId, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: handleClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Modal variant="Surface" size="300" flexHeight>
              <EventReaders room={room} eventId={eventId} requestClose={handleClose} />
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.CheckTwice} />}
        radii="300"
        onClick={() => setOpen(true)}
        {...props}
        ref={ref}
        aria-pressed={open}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          Read Receipts
        </Text>
      </MenuItem>
    </>
  );
});

export const MessageSourceCodeItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  const getContent = (evt: MatrixEvent) =>
    evt.isEncrypted()
      ? {
          [`<== DECRYPTED_EVENT ==>`]: evt.getEffectiveEvent(),
          [`<== ORIGINAL_EVENT ==>`]: evt.event,
        }
      : evt.event;

  const getText = (): string => {
    const evtId = mEvent.getId()!;
    const evtTimeline = room.getTimelineForEvent(evtId);
    const edits =
      evtTimeline &&
      getEventEdits(evtTimeline.getTimelineSet(), evtId, mEvent.getType())?.getRelations();

    if (!edits) return JSON.stringify(getContent(mEvent), null, 2);

    const content: Record<string, unknown> = {
      '<== MAIN_EVENT ==>': getContent(mEvent),
    };

    edits.forEach((editEvt, index) => {
      content[`<== REPLACEMENT_EVENT_${index + 1} ==>`] = getContent(editEvt);
    });

    return JSON.stringify(content, null, 2);
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: handleClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Modal variant="Surface" size="500">
              <TextViewer
                name="Source Code"
                langName="json"
                text={getText()}
                requestClose={handleClose}
              />
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.BlockCode} />}
        radii="300"
        onClick={() => setOpen(true)}
        {...props}
        ref={ref}
        aria-pressed={open}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          View Source
        </Text>
      </MenuItem>
    </>
  );
});

export const MessageCopyLinkItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {

  const handleCopy = () => {
    const eventId = mEvent.getId();
    if (!eventId) return;
    copyToClipboard(getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room)));
    onClose?.();
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Link} />}
      radii="300"
      onClick={handleCopy}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        Copy Link
      </Text>
    </MenuItem>
  );
});

export const MessageEditHistoryItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  // Same signal the "(edited)" marker uses, so the entry appears on exactly the
  // messages that show as edited — never on a message that looks untouched.
  const evtId = mEvent.getId();
  const evtTimeline = evtId ? room.getTimelineForEvent(evtId) : undefined;
  const editCount =
    evtId && evtTimeline
      ? (getEventEdits(evtTimeline.getTimelineSet(), evtId, mEvent.getType())?.getRelations()
          ?.length ?? 0)
      : 0;

  if (editCount === 0) return null;

  return (
    <>
      {open && (
        <EditHistoryPrompt
          room={room}
          mEvent={mEvent}
          requestClose={() => {
            setOpen(false);
            onClose?.();
          }}
        />
      )}
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.Clock} />}
        radii="300"
        onClick={() => setOpen(true)}
        aria-pressed={open}
        {...props}
        ref={ref}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          Edit History
        </Text>
      </MenuItem>
    </>
  );
});

export const MessageForwardItem = as<
  'button',
  {
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ mEvent, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <ForwardPrompt
          mEvent={mEvent}
          requestClose={() => {
            setOpen(false);
            onClose?.();
          }}
        />
      )}
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.ArrowRight} />}
        radii="300"
        onClick={() => setOpen(true)}
        aria-pressed={open}
        {...props}
        ref={ref}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          Forward
        </Text>
      </MenuItem>
    </>
  );
});

export const MessagePinItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const mx = useMatrixClient();
  const pinnedEvents = useRoomPinnedEvents(room);
  const isPinned = pinnedEvents.includes(mEvent.getId() ?? '');

  const handlePin = () => {
    const eventId = mEvent.getId();
    const pinContent: RoomPinnedEventsEventContent = {
      pinned: Array.from(pinnedEvents).filter((id) => id !== eventId),
    };
    if (!isPinned && eventId) {
      pinContent.pinned.push(eventId);
    }
    mx.sendStateEvent(room.roomId, StateEvent.RoomPinnedEvents as any, pinContent);
    onClose?.();
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Pin} />}
      radii="300"
      onClick={handlePin}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {isPinned ? 'Unpin Message' : 'Pin Message'}
      </Text>
    </MenuItem>
  );
});

/**
 * The delete confirmation, on its own.
 *
 * Split out of `MessageDeleteItem` because the Shift toolbar reaches the same
 * action from an icon button rather than a menu row, and a confirmation dialog
 * cannot be owned by a toolbar that unmounts the instant the pointer leaves the
 * message. Same shape as `ForwardPrompt`: whoever wants it mounts it, and is
 * told when it is finished with.
 */
export function MessageDeletePrompt({
  room,
  mEvent,
  requestClose,
}: {
  room: Room;
  mEvent: MatrixEvent;
  requestClose: () => void;
}) {
  const mx = useMatrixClient();

  const [deleteState, deleteMessage] = useAsyncCallback(
    useCallback(
      (eventId: string, reason?: string) =>
        mx.redactEvent(room.roomId, eventId, undefined, reason ? { reason } : undefined),
      [mx, room]
    )
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const eventId = mEvent.getId();
    if (
      !eventId ||
      deleteState.status === AsyncStatus.Loading ||
      deleteState.status === AsyncStatus.Success
    )
      return;
    const target = evt.target as HTMLFormElement | undefined;
    const reasonInput = target?.reasonInput as HTMLInputElement | undefined;
    const reason = reasonInput && reasonInput.value.trim();
    deleteMessage(eventId, reason);
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: requestClose,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">Delete Message</Text>
              </Box>
              <IconButton size="300" onClick={requestClose} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box
              as="form"
              onSubmit={handleSubmit}
              style={{ padding: config.space.S400 }}
              direction="Column"
              gap="400"
            >
              <Text priority="400">
                This action is irreversible! Are you sure that you want to delete this message?
              </Text>
              <Box direction="Column" gap="100">
                <Text size="L400">
                  Reason{' '}
                  <Text as="span" size="T200">
                    (optional)
                  </Text>
                </Text>
                <Input name="reasonInput" variant="Background" />
                {deleteState.status === AsyncStatus.Error && (
                  <Text style={{ color: color.Critical.Main }} size="T300">
                    Failed to delete message! Please try again.
                  </Text>
                )}
              </Box>
              <Button
                type="submit"
                variant="Critical"
                before={
                  deleteState.status === AsyncStatus.Loading ? (
                    <Spinner fill="Solid" variant="Critical" size="200" />
                  ) : undefined
                }
                aria-disabled={deleteState.status === AsyncStatus.Loading}
              >
                <Text size="B400">
                  {deleteState.status === AsyncStatus.Loading ? 'Deleting...' : 'Delete'}
                </Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export const MessageDeleteItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const [open, setOpen] = useState(false);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      {open && <MessageDeletePrompt room={room} mEvent={mEvent} requestClose={handleClose} />}
      <Button
        variant="Critical"
        fill="None"
        size="300"
        after={<Icon size="100" src={Icons.Delete} />}
        radii="300"
        onClick={() => setOpen(true)}
        aria-pressed={open}
        {...props}
        ref={ref}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          Delete
        </Text>
      </Button>
    </>
  );
});

export const MessageReportItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const mx = useMatrixClient();
  const [open, setOpen] = useState(false);

  const [reportState, reportMessage] = useAsyncCallback(
    useCallback(
      (eventId: string, score: number, reason: string) =>
        mx.reportEvent(room.roomId, eventId, score, reason),
      [mx, room]
    )
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const eventId = mEvent.getId();
    if (
      !eventId ||
      reportState.status === AsyncStatus.Loading ||
      reportState.status === AsyncStatus.Success
    )
      return;
    const target = evt.target as HTMLFormElement | undefined;
    const reasonInput = target?.reasonInput as HTMLInputElement | undefined;
    const reason = reasonInput && reasonInput.value.trim();
    if (reasonInput) reasonInput.value = '';
    reportMessage(eventId, reason ? -100 : -50, reason || 'No reason provided');
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: handleClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Dialog variant="Surface">
              <Header
                style={{
                  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                  borderBottomWidth: config.borderWidth.B300,
                }}
                variant="Surface"
                size="500"
              >
                <Box grow="Yes">
                  <Text size="H4">Report Message</Text>
                </Box>
                <IconButton size="300" onClick={handleClose} radii="300">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Header>
              <Box
                as="form"
                onSubmit={handleSubmit}
                style={{ padding: config.space.S400 }}
                direction="Column"
                gap="400"
              >
                <Text priority="400">
                  Report this message to server, which may then notify the appropriate people to
                  take action.
                </Text>
                <Box direction="Column" gap="100">
                  <Text size="L400">Reason</Text>
                  <Input name="reasonInput" variant="Background" required />
                  {reportState.status === AsyncStatus.Error && (
                    <Text style={{ color: color.Critical.Main }} size="T300">
                      Failed to report message! Please try again.
                    </Text>
                  )}
                  {reportState.status === AsyncStatus.Success && (
                    <Text style={{ color: color.Success.Main }} size="T300">
                      Message has been reported to server.
                    </Text>
                  )}
                </Box>
                <Button
                  type="submit"
                  variant="Critical"
                  before={
                    reportState.status === AsyncStatus.Loading ? (
                      <Spinner fill="Solid" variant="Critical" size="200" />
                    ) : undefined
                  }
                  aria-disabled={
                    reportState.status === AsyncStatus.Loading ||
                    reportState.status === AsyncStatus.Success
                  }
                >
                  <Text size="B400">
                    {reportState.status === AsyncStatus.Loading ? 'Reporting...' : 'Report'}
                  </Text>
                </Button>
              </Box>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <Button
        variant="Critical"
        fill="None"
        size="300"
        after={<Icon size="100" src={Icons.Warning} />}
        radii="300"
        onClick={() => setOpen(true)}
        aria-pressed={open}
        {...props}
        ref={ref}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          Report
        </Text>
      </Button>
    </>
  );
});

type MessageShiftOptionButtonProps = {
  label: string;
  /** Shown in place of `label` for a moment after a press, as confirmation. */
  doneLabel?: string;
  icon: IconSrc;
  pressed?: boolean;
  /** Paints the button in the destructive palette. Delete, and nothing else. */
  critical?: boolean;
  eventId?: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
};
function MessageShiftOptionButton({
  label,
  doneLabel,
  icon,
  pressed,
  critical,
  eventId,
  onClick,
}: MessageShiftOptionButtonProps) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return undefined;
    const timeoutId = setTimeout(() => setDone(false), 1000);
    return () => clearTimeout(timeoutId);
  }, [done]);

  return (
    <TooltipProvider
      position="Top"
      align="Center"
      offset={4}
      delay={200}
      tooltip={
        <Tooltip>
          <Text size="L400">{done && doneLabel ? doneLabel : label}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          onClick={(evt: Parameters<MouseEventHandler<HTMLButtonElement>>[0]) => {
            onClick(evt);
            if (doneLabel) setDone(true);
          }}
          data-event-id={eventId}
          variant={critical ? 'Critical' : 'SurfaceVariant'}
          size="300"
          radii="300"
          aria-label={label}
          aria-pressed={pressed}
        >
          <Icon src={icon} size="100" />
        </IconButton>
      )}
    </TooltipProvider>
  );
}

/**
 * The hover toolbar as it looks while Shift is held — Discord's gesture.
 *
 * The whole bar is replaced, not just its emoji end: copy id, copy link, mark
 * unread, pin, reply, add reaction, edit, forward, delete, in that order. Held
 * Shift is a request for the FULL set of things that can be done to a message
 * without opening the "..." menu and clicking a second time, so the four that
 * the everyday bar already offers are repeated here rather than dropped — a bar
 * that removed them would make Shift a trade instead of an addition.
 *
 * Every button is conditional on the action being possible at all. Edit and
 * delete answer to the same checks the menu uses (`canEditEvent`, the room's
 * redaction power), so a message you may not touch simply shows a shorter bar.
 *
 * Copy Message ID rides on the developer-tools setting, the same gate Discord
 * puts it behind: an event id is meaningless to anyone not looking at the
 * protocol, and it is the one button here whose result is not visible in the
 * client.
 *
 * Add reaction, forward and delete each open something that outlives the bar —
 * a popover, a modal, a confirmation. None of them is owned here: the toolbar
 * unmounts the moment the pointer leaves the row, so it asks `Message` to open
 * them and `Message` holds them.
 *
 * Mounted only while Shift is actually down, so `useRoomPinnedEvents` — a state
 * event subscription — is live on one message at a time rather than on every
 * row in the timeline. That is the reason this is a component and not a branch
 * inlined into `Message`.
 */
export function MessageShiftOptions({
  room,
  mEvent,
  canDelete,
  canPinEvent,
  canSendReaction,
  showDeveloperTools,
  onReplyClick,
  onAddReaction,
  onEdit,
  onForward,
  onDelete,
}: {
  room: Room;
  mEvent: MatrixEvent;
  canDelete?: boolean;
  canPinEvent?: boolean;
  canSendReaction?: boolean;
  showDeveloperTools?: boolean;
  onReplyClick: MouseEventHandler<HTMLButtonElement>;
  onAddReaction: MouseEventHandler<HTMLButtonElement>;
  /** Absent when the timeline has nowhere to put an editor. */
  onEdit?: (eventId: string) => void;
  onForward: () => void;
  onDelete: () => void;
}) {
  const mx = useMatrixClient();
  const pinnedEvents = useRoomPinnedEvents(room);
  const eventId = mEvent.getId();
  const isPinned = !!eventId && pinnedEvents.includes(eventId);

  if (!eventId) return null;

  const handleCopyId = () => {
    copyToClipboard(eventId);
  };

  const handleCopyLink = () => {
    copyToClipboard(getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room)));
  };

  const handleMarkUnread = () => {
    markAsUnread(mx, room.roomId, eventId);
  };

  const handlePin = () => {
    const pinContent: RoomPinnedEventsEventContent = {
      pinned: pinnedEvents.filter((id) => id !== eventId),
    };
    if (!isPinned) pinContent.pinned.push(eventId);
    mx.sendStateEvent(room.roomId, StateEvent.RoomPinnedEvents as any, pinContent).catch((err) => {
      console.error('[shift-options] pin sendStateEvent failed:', err);
    });
  };

  return (
    <>
      {showDeveloperTools && (
        <MessageShiftOptionButton
          label="Copy Message ID"
          doneLabel="Copied!"
          icon={Icons.Hash}
          onClick={handleCopyId}
        />
      )}
      <MessageShiftOptionButton
        label="Copy Message Link"
        doneLabel="Copied!"
        icon={Icons.Link}
        onClick={handleCopyLink}
      />
      <MessageShiftOptionButton
        label="Mark Unread"
        icon={Icons.MessageUnread}
        onClick={handleMarkUnread}
      />
      {canPinEvent && (
        <MessageShiftOptionButton
          label={isPinned ? 'Unpin Message' : 'Pin Message'}
          icon={Icons.Pin}
          pressed={isPinned}
          onClick={handlePin}
        />
      )}
      <MessageShiftOptionButton
        label="Reply"
        icon={Icons.ReplyArrow}
        eventId={eventId}
        onClick={onReplyClick}
      />
      {canSendReaction && (
        <MessageShiftOptionButton
          label="Add Reaction"
          icon={Icons.SmilePlus}
          onClick={onAddReaction}
        />
      )}
      {onEdit && canEditEvent(mx, mEvent) && (
        <MessageShiftOptionButton
          label="Edit Message"
          icon={Icons.Pencil}
          onClick={() => onEdit(eventId)}
        />
      )}
      <MessageShiftOptionButton
        label="Forward Message"
        icon={Icons.ArrowRight}
        onClick={onForward}
      />
      {canDelete && !mEvent.isRedacted() && (
        // The one destructive button in a dense row of icons, and it carries
        // the same red the menu's Delete does. It opens the same confirmation,
        // so the colour is a warning rather than the only thing standing
        // between a slipped press and a redaction.
        <MessageShiftOptionButton
          label="Delete Message"
          icon={Icons.Delete}
          critical
          onClick={onDelete}
        />
      )}
    </>
  );
}

export type MessageProps = {
  room: Room;
  mEvent: MatrixEvent;
  collapse: boolean;
  /**
   * Event id of the FIRST message in this message's group — its own id when it
   * is that first message.
   *
   * The group is the run of consecutive same-sender messages that renders under
   * one header, i.e. this message plus every `collapse`d one after it. Only the
   * timeline knows where a run starts, which is why this is a prop rather than
   * something derived here.
   */
  groupHeadEventId?: string;
  highlight: boolean;
  repliedToMe?: boolean;
  edit?: boolean;
  canDelete?: boolean;
  canSendReaction?: boolean;
  canPinEvent?: boolean;
  imagePackRooms?: Room[];
  relations?: Relations;
  messageLayout: MessageLayout;
  messageSpacing: MessageSpacing;
  onUserClick: MouseEventHandler<HTMLButtonElement>;
  onUsernameClick: MouseEventHandler<HTMLButtonElement>;
  onReplyClick: (
    ev: Parameters<MouseEventHandler<HTMLButtonElement>>[0],
    startThread?: boolean
  ) => void;
  onThreadClick: (rootId: string) => void;
  onEditId?: (eventId?: string) => void;
  onReactionToggle: (targetEventId: string, key: string, shortcode?: string) => void;
  reply?: ReactNode;
  reactions?: ReactNode;
  /** Hide OTHER people's read receipts. Nothing to do with what you send. */
  hideOthersReadReceipts?: boolean;
  showDeveloperTools?: boolean;
  memberPowerTag?: MemberPowerTag;
  accessibleTagColors?: Map<string, string>;
  legacyUsernameColor?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
export const Message = as<'div', MessageProps>(
  (
    {
      className,
      room,
      mEvent,
      collapse,
      groupHeadEventId,
      highlight,
      repliedToMe,
      edit,
      canDelete,
      canSendReaction,
      canPinEvent,
      imagePackRooms,
      relations,
      messageLayout,
      messageSpacing,
      onUserClick,
      onUsernameClick,
      onReplyClick,
      onThreadClick,
      onReactionToggle,
      onEditId,
      reply,
      reactions,
      hideOthersReadReceipts,
      showDeveloperTools,
      memberPowerTag,
      accessibleTagColors,
      legacyUsernameColor,
      hour24Clock,
      dateFormatString,
      children,
      ...props
    },
    ref
  ) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const senderId = mEvent.getSender() ?? '';
    const [readReceiptStyle] = useSetting(settingsAtom, 'readReceiptStyle');
    const [replyOnDoubleClick] = useSetting(settingsAtom, 'replyOnDoubleClick');
    const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
    const elementReceipts = useElementReadReceipts(
      room,
      readReceiptStyle === 'element' && !hideOthersReadReceipts,
      showHiddenEvents
    );
    const receiptUserIds = elementReceipts.get(mEvent.getId() ?? '') ?? [];

    const [hover, setHover] = useState(false);
    const { hoverProps } = useHover({ onHoverChange: setHover });
    const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setHover });
    const [menuAnchor, setMenuAnchor] = useState<RectCords>();
    const [emojiBoardAnchor, setEmojiBoardAnchor] = useState<RectCords>();

    // Publish hover state to the module-level ref so keybinds bound at
    // RoomTimeline scope (MessageKeybinds) can act on the message under
    // the cursor without a context.
    useEffect(() => {
      const id = mEvent.getId();
      if (!id) return undefined;
      if (hover) setHoveredMessageEventId(id);
      return () => clearHoveredMessageEventId(id);
    }, [hover, mEvent]);

    /**
     * Publish the hover to the message that OWNS this message's header.
     *
     * A collapsed message has no header of its own, so the sender label it
     * should reveal lives on another component entirely — the group's first
     * message, which may be several rows up. That component subscribes below;
     * this is the other half. Falls back to this message's own id so a message
     * rendered without the prop still lights up its own header.
     */
    useEffect(() => {
      const id = mEvent.getId();
      if (!id) return undefined;
      if (hover) setHoveredMessageGroup(id, groupHeadEventId ?? id);
      return () => clearHoveredMessageGroup(id);
    }, [hover, mEvent, groupHeadEventId]);

    /**
     * Only a group's first message subscribes: it is the only one that renders
     * the label, and keying the store by head means a pointer moving within a
     * group notifies nothing at all.
     */
    const groupHovered = useHoveredMessageGroup(
      collapse ? undefined : groupHeadEventId ?? mEvent.getId()
    );

    const [forwardOpen, setForwardOpen] = useState(false);
    // Owned here rather than by the Shift toolbar that opens it: that toolbar
    // unmounts as soon as the pointer leaves the row, and a confirmation dialog
    // that vanishes when you move towards it is worse than none.
    const [deleteOpen, setDeleteOpen] = useState(false);

    /**
     * Holding Shift swaps the hover toolbar for the power actions, the way
     * Discord's does — see `MessageShiftOptions`.
     *
     * Subscribed only while this row is hovered, which is the whole reason the
     * modifier can be watched at all: a shared subscription would re-render
     * every message in the timeline on every capital letter typed into the
     * composer. `hover` also covers keyboard focus (`focusWithinProps` feeds the
     * same state), so the gesture is reachable without a pointer.
     *
     * Suppressed while this message's own emoji board or menu is open. Both
     * contain a text field, and Shift in a text field means a capital letter —
     * swapping the toolbar underneath an open popover would move the button the
     * popover is anchored to while the user is typing into it.
     */
    const shiftHeld = useShiftKey(hover && !edit);
    const showShiftOptions = shiftHeld && !menuAnchor && !emojiBoardAnchor;

    /**
     * Service the keybinds that need this component rather than just the SDK.
     *
     * `add-reaction` and `forward-message` open a popover and a modal owned by
     * this instance, so `MessageKeybinds` can only ask; see `state/messageAction`.
     * Subscribing per message rather than reading a shared atom keeps a keypress
     * from re-rendering every row in the timeline.
     */
    useEffect(() => {
      const id = mEvent.getId();
      if (!id || edit) return undefined;
      return subscribeMessageAction(id, (request) => {
        if (request.type === 'add-reaction') {
          setEmojiBoardAnchor(request.anchor);
          return;
        }
        setForwardOpen(true);
      });
    }, [mEvent, edit]);

    /**
     * A webhook posts under a name of its own — "CI", "Deploy", "Alerts" — and
     * the message is attributed to that rather than to the bot account that
     * relayed it. Without this every integration in a room reads as one sender,
     * which is the whole reason Discord webhooks carry a username at all.
     *
     * Self-asserted, and labelled as such by the WEBHOOK badge beside it. The
     * account underneath is unchanged: it still owns the avatar (unless the
     * webhook supplied an `mxc://` one), and the full mxid still appears on
     * hover.
     */
    const webhookIdentity = getWebhookIdentity(mEvent);
    const senderDisplayName =
      webhookIdentity?.username ??
      getMemberDisplayName(room, senderId) ??
      getMxIdLocalPart(senderId) ??
      senderId;
    const senderAvatarMxc = webhookIdentity?.avatarUrl ?? getMemberAvatarMxc(room, senderId);
    const senderPresence = useUserPresence(senderId);

    // Local echo status. Sends were fire-and-forget: a message that never
    // reached the server looked exactly like one that did, and then vanished on
    // the next reload with nothing to explain where it went. RoomTimeline
    // subscribes to RoomEvent.LocalEchoUpdated so these transitions re-render.
    const eventStatus = mEvent.status;
    const isSending =
      eventStatus === EventStatus.SENDING ||
      eventStatus === EventStatus.QUEUED ||
      eventStatus === EventStatus.ENCRYPTING;
    const isFailed = eventStatus === EventStatus.NOT_SENT;

    const [retryState, resendMessage] = useAsyncCallback(
      useCallback(() => Promise.resolve(mx.resendEvent(mEvent, room)), [mx, mEvent, room])
    );
    const handleRemoveFailed = useCallback(() => {
      mx.cancelPendingEvent(mEvent);
    }, [mx, mEvent]);

    const tagColor = memberPowerTag?.color
      ? accessibleTagColors?.get(memberPowerTag.color)
      : undefined;
    const tagIconSrc = memberPowerTag?.icon
      ? getPowerTagIconSrc(mx, useAuthentication, memberPowerTag.icon)
      : undefined;

    const usernameColor = legacyUsernameColor ? colorMXID(senderId) : tagColor;

    const headerJSX = !collapse && (
      <Box
        className={
          messageLayout === MessageLayout.Modern ? css.MessageHeaderOptionsSpace : undefined
        }
        gap="300"
        direction={messageLayout === MessageLayout.Compact ? 'RowReverse' : 'Row'}
        justifyContent="SpaceBetween"
        alignItems="Baseline"
        grow="Yes"
      >
        <Box alignItems="Baseline" gap="200" grow="Yes">
          {/*
            Wraps rather than squeezing. The name is shown in full now (see
            `Username` in layout.css.ts), so when the row runs out of width the
            timestamp moves to the next line instead of the name losing its tail
            — which is what happened on a phone and on a narrow window.
          */}
          <Box alignItems="Baseline" gap="100" wrap="Wrap">
            <Username
              as="button"
              style={{ color: usernameColor }}
              data-user-id={senderId}
              onContextMenu={onUserClick}
              onClick={onUsernameClick}
            >
              <Text as="span" size={messageLayout === MessageLayout.Bubble ? 'T300' : 'T400'}>
                <UsernameBold>{senderDisplayName}</UsernameBold>
              </Text>
            </Username>
            {webhookIdentity ? (
              <Badge as="span" size="400" variant="Secondary" fill="Soft" radii="300">
                <Text as="span" size="L400">
                  WEBHOOK
                </Text>
              </Badge>
            ) : (
              <BotBadge room={room} userId={senderId} />
            )}
            <SenderTime
              senderId={senderId}
              ts={mEvent.getTs()}
              compact={messageLayout === MessageLayout.Compact}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
              // Inside the timestamp's own slot, not beside it. That slot is
              // sized to the (invisible) sender-local string so the hover swap
              // moves nothing, so a clock placed after it floated away from the
              // time it qualifies whenever that string was the wider of the two.
              trailing={
                isSending && (
                  <Icon
                    className={css.MessageStatusSending}
                    size="50"
                    src={Icons.Clock}
                    aria-label="Sending"
                  />
                )
              }
            />
          </Box>
          {tagIconSrc && <PowerIcon size="100" iconSrc={tagIconSrc} />}
        </Box>
      </Box>
    );

    /**
     * A collapsed message shows no time of its own — the one in the group
     * header is the first message's — and its avatar slot is empty for the same
     * reason. Hovering fills that slot with this message's own time.
     *
     * Compact layout is excluded because it already puts a timestamp at the
     * start of every row, collapsed or not; there is nothing missing to
     * restore, and it has no avatar slot to put it in.
     */
    const gutterTimeJSX = collapse &&
      messageLayout !== MessageLayout.Compact &&
      (hover || !!menuAnchor) && (
        // The wrapper carries the positioning and the line box; Time keeps its
        // own smaller type. Putting both on one element would pit
        // `line-height: inherit` against the size token folds sets on the very
        // same class, and which of two equally specific rules wins is settled
        // by stylesheet order — not something to hang alignment on.
        <div className={css.MessageGutterTime}>
          <SenderTime
            senderId={senderId}
            ts={mEvent.getTs()}
            compact
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        </div>
      );

    /**
     * The sender's full mxid, shown on hover — on EVERY message of a group.
     *
     * The full id and not just the localpart: two people can share a localpart
     * across homeservers, which is exactly when knowing who sent something
     * matters, and that is the part which disambiguates them.
     *
     * This is deliberately one element for both a group's first message and the
     * ones after it. It used to be two — a flex child of `headerJSX` when
     * `!collapse`, and this positioned one when `collapse` — which drifted:
     * only the positioned one was ever given clearance for the hover toolbar,
     * so the same label sat 144px apart between the two cases. Worse, the
     * flush-right one was the broken case rather than the correct one, sitting
     * under an opaque toolbar and losing the tops of its glyphs.
     *
     * Modern layout only: Compact already puts the sender at the start of every
     * row, and Bubble groups by column.
     */
    // Group's first line only. A collapsed message is one of a run from the
    // same sender directly under that header, so repeating the mxid on each
    // of them labels the same sender over and over; the header line is where
    // the sender is identified, and that is where the full id belongs.
    //
    // `groupHovered` is what makes hovering ANY message of the group show it —
    // the pointer is far more often on a collapsed message than on the header,
    // and a label that only answered "who sent this?" while the pointer was on
    // the one row that already names the sender answered it exactly when it was
    // not being asked. `hover` stays in the condition as the local fallback for
    // a message rendered outside a timeline that tracks groups.
    const senderMxIdJSX = messageLayout === MessageLayout.Modern &&
      !collapse &&
      (hover || groupHovered) && (
        // `ground` is decided by THIS row, not by the group's hover: it picks
        // the background the label paints over itself, and only the row the
        // pointer is actually on is tinted. A row that replies to you keeps
        // `MessageReplyHighlight`'s amber while it is unhovered, and the label
        // has to carry that too or it reads as a grey box on a golden row.
        <div
          className={css.MessageSenderMxId({
            ground: hover ? 'hover' : repliedToMe ? 'reply' : 'plain',
          })}
        >
          {/*
            `truncate` lives on the Text, not the wrapper: the wrapper is a
            flex container now (it centres this line in the band under the
            hover toolbar), and `text-overflow` applies to the box whose own
            content overflows — which is this one.
          */}
          <Text as="span" size="T200" priority="300" truncate>
            {senderId}
          </Text>
        </div>
      );

    const avatarJSX = !collapse && messageLayout !== MessageLayout.Compact && (
      <AvatarBase
        className={messageLayout === MessageLayout.Bubble ? css.BubbleAvatarBase : undefined}
      >
        <AvatarPresence
          badge={
            senderPresence ? (
              <PresenceBadge
                presence={senderPresence.presence}
                status={senderPresence.status}
                size="200"
              />
            ) : null
          }
        >
          <Avatar
            className={css.MessageAvatar}
            as="button"
            size="300"
            data-user-id={senderId}
            onClick={onUserClick}
          >
            <UserAvatar
              userId={senderId}
              src={
                senderAvatarMxc
                  ? mxcUrlToHttp(mx, senderAvatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined
                  : undefined
              }
              alt={senderDisplayName}
              renderFallback={() => <Icon size="200" src={Icons.User} filled />}
            />
          </Avatar>
        </AvatarPresence>
      </AvatarBase>
    );

    const [readReceiptOpen, setReadReceiptOpen] = useState(false);

    /**
     * Which messages can take the receipts inline, and the two shapes they come
     * in.
     *
     * Keyed off the msgtype rather than off anything about the rendered node,
     * because this component only ever sees that node as opaque `children`.
     * These three are exactly the msgtypes `RenderMessageContent` sends to
     * `MText` / `MEmote` / `MNotice`, which are the renderers that read the
     * trailing context; anything else lands on an attachment renderer that does
     * not, and would silently drop the receipts if it were handed them.
     */
    const msgType = (mEvent.getContent() as { msgtype?: string }).msgtype;
    const textLikeContent =
      msgType === MsgType.Text || msgType === MsgType.Notice || msgType === MsgType.Emote;

    const receiptsJSX = receiptUserIds.length > 0 && (
      <Box shrink="No" style={{ cursor: 'pointer' }} onClick={() => setReadReceiptOpen(true)}>
        <ReadReceiptAvatars room={room} userIds={receiptUserIds} />
      </Box>
    );

    // The same avatars as an inline box, so they join the text's line boxes
    // instead of sitting beside the block. `vertical-align` is carried by the
    // class; see MessageInlineReceipts.
    const inlineReceiptsJSX = textLikeContent && receiptUserIds.length > 0 && (
      <Box
        as="span"
        className={css.MessageInlineReceipts}
        onClick={() => setReadReceiptOpen(true)}
      >
        <ReadReceiptAvatars room={room} userIds={receiptUserIds} />
      </Box>
    );

    /**
     * Whether the body column spans the row instead of shrink-wrapping.
     *
     * A press in the blank strip to the RIGHT of a message resolves to a caret
     * position, and which one depends on what else is in the column. With the
     * body column shrink-wrapped (`alignSelf="Start"`) and a full-width header
     * sibling above it — which is exactly a group's FIRST message — Chromium
     * resolves that press to offset 0 of the body instead of the end of the
     * line. A drag started there therefore anchors at the start of the message
     * and paints from the left, and the half of the text it selects is the
     * wrong half. Collapsed messages have no header, so they never showed it,
     * and a message wide enough to leave no blank strip never showed it either.
     *
     * Stretching the column puts that strip inside the body's own block and the
     * press resolves to the end of the line, matching a collapsed message
     * exactly. `alignItems="Start"` hands the shrink-wrapping to the children,
     * so the reply preview, the reactions and the receipts keep the widths they
     * had. Only Modern layout needs it: Compact puts this column in a ROW, where
     * `alignSelf` is the vertical axis and means something else entirely, and
     * Bubble keeps its header outside the bubble so the two are never siblings.
     *
     * Measured, not reasoned about: a press at the right of a one-line group
     * leader dragged back to 45% of the text selected the leading "short lead"
     * and painted from the message's left edge; with this it selects the
     * trailing "ing message" and paints from the pointer, which is what the
     * collapsed control did all along.
     */
    const stretchBodyColumn =
      messageLayout !== MessageLayout.Compact && messageLayout !== MessageLayout.Bubble;

    const msgContentJSX = (
      <Box
        direction="Column"
        alignSelf={stretchBodyColumn ? undefined : 'Start'}
        alignItems={stretchBodyColumn ? 'Start' : undefined}
        style={{ maxWidth: '100%' }}
      >
        {reply}
        {edit && onEditId ? (
          <MessageEditor
            style={{
              maxWidth: '100%',
              width: '100vw',
            }}
            roomId={room.roomId}
            room={room}
            mEvent={mEvent}
            imagePackRooms={imagePackRooms}
            onCancel={() => onEditId()}
          />
        ) : (
          /*
           * Receipts sit at the end of the message, not at the end of the
           * widest thing above it.
           *
           * The body used to `grow`, which sounds harmless but is what put them
           * in the wrong place: this row lives inside a column that shrink-wraps
           * (`alignSelf="Start"` on msgContentJSX), so the column is as wide as
           * its widest child — often the reply preview. A growing body then
           * filled that width and pushed the receipts out to the REPLY's right
           * edge, leaving them floating past the end of a message that might be
           * two words long.
           *
           * Without the grow, the row is only as wide as the message plus the
           * receipts, so they land where the message actually ends.
           *
           * That is still only true of a message that does not wrap. Laying the
           * receipts out HERE can only ever place them beside the body's box,
           * and a text block's box is as wide as its longest line — so on a
           * wrapped message they sat out past the end of the longest line with a
           * gap after the short final one, and `alignItems="End"` put them
           * against the bottom edge of that box rather than on the last line's
           * text. Text messages therefore hand them to `MessageTrailingContext`
           * instead, which drops them into the same inline flow as the body so
           * they follow the last character and centre on it, and this row is
           * left to the attachments, which have no last line to sit after and
           * want them beside the card exactly as before.
           */
          <MessageTrailingContext.Provider value={inlineReceiptsJSX || null}>
            <Box gap="200" alignItems="End" style={{ maxWidth: '100%' }}>
              <Box style={{ minWidth: 0 }}>{children}</Box>
              {!textLikeContent && receiptsJSX}
            </Box>
          </MessageTrailingContext.Provider>
        )}
        {reactions}
        {isFailed && (
          <Box className={css.MessageFailedBar} direction="Row" alignItems="Center" gap="200">
            <Icon size="100" src={Icons.Warning} style={{ color: color.Critical.Main }} />
            <Text size="T300" style={{ color: color.Critical.Main }}>
              {retryState.status === AsyncStatus.Error
                ? 'Failed to send. Retry failed.'
                : 'Failed to send'}
            </Text>
            <Box shrink="No" grow="Yes" justifyContent="End" gap="100" alignItems="Center">
              {retryState.status === AsyncStatus.Loading ? (
                <Spinner size="100" variant="Critical" />
              ) : (
                <Button
                  size="300"
                  variant="Critical"
                  fill="Soft"
                  radii="300"
                  onClick={() => resendMessage()}
                  before={<Icon size="100" src={Icons.Reload} />}
                >
                  <Text size="B300">Retry</Text>
                </Button>
              )}
              <IconButton
                variant="Critical"
                fill="Soft"
                size="300"
                radii="300"
                onClick={handleRemoveFailed}
                aria-label="Remove failed message"
              >
                <Icon size="100" src={Icons.Cross} />
              </IconButton>
            </Box>
          </Box>
        )}
        {forwardOpen && (
          <ForwardPrompt mEvent={mEvent} requestClose={() => setForwardOpen(false)} />
        )}
        {deleteOpen && (
          <MessageDeletePrompt
            room={room}
            mEvent={mEvent}
            requestClose={() => setDeleteOpen(false)}
          />
        )}
        <Overlay open={readReceiptOpen} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: () => setReadReceiptOpen(false),
                clickOutsideDeactivates: true,
                escapeDeactivates: stopPropagation,
              }}
            >
              <Modal variant="Surface" size="300" flexHeight>
                <EventReaders
                  room={room}
                  eventId={mEvent.getId() ?? ''}
                  requestClose={() => setReadReceiptOpen(false)}
                />
              </Modal>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      </Box>
    );

    const handleContextMenu: MouseEventHandler<HTMLDivElement> = (evt) => {
      if (evt.altKey || !window.getSelection()?.isCollapsed || edit) return;
      const tag = (evt.target as any).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'a') return;
      evt.preventDefault();
      setMenuAnchor({
        x: evt.clientX,
        y: evt.clientY,
        width: 0,
        height: 0,
      });
    };

    /**
     * Double-clicking a message stages a reply to it.
     *
     * Interactive children keep their own behaviour: a double-click on a link,
     * a button or an input belongs to that element, not to the message.
     *
     * It does NOT exclude the message text, and used to. The reasoning was that
     * a double-click on text means "select this word" everywhere else, so
     * landing on text was read as aiming at the text and skipped — which left
     * the gesture working only on the blank strip beside a message. Since the
     * text is the part anyone actually double-clicks, the feature read as
     * simply broken. The word still gets selected either way; the browser does
     * that itself and staging a reply does not undo it. Anyone who wants the
     * old behaviour has the setting.
     *
     * Switchable via `replyOnDoubleClick`, which the keybind registry exposes
     * as the `reply-double-click` gesture so it sits beside the `r` binding
     * that does the same job — a gesture nobody can find in a settings list is
     * indistinguishable from one that does not exist.
     */
    const handleDoubleClick: MouseEventHandler<HTMLDivElement> = useCallback(
      (evt) => {
        if (!replyOnDoubleClick) return;
        if (edit) return;
        const target = evt.target as HTMLElement;
        if (target.closest('a, button, input, textarea, [contenteditable]')) return;
        onReplyClick(evt as unknown as Parameters<typeof onReplyClick>[0]);
      },
      [edit, onReplyClick, replyOnDoubleClick]
    );

    const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setMenuAnchor(target.getBoundingClientRect());
    };

    const closeMenu = () => {
      setMenuAnchor(undefined);
    };

    const handleOpenEmojiBoard: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setEmojiBoardAnchor(target.getBoundingClientRect());
    };
    const handleAddReactions: MouseEventHandler<HTMLButtonElement> = () => {
      const rect = menuAnchor;
      closeMenu();
      // open it with timeout because closeMenu
      // FocusTrap will return focus from emojiBoard

      setTimeout(() => {
        setEmojiBoardAnchor(rect);
      }, 100);
    };

    const isThreadedMessage = mEvent.threadRootId !== undefined;

    return (
      <MessageBase
        className={classNames(css.MessageBase, className, {
          [css.MessageBaseBubbleCollapsed]: messageLayout === MessageLayout.Bubble && collapse,
          [css.MessageReplyHighlight]: repliedToMe,
          [css.MessageSending]: isSending,
        })}
        tabIndex={0}
        space={messageSpacing}
        collapse={collapse}
        highlight={highlight}
        selected={!!menuAnchor || !!emojiBoardAnchor}
        onDoubleClick={handleDoubleClick}
        {...props}
        {...hoverProps}
        {...focusWithinProps}
        ref={ref}
      >
        {senderMxIdJSX}
        {!edit && (hover || !!menuAnchor || !!emojiBoardAnchor) && (
          <div className={css.MessageOptionsBase}>
            <Menu
              className={css.MessageOptionsBar}
              variant="SurfaceVariant"
              onMouseDown={preventSelectionAnchor}
            >
              <Box gap="100">
                {showShiftOptions ? (
                  <MessageShiftOptions
                    room={room}
                    mEvent={mEvent}
                    canDelete={canDelete}
                    canPinEvent={canPinEvent}
                    canSendReaction={canSendReaction}
                    showDeveloperTools={showDeveloperTools}
                    onReplyClick={onReplyClick}
                    // Setting the anchor drops `showShiftOptions`, so the board
                    // opens against the everyday toolbar that takes this bar's
                    // place. Same anchor rect either way — `handleOpenEmojiBoard`
                    // measures the bar, not the button — so it lands where the
                    // button the user pressed was standing.
                    onAddReaction={handleOpenEmojiBoard}
                    onEdit={onEditId}
                    onForward={() => setForwardOpen(true)}
                    onDelete={() => setDeleteOpen(true)}
                  />
                ) : (
                  <>
                    {canSendReaction && (
                      <PopOut
                        position="Bottom"
                        align={emojiBoardAnchor?.width === 0 ? 'Start' : 'End'}
                        offset={emojiBoardAnchor?.width === 0 ? 0 : undefined}
                        anchor={emojiBoardAnchor}
                        content={
                          <EmojiBoard
                            imagePackRooms={imagePackRooms ?? []}
                            returnFocusOnDeactivate={false}
                            allowTextCustomEmoji
                            allowMashup
                            onEmojiSelect={(key) => {
                              onReactionToggle(mEvent.getId()!, key);
                              setEmojiBoardAnchor(undefined);
                            }}
                            onCustomEmojiSelect={(mxc, shortcode) => {
                              onReactionToggle(mEvent.getId()!, mxc, shortcode);
                              setEmojiBoardAnchor(undefined);
                            }}
                            requestClose={() => {
                              setEmojiBoardAnchor(undefined);
                            }}
                          />
                        }
                      >
                        <IconButton
                          onClick={handleOpenEmojiBoard}
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                          aria-pressed={!!emojiBoardAnchor}
                        >
                          <Icon src={Icons.SmilePlus} size="100" />
                        </IconButton>
                      </PopOut>
                    )}
                    <IconButton
                      onClick={onReplyClick}
                      data-event-id={mEvent.getId()}
                      variant="SurfaceVariant"
                      size="300"
                      radii="300"
                    >
                      <Icon src={Icons.ReplyArrow} size="100" />
                    </IconButton>
                    {(
                      <IconButton
                        onClick={() => {
                          const threadRoot = mEvent.threadRootId ?? mEvent.getId();
                          if (threadRoot) onThreadClick(threadRoot);
                        }}
                        data-event-id={mEvent.getId()}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                      >
                        <Icon src={Icons.ThreadPlus} size="100" />
                      </IconButton>
                    )}
                    {canEditEvent(mx, mEvent) && onEditId && (
                      <IconButton
                        onClick={() => onEditId(mEvent.getId())}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                      >
                        <Icon src={Icons.Pencil} size="100" />
                      </IconButton>
                    )}
                    <PopOut
                      anchor={menuAnchor}
                      position="Bottom"
                      align={menuAnchor?.width === 0 ? 'Start' : 'End'}
                      offset={menuAnchor?.width === 0 ? 0 : undefined}
                      content={
                        <FocusTrap
                          focusTrapOptions={{
                            initialFocus: false,
                            onDeactivate: () => setMenuAnchor(undefined),
                            clickOutsideDeactivates: true,
                            isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                            isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                            escapeDeactivates: stopPropagation,
                          }}
                        >
                          <Menu>
                            {canSendReaction && (
                              <MessageQuickReactions
                                onReaction={(key, shortcode) => {
                                  onReactionToggle(mEvent.getId()!, key, shortcode);
                                  closeMenu();
                                }}
                              />
                            )}
                            <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                              {canSendReaction && (
                                <MenuItem
                                  size="300"
                                  after={<Icon size="100" src={Icons.SmilePlus} />}
                                  radii="300"
                                  onClick={handleAddReactions}
                                >
                                  <Text
                                    className={css.MessageMenuItemText}
                                    as="span"
                                    size="T300"
                                    truncate
                                  >
                                    Add Reaction
                                  </Text>
                                </MenuItem>
                              )}
                              {relations && (
                                <MessageAllReactionItem
                                  room={room}
                                  relations={relations}
                                  onClose={closeMenu}
                                />
                              )}
                              <MenuItem
                                size="300"
                                after={<Icon size="100" src={Icons.ReplyArrow} />}
                                radii="300"
                                data-event-id={mEvent.getId()}
                                onClick={(evt: any) => {
                                  onReplyClick(evt);
                                  closeMenu();
                                }}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  Reply
                                </Text>
                              </MenuItem>
                              <MenuItem
                                size="300"
                                after={<Icon src={Icons.ThreadPlus} size="100" />}
                                radii="300"
                                data-event-id={mEvent.getId()}
                                onClick={() => {
                                  // Both cases open the panel: on a root it starts
                                  // (or resumes) its thread, on a reply it opens the
                                  // thread that reply belongs to. Seeding the room
                                  // composer with a thread relation, as this used
                                  // to, left the reply to be typed in a composer
                                  // that showed no thread at all.
                                  const threadRoot = mEvent.threadRootId ?? mEvent.getId();
                                  if (threadRoot) onThreadClick(threadRoot);
                                  closeMenu();
                                }}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  {isThreadedMessage ? 'View Thread' : 'Reply in Thread'}
                                </Text>
                              </MenuItem>
                              {canEditEvent(mx, mEvent) && onEditId && (
                                <MenuItem
                                  size="300"
                                  after={<Icon size="100" src={Icons.Pencil} />}
                                  radii="300"
                                  data-event-id={mEvent.getId()}
                                  onClick={() => {
                                    onEditId(mEvent.getId());
                                    closeMenu();
                                  }}
                                >
                                  <Text
                                    className={css.MessageMenuItemText}
                                    as="span"
                                    size="T300"
                                    truncate
                                  >
                                    Edit Message
                                  </Text>
                                </MenuItem>
                              )}
                              {!hideOthersReadReceipts && (
                                <MessageReadReceiptItem
                                  room={room}
                                  eventId={mEvent.getId() ?? ''}
                                  onClose={closeMenu}
                                />
                              )}
                              {showDeveloperTools && (
                                <MessageSourceCodeItem
                                  room={room}
                                  mEvent={mEvent}
                                  onClose={closeMenu}
                                />
                              )}
                              <MessageForwardItem mEvent={mEvent} onClose={closeMenu} />
                              <MessageEditHistoryItem
                                room={room}
                                mEvent={mEvent}
                                onClose={closeMenu}
                              />
                              <MessageCopyLinkItem room={room} mEvent={mEvent} onClose={closeMenu} />
                              <MenuItem
                                size="300"
                                after={<Icon size="100" src={Icons.MessageUnread} />}
                                radii="300"
                                onClick={() => {
                                  markAsUnread(mx, room.roomId, mEvent.getId()!);
                                  closeMenu();
                                }}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  Mark Unread
                                </Text>
                              </MenuItem>
                              {canPinEvent && (
                                <MessagePinItem room={room} mEvent={mEvent} onClose={closeMenu} />
                              )}
                            </Box>
                            {((!mEvent.isRedacted() && canDelete) ||
                              mEvent.getSender() !== mx.getUserId()) && (
                              <>
                                <Line size="300" />
                                <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                                  {!mEvent.isRedacted() && canDelete && (
                                    <MessageDeleteItem
                                      room={room}
                                      mEvent={mEvent}
                                      onClose={closeMenu}
                                    />
                                  )}
                                  {mEvent.getSender() !== mx.getUserId() && (
                                    <MessageReportItem
                                      room={room}
                                      mEvent={mEvent}
                                      onClose={closeMenu}
                                    />
                                  )}
                                </Box>
                              </>
                            )}
                          </Menu>
                        </FocusTrap>
                      }
                    >
                      <IconButton
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                        onClick={handleOpenMenu}
                        aria-pressed={!!menuAnchor}
                      >
                        <Icon src={Icons.VerticalDots} size="100" />
                      </IconButton>
                    </PopOut>
                  </>
                )}
              </Box>
            </Menu>
          </div>
        )}
        {messageLayout === MessageLayout.Compact && (
          <CompactLayout before={headerJSX} onContextMenu={handleContextMenu}>
            {msgContentJSX}
          </CompactLayout>
        )}
        {messageLayout === MessageLayout.Bubble && (
          <BubbleLayout
            before={avatarJSX || gutterTimeJSX}
            header={headerJSX}
            onContextMenu={handleContextMenu}
          >
            {msgContentJSX}
          </BubbleLayout>
        )}
        {messageLayout !== MessageLayout.Compact && messageLayout !== MessageLayout.Bubble && (
          <ModernLayout before={avatarJSX || gutterTimeJSX} onContextMenu={handleContextMenu}>
            {headerJSX}
            {msgContentJSX}
          </ModernLayout>
        )}
      </MessageBase>
    );
  }
);

export type EventProps = {
  room: Room;
  mEvent: MatrixEvent;
  highlight: boolean;
  canDelete?: boolean;
  messageSpacing: MessageSpacing;
  /** Hide OTHER people's read receipts. Nothing to do with what you send. */
  hideOthersReadReceipts?: boolean;
  showDeveloperTools?: boolean;
};
export const Event = as<'div', EventProps>(
  (
    {
      className,
      room,
      mEvent,
      highlight,
      canDelete,
      messageSpacing,
      hideOthersReadReceipts,
      showDeveloperTools,
      children,
      ...props
    },
    ref
  ) => {
    const mx = useMatrixClient();
    const [hover, setHover] = useState(false);
    const { hoverProps } = useHover({ onHoverChange: setHover });
    const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setHover });
    const [menuAnchor, setMenuAnchor] = useState<RectCords>();
    const stateEvent = typeof mEvent.getStateKey() === 'string';

    const handleContextMenu: MouseEventHandler<HTMLDivElement> = (evt) => {
      if (evt.altKey || !window.getSelection()?.isCollapsed) return;
      const tag = (evt.target as any).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'a') return;
      evt.preventDefault();
      setMenuAnchor({
        x: evt.clientX,
        y: evt.clientY,
        width: 0,
        height: 0,
      });
    };

    const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setMenuAnchor(target.getBoundingClientRect());
    };

    const closeMenu = () => {
      setMenuAnchor(undefined);
    };

    return (
      <MessageBase
        className={classNames(css.MessageBase, className)}
        tabIndex={0}
        space={messageSpacing}
        autoCollapse
        highlight={highlight}
        selected={!!menuAnchor}
        {...props}
        {...hoverProps}
        {...focusWithinProps}
        ref={ref}
      >
        {(hover || !!menuAnchor) && (
          <div className={css.MessageOptionsBase}>
            <Menu
              className={css.MessageOptionsBar}
              variant="SurfaceVariant"
              onMouseDown={preventSelectionAnchor}
            >
              <Box gap="100">
                <PopOut
                  anchor={menuAnchor}
                  position="Bottom"
                  align={menuAnchor?.width === 0 ? 'Start' : 'End'}
                  offset={menuAnchor?.width === 0 ? 0 : undefined}
                  content={
                    <FocusTrap
                      focusTrapOptions={{
                        initialFocus: false,
                        onDeactivate: () => setMenuAnchor(undefined),
                        clickOutsideDeactivates: true,
                        isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                        isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                        escapeDeactivates: stopPropagation,
                      }}
                    >
                      <Menu {...props} ref={ref}>
                        <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                          {!hideOthersReadReceipts && (
                            <MessageReadReceiptItem
                              room={room}
                              eventId={mEvent.getId() ?? ''}
                              onClose={closeMenu}
                            />
                          )}
                          {showDeveloperTools && (
                            <MessageSourceCodeItem
                              room={room}
                              mEvent={mEvent}
                              onClose={closeMenu}
                            />
                          )}
                          <MessageForwardItem mEvent={mEvent} onClose={closeMenu} />
                          <MessageEditHistoryItem
                            room={room}
                            mEvent={mEvent}
                            onClose={closeMenu}
                          />
                          <MessageCopyLinkItem room={room} mEvent={mEvent} onClose={closeMenu} />
                        </Box>
                        {((!mEvent.isRedacted() && canDelete && !stateEvent) ||
                          (mEvent.getSender() !== mx.getUserId() && !stateEvent)) && (
                          <>
                            <Line size="300" />
                            <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                              {!mEvent.isRedacted() && canDelete && (
                                <MessageDeleteItem
                                  room={room}
                                  mEvent={mEvent}
                                  onClose={closeMenu}
                                />
                              )}
                              {mEvent.getSender() !== mx.getUserId() && (
                                <MessageReportItem
                                  room={room}
                                  mEvent={mEvent}
                                  onClose={closeMenu}
                                />
                              )}
                            </Box>
                          </>
                        )}
                      </Menu>
                    </FocusTrap>
                  }
                >
                  <IconButton
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                    onClick={handleOpenMenu}
                    aria-pressed={!!menuAnchor}
                  >
                    <Icon src={Icons.VerticalDots} size="100" />
                  </IconButton>
                </PopOut>
              </Box>
            </Menu>
          </div>
        )}
        <div onContextMenu={handleContextMenu}>{children}</div>
      </MessageBase>
    );
  }
);
