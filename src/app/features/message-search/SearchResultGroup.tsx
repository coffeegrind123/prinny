/* eslint-disable react/destructuring-assignment */
import { MouseEventHandler, useMemo, useState } from 'react';
import { IEventWithRoomId, JoinRule, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import {
  Avatar,
  Box,
  Chip,
  Header,
  Icon,
  Icons,
  Line,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  config,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeHighlightRegex,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import { mxcUrlToHttp } from '../../utils/matrix';
import { useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../types/matrix/room';
import {
  AvatarBase,
  ImageContent,
  MSticker,
  ModernLayout,
  RedactedContent,
  Reply,
  Time,
  Username,
  UsernameBold,
} from '../../components/message';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { getRoomAvatarUrl } from '../../utils/room';
import { ResultItem } from './useMessageSearch';
import { getResultAvatarMxc, getResultDisplayName, getResultProfile } from './resultUtils';
import { SearchResultContext } from './SearchResultContext';
import { SequenceCard } from '../../components/sequence-card';
import { UserAvatar } from '../../components/user-avatar';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useMediaPreviewsAllowed } from '../../hooks/useMediaPreview';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { useTheme } from '../../hooks/useTheme';
import { PowerIcon } from '../../components/power';
import colorMXID from '../../../util/colorMXID';
import {
  getPowerTagIconSrc,
  useAccessiblePowerTagColors,
  useGetMemberPowerTag,
} from '../../hooks/useMemberPowerTag';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { stopPropagation } from '../../utils/keyboard';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import * as messageCss from '../room/message/styles.css';
import {
  MessageCopyLinkItem,
  MessageDeleteItem,
  MessageEditHistoryItem,
  MessageForwardItem,
  MessagePinItem,
  MessageReportItem,
  MessageSourceCodeItem,
} from '../room/message';

type SearchResultGroupProps = {
  room: Room;
  highlights: string[];
  items: ResultItem[];
  mediaAutoLoad?: boolean;
  urlPreview?: boolean;
  onOpen: (roomId: string, eventId: string) => void;
  legacyUsernameColor?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
export function SearchResultGroup({
  room,
  highlights,
  items,
  mediaAutoLoad: mediaAutoLoadSetting,
  urlPreview,
  onOpen,
  legacyUsernameColor,
  hour24Clock,
  dateFormatString,
}: SearchResultGroupProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const mediaPreviewsAllowed = useMediaPreviewsAllowed(room);
  const mediaAutoLoad = (mediaAutoLoadSetting ?? false) && mediaPreviewsAllowed;
  const highlightRegex = useMemo(() => makeHighlightRegex(highlights), [highlights]);

  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);

  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);

  const theme = useTheme();
  const accessibleTagColors = useAccessiblePowerTagColors(theme.kind, creatorsTag, powerLevelTags);

  const mentionClickHandler = useMentionClickHandler(room.roomId);
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
        highlightRegex,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
        mediaPreviews: mediaAutoLoad,
      }),
    [
      mx,
      room,
      linkifyOpts,
      highlightRegex,
      mentionClickHandler,
      spoilerClickHandler,
      useAuthentication,
      mediaAutoLoad,
    ],
  );

  const renderMatrixEvent = useMatrixEventRenderer<[IEventWithRoomId, string, GetContentCallback]>(
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
            highlightRegex={highlightRegex}
            outlineAttachment
          />
        );
      },
      [MessageEvent.Reaction]: (event, displayName, getContent) => {
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

  const [showDeveloperTools] = useSetting(settingsAtom, 'developerTools');
  const permissions = useRoomPermissions(creators, powerLevels);
  const canRedact = permissions.action('redact', mx.getSafeUserId());
  const canDeleteOwn = permissions.event(MessageEvent.RoomRedaction, mx.getSafeUserId());
  const canPinEvent = permissions.stateEvent(StateEvent.RoomPinnedEvents, mx.getSafeUserId());

  // One menu for the whole group rather than one PopOut per result: a search can
  // list hundreds of hits and only ever one menu is open.
  const [menu, setMenu] = useState<{ anchor: RectCords; mEvent: MatrixEvent }>();
  const closeMenu = () => setMenu(undefined);

  const handleContextMenu =
    (event: IEventWithRoomId): MouseEventHandler =>
    (evt) => {
      // Same escape hatches the timeline's menu uses: alt is the browser's own
      // "give me the real menu" gesture, an active selection means the user is
      // after copy/paste, and a link has its own menu worth more than ours.
      if (evt.altKey || !window.getSelection()?.isCollapsed) return;
      const tag = (evt.target as HTMLElement).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'a') return;
      evt.preventDefault();

      // A search hit is a raw `IEventWithRoomId` off the search API, not a live
      // timeline event. Wrapping it is what lets the timeline's own menu items
      // be reused verbatim — they only ever ask it for id, sender, type and
      // content. The ones that need a loaded timeline (edit history, and the
      // edit list in view-source) degrade on their own when there is none.
      setMenu({
        anchor: { x: evt.clientX, y: evt.clientY, width: 0, height: 0 },
        mEvent: new MatrixEvent(event),
      });
    };

  const menuEventId = menu?.mEvent.getId();
  const menuIsOwn = menu?.mEvent.getSender() === mx.getUserId();
  const menuCanDelete = canRedact || (canDeleteOwn && menuIsOwn);

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
      </Header>
      <Box direction="Column" gap="100">
        {items.map((item) => {
          const { event } = item;

          const senderProfile = getResultProfile(item.context, event.sender);
          const displayName = getResultDisplayName(room, event.sender, senderProfile);
          const senderAvatarMxc = getResultAvatarMxc(room, event.sender, senderProfile);

          const relation = event.content['m.relates_to'];
          const mainEventId =
            relation?.rel_type === RelationType.Replace ? relation.event_id : event.event_id;

          const getContent = (() =>
            event.content['m.new_content'] ?? event.content) as GetContentCallback;

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
              key={event.event_id}
              style={{ padding: config.space.S400 }}
              variant="SurfaceVariant"
              direction="Column"
            >
              <ModernLayout
                onContextMenu={handleContextMenu(event)}
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
                      data-event-id={mainEventId}
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
                <SearchResultContext room={room} context={item.context} position="before" />
                {renderMatrixEvent(event.type, false, event, displayName, getContent)}
                <SearchResultContext room={room} context={item.context} position="after" />
              </ModernLayout>
            </SequenceCard>
          );
        })}
      </Box>
      <PopOut
        anchor={menu?.anchor}
        position="Bottom"
        align="Start"
        offset={0}
        content={
          menu && (
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: closeMenu,
                clickOutsideDeactivates: true,
                isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                escapeDeactivates: stopPropagation,
              }}
            >
              <Menu>
                <Box direction="Column" gap="100" className={messageCss.MessageMenuGroup}>
                  <MenuItem
                    size="300"
                    after={<Icon size="100" src={Icons.ArrowGoRight} />}
                    radii="300"
                    onClick={() => {
                      if (menuEventId) onOpen(room.roomId, menuEventId);
                      closeMenu();
                    }}
                  >
                    <Text className={messageCss.MessageMenuItemText} as="span" size="T300" truncate>
                      Open in Room
                    </Text>
                  </MenuItem>
                  <MessageForwardItem mEvent={menu.mEvent} onClose={closeMenu} />
                  <MessageEditHistoryItem room={room} mEvent={menu.mEvent} onClose={closeMenu} />
                  <MessageCopyLinkItem room={room} mEvent={menu.mEvent} onClose={closeMenu} />
                  {showDeveloperTools && (
                    <MessageSourceCodeItem room={room} mEvent={menu.mEvent} onClose={closeMenu} />
                  )}
                  {canPinEvent && (
                    <MessagePinItem room={room} mEvent={menu.mEvent} onClose={closeMenu} />
                  )}
                </Box>
                {(menuCanDelete || !menuIsOwn) && (
                  <>
                    <Line size="300" />
                    <Box direction="Column" gap="100" className={messageCss.MessageMenuGroup}>
                      {menuCanDelete && (
                        <MessageDeleteItem room={room} mEvent={menu.mEvent} onClose={closeMenu} />
                      )}
                      {!menuIsOwn && (
                        <MessageReportItem room={room} mEvent={menu.mEvent} onClose={closeMenu} />
                      )}
                    </Box>
                  </>
                )}
              </Menu>
            </FocusTrap>
          )
        }
      />
    </Box>
  );
}
