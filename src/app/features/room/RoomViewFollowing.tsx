import { Fragment, useState } from 'react';
import {
  Box,
  Icon,
  Icons,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  as,
  config,
} from 'folds';
import { Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { FocusTrap } from 'focus-trap-react';

import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import * as css from './RoomViewFollowing.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomLatestRenderedEvent } from '../../hooks/useRoomLatestRenderedEvent';
import { useRoomEventReaders } from '../../hooks/useRoomEventReaders';
import { EventReaders } from '../../components/event-readers';
import { stopPropagation } from '../../utils/keyboard';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

export function RoomViewFollowingPlaceholder() {
  return <div className={css.RoomViewFollowingPlaceholder} />;
}

export type RoomViewFollowingProps = {
  room: Room;
};
export const RoomViewFollowing = as<'div', RoomViewFollowingProps>(
  ({ className, room, ...props }, ref) => {
    const mx = useMatrixClient();
    const [readReceiptStyle] = useSetting(settingsAtom, 'readReceiptStyle');
    const [hideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');
    const [open, setOpen] = useState(false);
    const latestEvent = useRoomLatestRenderedEvent(room);
    const latestEventReaders = useRoomEventReaders(room, latestEvent?.getId());
    const names = latestEventReaders
      .filter((readerId) => readerId !== mx.getUserId())
      .map(
        (readerId) =>
          getMemberDisplayName(room, readerId) ?? getMxIdLocalPart(readerId) ?? readerId,
      );
    // Name yourself only when your receipt is public; a private one is seen by
    // no one else, so "you" would claim something the others can't see.
    const selfFollowing = !hideReadReceipts && latestEventReaders.includes(mx.getUserId() ?? '');
    const parts = names.slice(0, 3);
    if (names.length > 3) parts.push(`${names.length - 3} others`);
    if (names.length > 0 && selfFollowing) parts.push('you');

    const eventId = latestEvent?.getId();

    if (readReceiptStyle === 'element') return <RoomViewFollowingPlaceholder />;

    return (
      <>
        {eventId && (
          <Overlay open={open} backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: () => setOpen(false),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                {/* flex column so EventReaders' maxHeight can shrink the modal
                    to the size of the actual reader list. */}
                <Modal
                  variant="Surface"
                  size="300"
                  flexHeight
                  style={{ display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}
                >
                  <EventReaders room={room} eventId={eventId} requestClose={() => setOpen(false)} />
                </Modal>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
        <Box
          as={names.length > 0 ? 'button' : 'div'}
          onClick={names.length > 0 ? () => setOpen(true) : undefined}
          className={classNames(css.RoomViewFollowing({ clickable: names.length > 0 }), className)}
          alignItems="Center"
          justifyContent="End"
          gap="200"
          {...props}
          ref={ref}
        >
          {names.length > 0 && (
            <>
              <Icon style={{ opacity: config.opacity.P300 }} size="100" src={Icons.CheckTwice} />
              <Text size="T300" truncate>
                {parts.map((part, index) => (
                  // Display names can repeat, and the list is rebuilt whole.
                  <Fragment key={index}>
                    {index > 0 && (
                      <Text as="span" size="Inherit" priority="300">
                        {index === parts.length - 1 ? ' and ' : ', '}
                      </Text>
                    )}
                    <b>{part}</b>
                  </Fragment>
                ))}
                <Text as="span" size="Inherit" priority="300">
                  {parts.length === 1
                    ? ' is following the conversation.'
                    : ' are following the conversation.'}
                </Text>
              </Text>
            </>
          )}
        </Box>
      </>
    );
  },
);
