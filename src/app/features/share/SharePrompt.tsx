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
import { useAtomValue, useStore } from 'jotai';
import { Room } from 'matrix-js-sdk';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useDirects, useRooms } from '../../state/hooks/roomList';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { mDirectAtom } from '../../state/mDirectList';
import {
  useAsyncSearch,
  SearchItemStrGetter,
  UseAsyncSearchOptions,
} from '../../hooks/useAsyncSearch';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useAllJoinedRoomsSet, useGetRoom } from '../../hooks/useGetRoom';
import { factoryRoomIdByAtoZ } from '../../utils/sort';
import { VirtualTile } from '../../components/virtualizer';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { getDirectRoomAvatarUrl, getRoomAvatarUrl } from '../../utils/room';
import { nameInitials } from '../../utils/common';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { stopPropagation } from '../../utils/keyboard';
import { ModalFlexScroll } from '../../styles/Modal.css';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import {
  roomIdToMsgDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
} from '../../state/room/roomInputDrafts';
import { filesToUploadItems } from '../../utils/uploadItems';
import { SharePayload, readSharedFile, shareText } from '../../utils/share-target';
import { BlockType } from '../../components/editor/types';
import { ParagraphElement } from '../../components/editor/slate';

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
 * Shared text as composer content: one paragraph per line, no marks.
 *
 * Plain text on purpose. The string came from another app, and the composer's
 * own markdown/HTML handling should apply to it exactly as if it had been
 * typed — building richer nodes here would let a sending app author formatting
 * (or a mention, or a link element) in someone else's composer.
 */
const textToDraft = (text: string): ParagraphElement[] =>
  text.split('\n').map((line) => ({
    type: BlockType.Paragraph,
    children: [{ text: line }],
  }));

type ShareResult = {
  requested: number;
  read: number;
};

type SharePromptProps = {
  payload: SharePayload;
  requestClose: () => void;
};

/**
 * Room picker for content shared into the app from the Android share sheet.
 *
 * Nothing is sent. The share is staged into the chosen room's composer — text
 * as a draft, files as attachments — and the room is opened so the user can
 * add a comment and press send themselves. That matters beyond politeness:
 * this content arrives from an arbitrary other app on the device, and a share
 * that sent on its own would make "post this to a room" reachable by any app
 * that can build an intent.
 */
export function SharePrompt({ payload, requestClose }: SharePromptProps) {
  const mx = useMatrixClient();
  const store = useStore();
  const useAuthentication = useMediaAuthentication();
  const { navigateRoom } = useRoomNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const mDirects = useAtomValue(mDirectAtom);
  const rooms = useRooms(mx, allRoomsAtom, mDirects);
  const directs = useDirects(mx, allRoomsAtom, mDirects);

  const allRoomsSet = useAllJoinedRoomsSet();
  const getRoom = useGetRoom(allRoomsSet);

  const [selected, setSelected] = useState<string | undefined>();

  const allItems: string[] = useMemo(
    () => [...directs, ...rooms].sort(factoryRoomIdByAtoZ(mx)),
    [rooms, directs, mx],
  );

  const getRoomNameStr: SearchItemStrGetter<string> = useCallback(
    (rId) => getRoom(rId)?.name ?? rId,
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
    setSelected((prev) => (prev === roomId ? undefined : roomId));
  };

  const [stageState, stage] = useAsyncCallback<ShareResult, Error, [string]>(
    useCallback(
      async (roomId: string) => {
        const room = getRoom(roomId);
        if (!room) throw new Error('That room is no longer available.');

        const text = shareText(payload);
        if (text) {
          store.set(roomIdToMsgDraftAtomFamily(roomId), textToDraft(text));
        }

        const files: File[] = [];
        // Sequential, not Promise.all. Each file is materialised whole in
        // memory (base64 over the bridge, then the decoded bytes, then the
        // File) and the cap is 100 MiB apiece — reading a multi-file share in
        // parallel is how a phone gets its WebView killed mid-share.
        for (const ref of payload.files) {
          try {
            files.push(await readSharedFile(ref.token));
          } catch (err) {
            // Not fatal: stage what did come through and report the shortfall.
            // The token is consumed either way, so there is nothing to retry.
            console.error('[share] Could not read a shared file:', err);
          }
        }

        if (files.length > 0) {
          const uploadItems = await filesToUploadItems(room, files);
          if (uploadItems.length > 0) {
            store.set(roomIdToUploadItemsAtomFamily(roomId), {
              type: 'PUT',
              item: uploadItems,
            });
          }
        }

        if (!text && files.length === 0) {
          throw new Error('Nothing from that share could be read.');
        }

        return { requested: payload.files.length, read: files.length };
      },
      [getRoom, payload, store],
    ),
  );

  const staging = stageState.status === AsyncStatus.Loading;
  const staged = stageState.status === AsyncStatus.Success ? stageState.data : undefined;
  const partial = staged !== undefined && staged.read < staged.requested;

  const openRoom = useCallback(() => {
    if (!selected) return;
    navigateRoom(selected);
    requestClose();
  }, [selected, navigateRoom, requestClose]);

  const handleShare = () => {
    if (!selected) return;
    stage(selected).then((result) => {
      // A partial read keeps the dialog up so the shortfall is actually seen;
      // everything that did come through is already staged in the room.
      if (result.read === result.requested) openRoom();
    });
  };

  const fileCount = payload.files.length;
  const selectedRoom: Room | undefined = selected ? getRoom(selected) : undefined;

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
                  <Text size="H4">Share to</Text>
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
                        const selectedItem = selected === roomId;
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
                              disabled={staging}
                              aria-pressed={selectedItem}
                              before={
                                <Avatar size="200" radii={dm ? '400' : '300'}>
                                  {dm ? (
                                    <RoomAvatar
                                      roomId={room.roomId}
                                      src={getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)}
                                      alt={room.name}
                                      renderFallback={() => (
                                        <Text as="span" size="H6">
                                          {nameInitials(room.name)}
                                        </Text>
                                      )}
                                    />
                                  ) : (
                                    <RoomAvatar
                                      roomId={room.roomId}
                                      src={getRoomAvatarUrl(mx, room, 96, useAuthentication)}
                                      alt={room.name}
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
                                  {room.name}
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
                  <Text size="T200" priority="300">
                    {fileCount > 0
                      ? `${fileCount} ${fileCount === 1 ? 'file' : 'files'}${
                          shareText(payload) ? ' and text' : ''
                        } will be added to the composer — nothing is sent until you send it.`
                      : 'This will be added to the composer — nothing is sent until you send it.'}
                  </Text>

                  {partial && staged && (
                    <Text size="T200" style={{ color: color.Warning.Main }}>
                      Only {staged.read} of {staged.requested} files could be read. A file over
                      100&nbsp;MB, or one the sending app has already released, cannot be brought
                      across. Anything that did come through is waiting in{' '}
                      {selectedRoom?.name ?? 'the room'}.
                    </Text>
                  )}

                  {stageState.status === AsyncStatus.Error && (
                    <Text size="T200" style={{ color: color.Critical.Main }}>
                      {stageState.error.message}
                    </Text>
                  )}

                  {partial ? (
                    <Button variant="Primary" onClick={openRoom}>
                      <Text size="B400">Open {selectedRoom?.name ?? 'room'}</Text>
                    </Button>
                  ) : (
                    <Button
                      variant="Primary"
                      onClick={handleShare}
                      disabled={!selected || staging}
                      before={
                        staging ? <Spinner fill="Solid" variant="Primary" size="200" /> : undefined
                      }
                    >
                      <Text size="B400">
                        {selectedRoom ? `Share to ${selectedRoom.name}` : 'Share'}
                      </Text>
                    </Button>
                  )}
                </Box>
              </Menu>
            </Box>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
