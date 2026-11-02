import { useMemo, useRef } from 'react';
import {
  Avatar,
  Box,
  Button,
  Header,
  Icon,
  IconButton,
  Icons,
  Line,
  Scroll,
  Spinner,
  Text,
  config,
} from 'folds';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { EventType, MatrixEvent, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useThreadEvents } from '../../../hooks/useThreadEvents';
import { useRoomEvent } from '../../../hooks/useRoomEvent';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useEditor } from '../../../components/editor';
import { RoomInput } from '../RoomInput';
import {
  getReactCustomHtmlParser,
  makeMentionCustomProps,
  renderMatrixMention,
  factoryRenderLinkifyWithMention,
  LINKIFY_OPTS,
} from '../../../plugins/react-custom-html-parser';
import { useMentionClickHandler } from '../../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../../hooks/useSpoilerClickHandler';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { useKatex } from '../../../hooks/useKatex';
import {
  MessageBase,
  ModernLayout,
  RedactedContent,
  Time,
  Username,
} from '../../../components/message';
import { UserAvatar } from '../../../components/user-avatar';
import { nameInitials } from '../../../utils/common';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { contentForDisplay, getPerMessageProfile } from '../../../utils/perMessageProfile';
import colorMXID from '../../../../util/colorMXID';

type ThreadMessageProps = {
  room: Room;
  mEvent: MatrixEvent;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: LinkifyOpts;
  hour24Clock: boolean;
  dateFormatString: string;
  mediaAutoLoad: boolean;
  urlPreview: boolean;
};

/**
 * A message inside a thread.
 *
 * Deliberately simpler than the room timeline's `Message`: a thread is tens of
 * events, not thousands, so it needs no virtualiser, no pagination machinery
 * and no jump-to-event. What it does share is `RenderMessageContent`, so voice
 * notes, polls, images and maths all look the same here as they do in the room.
 */
function ThreadMessage({
  room,
  mEvent,
  htmlReactParserOptions,
  linkifyOpts,
  hour24Clock,
  dateFormatString,
  mediaAutoLoad,
  urlPreview,
}: ThreadMessageProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const senderId = mEvent.getSender() ?? '';
  const profile = getPerMessageProfile(mEvent.getContent());
  const displayName =
    profile?.displayname ??
    getMemberDisplayName(room, senderId) ??
    getMxIdLocalPart(senderId) ??
    senderId;
  const avatarMxc = profile ? profile.avatarUrl : getMemberAvatarMxc(room, senderId);

  const getContent = (() => contentForDisplay(mEvent.getContent())) as never;

  return (
    <MessageBase space="300">
      <ModernLayout
        before={
          // Must sit inside a sized <Avatar>: UserAvatar renders a fill-parent
          // AvatarImage, so without the fixed box it expanded to the column
          // width — the "avatar fills the whole thing" in the thread panel.
          <Avatar size="300">
            <UserAvatar
              userId={senderId}
              src={
                avatarMxc
                  ? (mxcUrlToHttp(mx, avatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined)
                  : undefined
              }
              alt={displayName}
              renderFallback={() => <Text size="H6">{nameInitials(displayName)}</Text>}
            />
          </Avatar>
        }
      >
        <Box gap="200" alignItems="Baseline">
          <Username style={{ color: colorMXID(senderId) }}>
            <Text as="span" size="T300" truncate>
              <b>{displayName}</b>
            </Text>
          </Username>
          <Time
            ts={mEvent.getTs()}
            compact={false}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
            size="T200"
            priority="300"
          />
        </Box>

        {mEvent.isRedacted() ? (
          <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
        ) : (
          <RenderMessageContent
            displayName={displayName}
            msgType={mEvent.getContent().msgtype ?? ''}
            decryptionFailureCode={mEvent.decryptionFailureReason}
            ts={mEvent.getTs()}
            getContent={getContent}
            mediaAutoLoad={mediaAutoLoad}
            urlPreview={urlPreview}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
            outlineAttachment
          />
        )}
      </ModernLayout>
    </MessageBase>
  );
}

type ThreadViewProps = {
  room: Room;
  rootId: string;
  onClose: () => void;
};

export function ThreadView({ room, rootId, onClose }: ThreadViewProps) {
  const mx = useMatrixClient();
  const editor = useEditor();
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const rootEvent = useRoomEvent(room, rootId);
  const { events, loading, canPaginate, paginate } = useThreadEvents(room, rootId);

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [globalUrlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const urlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : globalUrlPreview;
  const [mathsEnabled] = useSetting(settingsAtom, 'renderMaths');
  const renderMaths = useKatex(mathsEnabled);
  const useAuthentication = useMediaAuthentication();

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

  const latestEventId = events.length > 0 ? events[events.length - 1].getId() : undefined;

  return (
    <Box grow="Yes" direction="Column" ref={containerRef}>
      <Header
        size="600"
        style={{
          padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
          borderBottomWidth: config.borderWidth.B300,
        }}
        variant="Background"
      >
        <Box grow="Yes" alignItems="Center" gap="200">
          <Icon size="200" src={Icons.Message} />
          <Text size="H4" truncate>
            Thread
          </Text>
        </Box>
        <Box shrink="No">
          <IconButton onClick={onClose} variant="Background" size="300" radii="300">
            <Icon src={Icons.Cross} />
          </IconButton>
        </Box>
      </Header>

      <Box grow="Yes">
        <Scroll ref={scrollRef} size="300" hideTrack visibility="Hover">
          <Box direction="Column" style={{ padding: config.space.S200 }}>
            {rootEvent === undefined && (
              <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
                <Spinner variant="Secondary" size="400" />
              </Box>
            )}

            {rootEvent === null && (
              <Text size="T200" priority="300" style={{ padding: config.space.S400 }}>
                The message this thread started from could not be loaded.
              </Text>
            )}

            {rootEvent && (
              <ThreadMessage
                room={room}
                mEvent={rootEvent}
                htmlReactParserOptions={htmlReactParserOptions}
                linkifyOpts={linkifyOpts}
                hour24Clock={hour24Clock}
                dateFormatString={dateFormatString}
                mediaAutoLoad={mediaAutoLoad}
                urlPreview={urlPreview}
              />
            )}

            <Box style={{ padding: `${config.space.S200} 0` }} alignItems="Center" gap="200">
              <Line style={{ flexGrow: 1 }} variant="Surface" size="300" />
              <Text size="L400" priority="300">
                {events.length === 1 ? '1 reply' : `${events.length} replies`}
              </Text>
              <Line style={{ flexGrow: 1 }} variant="Surface" size="300" />
            </Box>

            {canPaginate && (
              <Box justifyContent="Center" style={{ paddingBottom: config.space.S200 }}>
                <Button
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                  outlined
                  onClick={paginate}
                  disabled={loading}
                >
                  <Text size="B300">{loading ? 'Loading…' : 'Load earlier replies'}</Text>
                </Button>
              </Box>
            )}

            {loading && events.length === 0 && (
              <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
                <Spinner variant="Secondary" size="400" />
              </Box>
            )}

            {events.map((mEvent) => (
              <ThreadMessage
                key={mEvent.getId()}
                room={room}
                mEvent={mEvent}
                htmlReactParserOptions={htmlReactParserOptions}
                linkifyOpts={linkifyOpts}
                hour24Clock={hour24Clock}
                dateFormatString={dateFormatString}
                mediaAutoLoad={mediaAutoLoad}
                urlPreview={urlPreview}
              />
            ))}
          </Box>
        </Scroll>
      </Box>

      <Box shrink="No" direction="Column" style={{ padding: config.space.S200 }}>
        <RoomInput
          room={room}
          roomId={room.roomId}
          editor={editor}
          fileDropContainerRef={containerRef}
          threadRootId={rootId}
          threadLatestEventId={latestEventId}
        />
      </Box>
    </Box>
  );
}

export const canReplyInThread = (room: Room, mx: ReturnType<typeof useMatrixClient>): boolean =>
  room.currentState.maySendEvent(EventType.RoomMessage, mx.getSafeUserId());
