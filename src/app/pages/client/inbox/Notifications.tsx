/* eslint-disable react/destructuring-assignment */
import {
  MouseEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  Chip,
  Header,
  Icon,
  IconButton,
  Icons,
  Scroll,
  Text,
  config,
  toRem,
} from 'folds';
import { useSearchParams } from 'react-router-dom';
import {
  INotification,
  INotificationsResponse,
  IRoomEvent,
  MatrixClient,
  JoinRule,
  MatrixEvent,
  Method,
  RelationType,
  Room,
} from 'matrix-js-sdk';
import { useVirtualizer } from '@tanstack/react-virtual';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useAtomValue } from 'jotai';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../../components/page';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { InboxNotificationsPathSearchParams } from '../../paths';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { SequenceCard } from '../../../components/sequence-card';
import { RoomAvatar, RoomIcon } from '../../../components/room-avatar';
import {
  getEditedEvent,
  getMemberAvatarMxc,
  getMemberDisplayName,
  getRoomAvatarUrl,
} from '../../../utils/room';
import { ScrollTopContainer } from '../../../components/scroll-top-container';
import { useInterval } from '../../../hooks/useInterval';
import {
  AvatarBase,
  ImageContent,
  MSticker,
  MessageNotDecryptedContent,
  MessageUnsupportedContent,
  ModernLayout,
  RedactedContent,
  Reply,
  Time,
  Username,
  UsernameBold,
} from '../../../components/message';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../../plugins/react-custom-html-parser';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { Image } from '../../../components/media';
import { ImageViewer } from '../../../components/image-viewer';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../../types/matrix/room';
import { useMatrixEventRenderer } from '../../../hooks/useMatrixEventRenderer';
import { useMemberEventParser } from '../../../hooks/useMemberEventParser';
import * as customHtmlCss from '../../../styles/CustomHtml.css';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { useRoomUnread } from '../../../state/hooks/unread';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { markAsRead } from '../../../utils/notifications';
import { ContainerColor } from '../../../styles/ContainerColor.css';
import { VirtualTile } from '../../../components/virtualizer';
import { UserAvatar } from '../../../components/user-avatar';
import { EncryptedContent } from '../../../features/room/message';
import { useMentionClickHandler } from '../../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../../hooks/useSpoilerClickHandler';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { BackRouteHandler } from '../../../components/BackRouteHandler';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { usePowerLevelTags } from '../../../hooks/usePowerLevelTags';
import { useTheme } from '../../../hooks/useTheme';
import { PowerIcon } from '../../../components/power';
import colorMXID from '../../../../util/colorMXID';
import { mDirectAtom } from '../../../state/mDirectList';
import {
  getPowerTagIconSrc,
  useAccessiblePowerTagColors,
  useGetMemberPowerTag,
} from '../../../hooks/useMemberPowerTag';
import { useRoomCreatorsTag } from '../../../hooks/useRoomCreatorsTag';
import { useRoomCreators } from '../../../hooks/useRoomCreators';

type RoomNotificationsGroup = {
  roomId: string;
  notifications: INotification[];
};
type NotificationTimeline = {
  nextToken?: string;
  groups: RoomNotificationsGroup[];
};
type LoadTimeline = (from?: string) => Promise<void>;
type SilentReloadTimeline = () => Promise<void>;

const groupNotifications = (
  notifications: INotification[],
  allowRooms: Set<string>,
): RoomNotificationsGroup[] => {
  const groups: RoomNotificationsGroup[] = [];
  notifications.forEach((notification) => {
    if (!allowRooms.has(notification.room_id)) return;

    const groupIndex = groups.length - 1;
    const lastAddedGroup: RoomNotificationsGroup | undefined = groups[groupIndex];
    if (lastAddedGroup && notification.room_id === lastAddedGroup.roomId) {
      lastAddedGroup.notifications.push(notification);
      return;
    }
    groups.push({
      roomId: notification.room_id,
      notifications: [notification],
    });
  });
  return groups;
};

/** Events per encrypted room the local scan looks back over. */
const LOCAL_SCAN_PER_ROOM = 60;

/**
 * Notifications the server could not have told us about.
 *
 * `/notifications` is evaluated on the homeserver, against content the
 * homeserver can read. In an encrypted room it can read none of it: a message
 * that mentions you by name, or matches a keyword rule, is an opaque
 * `m.room.encrypted` blob to the server, so it never appears in the response
 * and the inbox is silently empty in exactly the rooms this client is usually
 * used in. Only the client can evaluate those rules, because only the client
 * has the plaintext.
 *
 * So the same push rules are run here, locally, over the decrypted events
 * already in memory, and the results are merged into the first page.
 * `forceRecalculate` is not optional: the SDK caches push actions on the event,
 * and for an encrypted event the cached value is the one computed *before*
 * decryption — i.e. computed against ciphertext, which matches nothing.
 *
 * Bounded to what is in memory on purpose. Paginating every encrypted room's
 * history to build an inbox would be a very large amount of work for a view
 * people glance at.
 */
const localEncryptedNotifications = (
  mx: MatrixClient,
  allowRooms: Set<string>,
  onlyHighlight: boolean,
): INotification[] => {
  const userId = mx.getUserId();
  if (!userId) return [];
  const found: INotification[] = [];

  allowRooms.forEach((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || !room.hasEncryptionStateEvent()) return;

    const events = room.getLiveTimeline().getEvents();
    const from = Math.max(0, events.length - LOCAL_SCAN_PER_ROOM);
    for (let i = events.length - 1; i >= from; i -= 1) {
      const mEvent = events[i];
      const eventId = mEvent.getId();
      // Your own message notifying you is a rule this client should not need
      // the server's help to dismiss.
      if (!eventId || mEvent.getSender() === userId || mEvent.isRedacted()) continue;

      let actions;
      try {
        actions = mx.getPushActionsForEvent(mEvent, true);
      } catch {
        continue;
      }
      if (!actions?.notify) continue;
      if (onlyHighlight && !actions.tweaks?.highlight) continue;

      found.push({
        actions: [],
        event: mEvent.event as IRoomEvent,
        read: room.hasUserReadEvent(userId, eventId),
        room_id: roomId,
        ts: mEvent.getTs(),
      });
    }
  });

  return found;
};

/**
 * Server and locally-evaluated notifications as one list, newest first.
 *
 * De-duplicated by event id with the server's copy winning, because it carries
 * the `actions` the server decided on and this view renders from those.
 */
const mergeNotifications = (server: INotification[], local: INotification[]): INotification[] => {
  if (local.length === 0) return server;
  const seen = new Set(server.map((n) => n.event.event_id));
  const merged = server.concat(local.filter((n) => !seen.has(n.event.event_id)));
  return merged.sort((a, b) => b.ts - a.ts);
};

const useNotificationTimeline = (
  paginationLimit: number,
  onlyHighlight?: boolean,
): [NotificationTimeline, LoadTimeline, SilentReloadTimeline] => {
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);
  const allJoinedRooms = useMemo(() => new Set(allRooms), [allRooms]);

  const [notificationTimeline, setNotificationTimeline] = useState<NotificationTimeline>({
    groups: [],
  });

  const fetchNotifications = useCallback(
    (from?: string, limit?: number, only?: 'highlight') => {
      const queryParams = { from, limit, only };
      return mx.http.authedRequest<INotificationsResponse>(
        Method.Get,
        '/notifications',
        queryParams,
      );
    },
    [mx],
  );

  const loadTimeline: LoadTimeline = useCallback(
    async (from) => {
      if (!from) {
        setNotificationTimeline({ groups: [] });
      }
      const data = await fetchNotifications(
        from,
        paginationLimit,
        onlyHighlight ? 'highlight' : undefined,
      );
      // Only on the first page: local results have no pagination token, so
      // merging them into every page would repeat them down the list.
      const notifications = from
        ? data.notifications
        : mergeNotifications(
            data.notifications,
            localEncryptedNotifications(mx, allJoinedRooms, !!onlyHighlight),
          );
      const groups = groupNotifications(notifications, allJoinedRooms);

      setNotificationTimeline((currentTimeline) => {
        if (currentTimeline.nextToken === from) {
          return {
            nextToken: data.next_token,
            groups: from ? currentTimeline.groups.concat(groups) : groups,
          };
        }
        return currentTimeline;
      });
    },
    [mx, paginationLimit, onlyHighlight, fetchNotifications, allJoinedRooms],
  );

  /**
   * Reload timeline silently i.e without setting to default
   * before fetching notifications from start
   */
  const silentReloadTimeline: SilentReloadTimeline = useCallback(async () => {
    const data = await fetchNotifications(
      undefined,
      paginationLimit,
      onlyHighlight ? 'highlight' : undefined,
    );
    const groups = groupNotifications(
      mergeNotifications(
        data.notifications,
        localEncryptedNotifications(mx, allJoinedRooms, !!onlyHighlight),
      ),
      allJoinedRooms,
    );
    setNotificationTimeline({
      nextToken: data.next_token,
      groups,
    });
  }, [mx, paginationLimit, onlyHighlight, fetchNotifications, allJoinedRooms]);

  return [notificationTimeline, loadTimeline, silentReloadTimeline];
};

type RoomNotificationsGroupProps = {
  room: Room;
  notifications: INotification[];
  mediaAutoLoad?: boolean;
  urlPreview?: boolean;
  hideReadReceipts: boolean;
  onOpen: (roomId: string, eventId: string) => void;
  legacyUsernameColor?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
function RoomNotificationsGroupComp({
  room,
  notifications,
  mediaAutoLoad,
  urlPreview,
  hideReadReceipts,
  onOpen,
  legacyUsernameColor,
  hour24Clock,
  dateFormatString,
}: RoomNotificationsGroupProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);

  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);

  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);

  const theme = useTheme();
  const accessibleTagColors = useAccessiblePowerTagColors(theme.kind, creatorsTag, powerLevelTags);

  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const parseMemberEvent = useMemberEventParser();
  const spoilerClickHandler = useSpoilerClickHandler();

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
      }),
    [mx, room, linkifyOpts, mentionClickHandler, spoilerClickHandler, useAuthentication],
  );

  const renderMatrixEvent = useMatrixEventRenderer<[IRoomEvent, string, GetContentCallback]>(
    {
      [MessageEvent.RoomMessage]: (event, displayName, getContent) => {
        if (event.unsigned?.redacted_because) {
          return <RedactedContent reason={event.unsigned?.redacted_because.content.reason} />;
        }

        return (
          <RenderMessageContent
            displayName={displayName}
            msgType={event.content.msgtype ?? ''}
            ts={event.origin_server_ts}
            getContent={getContent}
            mediaAutoLoad={mediaAutoLoad}
            urlPreview={urlPreview}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
            outlineAttachment
          />
        );
      },
      [MessageEvent.RoomMessageEncrypted]: (evt, displayName) => {
        const evtTimeline = room.getTimelineForEvent(evt.event_id);

        const mEvent = evtTimeline?.getEvents().find((e) => e.getId() === evt.event_id);

        if (!mEvent || !evtTimeline) {
          return (
            <Box grow="Yes" direction="Column">
              <Text size="T400" priority="300">
                <code className={customHtmlCss.Code}>{evt.type}</code>
                {' event'}
              </Text>
            </Box>
          );
        }

        return (
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
                const editedEvent = getEditedEvent(
                  evt.event_id,
                  mEvent,
                  evtTimeline.getTimelineSet(),
                );
                const getContent = (() =>
                  editedEvent?.getContent()['m.new_content'] ??
                  mEvent.getContent()) as GetContentCallback;

                return (
                  <RenderMessageContent
                    displayName={displayName}
                    msgType={mEvent.getContent().msgtype ?? ''}
                    ts={mEvent.getTs()}
                    edited={!!editedEvent}
                    getContent={getContent}
                    mediaAutoLoad={mediaAutoLoad}
                    urlPreview={urlPreview}
                    htmlReactParserOptions={htmlReactParserOptions}
                    linkifyOpts={linkifyOpts}
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
        );
      },
      [MessageEvent.Sticker]: (event, displayName, getContent) => {
        if (event.unsigned?.redacted_because) {
          return <RedactedContent reason={event.unsigned?.redacted_because.content.reason} />;
        }
        return (
          <MSticker
            content={getContent()}
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
      },
      /**
       * An invite arrives as an `m.room.member` state event, and without this it
       * fell through to the generic branch below and rendered as the literal
       * text "`m.room.member` event" — the notification that most needs to say
       * what it is was the one saying least.
       *
       * Parsed with the same `useMemberEventParser` the timeline uses, rather
       * than a second set of phrasings written here: membership has more cases
       * than invite (knock, accepted knock, kick, ban, unban, profile changes),
       * and two independent renderings of them drift. The parser wants a
       * `MatrixEvent`, so the raw notification JSON is wrapped in one —
       * `unsigned.prev_content` comes through, which is what tells an accepted
       * knock apart from an ordinary invite.
       */
      [StateEvent.RoomMember]: (event) => {
        const { body } = parseMemberEvent(new MatrixEvent(event));
        return (
          <Box grow="Yes" direction="Column">
            <Text size="T400" priority="300">
              {body}
            </Text>
          </Box>
        );
      },
      [StateEvent.RoomTombstone]: (event) => {
        const { content } = event;
        return (
          <Box grow="Yes" direction="Column">
            <Text size="T400" priority="300">
              Room Tombstone. {content.body}
            </Text>
          </Box>
        );
      },
    },
    undefined,
    (event) => {
      if (event.unsigned?.redacted_because) {
        return <RedactedContent reason={event.unsigned?.redacted_because.content.reason} />;
      }
      return (
        <Box grow="Yes" direction="Column">
          <Text size="T400" priority="300">
            <code className={customHtmlCss.Code}>{event.type}</code>
            {' event'}
          </Text>
        </Box>
      );
    },
  );

  const handleOpenClick: MouseEventHandler = (evt) => {
    const eventId = evt.currentTarget.getAttribute('data-event-id');
    if (!eventId) return;
    onOpen(room.roomId, eventId);
  };
  const handleMarkAsRead = () => {
    markAsRead(mx, room.roomId, hideReadReceipts);
  };

  return (
    <Box direction="Column" gap="200">
      <Header size="300">
        <Box gap="200" grow="Yes">
          <Avatar size="200" radii="300">
            <RoomAvatar
              roomId={room.roomId}
              src={getRoomAvatarUrl(mx, room, 96, useAuthentication)}
              alt={room.name}
              renderFallback={() => (
                <RoomIcon
                  size="50"
                  roomType={room.getType()}
                  joinRule={room.getJoinRule() ?? JoinRule.Restricted}
                  filled
                />
              )}
            />
          </Avatar>
          <Text size="H4" truncate>
            {room.name}
          </Text>
        </Box>
        <Box shrink="No">
          {unread && (
            <Chip
              variant="Primary"
              radii="Pill"
              onClick={handleMarkAsRead}
              before={<Icon size="100" src={Icons.CheckTwice} />}
            >
              <Text size="T200">Mark as Read</Text>
            </Chip>
          )}
        </Box>
      </Header>
      <Box direction="Column" gap="100">
        {notifications.map((notification) => {
          const { event } = notification;

          const displayName =
            getMemberDisplayName(room, event.sender) ??
            getMxIdLocalPart(event.sender) ??
            event.sender;
          const senderAvatarMxc = getMemberAvatarMxc(room, event.sender);
          const getContent = (() => event.content) as GetContentCallback;

          const relation = event.content['m.relates_to'];
          const replyEventId = relation?.['m.in_reply_to']?.event_id;
          const threadRootId =
            relation?.rel_type === RelationType.Thread ? relation.event_id : undefined;

          const memberPowerTag = getMemberPowerTag(event.sender);
          const tagColor = memberPowerTag?.color
            ? accessibleTagColors?.get(memberPowerTag.color)
            : undefined;
          const tagIconSrc = memberPowerTag?.icon
            ? getPowerTagIconSrc(mx, useAuthentication, memberPowerTag.icon)
            : undefined;

          const usernameColor = legacyUsernameColor ? colorMXID(event.sender) : tagColor;

          return (
            <SequenceCard
              key={notification.event.event_id}
              style={{ padding: config.space.S400 }}
              variant="SurfaceVariant"
              direction="Column"
            >
              <ModernLayout
                before={
                  <AvatarBase>
                    <Avatar size="300">
                      <UserAvatar
                        userId={event.sender}
                        src={
                          senderAvatarMxc
                            ? (mxcUrlToHttp(
                                mx,
                                senderAvatarMxc,
                                useAuthentication,
                                48,
                                48,
                                'crop',
                              ) ?? undefined)
                            : undefined
                        }
                        alt={displayName}
                        renderFallback={() => <Icon size="200" src={Icons.User} filled />}
                      />
                    </Avatar>
                  </AvatarBase>
                }
              >
                <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
                  <Box gap="200" alignItems="Baseline">
                    <Box alignItems="Center" gap="200">
                      <Username style={{ color: usernameColor }}>
                        <Text as="span" truncate>
                          <UsernameBold>{displayName}</UsernameBold>
                        </Text>
                      </Username>
                      {tagIconSrc && <PowerIcon size="100" iconSrc={tagIconSrc} />}
                    </Box>
                    <Time
                      ts={event.origin_server_ts}
                      hour24Clock={hour24Clock}
                      dateFormatString={dateFormatString}
                    />
                  </Box>
                  <Box shrink="No" gap="200" alignItems="Center">
                    <Chip
                      data-event-id={event.event_id}
                      onClick={handleOpenClick}
                      variant="Secondary"
                      radii="400"
                    >
                      <Text size="T200">Open</Text>
                    </Chip>
                  </Box>
                </Box>
                {replyEventId && (
                  <Reply
                    room={room}
                    replyEventId={replyEventId}
                    threadRootId={threadRootId}
                    onClick={handleOpenClick}
                    getMemberPowerTag={getMemberPowerTag}
                    accessibleTagColors={accessibleTagColors}
                    legacyUsernameColor={legacyUsernameColor}
                  />
                )}
                {renderMatrixEvent(event.type, false, event, displayName, getContent)}
              </ModernLayout>
            </SequenceCard>
          );
        })}
      </Box>
    </Box>
  );
}

const useNotificationsSearchParams = (
  searchParams: URLSearchParams,
): InboxNotificationsPathSearchParams =>
  useMemo(
    () => ({
      only: searchParams.get('only') ?? undefined,
    }),
    [searchParams],
  );

const DEFAULT_REFRESH_MS = 7000;

type NotificationsProps = {
  /** Page title. The combined inbox reuses this page under its own name. */
  title?: string;
  /**
   * Rendered inside this page's scroll container, above the filter chips.
   *
   * A slot rather than a separate page, because the notification list is
   * virtualised against the `Scroll` element below — putting it inside another
   * scroller would leave the virtualiser measuring a viewport that never
   * scrolls, so it would render only the first screenful and stop. The combined
   * inbox therefore puts the invites INTO this scroller instead of wrapping it.
   */
  before?: ReactNode;
};
export function Notifications({ title = 'Notification Messages', before }: NotificationsProps) {
  const mx = useMatrixClient();
  const [hideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const screenSize = useScreenSizeContext();
  const mDirects = useAtomValue(mDirectAtom);

  const { navigateRoom } = useRoomNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const notificationsSearchParams = useNotificationsSearchParams(searchParams);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTopAnchorRef = useRef<HTMLDivElement>(null);
  const [refreshIntervalTime, setRefreshIntervalTime] = useState(DEFAULT_REFRESH_MS);

  const onlyHighlight = notificationsSearchParams.only === 'highlight';
  const setOnlyHighlighted = (highlight: boolean) => {
    if (highlight) {
      setSearchParams(
        new URLSearchParams({
          only: 'highlight',
        }),
      );
      return;
    }
    setSearchParams();
  };

  const [notificationTimeline, _loadTimeline, silentReloadTimeline] = useNotificationTimeline(
    24,
    onlyHighlight,
  );
  const [timelineState, loadTimeline] = useAsyncCallback(_loadTimeline);

  const virtualizer = useVirtualizer({
    count: notificationTimeline.groups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 4,
  });
  const vItems = virtualizer.getVirtualItems();

  useInterval(
    useCallback(() => {
      silentReloadTimeline();
    }, [silentReloadTimeline]),
    refreshIntervalTime,
  );

  const handleScrollTopVisibility = useCallback(
    (onTop: boolean) => setRefreshIntervalTime(onTop ? DEFAULT_REFRESH_MS : -1),
    [],
  );

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const lastVItem = vItems[vItems.length - 1];
  const lastVItemIndex: number | undefined = lastVItem?.index;
  useEffect(() => {
    if (
      timelineState.status === AsyncStatus.Success &&
      notificationTimeline.groups.length - 1 === lastVItemIndex &&
      notificationTimeline.nextToken
    ) {
      loadTimeline(notificationTimeline.nextToken);
    }
  }, [timelineState, notificationTimeline, lastVItemIndex, loadTimeline]);

  return (
    <Page>
      <PageHeader balance>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" basis="No">
            {screenSize === ScreenSize.Mobile && (
              <BackRouteHandler>
                {(onBack) => (
                  <IconButton onClick={onBack}>
                    <Icon src={Icons.ArrowLeft} />
                  </IconButton>
                )}
              </BackRouteHandler>
            )}
          </Box>
          <Box alignItems="Center" gap="200">
            {screenSize !== ScreenSize.Mobile && <Icon size="400" src={Icons.Message} />}
            <Text size="H3" truncate>
              {title}
            </Text>
          </Box>
          <Box grow="Yes" basis="No" />
        </Box>
      </PageHeader>

      <Box style={{ position: 'relative' }} grow="Yes">
        <Scroll ref={scrollRef} hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              <Box direction="Column" gap="200">
                {before}
                <Box ref={scrollTopAnchorRef} direction="Column" gap="100">
                  <span data-spacing-node />
                  <Text size="L400">Filter</Text>
                  <Box gap="200">
                    <Chip
                      onClick={() => setOnlyHighlighted(false)}
                      variant={!onlyHighlight ? 'Success' : 'Surface'}
                      aria-pressed={!onlyHighlight}
                      before={!onlyHighlight && <Icon size="100" src={Icons.Check} />}
                      outlined
                    >
                      <Text size="T200">All Notifications</Text>
                    </Chip>
                    <Chip
                      onClick={() => setOnlyHighlighted(true)}
                      variant={onlyHighlight ? 'Success' : 'Surface'}
                      aria-pressed={onlyHighlight}
                      before={onlyHighlight && <Icon size="100" src={Icons.Check} />}
                      outlined
                    >
                      <Text size="T200">Highlighted</Text>
                    </Chip>
                  </Box>
                </Box>
                <ScrollTopContainer
                  scrollRef={scrollRef}
                  anchorRef={scrollTopAnchorRef}
                  onVisibilityChange={handleScrollTopVisibility}
                >
                  <IconButton
                    onClick={() => virtualizer.scrollToOffset(0)}
                    variant="SurfaceVariant"
                    radii="Pill"
                    outlined
                    size="300"
                    aria-label="Scroll to Top"
                  >
                    <Icon src={Icons.ChevronTop} size="300" />
                  </IconButton>
                </ScrollTopContainer>
                <div
                  style={{
                    position: 'relative',
                    height: virtualizer.getTotalSize(),
                  }}
                >
                  {vItems.map((vItem) => {
                    const group = notificationTimeline.groups[vItem.index];
                    if (!group) return null;
                    const groupRoom = mx.getRoom(group.roomId);
                    if (!groupRoom) return null;

                    return (
                      <VirtualTile
                        virtualItem={vItem}
                        style={{ paddingTop: config.space.S500 }}
                        ref={virtualizer.measureElement}
                        key={vItem.index}
                      >
                        <RoomNotificationsGroupComp
                          room={groupRoom}
                          notifications={group.notifications}
                          mediaAutoLoad={mediaAutoLoad}
                          urlPreview={urlPreview}
                          hideReadReceipts={hideReadReceipts}
                          onOpen={navigateRoom}
                          legacyUsernameColor={
                            legacyUsernameColor || mDirects.has(groupRoom.roomId)
                          }
                          hour24Clock={hour24Clock}
                          dateFormatString={dateFormatString}
                        />
                      </VirtualTile>
                    );
                  })}
                </div>

                {timelineState.status === AsyncStatus.Success &&
                  notificationTimeline.groups.length === 0 && (
                    <Box
                      className={ContainerColor({ variant: 'SurfaceVariant' })}
                      style={{
                        padding: config.space.S300,
                        borderRadius: config.radii.R400,
                      }}
                      direction="Column"
                      gap="200"
                    >
                      <Text>No Notifications</Text>
                      <Text size="T200">
                        You don&apos;t have any new notifications to display yet.
                      </Text>
                    </Box>
                  )}

                {timelineState.status === AsyncStatus.Loading && (
                  <Box direction="Column" gap="100">
                    {[...Array(8).keys()].map((key) => (
                      <SequenceCard
                        variant="SurfaceVariant"
                        key={key}
                        style={{ minHeight: toRem(80) }}
                      />
                    ))}
                  </Box>
                )}
                {timelineState.status === AsyncStatus.Error && (
                  <Box
                    className={ContainerColor({ variant: 'Critical' })}
                    style={{
                      padding: config.space.S300,
                      borderRadius: config.radii.R400,
                    }}
                    direction="Column"
                    gap="200"
                  >
                    <Text size="L400">{(timelineState.error as Error).name}</Text>
                    <Text size="T300">{(timelineState.error as Error).message}</Text>
                  </Box>
                )}
              </Box>
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
