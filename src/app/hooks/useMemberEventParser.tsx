import { MouseEventHandler, ReactNode } from 'react';
import { IconSrc, Icons } from 'folds';
import { MatrixEvent } from 'matrix-js-sdk';
import { IMemberContent, Membership } from '../../types/matrix/room';
import { getMxIdLocalPart } from '../utils/matrix';
import { isMembershipChanged } from '../utils/room';
import { stripUnsafeTextChars } from '../utils/unsafeText';
import { InlineUsername } from '../components/message/layout';

export type ParsedResult = {
  icon: IconSrc;
  body: ReactNode;
};

export type MemberEventParser = (mEvent: MatrixEvent) => ParsedResult;

/**
 * Turns membership events into a line of text. With `onUserClick`, the names in it are buttons
 * carrying the user's ID in `data-user-id` that call it on click and right-click, as the sender's
 * name on a message does; without it (the inbox) they stay plain bold text.
 */
export const useMemberEventParser = (
  onUserClick?: MouseEventHandler<HTMLButtonElement>,
): MemberEventParser => {
  const name = (userId: string, label: ReactNode): ReactNode =>
    onUserClick ? (
      <InlineUsername data-user-id={userId} onClick={onUserClick} onContextMenu={onUserClick}>
        {label}
      </InlineUsername>
    ) : (
      <b>{label}</b>
    );

  const parseMemberEvent: MemberEventParser = (mEvent) => {
    const content = mEvent.getContent<IMemberContent>();
    const prevContent = mEvent.getPrevContent() as IMemberContent;
    const senderId = mEvent.getSender();
    const userId = mEvent.getStateKey();
    const reason =
      typeof content.reason === 'string' ? stripUnsafeTextChars(content.reason) : undefined;

    if (!senderId || !userId)
      return {
        icon: Icons.User,
        body: 'Broken membership event',
      };

    const senderName = getMxIdLocalPart(senderId);
    const userName =
      typeof content.displayname === 'string'
        ? stripUnsafeTextChars(content.displayname) || getMxIdLocalPart(userId)
        : getMxIdLocalPart(userId);

    if (isMembershipChanged(mEvent)) {
      if (content.membership === Membership.Invite) {
        if (prevContent.membership === Membership.Knock) {
          return {
            icon: Icons.ArrowGoRightPlus,
            body: (
              <>
                {name(senderId, senderName)}
                {' accepted '}
                {name(userId, userName)}
                {`'s join request `}
                {reason}
              </>
            ),
          };
        }

        return {
          icon: Icons.ArrowGoRightPlus,
          body: (
            <>
              {name(senderId, senderName)}
              {' invited '}
              {name(userId, userName)} {reason}
            </>
          ),
        };
      }

      if (content.membership === Membership.Knock) {
        return {
          icon: Icons.ArrowGoRightPlus,
          body: (
            <>
              {name(userId, userName)}
              {' request to join room '}
              {reason}
            </>
          ),
        };
      }

      if (content.membership === Membership.Join) {
        return {
          icon: Icons.ArrowGoRight,
          body: (
            <>
              {name(userId, userName)}
              {' joined the room'}
            </>
          ),
        };
      }

      if (content.membership === Membership.Leave) {
        if (prevContent.membership === Membership.Invite) {
          return {
            icon: Icons.ArrowGoRightCross,
            body:
              senderId === userId ? (
                <>
                  {name(userId, userName)}
                  {' rejected the invitation '}
                  {reason}
                </>
              ) : (
                <>
                  {name(senderId, senderName)}
                  {' rejected '}
                  {name(userId, userName)}
                  {`'s join request `}
                  {reason}
                </>
              ),
          };
        }

        if (prevContent.membership === Membership.Knock) {
          return {
            icon: Icons.ArrowGoRightCross,
            body:
              senderId === userId ? (
                <>
                  {name(userId, userName)}
                  {' revoked joined request '}
                  {reason}
                </>
              ) : (
                <>
                  {name(senderId, senderName)}
                  {' revoked '}
                  {name(userId, userName)}
                  {`'s invite `}
                  {reason}
                </>
              ),
          };
        }

        if (prevContent.membership === Membership.Ban) {
          return {
            icon: Icons.ArrowGoLeft,
            body: (
              <>
                {name(senderId, senderName)}
                {' unbanned '}
                {name(userId, userName)} {reason}
              </>
            ),
          };
        }

        return {
          icon: Icons.ArrowGoLeft,
          body:
            senderId === userId ? (
              <>
                {name(userId, userName)}
                {' left the room '}
                {reason}
              </>
            ) : (
              <>
                {name(senderId, senderName)}
                {' kicked '}
                {name(userId, userName)} {reason}
              </>
            ),
        };
      }

      if (content.membership === Membership.Ban) {
        return {
          icon: Icons.ArrowGoLeft,
          body: (
            <>
              {name(senderId, senderName)}
              {' banned '}
              {name(userId, userName)} {reason}
            </>
          ),
        };
      }
    }

    if (content.displayname !== prevContent.displayname) {
      const prevUserName =
        typeof prevContent.displayname === 'string'
          ? stripUnsafeTextChars(prevContent.displayname) || getMxIdLocalPart(userId)
          : getMxIdLocalPart(userId);

      return {
        icon: Icons.Mention,
        body:
          typeof content.displayname === 'string' ? (
            <>
              {name(userId, prevUserName)}
              {' changed display name to '}
              {name(userId, userName)}
            </>
          ) : (
            <>
              {name(userId, prevUserName)}
              {' removed their display name '}
            </>
          ),
      };
    }
    if (content.avatar_url !== prevContent.avatar_url) {
      return {
        icon: Icons.User,
        body:
          content.avatar_url && typeof content.avatar_url === 'string' ? (
            <>
              {name(userId, userName)}
              {' changed their avatar'}
            </>
          ) : (
            <>
              {name(userId, userName)}
              {' removed their avatar '}
            </>
          ),
      };
    }

    return {
      icon: Icons.User,
      body: 'Membership event with no changes',
    };
  };

  return parseMemberEvent;
};
