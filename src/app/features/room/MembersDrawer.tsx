import {
  ChangeEventHandler,
  MouseEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom } from 'jotai';
import {
  Avatar,
  Badge,
  Box,
  Chip,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  MenuItem,
  PopOut,
  RectCords,
  Scroll,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  config,
} from 'folds';
import { MatrixClient, Room, RoomMember } from 'matrix-js-sdk';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';

import * as css from './MembersDrawer.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { UseStateProvider } from '../../components/UseStateProvider';
import {
  SearchItemStrGetter,
  UseAsyncSearchOptions,
  useAsyncSearch,
} from '../../hooks/useAsyncSearch';
import { useDebounce } from '../../hooks/useDebounce';
import { TypingIndicator } from '../../components/typing-indicator';
import { getMemberDisplayName, getMemberSearchStr } from '../../utils/room';
import { BotBadge } from '../../components/BotBadge';
import { getMxIdLocalPart } from '../../utils/matrix';
import { useSetSetting, useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { roomSearchFocusRequestAtom } from '../../state/roomSearch';
import { millify } from '../../plugins/millify';
import { ScrollTopContainer } from '../../components/scroll-top-container';
import { UserAvatar } from '../../components/user-avatar';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useMembershipFilter, useMembershipFilterMenu } from '../../hooks/useMemberFilter';
import { useMemberPowerSort, useMemberSort, useMemberSortMenu } from '../../hooks/useMemberSort';
import { useGetMemberPowerLevel, usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { MembershipFilterMenu } from '../../components/MembershipFilterMenu';
import { MemberSortMenu } from '../../components/MemberSortMenu';
import { useOpenUserRoomProfile, useUserRoomProfileState } from '../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { useFlattenPowerTagMembers, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useUserPresence } from '../../hooks/useUserPresence';
import { useUserRichPresence } from '../../hooks/useUserRichPresence';
import { AvatarPresence, PresenceBadge, PresenceStatus } from '../../components/presence';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useResizablePane } from '../../hooks/useResizablePane';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { RoomMessageResults } from '../message-search/RoomMessageResults';

type MemberItemProps = {
  mx: MatrixClient;
  useAuthentication: boolean;
  room: Room;
  member: RoomMember;
  onClick: MouseEventHandler<HTMLButtonElement>;
  pressed?: boolean;
  typing?: boolean;
};
function MemberItem({
  mx,
  useAuthentication,
  room,
  member,
  onClick,
  pressed,
  typing,
}: MemberItemProps) {
  const name =
    getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;
  const avatarMxcUrl = member.getMxcAvatarUrl();
  const avatarUrl = avatarMxcUrl
    ? mx.mxcUrlToHttp(avatarMxcUrl, 100, 100, 'crop', undefined, false, useAuthentication)
    : undefined;
  const userPresence = useUserPresence(member.userId);
  // Second line under the name: the member's own status message when they set
  // one, otherwise what they are listening to or playing. A custom status wins
  // — it is the thing they chose to say — and the rich-presence icon still
  // prefixes it so the activity is visible either way.
  const statusMsg = userPresence?.status || undefined;
  const richPresence = useUserRichPresence(member.userId);

  return (
    <MenuItem
      style={{ padding: `0 ${config.space.S200}` }}
      aria-pressed={pressed}
      data-user-id={member.userId}
      variant="Background"
      radii="400"
      onClick={onClick}
      before={
        <AvatarPresence
          badge={
            userPresence ? (
              <PresenceBadge presence={userPresence.presence} status={userPresence.status} size="200" />
            ) : null
          }
        >
          <Avatar size="200">
            <UserAvatar
              userId={member.userId}
              src={avatarUrl ?? undefined}
              alt={name}
              renderFallback={() => <Icon size="50" src={Icons.User} filled />}
            />
          </Avatar>
        </AvatarPresence>
      }
      after={
        typing && (
          <Badge size="300" variant="Secondary" fill="Soft" radii="Pill" outlined>
            <TypingIndicator size="300" />
          </Badge>
        )
      }
    >
      <Box grow="Yes" direction="Column">
        <Box alignItems="Center" gap="200">
          <Text size="T400" truncate>
            {name}
          </Text>
          <BotBadge room={room} userId={member.userId} />
        </Box>
        {(statusMsg || richPresence) && (
          <PresenceStatus
            className={css.MemberStatus}
            status={statusMsg}
            richPresence={richPresence}
          />
        )}
      </Box>
    </MenuItem>
  );
}

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  limit: 1000,
  matchOptions: {
    contain: true,
  },
};

// Shortest term that will trigger the *message* search below the member list.
//
// Member filtering stays instant from 1 character — it is a local array filter.
// Message search is not: in an encrypted room it back-paginates and decrypts
// real history (see RoomMessageResults / useClientRoomSearch). A 1-2 character
// term is both useless as a query and the worst case for that scan, because it
// almost never matches early and so drives the deepest walk. RoomMessageResults
// caps how many pages it will pull on its own and cancels the in-flight scan
// when this term changes or the drawer unmounts; this gate keeps the loop from
// ever starting for a term that cannot be meant seriously.
const MIN_MESSAGE_SEARCH_TERM_LEN = 3;

const mxIdToName = (mxId: string) => getMxIdLocalPart(mxId) ?? mxId;
const getRoomMemberStr: SearchItemStrGetter<RoomMember> = (m, query) =>
  getMemberSearchStr(m, query, mxIdToName);

type MembersDrawerProps = {
  room: Room;
  members: RoomMember[];
  /**
   * Render as a full-width overlay rather than a fixed-width side panel. Used
   * below the desktop breakpoint, where this is the whole screen instead of a
   * column beside the timeline.
   */
  overlay?: boolean;
  /**
   * What the close button does. Defaults to collapsing the people drawer
   * setting, which is right for the desktop side panel; the overlay passes its
   * own dismiss instead, since hiding it must not also turn the drawer off for
   * desktop.
   */
  onClose?: () => void;
};
export function MembersDrawer({ room, members, overlay, onClose }: MembersDrawerProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const setPeopleDrawer = useSetSetting(settingsAtom, 'isPeopleDrawer');
  const closeDrawer = useCallback(() => {
    if (onClose) onClose();
    else setPeopleDrawer(false);
  }, [onClose, setPeopleDrawer]);
  const screenSize = useScreenSizeContext();
  const pane = useResizablePane('membersPane');
  const { navigateRoom } = useRoomNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollTopAnchorRef = useRef<HTMLDivElement>(null);
  // Debounced term that drives the inline message search below the member list.
  // Kept separate from the member filter so member results stay instant.
  const [messageTerm, setMessageTerm] = useState<string>();
  // Whether that message search is still working. The results live below the
  // member list — often below the fold — so the search box itself has to say so.
  const [messageSearching, setMessageSearching] = useState(false);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const getPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
  const getPowerLevel = useGetMemberPowerLevel(powerLevels);

  const fetchingMembers = members.length < room.getJoinedMemberCount();
  const openUserRoomProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();
  const openProfileUserId = useUserRoomProfileState()?.userId;

  const membershipFilterMenu = useMembershipFilterMenu();
  const sortFilterMenu = useMemberSortMenu();
  const [sortFilterIndex, setSortFilterIndex] = useSetting(settingsAtom, 'memberSortFilterIndex');
  const [membershipFilterIndex, setMembershipFilterIndex] = useState(0);

  const membershipFilter = useMembershipFilter(membershipFilterIndex, membershipFilterMenu);
  const memberSort = useMemberSort(sortFilterIndex, sortFilterMenu);
  const memberPowerSort = useMemberPowerSort(creators, getPowerLevel);

  const typingMembers = useRoomTypingMember(room.roomId);

  const filteredMembers = useMemo(
    () => members.filter(membershipFilter.filterFn).sort(memberSort.sortFn).sort(memberPowerSort),
    [members, membershipFilter, memberSort, memberPowerSort]
  );

  const [result, search, resetSearch] = useAsyncSearch(
    filteredMembers,
    getRoomMemberStr,
    SEARCH_OPTIONS
  );
  if (!result && searchInputRef.current?.value) search(searchInputRef.current.value);

  const processMembers = result ? result.items : filteredMembers;

  const PLTagOrRoomMember = useFlattenPowerTagMembers(processMembers, getPowerTag);

  const virtualizer = useVirtualizer({
    count: PLTagOrRoomMember.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  const handleSearchChange: ChangeEventHandler<HTMLInputElement> = useDebounce(
    useCallback(
      (evt) => {
        const value = evt.target.value.trim();
        if (value) search(value);
        else resetSearch();
        // The same box also searches message text (encrypted rooms scan locally,
        // others hit the server). Empty — or too short to be a real query —
        // clears it, which also aborts any scan still running for the previous
        // term.
        setMessageTerm(value.length >= MIN_MESSAGE_SEARCH_TERM_LEN ? value : undefined);
      },
      [search, resetSearch]
    ),
    { wait: 300 }
  );

  const handleMessageOpen = useCallback(
    (roomId: string, eventId: string) => {
      navigateRoom(roomId, eventId);
      // On mobile/tablet the drawer overlays the timeline — close it so the
      // jumped-to message is visible.
      if (screenSize !== ScreenSize.Desktop) closeDrawer();
    },
    [navigateRoom, screenSize, closeDrawer]
  );

  // The toolbar search button has no drawer of its own to open on desktop, so it
  // raises a request here and we put the caret in the search box. The request is
  // consumed (reset to 0) rather than just observed, so opening the member list
  // any other way — including the very next time — does not steal focus into
  // search. This also covers the mount case: the button opens the drawer and
  // raises the request in the same click, so the drawer often only mounts after.
  const [searchFocusRequest, setSearchFocusRequest] = useAtom(roomSearchFocusRequestAtom);
  useEffect(() => {
    if (searchFocusRequest === 0) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
    setSearchFocusRequest(0);
  }, [searchFocusRequest, setSearchFocusRequest]);

  const clearSearch = useCallback(() => {
    if (searchInputRef.current) {
      searchInputRef.current.value = '';
      searchInputRef.current.focus();
    }
    resetSearch();
    setMessageTerm(undefined);
  }, [resetSearch]);

  const handleMemberClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const btn = evt.currentTarget as HTMLButtonElement;
    const userId = btn.getAttribute('data-user-id');
    if (!userId) return;
    openUserRoomProfile(room.roomId, space?.roomId, userId, btn.getBoundingClientRect(), 'Left');
  };

  return (
    <Box
      className={classNames(
        overlay ? css.MembersDrawerOverlay : css.MembersDrawer,
        ContainerColor({ variant: 'Background' })
      )}
      shrink="No"
      grow={overlay ? 'Yes' : undefined}
      // The overlay is the whole screen and has nothing to be resized against,
      // so it keeps its own full-width class.
      style={overlay ? undefined : pane.style}
      direction="Column"
    >
      <Header className={css.MembersDrawerHeader} variant="Background" size="600">
        <Box grow="Yes" alignItems="Center" gap="200">
          <Box grow="Yes">
            <Text size="H5" truncate>
              People
            </Text>
          </Box>
          <Box shrink="No" alignItems="Center">
            <TooltipProvider
              position="Bottom"
              align="End"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>Close</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  variant="Background"
                  onClick={closeDrawer}
                >
                  <Icon src={Icons.Cross} />
                </IconButton>
              )}
            </TooltipProvider>
          </Box>
        </Box>
      </Header>
      <Box className={css.MembersDrawerSearch} direction="Column" shrink="No">
        <Input
          ref={searchInputRef}
          onChange={handleSearchChange}
          style={{ paddingRight: config.space.S200 }}
          placeholder="Search people & messages..."
          variant="SurfaceVariant"
          size="400"
          radii="400"
          autoComplete="off"
          before={
            messageSearching ? (
              <Spinner size="50" variant="Secondary" />
            ) : (
              <Icon size="50" src={Icons.Search} />
            )
          }
          after={
            result && (
              <Chip
                variant="Secondary"
                size="400"
                radii="Pill"
                aria-pressed
                onClick={clearSearch}
                after={<Icon size="50" src={Icons.Cross} />}
              >
                <Text size="B300">{`${result.items.length} ${
                  result.items.length === 1 ? 'Person' : 'People'
                }`}</Text>
              </Chip>
            )
          }
        />
      </Box>
      <Box className={css.MemberDrawerContentBase} grow="Yes">
        <Scroll ref={scrollRef} variant="Background" size="300" visibility="Hover" hideTrack>
          <Box className={css.MemberDrawerContent} direction="Column" gap="200">
            <Box ref={scrollTopAnchorRef} className={css.DrawerGroup} direction="Column" gap="200">
              {/* The member count is the only thing in this row allowed to
                  shrink. The two chips below are controls whose labels are
                  short phrases — "A to Z", "Z to A" — and a flex row 266px wide
                  squeezed them until the label wrapped mid-phrase, putting "A
                  to" on one line and "Z" under it. `minWidth: 0` lets the count
                  truncate (it already has the full number in its title), and
                  `flexShrink: 0` on the chips means it is the one that gives. */}
              <Box alignItems="Center" gap="200">
                <Box grow="Yes" style={{ minWidth: 0 }}>
                  <Text size="L400" truncate title={`${room.getJoinedMemberCount()} Members`}>
                    {`${millify(room.getJoinedMemberCount())} Members`}
                  </Text>
                </Box>
                <UseStateProvider initial={undefined}>
                  {(anchor: RectCords | undefined, setAnchor) => (
                    <PopOut
                      style={{ flexShrink: 0 }}
                      anchor={anchor}
                      position="Bottom"
                      align="Start"
                      offset={4}
                      content={
                        <MembershipFilterMenu
                          selected={membershipFilterIndex}
                          onSelect={setMembershipFilterIndex}
                          requestClose={() => setAnchor(undefined)}
                        />
                      }
                    >
                      <Chip
                        onClick={
                          ((evt) =>
                            setAnchor(
                              evt.currentTarget.getBoundingClientRect()
                            )) as MouseEventHandler<HTMLButtonElement>
                        }
                        variant="Background"
                        size="400"
                        radii="300"
                        before={<Icon src={Icons.Filter} size="50" />}
                      >
                        <Text size="T200" truncate>
                          {membershipFilter.name}
                        </Text>
                      </Chip>
                    </PopOut>
                  )}
                </UseStateProvider>
                <UseStateProvider initial={undefined}>
                  {(anchor: RectCords | undefined, setAnchor) => (
                    <PopOut
                      style={{ flexShrink: 0 }}
                      anchor={anchor}
                      position="Bottom"
                      align="End"
                      offset={4}
                      content={
                        <MemberSortMenu
                          selected={sortFilterIndex}
                          onSelect={setSortFilterIndex}
                          requestClose={() => setAnchor(undefined)}
                        />
                      }
                    >
                      <Chip
                        onClick={
                          ((evt) =>
                            setAnchor(
                              evt.currentTarget.getBoundingClientRect()
                            )) as MouseEventHandler<HTMLButtonElement>
                        }
                        variant="Background"
                        size="400"
                        radii="300"
                        after={<Icon src={Icons.Sort} size="50" />}
                      >
                        <Text size="T200" truncate>
                          {memberSort.name}
                        </Text>
                      </Chip>
                    </PopOut>
                  )}
                </UseStateProvider>
              </Box>
            </Box>

            <ScrollTopContainer scrollRef={scrollRef} anchorRef={scrollTopAnchorRef}>
              <IconButton
                onClick={() => virtualizer.scrollToOffset(0)}
                variant="Surface"
                radii="Pill"
                outlined
                size="300"
                aria-label="Scroll to Top"
              >
                <Icon src={Icons.ChevronTop} size="300" />
              </IconButton>
            </ScrollTopContainer>

            {!fetchingMembers && !result && processMembers.length === 0 && (
              <Text style={{ padding: config.space.S300 }} align="Center">
                {`No "${membershipFilter.name}" Members`}
              </Text>
            )}

            <Box className={css.MembersGroup} direction="Column" gap="100">
              <div
                style={{
                  position: 'relative',
                  height: virtualizer.getTotalSize(),
                }}
              >
                {virtualizer.getVirtualItems().map((vItem) => {
                  const tagOrMember = PLTagOrRoomMember[vItem.index];
                  if (!('userId' in tagOrMember)) {
                    return (
                      <Text
                        style={{
                          transform: `translateY(${vItem.start}px)`,
                        }}
                        data-index={vItem.index}
                        ref={virtualizer.measureElement}
                        key={`${room.roomId}-${vItem.index}`}
                        className={classNames(css.MembersGroupLabel, css.DrawerVirtualItem)}
                        size="L400"
                      >
                        {tagOrMember.name}
                      </Text>
                    );
                  }

                  return (
                    <div
                      style={{
                        transform: `translateY(${vItem.start}px)`,
                      }}
                      className={css.DrawerVirtualItem}
                      data-index={vItem.index}
                      key={`${room.roomId}-${tagOrMember.userId}`}
                      ref={virtualizer.measureElement}
                    >
                      <MemberItem
                        mx={mx}
                        useAuthentication={useAuthentication}
                        room={room}
                        member={tagOrMember}
                        onClick={handleMemberClick}
                        pressed={openProfileUserId === tagOrMember.userId}
                        typing={typingMembers.some(
                          (receipt) => receipt.userId === tagOrMember.userId
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            </Box>

            {fetchingMembers && (
              <Box justifyContent="Center">
                <Spinner />
              </Box>
            )}

            {messageTerm && (
              <Box className={css.DrawerGroup} direction="Column">
                <RoomMessageResults
                  room={room}
                  term={messageTerm}
                  onOpen={handleMessageOpen}
                  onSearchingChange={setMessageSearching}
                />
              </Box>
            )}
          </Box>
        </Scroll>
      </Box>
    </Box>
  );
}
