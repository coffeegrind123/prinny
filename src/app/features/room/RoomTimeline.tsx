/* eslint-disable react/destructuring-assignment */
import React, {
  ClipboardEventHandler,
  Dispatch,
  MouseEventHandler,
  MutableRefObject,
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Direction,
  EventTimeline,
  EventTimelineSet,
  EventTimelineSetHandlerMap,
  EventType,
  MatrixClient,
  MatrixEvent,
  RelationType,
  Room,
  RoomEvent,
  RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { M_POLL_START } from 'matrix-js-sdk/lib/@types/polls';
import { HTMLReactParserOptions } from 'html-react-parser';
import classNames from 'classnames';
import { Editor } from 'slate';
import to from '../../utils/await-to';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Badge,
  Box,
  Chip,
  ContainerColor,
  Icon,
  Icons,
  Line,
  Scroll,
  Text,
  as,
  config,
  toRem,
} from 'folds';
import { isKeyHotkey } from '../../utils/is-hotkey';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useTranslation } from 'react-i18next';
import { eventWithShortcode, factoryEventSentBy, getMxIdLocalPart } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useVirtualPaginator, ItemRange } from '../../hooks/useVirtualPaginator';
import { useScrollContentAnchor } from '../../hooks/useScrollContentAnchor';
import { useAlive } from '../../hooks/useAlive';
import { editableActiveElement, scrollToBottom } from '../../utils/dom';
import { setActiveTimelineScrollContainer } from '../../components/global-keybinds/GlobalKeybinds';
import { MessageKeybinds } from './MessageKeybinds';
import {
  DefaultPlaceholder,
  CompactPlaceholder,
  Reply,
  MessageBase,
  MessageUnsupportedContent,
  Time,
  MessageNotDecryptedContent,
  RedactedContent,
  MSticker,
  ImageContent,
  EventContent,
} from '../../components/message';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import {
  canEditEvent,
  decryptAllTimelineEvent,
  findRoomEventById,
  getEditedEvent,
  getReplyDraftBody,
  getEventReactions,
  getLatestEditableEvt,
  getMemberDisplayName,
  getReactionContent,
  matchingReactionKey,
  isMembershipChanged,
  reactionOrEditEvent,
} from '../../utils/room';
import { useSetting } from '../../state/hooks/settings';
import { MessageLayout, settingsAtom } from '../../state/settings';
import { useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { Reactions, Message, Event, EncryptedContent } from './message';
import { useMemberEventParser } from '../../hooks/useMemberEventParser';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { RoomIntro } from '../../components/room-intro';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import { markAsRead, releaseAutoMarkAsRead } from '../../utils/notifications';
import { useIsRoomBackdrop } from '../../hooks/useRoomBackdrop';
import { useDebounce } from '../../hooks/useDebounce';
import { getResizeObserverEntry, useResizeObserver } from '../../hooks/useResizeObserver';
import * as css from './RoomTimeline.css';
import { inSameDay, minuteDifference, timeDayMonthYear, today, yesterday } from '../../utils/time';
import { isEmptyEditor, moveCursor, safeFocusEditor } from '../../components/editor';
import { roomIdToReplyDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../types/matrix/room';
import { useKeyDown } from '../../hooks/useKeyDown';
import { useDocumentFocusChange } from '../../hooks/useDocumentFocusChange';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useKatex } from '../../hooks/useKatex';
import { chatEffectAtom } from './ChatEffects';
import { effectForBody, effectForMsgType } from '../../plugins/effects';
import { PollContent } from '../../components/message/content/PollContent';
import { BotKeyboard } from '../../components/message/content/BotKeyboard';
import { BotContentKey, sanitizeReplyMarkup } from '../../../types/matrix/bot';
import { botDisplayContent } from '../../utils/bot';
import { MapView } from '../../components/map';
import { useMapStyleUrl, useMapsEnabled } from '../../hooks/useMapStyleUrl';
import { ThreadSummary } from './thread/ThreadSummary';
import { threadViewAtom } from '../../state/threadView';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { eventToTranscriptLine } from '../../utils/copyTranscript';

const TimelineFloat = as<'div', css.TimelineFloatVariants>(
  ({ position, className, ...props }, ref) => (
    <Box
      className={classNames(css.TimelineFloat({ position }), className)}
      justifyContent="Center"
      alignItems="Center"
      gap="200"
      {...props}
      ref={ref}
    />
  ),
);

const TimelineDivider = as<'div', { variant?: ContainerColor | 'Inherit' }>(
  ({ variant, children, ...props }, ref) => (
    <Box gap="100" justifyContent="Center" alignItems="Center" {...props} ref={ref}>
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
      {children}
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
    </Box>
  ),
);

export const getLiveTimeline = (room: Room): EventTimeline =>
  room.getUnfilteredTimelineSet().getLiveTimeline();

// A live event only warrants moving the viewport (scroll-to-bottom / jump to
// live edge) when it produces a NEW visible message row. Reactions, edits and
// redactions mutate existing rows in place — matching the render filter, which
// skips events that carry a relation or are redactions — so they must not yank
// the timeline. Without this, reacting to a message (an `m.reaction` event you
// "sent") triggered the scroll-on-send path and jumped to the most recent
// message.
const isLiveDisplayEvent = (mEvent: MatrixEvent): boolean => {
  if (mEvent.getType() === EventType.Reaction) return false;
  if (mEvent.isRedaction()) return false;
  const relation = mEvent.getRelation();
  if (
    relation?.rel_type === RelationType.Annotation ||
    relation?.rel_type === RelationType.Replace
  ) {
    return false;
  }
  return true;
};

export const getEventTimeline = (room: Room, eventId: string): EventTimeline | undefined => {
  const timelineSet = room.getUnfilteredTimelineSet();
  return timelineSet.getTimelineForEvent(eventId) ?? undefined;
};

export const getFirstLinkedTimeline = (
  timeline: EventTimeline,
  direction: Direction,
): EventTimeline => {
  const linkedTm = timeline.getNeighbouringTimeline(direction);
  if (!linkedTm) return timeline;
  return getFirstLinkedTimeline(linkedTm, direction);
};

export const getLinkedTimelines = (timeline: EventTimeline): EventTimeline[] => {
  const firstTimeline = getFirstLinkedTimeline(timeline, Direction.Backward);
  const timelines: EventTimeline[] = [];

  for (
    let nextTimeline: EventTimeline | null = firstTimeline;
    nextTimeline;
    nextTimeline = nextTimeline.getNeighbouringTimeline(Direction.Forward)
  ) {
    timelines.push(nextTimeline);
  }
  return timelines;
};

export const timelineToEventsCount = (t: EventTimeline) => t.getEvents().length;
export const getTimelinesEventsCount = (timelines: EventTimeline[]): number => {
  const timelineEventCountReducer = (count: number, tm: EventTimeline) =>
    count + timelineToEventsCount(tm);
  return timelines.reduce(timelineEventCountReducer, 0);
};

export const getTimelineAndBaseIndex = (
  timelines: EventTimeline[],
  index: number,
): [EventTimeline | undefined, number] => {
  let uptoTimelineLen = 0;
  const timeline = timelines.find((t) => {
    uptoTimelineLen += t.getEvents().length;
    if (index < uptoTimelineLen) return true;
    return false;
  });
  if (!timeline) return [undefined, 0];
  return [timeline, uptoTimelineLen - timeline.getEvents().length];
};

export const getTimelineRelativeIndex = (absoluteIndex: number, timelineBaseIndex: number) =>
  absoluteIndex - timelineBaseIndex;

export const getTimelineEvent = (timeline: EventTimeline, index: number): MatrixEvent | undefined =>
  timeline.getEvents()[index];

export const getEventIdAbsoluteIndex = (
  timelines: EventTimeline[],
  eventTimeline: EventTimeline,
  eventId: string,
): number | undefined => {
  const timelineIndex = timelines.findIndex((t) => t === eventTimeline);
  if (timelineIndex === -1) return undefined;
  const eventIndex = eventTimeline.getEvents().findIndex((evt) => evt.getId() === eventId);
  if (eventIndex === -1) return undefined;
  const baseIndex = timelines
    .slice(0, timelineIndex)
    .reduce((accValue, timeline) => timeline.getEvents().length + accValue, 0);
  return baseIndex + eventIndex;
};

type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  roomInputRef: RefObject<HTMLElement | null>;
  editor: Editor;
};

const PAGINATION_LIMIT = 80;

type Timeline = {
  linkedTimelines: EventTimeline[];
  range: ItemRange;
};

const useEventTimelineLoader = (
  mx: MatrixClient,
  room: Room,
  onLoad: (eventId: string, linkedTimelines: EventTimeline[], evtAbsIndex: number) => void,
  onError: (err: Error | null) => void,
) => {
  const loadEventTimeline = useCallback(
    async (eventId: string) => {
      const [err, replyEvtTimeline] = await to(
        mx.getEventTimeline(room.getUnfilteredTimelineSet(), eventId),
      );
      if (!replyEvtTimeline) {
        onError(err ?? null);
        return;
      }
      const linkedTimelines = getLinkedTimelines(replyEvtTimeline);
      const absIndex = getEventIdAbsoluteIndex(linkedTimelines, replyEvtTimeline, eventId);

      if (absIndex === undefined) {
        onError(err ?? null);
        return;
      }

      onLoad(eventId, linkedTimelines, absIndex);
    },
    [mx, room, onLoad, onError],
  );

  return loadEventTimeline;
};

const useTimelinePagination = (
  mx: MatrixClient,
  timeline: Timeline,
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  limit: number,
  /**
   * Set true for as long as this hook's own `/messages` is in flight, so
   * `useBackfillArrive` can tell our backfill from somebody else's — ours is
   * already accounted for by `recalibratePagination`, and counting it twice
   * would send the view further back than the events that arrived.
   */
  paginatingRef: MutableRefObject<boolean>,
) => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const alive = useAlive();

  const handleTimelinePagination = useMemo(() => {
    let fetching = false;

    const recalibratePagination = (
      linkedTimelines: EventTimeline[],
      timelinesEventsCount: number[],
      backwards: boolean,
    ) => {
      const topTimeline = linkedTimelines[0];
      const timelineMatch = (mt: EventTimeline) => (t: EventTimeline) => t === mt;

      const newLTimelines = getLinkedTimelines(topTimeline);
      const topTmIndex = newLTimelines.findIndex(timelineMatch(topTimeline));
      const topAddedTm = topTmIndex === -1 ? [] : newLTimelines.slice(0, topTmIndex);

      const topTmAddedEvt =
        timelineToEventsCount(newLTimelines[topTmIndex]) - timelinesEventsCount[0];
      const offsetRange = getTimelinesEventsCount(topAddedTm) + (backwards ? topTmAddedEvt : 0);

      setTimeline((currentTimeline) => ({
        linkedTimelines: newLTimelines,
        range:
          offsetRange > 0
            ? {
                start: currentTimeline.range.start + offsetRange,
                end: currentTimeline.range.end + offsetRange,
              }
            : { ...currentTimeline.range },
      }));
    };

    return async (backwards: boolean) => {
      if (fetching) return;
      const { linkedTimelines: lTimelines } = timelineRef.current;
      const timelinesEventsCount = lTimelines.map(timelineToEventsCount);

      const timelineToPaginate = backwards ? lTimelines[0] : lTimelines[lTimelines.length - 1];
      if (!timelineToPaginate) return;

      const paginationToken = timelineToPaginate.getPaginationToken(
        backwards ? Direction.Backward : Direction.Forward,
      );
      if (
        !paginationToken &&
        getTimelinesEventsCount(lTimelines) !==
          getTimelinesEventsCount(getLinkedTimelines(timelineToPaginate))
      ) {
        recalibratePagination(lTimelines, timelinesEventsCount, backwards);
        return;
      }

      fetching = true;
      paginatingRef.current = true;
      try {
        const [err] = await to(
          mx.paginateEventTimeline(timelineToPaginate, {
            backwards,
            limit,
          }),
        );
        if (err) {
          // A homeserver that refuses one `/messages` must not cost the room
          // its pagination for the rest of the session. The lock used to leak
          // here — an early `return` with `fetching` still true — so a single
          // failed request left the timeline permanently unable to load older
          // messages, and the only symptom was scrolling that stopped working.
          console.warn('[timeline] pagination failed', err);
          return;
        }
        const fetchedTimeline =
          timelineToPaginate.getNeighbouringTimeline(
            backwards ? Direction.Backward : Direction.Forward,
          ) ?? timelineToPaginate;
        // Decrypt all event ahead of render cycle
        const roomId = fetchedTimeline.getRoomId();
        const room = roomId ? mx.getRoom(roomId) : null;

        if (room?.hasEncryptionStateEvent()) {
          await to(decryptAllTimelineEvent(mx, fetchedTimeline));
        }

        if (alive()) {
          recalibratePagination(lTimelines, timelinesEventsCount, backwards);
        }
      } finally {
        fetching = false;
        paginatingRef.current = false;
      }
    };
  }, [mx, alive, setTimeline, limit, paginatingRef]);
  return handleTimelinePagination;
};

/**
 * Somebody else paginated this room's history, so shift the rendered window to
 * stay on the same messages.
 *
 * **The bug.** `range` is a pair of indices into the concatenation of
 * `linkedTimelines`, so it only means anything relative to how many events are
 * in front of it. Backwards pagination prepends events at the very top, which
 * moves every existing event further down that index space — and the timeline
 * accounted for this only when it had done the paginating itself
 * (`recalibratePagination`). Two other features paginate the SAME timeline
 * object, `room.getLiveTimeline()`: the media scan behind the gallery and the
 * feed (`useRoomMedia`), and in-room search (`useClientRoomSearch`). Opening a
 * photo from the timeline starts that scan, up to six pages of 80 events land
 * under the reader, `range` does not move, and the same indices are now
 * pointing hundreds of messages earlier in the conversation. Which is the
 * report: click an image, close it, and the chat has scrolled way up.
 *
 * `useLiveEventArrive` cannot cover it — it is gated on `data.liveEvent`, and
 * backfill is by definition not live.
 *
 * One `+1` per event rather than a count-difference at the end: the events
 * arrive one at a time and this has to hold after each, and React batches the
 * updates anyway. Prepends into a timeline this view is not rendering (the
 * reader is parked on a permalink in an older, unlinked timeline) shift nothing
 * and are ignored.
 */
const useBackfillArrive = (
  room: Room,
  linkedTimelines: EventTimeline[],
  ownPaginationRef: MutableRefObject<boolean>,
  onPrepend: () => void,
) => {
  const linkedRef = useRef(linkedTimelines);
  linkedRef.current = linkedTimelines;

  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data,
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      if (!toStartOfTimeline || data.liveEvent) return;
      if (ownPaginationRef.current) return;
      if (data.timeline && !linkedRef.current.includes(data.timeline)) return;
      onPrepend();
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [room, ownPaginationRef, onPrepend]);
};

const useLiveEventArrive = (room: Room, onArrive: (mEvent: MatrixEvent) => void) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data,
    ) => {
      if (eventRoom?.roomId !== room.roomId || !data.liveEvent) return;
      onArrive(mEvent);
    };
    const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (mEvent, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onArrive(mEvent);
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    room.on(RoomEvent.Redaction, handleRedaction);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
    };
  }, [room, onArrive]);
};

const useLiveTimelineRefresh = (room: Room, onRefresh: () => void) => {
  useEffect(() => {
    const handleTimelineRefresh: RoomEventHandlerMap[RoomEvent.TimelineRefresh] = (r) => {
      if (r.roomId !== room.roomId) return;
      onRefresh();
    };

    room.on(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    return () => {
      room.removeListener(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    };
  }, [room, onRefresh]);
};

/**
 * Fires when a local echo changes send status (SENDING -> SENT, or -> NOT_SENT).
 * The event object is mutated in place, so nothing else in the render path
 * notices; without this the failed-send bar would only appear on the next
 * unrelated re-render, which in a quiet room may be never.
 */
const useLocalEchoUpdated = (room: Room, onUpdate: () => void) => {
  useEffect(() => {
    const handleLocalEchoUpdated: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
      mEvent,
      eventRoom,
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onUpdate();
    };

    room.on(RoomEvent.LocalEchoUpdated, handleLocalEchoUpdated);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEchoUpdated);
    };
  }, [room, onUpdate]);
};

const getInitialTimeline = (room: Room) => {
  const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
  const evLength = getTimelinesEventsCount(linkedTimelines);
  return {
    linkedTimelines,
    range: {
      start: Math.max(evLength - PAGINATION_LIMIT, 0),
      end: evLength,
    },
  };
};

const getEmptyTimeline = () => ({
  range: { start: 0, end: 0 },
  linkedTimelines: [],
});

const getRoomUnreadInfo = (room: Room, scrollTo = false) => {
  const readUptoEventId = room.getEventReadUpTo(room.client.getUserId() ?? '');
  if (!readUptoEventId) return undefined;
  const evtTimeline = getEventTimeline(room, readUptoEventId);
  const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
  return {
    readUptoEventId,
    inLiveTimeline: latestTimeline === room.getLiveTimeline(),
    scrollTo,
  };
};

export function RoomTimeline({ room, eventId, roomInputRef, editor }: RoomTimelineProps) {
  const mx = useMatrixClient();
  const isBackdrop = useIsRoomBackdrop();
  const setChatEffect = useSetAtom(chatEffectAtom);
  const setThreadView = useSetAtom(threadViewAtom);
  const useAuthentication = useMediaAuthentication();
  // Two switches now, and the distinction is the point: `hideReadReceipts` is
  // about what this client SENDS (it makes `markAsRead` send privately), while
  // `hideOthersReadReceipts` is about what the timeline SHOWS. They used to be
  // one flag, so choosing not to broadcast also blinded you to everyone else.
  const [hideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');
  const [hideOthersReadReceipts] = useSetting(settingsAtom, 'hideOthersReadReceipts');
  const [messageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [messageSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const direct = useIsDirectRoom();
  const [hideMembershipEvents] = useSetting(settingsAtom, 'hideMembershipEvents');
  const [hideNickAvatarEvents] = useSetting(settingsAtom, 'hideNickAvatarEvents');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [mathsEnabled] = useSetting(settingsAtom, 'renderMaths');
  const [renderBotKeyboards] = useSetting(settingsAtom, 'renderBotKeyboards');
  const renderMaths = useKatex(mathsEnabled);
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
  const [showDeveloperTools] = useSetting(settingsAtom, 'developerTools');
  const [scrollOnSend] = useSetting(settingsAtom, 'scrollOnSend');
  const scrollOnSendRef = useRef(scrollOnSend);
  scrollOnSendRef.current = scrollOnSend;

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const ignoredUsersList = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsersList), [ignoredUsersList]);

  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);

  const theme = useTheme();
  const accessiblePowerTagColors = useAccessiblePowerTagColors(
    theme.kind,
    creatorsTag,
    powerLevelTags,
  );

  const permissions = useRoomPermissions(creators, powerLevels);

  const canRedact = permissions.action('redact', mx.getSafeUserId());
  const canDeleteOwn = permissions.event(MessageEvent.RoomRedaction, mx.getSafeUserId());
  const canSendReaction = permissions.event(MessageEvent.Reaction, mx.getSafeUserId());
  const canPinEvent = permissions.stateEvent(StateEvent.RoomPinnedEvents, mx.getSafeUserId());
  const [editId, setEditId] = useState<string>();

  const roomToParents = useAtomValue(roomToParentsAtom);
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const { navigateRoom } = useRoomNavigate();
  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();
  const openUserRoomProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();

  const imagePackRooms: Room[] = useImagePackRooms(room.roomId, roomToParents);

  const [unreadInfo, setUnreadInfo] = useState(() => getRoomUnreadInfo(room, true));
  const readUptoEventIdRef = useRef<string | undefined>(undefined);
  if (unreadInfo) {
    readUptoEventIdRef.current = unreadInfo.readUptoEventId;
  }

  const atBottomAnchorRef = useRef<HTMLElement>(null);
  const [atBottom, setAtBottom] = useState<boolean>(true);
  // Deliberately NOT mirroring `atBottom`. That state is set through a 1s
  // debounce (it drives the jump-to-bottom button, which should not flicker on
  // a stray wheel event), so a ref tracking it answered "are we pinned to the
  // bottom?" with a value up to a second stale — long enough for an arriving
  // message to scroll away from a user who had not moved. This ref is updated
  // straight from the intersection observer instead, so every auto-scroll
  // decision reads the current truth while the button keeps its debounce.
  const atBottomRef = useRef(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  // Expose the active timeline's scroll container to the global keybind
  // layer so PageUp/PageDown/etc. can scroll the current room without
  // plumbing a context down the tree. Unregister on unmount so a stale
  // detached node never receives scroll commands.
  useEffect(() => {
    setActiveTimelineScrollContainer(scrollRef.current);
    return () => setActiveTimelineScrollContainer(null);
  }, []);

  const [focusItem, setFocusItem] = useState<
    | {
        index: number;
        scrollTo: boolean;
        highlight: boolean;
      }
    | undefined
  >();
  const alive = useAlive();

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler)),
      ),
    }),
    [mx, room, mentionClickHandler],
  );
  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
        renderMaths,
      }),
    [
      mx,
      room,
      linkifyOpts,
      spoilerClickHandler,
      mentionClickHandler,
      useAuthentication,
      renderMaths,
    ],
  );
  // Maps stay off unless the viewer turned them on AND a tile style exists,
  // so a location message from someone else can never make this client fetch
  // tiles unprompted.
  const mapStyleUrl = useMapStyleUrl();
  const mapsEnabled = useMapsEnabled();
  const renderLocationMap = useCallback(
    (position: { latitude: string; longitude: string }) => {
      if (!mapsEnabled || !mapStyleUrl) return null;
      const latitude = Number(position.latitude);
      const longitude = Number(position.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return (
        <div style={{ width: '100%', maxWidth: toRem(400) }}>
          <MapView
            styleUrl={mapStyleUrl}
            pins={[{ latitude, longitude }]}
            height="180px"
            interactive={false}
          />
        </div>
      );
    },
    [mapsEnabled, mapStyleUrl],
  );

  const parseMemberEvent = useMemberEventParser();

  const [timeline, setTimeline] = useState<Timeline>(() =>
    eventId ? getEmptyTimeline() : getInitialTimeline(room),
  );
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const eventsLength = getTimelinesEventsCount(timeline.linkedTimelines);

  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const rangeAtStart = timeline.range.start === 0;
  const rangeAtEnd = timeline.range.end === eventsLength;
  const atLiveEndRef = useRef(liveTimelineLinked && rangeAtEnd);
  atLiveEndRef.current = liveTimelineLinked && rangeAtEnd;

  // True only while this component's own `/messages` is in flight — see
  // `useBackfillArrive`, which uses it to ignore the backfill we caused.
  const ownPaginationRef = useRef(false);
  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    PAGINATION_LIMIT,
    ownPaginationRef,
  );

  // History paginated in by the media scan or in-room search moves every
  // rendered event further down the index space `range` is expressed in.
  useBackfillArrive(
    room,
    timeline.linkedTimelines,
    ownPaginationRef,
    useCallback(() => {
      setTimeline((ct) => ({
        ...ct,
        range: {
          start: ct.range.start + 1,
          end: ct.range.end + 1,
        },
      }));
    }, []),
  );

  const getScrollElement = useCallback(() => scrollRef.current, []);

  const { getItems, scrollToItem, scrollToElement, observeBackAnchor, observeFrontAnchor } =
    useVirtualPaginator({
      count: eventsLength,
      limit: PAGINATION_LIMIT,
      range: timeline.range,
      onRangeChange: useCallback((r) => setTimeline((cs) => ({ ...cs, range: r })), []),
      getScrollElement,
      getItemElement: useCallback(
        (index: number) =>
          (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
          undefined,
        [],
      ),
      onEnd: handleTimelinePagination,
    });

  // A message grows after it is rendered — a link becomes a preview card, an
  // edit or a reaction arrives — and when it is above the viewport, everything
  // below it slides. See `useScrollContentAnchor`: this pins the message the
  // reader is looking at through those changes. Disabled while the view is
  // following the live end, where a new message moving the view is the point.
  useScrollContentAnchor(
    getScrollElement,
    useCallback(() => (scrollRef.current?.firstElementChild as HTMLElement) ?? null, []),
    '[data-message-item]',
    !atBottom,
    timeline.range,
  );

  const loadEventTimeline = useEventTimelineLoader(
    mx,
    room,
    useCallback(
      (evtId, lTimelines, evtAbsIndex) => {
        if (!alive()) return;
        const evLength = getTimelinesEventsCount(lTimelines);

        setFocusItem({
          index: evtAbsIndex,
          scrollTo: true,
          highlight: evtId !== readUptoEventIdRef.current,
        });
        setTimeline({
          linkedTimelines: lTimelines,
          range: {
            start: Math.max(evtAbsIndex - PAGINATION_LIMIT, 0),
            end: Math.min(evtAbsIndex + PAGINATION_LIMIT, evLength),
          },
        });
      },
      [alive],
    ),
    useCallback(() => {
      if (!alive()) return;
      setTimeline(getInitialTimeline(room));
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [alive, room]),
  );

  useLiveEventArrive(
    room,
    useCallback(
      (mEvt: MatrixEvent) => {
        // Effects fire on arrival only, and only for the room you are looking
        // at — replaying every 🎉 in the backlog when you scroll up, or firing
        // for a room in the background, would be a nuisance rather than a
        // flourish. `data.liveEvent` is already enforced by useLiveEventArrive.
        if (!isBackdrop && mEvt.getType() === EventType.RoomMessage && !mEvt.isRedacted()) {
          const content = mEvt.getContent();
          const effect =
            effectForMsgType(content.msgtype) ??
            (typeof content.body === 'string' ? effectForBody(content.body) : undefined);
          if (effect) {
            setChatEffect({ name: effect, key: Date.now() });
          }
        }

        // if user is at bottom of timeline
        // keep paginating timeline and conditionally mark as read
        // otherwise we update timeline without paginating
        // so timeline can be updated with evt like: edits, reactions etc
        if (atBottomRef.current) {
          if (
            !isBackdrop &&
            document.hasFocus() &&
            (!unreadInfo || mEvt.getSender() === mx.getUserId())
          ) {
            // Check if the document is in focus (user is actively viewing the app),
            // and either there are no unread messages or the latest message is from the current user.
            // If either condition is met, trigger the markAsRead function to send a read receipt.
            requestAnimationFrame(() =>
              markAsRead(mx, mEvt.getRoomId()!, hideReadReceipts, { auto: true }),
            );
          }

          if (!document.hasFocus() && !unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }

          // Only scroll for events that add a new visible row. Reactions/edits/
          // redactions still advance the range (they exist in the underlying
          // timeline) but must not move the viewport.
          if (isLiveDisplayEvent(mEvt)) {
            scrollToBottomRef.current.count += 1;
            // Smooth only when the animation will actually run and is worth
            // watching. An unfocused window throttles scroll animations, which
            // leaves the view stranded part-way down and reads as the timeline
            // refusing to follow; your own message should feel immediate.
            scrollToBottomRef.current.smooth =
              document.hasFocus() && mEvt.getSender() !== mx.getUserId();
          }

          setTimeline((ct) => ({
            ...ct,
            range: {
              start: ct.range.start + 1,
              end: ct.range.end + 1,
            },
          }));
          return;
        }
        // User is scrolled up. If they just sent a message themselves and the
        // "scroll on send" setting is on, jump back to the live edge so their
        // own message comes into view — mirrors handleJumpToLatest. Other
        // people's messages must NOT yank the viewport, so this is gated on the
        // sender being us.
        if (
          scrollOnSendRef.current &&
          mEvt.getSender() === mx.getUserId() &&
          isLiveDisplayEvent(mEvt)
        ) {
          setTimeline(getInitialTimeline(room));
          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = false;
          if (!isBackdrop && document.hasFocus()) {
            requestAnimationFrame(() =>
              markAsRead(mx, mEvt.getRoomId()!, hideReadReceipts, { auto: true }),
            );
          }
          return;
        }
        setTimeline((ct) => ({ ...ct }));
        if (!unreadInfo) {
          setUnreadInfo(getRoomUnreadInfo(room));
        }
      },
      [mx, room, unreadInfo, hideReadReceipts, isBackdrop, setChatEffect],
    ),
  );

  const handleOpenEvent = useCallback(
    async (
      evtId: string,
      highlight = true,
      onScroll: ((scrolled: boolean) => void) | undefined = undefined,
    ) => {
      const evtTimeline = getEventTimeline(room, evtId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(timeline.linkedTimelines, evtTimeline, evtId);

      if (typeof absoluteIndex === 'number') {
        const scrolled = scrollToItem(absoluteIndex, {
          behavior: 'smooth',
          align: 'center',
          stopInView: true,
        });
        if (onScroll) onScroll(scrolled);
        setFocusItem({
          index: absoluteIndex,
          scrollTo: false,
          highlight,
        });
      } else {
        setTimeline(getEmptyTimeline());
        loadEventTimeline(evtId);
      }
    },
    [room, timeline, scrollToItem, loadEventTimeline],
  );

  useLiveTimelineRefresh(
    room,
    useCallback(() => {
      if (liveTimelineLinked) {
        setTimeline(getInitialTimeline(room));
      }
    }, [room, liveTimelineLinked]),
  );

  useLocalEchoUpdated(
    room,
    useCallback(() => {
      setTimeline((ct) => ({ ...ct }));
    }, []),
  );

  // Stay at bottom when the timeline's own content resizes. The composer
  // observer below catches the editor growing; this catches everything that
  // settles *after* layout — images and video getting their intrinsic size, a
  // link preview arriving, a pane divider being dragged. Each of those grows
  // the content under a user who was pinned to the bottom, pushing the newest
  // message off-screen without them touching the scroll.
  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      return () => {
        if (!mounted) {
          // Skip the initial mounting call.
          mounted = true;
          return;
        }
        const scrollElement = getScrollElement();
        if (scrollElement && atBottomRef.current && atLiveEndRef.current) {
          scrollToBottom(scrollElement);
        }
      };
    }, [getScrollElement]),
    useCallback(() => getScrollElement()?.firstElementChild ?? null, [getScrollElement]),
  );

  // Stay at bottom when room editor resize
  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      return (entries) => {
        if (!mounted) {
          // skip initial mounting call
          mounted = true;
          return;
        }
        if (!roomInputRef.current) return;
        const editorBaseEntry = getResizeObserverEntry(roomInputRef.current, entries);
        const scrollElement = getScrollElement();
        if (!editorBaseEntry || !scrollElement) return;

        if (atBottomRef.current) {
          scrollToBottom(scrollElement);
        }
      };
    }, [getScrollElement, roomInputRef]),
    useCallback(() => roomInputRef.current, [roomInputRef]),
  );

  /**
   * Leaving the room ends the "I marked this unread while sitting in it"
   * suppression.
   *
   * Coming back is itself the act of reading the room, so the next visit must
   * be free to report it read normally. Without this the flag would survive
   * every later visit and the room would look permanently unread.
   */
  useEffect(
    () => () => {
      releaseAutoMarkAsRead(room.roomId);
    },
    [room.roomId],
  );

  const tryAutoMarkAsRead = useCallback(() => {
    // A backdrop room is mounted behind the room list purely so a swipe has
    // something to uncover. Reporting it read would clear an unread badge the
    // user never looked at.
    if (isBackdrop) return;
    const readUptoEventId = readUptoEventIdRef.current;
    if (!readUptoEventId) {
      requestAnimationFrame(() => markAsRead(mx, room.roomId, hideReadReceipts, { auto: true }));
      return;
    }
    const evtTimeline = getEventTimeline(room, readUptoEventId);
    const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
    if (latestTimeline === room.getLiveTimeline()) {
      requestAnimationFrame(() => markAsRead(mx, room.roomId, hideReadReceipts, { auto: true }));
    }
  }, [mx, room, hideReadReceipts, isBackdrop]);

  const debounceSetAtBottom = useDebounce(
    useCallback((entry: IntersectionObserverEntry) => {
      if (!entry.isIntersecting) setAtBottom(false);
    }, []),
    { wait: 1000 },
  );
  useIntersectionObserver(
    useCallback(
      (entries) => {
        const target = atBottomAnchorRef.current;
        if (!target) return;
        const targetEntry = getIntersectionObserverEntry(target, entries);
        if (targetEntry) {
          if (!targetEntry.isIntersecting) atBottomRef.current = false;
          debounceSetAtBottom(targetEntry);
        }
        if (targetEntry?.isIntersecting && atLiveEndRef.current) {
          atBottomRef.current = true;
          setAtBottom(true);
          if (document.hasFocus()) {
            tryAutoMarkAsRead();
          }
        }
      },
      [debounceSetAtBottom, tryAutoMarkAsRead],
    ),
    useCallback(
      () => ({
        root: getScrollElement(),
        rootMargin: '100px',
      }),
      [getScrollElement],
    ),
    useCallback(() => atBottomAnchorRef.current, []),
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus) => {
        if (inFocus) {
          if (!atBottomRef.current) return;
          if (unreadInfo?.inLiveTimeline) {
            handleOpenEvent(unreadInfo.readUptoEventId, false, (scrolled) => {
              // the unread event is already in view
              // so, try mark as read;
              if (!scrolled) {
                tryAutoMarkAsRead();
              }
            });
            return;
          }
          tryAutoMarkAsRead();
          return;
        }

        // Tabbing away while caught up drops the divider's anchor, so it is
        // recomputed from the last read when the window comes back. Without
        // this it stayed pinned wherever it was when the room was opened, and
        // "new messages" pointed at messages that had been read minutes ago —
        // the useless case, because the whole value of the line is telling you
        // where you got to before you looked away.
        if (atBottomRef.current && liveTimelineLinked) {
          readUptoEventIdRef.current = undefined;
          setUnreadInfo(undefined);
        }
      },
      [tryAutoMarkAsRead, unreadInfo, handleOpenEvent, liveTimelineLinked],
    ),
  );

  // Handle up arrow edit
  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (
          isKeyHotkey('arrowup', evt) &&
          editableActiveElement() &&
          document.activeElement?.getAttribute('data-editable-name') === 'RoomInput' &&
          isEmptyEditor(editor)
        ) {
          const editableEvt = getLatestEditableEvt(room.getLiveTimeline(), (mEvt) =>
            canEditEvent(mx, mEvt),
          );
          const editableEvtId = editableEvt?.getId();
          if (!editableEvtId) return;
          setEditId(editableEvtId);
          evt.preventDefault();
        }
      },
      [mx, room, editor],
    ),
  );

  useEffect(() => {
    if (eventId) {
      setTimeline(getEmptyTimeline());
      loadEventTimeline(eventId);
    }
  }, [eventId, loadEventTimeline]);

  // Scroll to bottom on initial timeline load
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollToBottom(scrollEl);
    }
  }, []);

  // if live timeline is linked and unreadInfo change
  // Scroll to last read message
  useLayoutEffect(() => {
    const { readUptoEventId, inLiveTimeline, scrollTo } = unreadInfo ?? {};
    if (readUptoEventId && inLiveTimeline && scrollTo) {
      const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const evtTimeline = getEventTimeline(room, readUptoEventId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(linkedTimelines, evtTimeline, readUptoEventId);
      if (absoluteIndex) {
        scrollToItem(absoluteIndex, {
          behavior: 'instant',
          align: 'start',
          stopInView: true,
        });
      }
    }
  }, [room, unreadInfo, scrollToItem]);

  // scroll to focused message
  useLayoutEffect(() => {
    if (focusItem && focusItem.scrollTo) {
      scrollToItem(focusItem.index, {
        behavior: 'instant',
        align: 'center',
        stopInView: true,
      });
    }

    setTimeout(() => {
      if (!alive()) return;
      setFocusItem((currentItem) => {
        if (currentItem === focusItem) return undefined;
        return currentItem;
      });
    }, 2000);
  }, [alive, focusItem, scrollToItem]);

  // scroll to bottom of timeline
  const scrollToBottomCount = scrollToBottomRef.current.count;
  useLayoutEffect(() => {
    if (scrollToBottomCount > 0) {
      const scrollEl = scrollRef.current;
      if (scrollEl)
        scrollToBottom(scrollEl, scrollToBottomRef.current.smooth ? 'smooth' : 'instant');
    }
  }, [scrollToBottomCount]);

  // Remove unreadInfo on mark as read
  useEffect(() => {
    if (!unread) {
      setUnreadInfo(undefined);
    }
  }, [unread]);

  // scroll out of view msg editor in view.
  useEffect(() => {
    if (editId) {
      // `editId` is a server-assigned event id. An id containing `"` or `\`
      // would either terminate the attribute selector early (matching the wrong
      // node) or make `querySelector` throw a SyntaxError that takes the
      // timeline down with it. CSS.escape makes the value inert as a selector.
      const editMsgElement =
        (scrollRef.current?.querySelector(
          `[data-message-id="${CSS.escape(editId)}"]`,
        ) as HTMLElement) ?? undefined;
      if (editMsgElement) {
        scrollToElement(editMsgElement, {
          align: 'center',
          behavior: 'smooth',
          stopInView: true,
        });
      }
    }
  }, [scrollToElement, editId]);

  const handleJumpToLatest = () => {
    if (eventId) {
      navigateRoom(room.roomId, undefined, { replace: true });
    }
    setTimeline(getInitialTimeline(room));
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = false;
  };

  const handleJumpToUnread = () => {
    if (unreadInfo?.readUptoEventId) {
      setTimeline(getEmptyTimeline());
      loadEventTimeline(unreadInfo.readUptoEventId);
    }
  };

  const handleMarkAsRead = () => {
    markAsRead(mx, room.roomId, hideReadReceipts);
  };

  const handleOpenReply: MouseEventHandler = useCallback(
    async (evt) => {
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      handleOpenEvent(targetId);
    },
    [handleOpenEvent],
  );

  const handleUserClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      openUserRoomProfile(
        room.roomId,
        space?.roomId,
        userId,
        evt.currentTarget.getBoundingClientRect(),
      );
    },
    [room, space, openUserRoomProfile],
  );
  // Clicking a sender's name opens their profile, the same as clicking their
  // avatar, rather than inserting a mention into the composer. Mentioning is
  // still a keystroke away through composer autocomplete, and is also an action
  // on the profile card this now opens — whereas reading who someone is had no
  // other one-click route from the timeline.

  // A bot's `switch_inline_query_current_chat` button: put its query in the
  // composer and let the user decide whether to send it. Never sends by
  // itself — a button press must not put words in someone's mouth.
  const handleSwitchInline = useCallback(
    (query: string) => {
      editor.insertText(query);
      safeFocusEditor(editor);
      moveCursor(editor);
    },
    [editor],
  );

  const handleReplyClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt, startThread = false) => {
      const replyId = evt.currentTarget.getAttribute('data-event-id');
      if (!replyId) {
        console.warn('Button should have "data-event-id" attribute!');
        return;
      }
      const replyEvt = findRoomEventById(room, replyId);
      if (!replyEvt) return;
      const { body, formattedBody } = getReplyDraftBody(replyEvt, room.getUnfilteredTimelineSet());
      const { 'm.relates_to': relation } = startThread
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: replyId } }
        : replyEvt.getWireContent();
      const senderId = replyEvt.getSender();
      // No longer gated on a plain `body` being present: a poll, an extensible
      // event or anything else without one is still a message somebody can
      // want to reply to, and the old gate made that click do nothing at all.
      if (senderId) {
        setReplyDraft({
          userId: senderId,
          eventId: replyId,
          body,
          formattedBody,
          relation,
        });
        setTimeout(() => safeFocusEditor(editor), 100);
      }
    },
    [room, setReplyDraft, editor],
  );

  const handleReactionToggle = useCallback(
    (targetEventId: string, key: string, shortcode?: string) => {
      const relations = getEventReactions(room.getUnfilteredTimelineSet(), targetEventId);
      const allReactions = relations?.getSortedAnnotationsByKey() ?? [];
      const reactionKey = matchingReactionKey(allReactions, key, shortcode);
      const [, reactionsSet] = allReactions.find(([k]) => k === reactionKey) ?? [];
      const reactions = reactionsSet ? Array.from(reactionsSet) : [];
      const myReaction = reactions.find(factoryEventSentBy(mx.getUserId()!));

      if (myReaction && !!myReaction?.isRelation()) {
        mx.redactEvent(room.roomId, myReaction.getId()!);
        return;
      }
      const rShortcode =
        shortcode ||
        (reactions.find(eventWithShortcode)?.getContent().shortcode as string | undefined);
      mx.sendEvent(
        room.roomId,
        MessageEvent.Reaction as any,
        getReactionContent(targetEventId, reactionKey, rShortcode),
      );
    },
    [mx, room],
  );
  const handleOpenThread = useCallback(
    (rootId: string) => {
      setThreadView({ roomId: room.roomId, rootId });
    },
    [room.roomId, setThreadView],
  );

  const handleEdit = useCallback(
    (editEvtId?: string) => {
      if (editEvtId) {
        setEditId(editEvtId);
        return;
      }
      setEditId(undefined);
      safeFocusEditor(editor);
    },
    [editor],
  );
  const { t } = useTranslation();

  const renderMatrixEvent = useMatrixEventRenderer<
    [string, MatrixEvent, number, EventTimelineSet, boolean, string]
  >(
    {
      [MessageEvent.RoomMessage]: (
        mEventId,
        mEvent,
        item,
        timelineSet,
        collapse,
        groupHeadEventId,
      ) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
        const rawContent = editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent();
        /**
         * A redaction strips the content but does not always leave the flag
         * this client reads.
         *
         * `isRedacted()` is true when the SDK has the `redacted_because` on the
         * event — which it does when the redaction arrived in the same timeline.
         * A message redacted before this client ever saw it (a room joined
         * later, a gappy sync, sliding sync in particular) arrives as an
         * ordinary `m.room.message` with `content: {}` and no unsigned block,
         * so it fell through to the message renderer, which found no `msgtype`
         * and no `body` and drew "Unsupported message (no body)". Empty content
         * on a message event has exactly one cause, and it is this one.
         */
        const contentRedacted = Object.keys(mEvent.getContent() ?? {}).length === 0;
        // Buttons come from the latest edit, so a bot can swap or retire them.
        const botMarkup = renderBotKeyboards
          ? sanitizeReplyMarkup(rawContent[BotContentKey.ReplyMarkup])
          : null;
        const showBotKeyboard = botMarkup !== null && !mEvent.isRedacted();
        const getContent = (() =>
          botDisplayContent(rawContent, showBotKeyboard)) as GetContentCallback;

        const senderId = mEvent.getSender() ?? '';
        const senderDisplayName =
          getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            groupHeadEventId={groupHeadEventId}
            highlight={highlighted}
            repliedToMe={
              !!replyEventId &&
              timelineSet.findEventById(replyEventId)?.getSender() === mx.getUserId()
            }
            edit={editId === mEventId}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUserClick}
            onReplyClick={handleReplyClick}
            onThreadClick={handleOpenThread}
            onReactionToggle={handleReactionToggle}
            onEditId={handleEdit}
            reply={
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              <>
                {/* Buttons the sender attached to this message. Read through
                    `getContent`, so an edit that swaps the keyboard takes
                    effect — and `getLatestEdit` already discards edits from
                    anyone but the original sender. */}
                {showBotKeyboard && botMarkup && (
                  <BotKeyboard
                    room={room}
                    mEvent={mEvent}
                    markup={botMarkup}
                    onSwitchInline={handleSwitchInline}
                  />
                )}
                {/* A thread root is the entry point to its replies; without
                    this the thread is only reachable by scrolling past it. */}
                <ThreadSummary room={room} mEvent={mEvent} onClick={handleOpenThread} />
                {reactionRelations && (
                  <Reactions
                    style={{ marginTop: config.space.S200 }}
                    room={room}
                    relations={reactionRelations}
                    mEventId={mEventId}
                    canSendReaction={canSendReaction}
                    onReactionToggle={handleReactionToggle}
                  />
                )}
              </>
            }
            hideOthersReadReceipts={hideOthersReadReceipts}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(senderId)}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() || contentRedacted ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <RenderMessageContent
                displayName={senderDisplayName}
                msgType={mEvent.getContent().msgtype ?? ''}
                ts={mEvent.getTs()}
                edited={!!editedEvent}
                getContent={getContent}
                mediaAutoLoad={mediaAutoLoad}
                urlPreview={showUrlPreview}
                htmlReactParserOptions={htmlReactParserOptions}
                linkifyOpts={linkifyOpts}
                renderLocationMap={renderLocationMap}
                outlineAttachment={messageLayout === MessageLayout.Bubble}
                roomId={room.roomId}
                eventId={mEventId}
              />
            )}
          </Message>
        );
      },
      [MessageEvent.RoomMessageEncrypted]: (
        mEventId,
        mEvent,
        item,
        timelineSet,
        collapse,
        groupHeadEventId,
      ) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            groupHeadEventId={groupHeadEventId}
            highlight={highlighted}
            repliedToMe={
              !!replyEventId &&
              timelineSet.findEventById(replyEventId)?.getSender() === mx.getUserId()
            }
            edit={editId === mEventId}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUserClick}
            onReplyClick={handleReplyClick}
            onThreadClick={handleOpenThread}
            onReactionToggle={handleReactionToggle}
            onEditId={handleEdit}
            reply={
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideOthersReadReceipts={hideOthersReadReceipts}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(mEvent.getSender() ?? '')}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            <EncryptedContent mEvent={mEvent}>
              {() => {
                if (mEvent.isRedacted()) return <RedactedContent />;
                if (mEvent.getType() === MessageEvent.Sticker)
                  return (
                    <MSticker
                      content={mEvent.getContent()}
                      renderImageContent={(props) => (
                        <ImageContent
                          {...props}
                          autoPlay={mediaAutoLoad}
                          renderImage={(p) => <Image {...p} loading="lazy" />}
                          renderViewer={(p) => <ImageViewer {...p} />}
                        />
                      )}
                    />
                  );
                if (mEvent.getType() === MessageEvent.RoomMessage) {
                  const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
                  const getContent = (() =>
                    editedEvent?.getContent()['m.new_content'] ??
                    mEvent.getContent()) as GetContentCallback;

                  const senderId = mEvent.getSender() ?? '';
                  const senderDisplayName =
                    getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
                  return (
                    <RenderMessageContent
                      displayName={senderDisplayName}
                      msgType={mEvent.getContent().msgtype ?? ''}
                      ts={mEvent.getTs()}
                      edited={!!editedEvent}
                      getContent={getContent}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                      renderLocationMap={renderLocationMap}
                      outlineAttachment={messageLayout === MessageLayout.Bubble}
                      roomId={room.roomId}
                      eventId={mEventId}
                    />
                  );
                }
                if (mEvent.getType() === MessageEvent.RoomMessageEncrypted)
                  return (
                    <Text>
                      <MessageNotDecryptedContent />
                    </Text>
                  );
                return (
                  <Text>
                    <MessageUnsupportedContent />
                  </Text>
                );
              }}
            </EncryptedContent>
          </Message>
        );
      },
      [MessageEvent.Sticker]: (mEventId, mEvent, item, timelineSet, collapse, groupHeadEventId) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            groupHeadEventId={groupHeadEventId}
            highlight={highlighted}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUserClick}
            onReplyClick={handleReplyClick}
            onThreadClick={handleOpenThread}
            onReactionToggle={handleReactionToggle}
            reply={
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideOthersReadReceipts={hideOthersReadReceipts}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(mEvent.getSender() ?? '')}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() || Object.keys(mEvent.getContent() ?? {}).length === 0 ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <MSticker
                content={mEvent.getContent()}
                renderImageContent={(props) => (
                  <ImageContent
                    {...props}
                    autoPlay={mediaAutoLoad}
                    renderImage={(p) => <Image {...p} loading="lazy" />}
                    renderViewer={(p) => <ImageViewer {...p} />}
                  />
                )}
              />
            )}
          </Message>
        );
      },
      // Polls arrive under two type names: the stable one and the MSC3381
      // unstable one that every client still sends. Both must render, or a poll
      // from Element shows up as an empty gap in the timeline.
      ...Object.fromEntries(
        [M_POLL_START.name, M_POLL_START.altName].filter(Boolean).map((pollType) => [
          pollType as string,
          (
            mEventId: string,
            mEvent: MatrixEvent,
            item: number,
            timelineSet: EventTimelineSet,
            collapse: boolean,
            groupHeadEventId: string,
          ) => {
            const reactionRelations = getEventReactions(timelineSet, mEventId);
            const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
            const hasReactions = reactions && reactions.length > 0;
            const highlighted = focusItem?.index === item && focusItem.highlight;
            const senderId = mEvent.getSender() ?? '';

            return (
              <Message
                key={mEvent.getId()}
                data-message-item={item}
                data-message-id={mEventId}
                room={room}
                mEvent={mEvent}
                messageSpacing={messageSpacing}
                messageLayout={messageLayout}
                collapse={collapse}
                groupHeadEventId={groupHeadEventId}
                highlight={highlighted}
                canDelete={canRedact || (canDeleteOwn && senderId === mx.getUserId())}
                canSendReaction={canSendReaction}
                canPinEvent={canPinEvent}
                imagePackRooms={imagePackRooms}
                relations={hasReactions ? reactionRelations : undefined}
                onUserClick={handleUserClick}
                onUsernameClick={handleUserClick}
                onReplyClick={handleReplyClick}
                onThreadClick={handleOpenThread}
                onReactionToggle={handleReactionToggle}
                reactions={
                  reactionRelations && (
                    <Reactions
                      style={{ marginTop: config.space.S200 }}
                      room={room}
                      relations={reactionRelations}
                      mEventId={mEventId}
                      canSendReaction={canSendReaction}
                      onReactionToggle={handleReactionToggle}
                    />
                  )
                }
                hideOthersReadReceipts={hideOthersReadReceipts}
                showDeveloperTools={showDeveloperTools}
                memberPowerTag={getMemberPowerTag(senderId)}
                accessibleTagColors={accessiblePowerTagColors}
                legacyUsernameColor={legacyUsernameColor || direct}
                hour24Clock={hour24Clock}
                dateFormatString={dateFormatString}
              >
                {mEvent.isRedacted() || Object.keys(mEvent.getContent() ?? {}).length === 0 ? (
                  <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
                ) : (
                  <PollContent
                    room={room}
                    mEvent={mEvent}
                    // Ending someone else's poll is a moderation action, so it
                    // needs redact power — the same bar as removing it.
                    canEnd={senderId === mx.getUserId() || canRedact}
                  />
                )}
              </Message>
            );
          },
        ]),
      ),
      [StateEvent.RoomMember]: (mEventId, mEvent, item) => {
        const membershipChanged = isMembershipChanged(mEvent);
        if (membershipChanged && hideMembershipEvents) return null;
        if (!membershipChanged && hideNickAvatarEvents) return null;

        const highlighted = focusItem?.index === item && focusItem.highlight;
        // A redacted state event has no content left to describe. Parsing it
        // anyway produced a line about a membership change that is no longer
        // recorded — at best meaningless, at worst a crash on a shape the
        // parser assumes is there. Show what actually happened to it instead.
        const redacted = mEvent.isRedacted();
        const parsed = redacted ? undefined : parseMemberEvent(mEvent);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideOthersReadReceipts={hideOthersReadReceipts}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={parsed?.icon ?? Icons.Delete}
              content={
                redacted ? (
                  <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
                ) : (
                  <Box grow="Yes" direction="Column">
                    <Text size="T300" priority="300">
                      {parsed?.body}
                    </Text>
                  </Box>
                )
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomName]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideOthersReadReceipts={hideOthersReadReceipts}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={mEvent.isRedacted() ? Icons.Delete : Icons.Hash}
              content={
                mEvent.isRedacted() ? (
                  <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
                ) : (
                  <Box grow="Yes" direction="Column">
                    <Text size="T300" priority="300">
                      <b>{senderName}</b>
                      {t('Organisms.RoomCommon.changed_room_name')}
                    </Text>
                  </Box>
                )
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomTopic]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideOthersReadReceipts={hideOthersReadReceipts}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={mEvent.isRedacted() ? Icons.Delete : Icons.Hash}
              content={
                mEvent.isRedacted() ? (
                  <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
                ) : (
                  <Box grow="Yes" direction="Column">
                    <Text size="T300" priority="300">
                      <b>{senderName}</b>
                      {' changed room topic'}
                    </Text>
                  </Box>
                )
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomAvatar]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideOthersReadReceipts={hideOthersReadReceipts}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={mEvent.isRedacted() ? Icons.Delete : Icons.Hash}
              content={
                mEvent.isRedacted() ? (
                  <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
                ) : (
                  <Box grow="Yes" direction="Column">
                    <Text size="T300" priority="300">
                      <b>{senderName}</b>
                      {' changed room avatar'}
                    </Text>
                  </Box>
                )
              }
            />
          </Event>
        );
      },
      [StateEvent.GroupCallMemberPrefix]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const content = mEvent.getContent();
        const prevContent = mEvent.getPrevContent();

        const callJoined = content.application;
        if (callJoined && 'application' in prevContent) {
          return null;
        }

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideOthersReadReceipts={hideOthersReadReceipts}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={callJoined ? Icons.Phone : Icons.PhoneDown}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {callJoined ? ' joined the call' : ' ended the call'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideOthersReadReceipts={hideOthersReadReceipts}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' state event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      if (Object.keys(mEvent.getContent()).length === 0) return null;
      if (mEvent.getRelation()) return null;
      if (mEvent.isRedaction()) return null;

      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideOthersReadReceipts={hideOthersReadReceipts}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
  );

  // Fork-only: replaces the browser's messy selection copy with a clean,
  // parseable transcript ([time] <sender> body, with reply context quoted).
  // Falls back to native copy when the selection is not a transcript-shaped
  // span of messages.
  const handleCopy = useCallback<ClipboardEventHandler<HTMLDivElement>>(
    (evt) => {
      // Never hijack copy from the in-message (Slate) message editor.
      if (editableActiveElement()) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

      const container = scrollRef.current;
      if (!container) return;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;

      const rootItem = (node: Node | null): HTMLElement | undefined => {
        let el: Node | null = node;
        while (el && el !== container) {
          if (el instanceof HTMLElement && el.hasAttribute('data-message-item')) return el;
          el = el.parentNode;
        }
        return undefined;
      };

      // Selection endpoints may sit on non-message nodes (day/unread
      // dividers). Widen to the message the divider belongs to: a divider
      // renders above the row it labels, so the start endpoint goes forward
      // and the end endpoint goes backward.
      const walk = (node: Node | null, forward: boolean): HTMLElement | undefined => {
        let current: Node | null = node;
        while (current && current !== container) {
          const item = rootItem(current);
          if (item) return item;
          current = (forward ? current.nextSibling : current.previousSibling) ?? current.parentNode;
        }
        return undefined;
      };

      const startEl = rootItem(range.startContainer) ?? walk(range.startContainer, true);
      const endEl = rootItem(range.endContainer) ?? walk(range.endContainer, false);
      if (!startEl || !endEl) return;

      const startAttr = startEl.getAttribute('data-message-item');
      const endAttr = endEl.getAttribute('data-message-item');
      if (startAttr === null || endAttr === null) return;
      const start = Number(startAttr);
      const end = Number(endAttr);
      if (Number.isNaN(start) || Number.isNaN(end)) return;

      const itemFrom = Math.min(start, end);
      const itemTo = Math.max(start, end);

      // Selecting inside a single message keeps native copy unless the whole
      // message row is covered, so raw text snippets stay copyable. Selections
      // spanning multiple messages always produce a transcript of every
      // touched message in full.
      if (itemFrom === itemTo) {
        if (!rootItem(range.startContainer) || !rootItem(range.endContainer)) return;
        // Whole-row check with false-positive margins: drags that begin a few
        // pixels left/right of the body still count as covering the row.
        const fullRange = document.createRange();
        fullRange.selectNodeContents(startEl);
        const coversWholeItem =
          range.compareBoundaryPoints(Range.START_TO_START, fullRange) <= 0 &&
          range.compareBoundaryPoints(Range.END_TO_END, fullRange) >= 0;
        if (!coversWholeItem) return;
      }

      const { linkedTimelines } = timelineRef.current;
      const transcript: string[] = [];
      for (let item = itemFrom; item <= itemTo; item += 1) {
        const [eventTimeline, baseIndex] = getTimelineAndBaseIndex(linkedTimelines, item);
        const mEvent =
          eventTimeline &&
          getTimelineEvent(eventTimeline, getTimelineRelativeIndex(item, baseIndex));
        // Match eventRenderer's visibility rules: never copy content the
        // timeline hides (ignored senders, redacted-with-hidden-events).
        const visible =
          mEvent &&
          eventTimeline &&
          !(mEvent.getSender() && ignoredUsersSet.has(mEvent.getSender() ?? '')) &&
          !(mEvent.isRedacted() && !showHiddenEvents);
        if (visible && mEvent && eventTimeline) {
          const line = eventToTranscriptLine(
            room,
            mEvent,
            eventTimeline.getTimelineSet(),
            hour24Clock,
          );
          if (line) transcript.push(line);
        }
      }

      if (transcript.length === 0) return;
      evt.clipboardData.setData('text/plain', transcript.join('\n'));
      evt.preventDefault();
    },
    [room, ignoredUsersSet, showHiddenEvents, hour24Clock],
  );

  let prevEvent: MatrixEvent | undefined;
  /**
   * The previous event this pass *looked at*, rendered or not.
   *
   * Distinct from `prevEvent`, which only advances for events that draw a row.
   * A read receipt is allowed to point at an event the timeline never renders —
   * a reaction, an edit, a thread reply — and when it did, the divider's test
   * (`prevEvent` is the read-up-to event) could never become true and the "new
   * messages" line simply did not appear. Which is the case people actually hit:
   * the last thing that happened in a busy room is very often a reaction.
   */
  let prevIteratedEventId: string | undefined;
  let isPrevRendered = false;
  let newDivider = false;
  let dayDivider = false;
  /**
   * Event id of the message heading the run currently being walked.
   *
   * Grouping is decided here and nowhere else — `collapsed` below is the same
   * decision, one message at a time — so this is the only place that can say
   * which message owns a collapsed one's header. Messages need it to publish
   * hover to that header (see `state/hoveredMessageGroup`).
   *
   * Carried in the same mutable-walk style as `prevEvent`, and with the same
   * lifetime: both are reset per render pass, so a group that starts above the
   * rendered window simply re-heads at the first message in it — which is also
   * exactly what `collapsed` does, since `isPrevRendered` starts false.
   */
  let groupHeadEventId: string | undefined;
  const eventRenderer = (item: number) => {
    const [eventTimeline, baseIndex] = getTimelineAndBaseIndex(timeline.linkedTimelines, item);
    if (!eventTimeline) return null;
    const timelineSet = eventTimeline?.getTimelineSet();
    const mEvent = getTimelineEvent(eventTimeline, getTimelineRelativeIndex(item, baseIndex));
    const mEventId = mEvent?.getId();

    if (!mEvent || !mEventId) return null;

    // Before any of the filters below, so an unrendered event can still anchor
    // the divider — see `prevIteratedEventId`.
    if (!newDivider && readUptoEventIdRef.current) {
      newDivider = prevIteratedEventId === readUptoEventIdRef.current;
    }
    prevIteratedEventId = mEventId;

    const eventSender = mEvent.getSender();
    if (eventSender && ignoredUsersSet.has(eventSender)) {
      return null;
    }
    if (mEvent.isRedacted() && !showHiddenEvents) {
      return null;
    }

    if (!dayDivider) {
      dayDivider = prevEvent ? !inSameDay(prevEvent.getTs(), mEvent.getTs()) : false;
    }

    const collapsed =
      isPrevRendered &&
      !dayDivider &&
      (!newDivider || eventSender === mx.getUserId()) &&
      prevEvent !== undefined &&
      prevEvent.getSender() === eventSender &&
      prevEvent.getType() === mEvent.getType() &&
      minuteDifference(prevEvent.getTs(), mEvent.getTs()) < 2;

    // An uncollapsed message starts a new group and therefore heads it. A
    // collapsed one inherits the head of the run it continues; the `??` is only
    // reachable if a collapsed message is the first thing this pass renders,
    // which `isPrevRendered` rules out, and it degrades to "heads itself".
    if (!collapsed) groupHeadEventId = mEventId;
    const eventGroupHeadId = groupHeadEventId ?? mEventId;

    const eventJSX = reactionOrEditEvent(mEvent)
      ? null
      : renderMatrixEvent(
          mEvent.getType(),
          typeof mEvent.getStateKey() === 'string',
          mEventId,
          mEvent,
          item,
          timelineSet,
          collapsed,
          eventGroupHeadId,
        );
    prevEvent = mEvent;
    isPrevRendered = !!eventJSX;

    const newDividerJSX =
      newDivider && eventJSX && eventSender !== mx.getUserId() ? (
        <MessageBase space={messageSpacing}>
          <Box gap="100" justifyContent="End" alignItems="Center">
            <Line style={{ flexGrow: 1 }} variant="Success" size="300" />
            <Badge as="span" size="400" variant="Success" fill="Solid" radii="300">
              <Text size="L400">NEW</Text>
            </Badge>
          </Box>
        </MessageBase>
      ) : null;

    const dayDividerJSX =
      dayDivider && eventJSX ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider variant="Surface">
            <Badge as="span" size="500" variant="Secondary" fill="None" radii="300">
              <Text size="L400">
                {(() => {
                  if (today(mEvent.getTs())) return 'Today';
                  if (yesterday(mEvent.getTs())) return 'Yesterday';
                  return timeDayMonthYear(mEvent.getTs());
                })()}
              </Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    if (eventJSX && (newDividerJSX || dayDividerJSX)) {
      if (newDividerJSX) newDivider = false;
      if (dayDividerJSX) dayDivider = false;

      return (
        <React.Fragment key={mEventId}>
          {newDividerJSX}
          {dayDividerJSX}
          {eventJSX}
        </React.Fragment>
      );
    }

    return eventJSX;
  };

  return (
    <Box grow="Yes" style={{ position: 'relative' }}>
      {unreadInfo?.readUptoEventId && !unreadInfo?.inLiveTimeline && (
        <TimelineFloat position="Top">
          <Chip
            variant="Primary"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.MessageUnread} />}
            onClick={handleJumpToUnread}
          >
            <Text size="L400">Jump to Unread</Text>
          </Chip>

          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.CheckTwice} />}
            onClick={handleMarkAsRead}
          >
            <Text size="L400">Mark as Read</Text>
          </Chip>
        </TimelineFloat>
      )}
      <MessageKeybinds room={room} onSetEditId={setEditId} editor={editor} />
      <Scroll ref={scrollRef} className={css.TimelineScroll} visibility="Hover">
        <Box
          direction="Column"
          justifyContent="End"
          style={{ minHeight: '100%', padding: `${config.space.S600} 0` }}
          onCopy={handleCopy}
        >
          {!canPaginateBack && rangeAtStart && getItems().length > 0 && (
            <div
              style={{
                padding: `${config.space.S700} ${config.space.S400} ${config.space.S600} ${
                  messageLayout === MessageLayout.Compact ? config.space.S400 : toRem(64)
                }`,
              }}
            >
              <RoomIntro room={room} />
            </div>
          )}
          {(canPaginateBack || !rangeAtStart) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
              </>
            ))}

          {getItems().map(eventRenderer)}

          {(!liveTimelineLinked || !rangeAtEnd) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
              </>
            ))}
          <span ref={atBottomAnchorRef} />
        </Box>
      </Scroll>
      {!atBottom && (
        <TimelineFloat position="Bottom">
          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.ArrowBottom} />}
            onClick={handleJumpToLatest}
          >
            <Text size="L400">Jump to Latest</Text>
          </Chip>
        </TimelineFloat>
      )}
    </Box>
  );
}
