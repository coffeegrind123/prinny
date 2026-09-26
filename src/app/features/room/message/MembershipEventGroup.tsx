import React, { MouseEventHandler, useState } from 'react';
import {
  Avatar,
  Box,
  Chip,
  Icon,
  Icons,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  as,
  toRem,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { EventContent, MessageBase, Time } from '../../../components/message';
import { UserAvatar } from '../../../components/user-avatar';
import { ReadReceiptAvatars } from '../../../components/read-receipt-avatars/ReadReceiptAvatars';
import { EventReaders } from '../../../components/event-readers';
import { useElementReadReceipts } from '../../../hooks/useElementReadReceipts';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useSetting } from '../../../state/hooks/settings';
import { MessageLayout, MessageSpacing, settingsAtom } from '../../../state/settings';
import { getMemberDisplayName } from '../../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { stopPropagation } from '../../../utils/keyboard';
import {
  MembershipSummaryEvent,
  getSummaryMembers,
  summarizeMembershipEvents,
} from '../../../utils/membershipSummary';
import { IMemberContent, Membership } from '../../../../types/matrix/room';
import * as css from './MembershipEventGroup.css';

/** Element shows at most five faces on a summary; the text names the rest. */
const AVATAR_LIMIT = 5;
const AVATAR_SIZE = toRem(20);

const profileName = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * The summary's view of one `m.room.member` event.
 *
 * A member is named by the profile the event itself carries rather than their
 * current one, so someone who has since left or renamed is still called what
 * they were called at the time. A rename is named by the OLD name — "alice
 * changed their name" is about the alice the reader knew. Events with no
 * profile (a leave, a redacted event) fall back to the room's member record.
 */
export const toMembershipSummaryEvent = (
  room: Room,
  mEvent: MatrixEvent,
): MembershipSummaryEvent => {
  const senderId = mEvent.getSender() ?? '';
  const userId = mEvent.getStateKey() || senderId;
  const content = mEvent.getContent<IMemberContent>();
  const prevContent = mEvent.getPrevContent() as IMemberContent;
  const renamed =
    content.membership === Membership.Join &&
    prevContent.membership === Membership.Join &&
    content.displayname !== prevContent.displayname;

  const displayName =
    (renamed ? profileName(prevContent.displayname) : undefined) ??
    profileName(content.displayname) ??
    profileName(prevContent.displayname) ??
    getMemberDisplayName(room, userId) ??
    getMxIdLocalPart(userId) ??
    userId;

  return {
    userId,
    senderId,
    displayName,
    redacted: mEvent.isRedacted(),
    content,
    prevContent,
  };
};

export type MembershipEventGroupProps = {
  room: Room;
  /** The run, oldest first. Two or more `m.room.member` events. */
  events: MatrixEvent[];
  expanded: boolean;
  onToggle: () => void;
  messageLayout: MessageLayout;
  messageSpacing: MessageSpacing;
  /** Hide OTHER people's read receipts. Nothing to do with what you send. */
  hideOthersReadReceipts?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
  onUserClick: MouseEventHandler<HTMLButtonElement>;
};

/**
 * The one-line summary a run of membership events collapses into, with the
 * faces of the members involved and the toggle that shows the events
 * themselves. When expanded, the timeline renders the individual rows right
 * after this one; this row stays as their header.
 */
export const MembershipEventGroup = as<'div', MembershipEventGroupProps>(
  (
    {
      className,
      room,
      events,
      expanded,
      onToggle,
      messageLayout,
      messageSpacing,
      hideOthersReadReceipts,
      hour24Clock,
      dateFormatString,
      onUserClick,
      ...props
    },
    ref,
  ) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [readReceiptStyle] = useSetting(settingsAtom, 'readReceiptStyle');
    const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
    const elementReceipts = useElementReadReceipts(
      room,
      readReceiptStyle === 'element' && !hideOthersReadReceipts,
      showHiddenEvents,
    );
    const [readersOpen, setReadersOpen] = useState(false);

    const summaryEvents = events.map((mEvent) => toMembershipSummaryEvent(room, mEvent));
    const tokens = summarizeMembershipEvents(summaryEvents);
    const members = getSummaryMembers(summaryEvents);
    const lastEvent = events[events.length - 1];

    // A receipt that stops on any event of the run belongs to the run. Carried
    // up to this row, which is the one thing on screen that stands for all of
    // them while they are collapsed. The readers list opens at the earliest of
    // those events: it lists everyone who has read at least that far, which is
    // every receipt gathered here.
    const receiptUserIds: string[] = [];
    let receiptsEventId: string | undefined;
    events.forEach((mEvent) => {
      const eventId = mEvent.getId();
      const userIds = eventId ? elementReceipts.get(eventId) : undefined;
      if (!eventId || !userIds) {
        return;
      }
      receiptsEventId = receiptsEventId ?? eventId;
      userIds.forEach((userId) => {
        if (!receiptUserIds.includes(userId)) {
          receiptUserIds.push(userId);
        }
      });
    });

    const avatarsJSX = (
      <span className={css.AvatarStack}>
        {members.slice(0, AVATAR_LIMIT).map((member) => {
          const avatarUrl = member.avatarMxc
            ? (mxcUrlToHttp(mx, member.avatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined)
            : undefined;
          return (
            <Avatar
              key={member.userId}
              className={css.StackedAvatar}
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
              as="button"
              size="200"
              radii="Pill"
              title={member.displayName}
              aria-label={member.displayName}
              data-user-id={member.userId}
              onClick={onUserClick}
            >
              <UserAvatar
                userId={member.userId}
                src={avatarUrl}
                alt={member.displayName}
                renderFallback={() => (
                  <Text as="span" size="T200">
                    {member.displayName[0]?.toUpperCase()}
                  </Text>
                )}
              />
            </Avatar>
          );
        })}
      </span>
    );

    return (
      <MessageBase
        className={classNames(css.SummaryRow, className)}
        space={messageSpacing}
        autoCollapse
        {...props}
        ref={ref}
      >
        <EventContent
          messageLayout={messageLayout}
          time={
            <Time
              ts={lastEvent.getTs()}
              compact={messageLayout === MessageLayout.Compact}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
            />
          }
          iconSrc={Icons.User}
          content={
            <Box grow="Yes" alignItems="Center" gap="200" wrap="Wrap">
              {avatarsJSX}
              <Text className={css.SummaryText} size="T300" priority="300">
                {tokens.map((token, index) => {
                  // Tokens are positional and rebuilt whole on every render, so
                  // the position is the identity.
                  const key = `${index}:${token.value}`;
                  if (token.kind === 'name') {
                    return <b key={key}>{token.value}</b>;
                  }
                  return <React.Fragment key={key}>{token.value}</React.Fragment>;
                })}
              </Text>
              <Chip
                className={css.ToggleChip}
                variant="SurfaceVariant"
                radii="Pill"
                aria-expanded={expanded}
                onClick={onToggle}
                after={<Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} />}
              >
                <Text as="span" size="T200">
                  {expanded ? 'Collapse' : 'Expand'}
                </Text>
              </Chip>
              {receiptUserIds.length > 0 && (
                <Box as="span" className={css.Receipts} onClick={() => setReadersOpen(true)}>
                  <ReadReceiptAvatars room={room} userIds={receiptUserIds} />
                </Box>
              )}
            </Box>
          }
        />
        {receiptsEventId && (
          <Overlay open={readersOpen} backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: () => setReadersOpen(false),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Modal variant="Surface" size="300" flexHeight>
                  <EventReaders
                    room={room}
                    eventId={receiptsEventId}
                    requestClose={() => setReadersOpen(false)}
                  />
                </Modal>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
      </MessageBase>
    );
  },
);
