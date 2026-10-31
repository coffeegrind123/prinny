import { useEffect, useMemo, useState, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Editor } from 'slate';
import { Avatar, Icon, Icons, MenuItem, Text } from 'folds';
import { MatrixClient, Room, RoomMember } from 'matrix-js-sdk';

import { AutocompleteQuery } from './autocompleteQuery';
import { AutocompleteMenu } from './AutocompleteMenu';
import { RosterLoad, useRoomMembers } from '../../../hooks/useRoomMembers';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import {
  SearchItemStrGetter,
  UseAsyncSearchOptions,
  useAsyncSearch,
} from '../../../hooks/useAsyncSearch';
import { normalize } from '../../../utils/AsyncSearch';
import { clickFocusedAutocompleteItem, onTabPress } from '../../../utils/keyboard';
import { createMentionElement, moveCursor, replaceWithElement, safeFocusEditor } from '../utils';
import { getMxIdLocalPart, getMxIdServer, isUserId } from '../../../utils/matrix';
import { getMemberDisplayName, getMemberSearchStr } from '../../../utils/room';
import { UserAvatar } from '../../user-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { Membership } from '../../../../types/matrix/room';

type MentionAutoCompleteHandler = (userId: string, name: string) => void;

type DirectoryUser = {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
};

const MAX_MENTION_RESULTS = 20;
const DIRECTORY_SEARCH_DELAY_MS = 200;

const userIdFromQueryText = (mx: MatrixClient, text: string) =>
  isUserId(`@${text}`)
    ? `@${text}`
    : `@${text}${text.endsWith(':') ? '' : ':'}${getMxIdServer(mx.getUserId() ?? '')}`;

function UnknownMentionItem({
  userId,
  name,
  handleAutocomplete,
}: {
  userId: string;
  name: string;
  handleAutocomplete: MentionAutoCompleteHandler;
}) {
  return (
    <MenuItem
      as="button"
      radii="300"
      onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
        onTabPress(evt, () => handleAutocomplete(userId, name))
      }
      onClick={() => handleAutocomplete(userId, name)}
      before={
        <Avatar size="200">
          <UserAvatar
            userId={userId}
            renderFallback={() => <Icon size="50" src={Icons.User} filled />}
          />
        </Avatar>
      }
    >
      <Text style={{ flexGrow: 1 }} size="B400">
        {name}
      </Text>
    </MenuItem>
  );
}

type UserMentionAutocompleteProps = {
  room: Room;
  editor: Editor;
  query: AutocompleteQuery<string>;
  requestClose: () => void;
};

const withAllowedMembership = (member: RoomMember): boolean =>
  member.membership === Membership.Join ||
  member.membership === Membership.Invite ||
  member.membership === Membership.Knock;

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  limit: 1000,
  matchOptions: {
    contain: true,
  },
};

const mxIdToName = (mxId: string) => getMxIdLocalPart(mxId) ?? mxId;
const getRoomMemberStr: SearchItemStrGetter<RoomMember> = (m, query) =>
  getMemberSearchStr(m, query, mxIdToName);

export function UserMentionAutocomplete({
  room,
  editor,
  query,
  requestClose,
}: UserMentionAutocompleteProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const roomId: string = room.roomId!;
  const roomAliasOrId = room.getCanonicalAlias() || roomId;
  const members = useRoomMembers(mx, roomId, RosterLoad.LazyIfLarge);
  // In a large room the roster stays lazily loaded, so the user directory
  // stands in for the members it does not hold yet.
  const rosterComplete = room.membersLoaded();
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  // Filtered before searching: filtering the first 20 results afterwards let
  // left or banned matches crowd mentionable ones out of the list.
  const mentionableMembers = useMemo(() => members.filter(withAllowedMembership), [members]);

  const [result, search, resetSearch] = useAsyncSearch(
    mentionableMembers,
    getRoomMemberStr,
    SEARCH_OPTIONS,
  );
  // The search is async, so `result` can still be for the previous query.
  const matchingResult = result?.query === normalize(query.text) ? result.items : undefined;
  const autoCompleteMembers = (matchingResult ?? mentionableMembers).slice(0, MAX_MENTION_RESULTS);
  const directoryMatches = useMemo(() => {
    const shown = new Set(autoCompleteMembers.map((m) => m.userId));
    return directoryUsers
      .filter((u) => !shown.has(u.userId))
      .slice(0, MAX_MENTION_RESULTS - autoCompleteMembers.length);
  }, [autoCompleteMembers, directoryUsers]);

  useEffect(() => {
    if (query.text) search(query.text);
    else resetSearch();
  }, [query.text, search, resetSearch]);

  useEffect(() => {
    setDirectoryUsers([]);
    if (!query.text || query.text === 'room' || rosterComplete) return undefined;

    let disposed = false;
    const timer = window.setTimeout(() => {
      mx.searchUserDirectory({ term: query.text, limit: MAX_MENTION_RESULTS })
        .then(({ results }) => {
          if (disposed) return;
          setDirectoryUsers(
            results.map((r) => ({
              userId: r.user_id,
              displayName: r.display_name,
              avatarUrl: r.avatar_url,
            })),
          );
        })
        .catch((err) => {
          console.warn('[mentions] user directory search failed', err);
        });
    }, DIRECTORY_SEARCH_DELAY_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [mx, query.text, rosterComplete]);

  const getDirectoryName = (u: DirectoryUser) =>
    u.displayName || getMxIdLocalPart(u.userId) || u.userId;

  const handleAutocomplete: MentionAutoCompleteHandler = (uId, name) => {
    const mentionEl = createMentionElement(
      uId,
      name.startsWith('@') ? name : `@${name}`,
      mx.getUserId() === uId || roomAliasOrId === uId,
    );
    replaceWithElement(editor, query.range, mentionEl);
    moveCursor(editor, true);
    safeFocusEditor(editor);
    requestClose();
  };

  const handleAutocompleteFirst = () => {
    if (query.text === 'room') {
      handleAutocomplete(roomAliasOrId, '@room');
      return;
    }
    const roomMember = autoCompleteMembers[0];
    if (roomMember) {
      handleAutocomplete(roomMember.userId, roomMember.name);
      return;
    }
    const directoryUser = directoryMatches[0];
    if (directoryUser) {
      handleAutocomplete(directoryUser.userId, getDirectoryName(directoryUser));
      return;
    }
    const userId = userIdFromQueryText(mx, query.text);
    handleAutocomplete(userId, userId);
  };

  useEffect(() => {
    const handleTab = (evt: KeyboardEvent) => {
      onTabPress(evt, () => {
        if (!clickFocusedAutocompleteItem()) handleAutocompleteFirst();
      });
    };
    window.addEventListener('keydown', handleTab, true);
    return () => window.removeEventListener('keydown', handleTab, true);
  });

  useEffect(() => {
    const handleEnter = (evt: KeyboardEvent) => {
      if (evt.key === 'Enter' && !evt.metaKey && !evt.ctrlKey) {
        evt.preventDefault();
        evt.stopPropagation();
        if (!clickFocusedAutocompleteItem()) handleAutocompleteFirst();
      }
    };
    window.addEventListener('keydown', handleEnter, true);
    return () => window.removeEventListener('keydown', handleEnter, true);
  });

  const getName = (member: RoomMember) =>
    getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;

  return (
    <AutocompleteMenu headerContent={<Text size="L400">Mentions</Text>} requestClose={requestClose}>
      {query.text === 'room' && (
        <UnknownMentionItem
          userId={roomAliasOrId}
          name="@room"
          handleAutocomplete={handleAutocomplete}
        />
      )}
      {autoCompleteMembers.length === 0 && directoryMatches.length === 0 ? (
        <UnknownMentionItem
          userId={userIdFromQueryText(mx, query.text)}
          name={userIdFromQueryText(mx, query.text)}
          handleAutocomplete={handleAutocomplete}
        />
      ) : (
        [
          ...autoCompleteMembers.map((roomMember, index) => {
            const avatarMxcUrl = roomMember.getMxcAvatarUrl();
            const avatarUrl = avatarMxcUrl
              ? mx.mxcUrlToHttp(avatarMxcUrl, 32, 32, 'crop', undefined, false, useAuthentication)
              : undefined;
            return (
              <MenuItem
                key={roomMember.userId}
                as="button"
                radii="300"
                data-autocomplete-index={index}
                aria-pressed={index === 0}
                onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
                  onTabPress(evt, () => handleAutocomplete(roomMember.userId, getName(roomMember)))
                }
                onClick={() => handleAutocomplete(roomMember.userId, getName(roomMember))}
                after={
                  <Text size="T200" priority="300" truncate>
                    {roomMember.userId}
                  </Text>
                }
                before={
                  <Avatar size="200">
                    <UserAvatar
                      userId={roomMember.userId}
                      src={avatarUrl ?? undefined}
                      alt={getName(roomMember)}
                      renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                    />
                  </Avatar>
                }
              >
                <Text style={{ flexGrow: 1 }} size="B400" truncate>
                  {getName(roomMember)}
                </Text>
              </MenuItem>
            );
          }),
          ...directoryMatches.map((directoryUser, dirIndex) => {
            const index = autoCompleteMembers.length + dirIndex;
            const name = getDirectoryName(directoryUser);
            const avatarUrl = directoryUser.avatarUrl
              ? mx.mxcUrlToHttp(
                  directoryUser.avatarUrl,
                  32,
                  32,
                  'crop',
                  undefined,
                  false,
                  useAuthentication,
                )
              : undefined;
            return (
              <MenuItem
                key={directoryUser.userId}
                as="button"
                radii="300"
                data-autocomplete-index={index}
                aria-pressed={index === 0}
                onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
                  onTabPress(evt, () => handleAutocomplete(directoryUser.userId, name))
                }
                onClick={() => handleAutocomplete(directoryUser.userId, name)}
                after={
                  <Text size="T200" priority="300" truncate>
                    {directoryUser.userId}
                  </Text>
                }
                before={
                  <Avatar size="200">
                    <UserAvatar
                      userId={directoryUser.userId}
                      src={avatarUrl ?? undefined}
                      alt={name}
                      renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                    />
                  </Avatar>
                }
              >
                <Text style={{ flexGrow: 1 }} size="B400" truncate>
                  {name}
                </Text>
              </MenuItem>
            );
          }),
        ]
      )}
    </AutocompleteMenu>
  );
}
