import {
  ChangeEventHandler,
  MouseEventHandler,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  Button,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Menu,
  MenuItem,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { useAtomValue } from 'jotai';
import { IContent, MatrixEvent, Room } from 'matrix-js-sdk';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useDirects, useRooms } from '../../../state/hooks/roomList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mDirectAtom } from '../../../state/mDirectList';
import {
  useAsyncSearch,
  SearchItemStrGetter,
  UseAsyncSearchOptions,
} from '../../../hooks/useAsyncSearch';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useAllJoinedRoomsSet, useGetRoom } from '../../../hooks/useGetRoom';
import { factoryRoomIdByAtoZ } from '../../../utils/sort';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomAvatar, RoomIcon } from '../../../components/room-avatar';
import { getDirectRoomAvatarUrl, getRoomAvatarUrl, getRoomName } from '../../../utils/room';
import { nameInitials } from '../../../utils/common';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { stopPropagation } from '../../../utils/keyboard';
import { useAlive } from '../../../hooks/useAlive';
import { rateLimitedActions } from '../../../utils/matrix';
import { ModalFlexScroll } from '../../../styles/Modal.css';
import { stripOptionalText } from '../../../utils/unsafeText';

const SEARCH_OPTS: UseAsyncSearchOptions = {
  limit: 1000,
  matchOptions: {
    contain: true,
  },
  normalizeOptions: {
    ignoreWhitespace: false,
  },
};

/**
 * Strips everything that ties an event to where it came from.
 *
 * Relations are the important part: forwarding a reply must not carry
 * `m.in_reply_to`, or the new room shows a reply to an event nobody there can
 * see. Mentions go too — the people named in the original did not ask to be
 * pinged in a room they may not even be in.
 */
export const getForwardableContent = (mEvent: MatrixEvent): IContent => {
  const original = mEvent.getContent();
  // An edited message forwards as what it says now, not what it first said.
  const edited = original['m.new_content'] as IContent | undefined;
  const content: IContent = { ...(edited ?? original) };

  delete content['m.relates_to'];
  delete content['m.new_content'];
  delete content['m.mentions'];

  return content;
};

type ForwardPromptProps = {
  mEvent: MatrixEvent;
  requestClose: () => void;
};

export function ForwardPrompt({ mEvent, requestClose }: ForwardPromptProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const alive = useAlive();
  const scrollRef = useRef<HTMLDivElement>(null);

  const mDirects = useAtomValue(mDirectAtom);
  const rooms = useRooms(mx, allRoomsAtom, mDirects);
  const directs = useDirects(mx, allRoomsAtom, mDirects);

  const allRoomsSet = useAllJoinedRoomsSet();
  const getRoom = useGetRoom(allRoomsSet);

  const [selected, setSelected] = useState<string[]>([]);

  const allItems: string[] = useMemo(
    () => [...directs, ...rooms].sort(factoryRoomIdByAtoZ(mx)),
    [rooms, directs, mx],
  );

  const getRoomNameStr: SearchItemStrGetter<string> = useCallback(
    (rId) => stripOptionalText(getRoom(rId)?.name) ?? rId,
    [getRoom],
  );

  const [searchResult, searchRoom, resetSearch] = useAsyncSearch(
    allItems,
    getRoomNameStr,
    SEARCH_OPTS,
  );

  const items = searchResult ? searchResult.items : allItems;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 5,
  });
  const vItems = virtualizer.getVirtualItems();

  const handleSearchChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    const value = evt.currentTarget.value.trim();
    if (!value) {
      resetSearch();
      return;
    }
    searchRoom(value);
  };

  const handleRoomClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const roomId = evt.currentTarget.getAttribute('data-room-id');
    if (!roomId) return;
    setSelected((prev) =>
      prev.includes(roomId) ? prev.filter((rId) => rId !== roomId) : [...prev, roomId],
    );
  };

  const [forwardState, forward] = useAsyncCallback<undefined, Error, [string[]]>(
    useCallback(
      async (roomIds) => {
        const content = getForwardableContent(mEvent);
        // Sends go one at a time through the shared helper, which already backs
        // off on 429 — a burst of sends to many rooms is exactly what
        // homeservers rate-limit.
        await rateLimitedActions(roomIds, async (roomId) => {
          await mx.sendEvent(roomId, mEvent.getType() as any, content as any);
        });
        return undefined;
      },
      [mx, mEvent],
    ),
  );

  const forwarding = forwardState.status === AsyncStatus.Loading;

  const handleForward = () => {
    forward(selected).then(() => {
      if (alive()) requestClose();
    });
  };

  // Forwarding an attachment out of an encrypted room copies its decryption key
  // into the destination. Into another encrypted room that is fine; into an
  // unencrypted one it publishes the key in cleartext, so say so rather than
  // letting it happen quietly.
  const sourceEncrypted = !!mEvent.getContent().file;
  const leaksKey =
    sourceEncrypted &&
    selected.some((rId) => {
      const room = getRoom(rId);
      return room ? !room.hasEncryptionStateEvent() : false;
    });

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: true,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Modal size="300" flexHeight>
            <Box grow="Yes" direction="Column">
              <Header
                size="500"
                style={{
                  padding: config.space.S200,
                  paddingLeft: config.space.S400,
                }}
              >
                <Box grow="Yes">
                  <Text size="H4">Forward Message</Text>
                </Box>
                <Box shrink="No">
                  <IconButton size="300" radii="300" onClick={requestClose}>
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Box>
              </Header>

              <Box grow="Yes">
                <Scroll className={ModalFlexScroll} ref={scrollRef} size="300" hideTrack>
                  <Box
                    style={{ padding: config.space.S300, paddingRight: 0 }}
                    direction="Column"
                    gap="400"
                  >
                    <Box
                      direction="Column"
                      style={{ position: 'sticky', top: config.space.S300, zIndex: 1 }}
                    >
                      <Input
                        onChange={handleSearchChange}
                        before={<Icon size="200" src={Icons.Search} />}
                        placeholder="Search rooms"
                        size="400"
                        variant="Background"
                        outlined
                        autoFocus
                      />
                    </Box>

                    {items.length === 0 && (
                      <Box
                        style={{ paddingTop: config.space.S700 }}
                        grow="Yes"
                        alignItems="Center"
                        justifyContent="Center"
                        direction="Column"
                        gap="100"
                      >
                        <Text size="H6" align="Center">
                          No Match Found
                        </Text>
                      </Box>
                    )}

                    <Box
                      style={{
                        position: 'relative',
                        height: virtualizer.getTotalSize(),
                      }}
                    >
                      {vItems.map((vItem) => {
                        const roomId = items[vItem.index];
                        const room: Room | undefined = getRoom(roomId);
                        if (!room) return null;
                        const selectedItem = selected.includes(roomId);
                        const dm = mDirects.has(room.roomId);

                        return (
                          <VirtualTile
                            virtualItem={vItem}
                            style={{ paddingBottom: config.space.S100 }}
                            ref={virtualizer.measureElement}
                            key={vItem.index}
                          >
                            <MenuItem
                              data-room-id={roomId}
                              onClick={handleRoomClick}
                              variant={selectedItem ? 'Success' : 'Surface'}
                              size="400"
                              radii="400"
                              disabled={forwarding}
                              aria-pressed={selectedItem}
                              before={
                                <Avatar size="200" radii={dm ? '400' : '300'}>
                                  {dm ? (
                                    <RoomAvatar
                                      roomId={room.roomId}
                                      src={getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)}
                                      alt={getRoomName(room)}
                                      renderFallback={() => (
                                        <Text as="span" size="H6">
                                          {nameInitials(getRoomName(room))}
                                        </Text>
                                      )}
                                    />
                                  ) : (
                                    <RoomAvatar
                                      roomId={room.roomId}
                                      src={getRoomAvatarUrl(mx, room, 96, useAuthentication)}
                                      alt={getRoomName(room)}
                                      renderFallback={() => (
                                        <RoomIcon
                                          size="200"
                                          joinRule={room.getJoinRule()}
                                          roomType={room.getType()}
                                        />
                                      )}
                                    />
                                  )}
                                </Avatar>
                              }
                            >
                              <Box grow="Yes">
                                <Text size="T300" truncate>
                                  {getRoomName(room)}
                                </Text>
                              </Box>
                            </MenuItem>
                          </VirtualTile>
                        );
                      })}
                    </Box>
                  </Box>
                </Scroll>
              </Box>

              <Menu
                variant="Surface"
                style={{
                  padding: config.space.S300,
                  borderTopWidth: config.borderWidth.B300,
                  borderRadius: 0,
                }}
              >
                <Box direction="Column" gap="200">
                  {leaksKey && (
                    <Text size="T200" style={{ color: color.Warning.Main }}>
                      One of the rooms you picked is not encrypted. Forwarding this attachment there
                      publishes its decryption key in plain text.
                    </Text>
                  )}
                  {forwardState.status === AsyncStatus.Error && (
                    <Text size="T200" style={{ color: color.Critical.Main }}>
                      Could not forward to every room. Nothing was retried automatically.
                    </Text>
                  )}
                  <Button
                    variant="Primary"
                    onClick={handleForward}
                    disabled={selected.length === 0 || forwarding}
                    before={
                      forwarding ? <Spinner fill="Solid" variant="Primary" size="200" /> : undefined
                    }
                  >
                    <Text size="B400">
                      {selected.length > 1 ? `Forward to ${selected.length} rooms` : 'Forward'}
                    </Text>
                  </Button>
                </Box>
              </Menu>
            </Box>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
