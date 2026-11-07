import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClientEvent,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useAccountDataCallback } from './useAccountDataCallback';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import {
  MEDIA_PREVIEW_TYPES,
  MediaPreviewConfig,
  PartialMediaPreviewConfig,
  mediaPreviewsAllowed,
  readMediaPreviewLevel,
  resolveMediaPreviewConfig,
} from '../utils/mediaPreview';
import { StateEvent } from '../../types/matrix/room';

const isPreviewType = (type: string): boolean =>
  (MEDIA_PREVIEW_TYPES as readonly string[]).includes(type);

const readGlobal = (mx: MatrixClient): PartialMediaPreviewConfig =>
  readMediaPreviewLevel(
    Object.fromEntries(
      MEDIA_PREVIEW_TYPES.map((type) => [type, mx.getAccountData(type as never)?.getContent()]),
    ),
  );

const readRoom = (room: Room): PartialMediaPreviewConfig =>
  readMediaPreviewLevel(
    Object.fromEntries(
      MEDIA_PREVIEW_TYPES.map((type) => [type, room.getAccountData(type)?.getContent()]),
    ),
  );

const readJoinRule = (room: Room): unknown =>
  room.currentState.getStateEvents(StateEvent.RoomJoinRules, '')?.getContent().join_rule;

/** The account-wide MSC4278 setting (keys as written, not yet defaulted). */
export const useGlobalMediaPreviewLevel = (): PartialMediaPreviewConfig => {
  const mx = useMatrixClient();
  const [level, setLevel] = useState(() => readGlobal(mx));

  useEffect(() => setLevel(readGlobal(mx)), [mx]);

  useAccountDataCallback(
    mx,
    useCallback(
      (event: MatrixEvent) => {
        if (isPreviewType(event.getType())) setLevel(readGlobal(mx));
      },
      [mx],
    ),
  );

  return level;
};

/**
 * Whether account data has arrived at all. Before the first sync completes,
 * "no media_preview_config" cannot be told apart from "not loaded yet", and
 * the timeline does render from cache in that window — an image that starts
 * loading there has already been fetched by the time the setting says off.
 */
const useAccountDataReady = (): boolean => {
  const mx = useMatrixClient();
  const [ready, setReady] = useState(() => mx.isInitialSyncComplete());

  useEffect(() => {
    if (ready) return undefined;
    const onSync = () => {
      if (mx.isInitialSyncComplete()) setReady(true);
    };
    onSync();
    mx.on(ClientEvent.Sync, onSync);
    return () => {
      mx.removeListener(ClientEvent.Sync, onSync);
    };
  }, [mx, ready]);

  return ready;
};

/** The room-level override, or `{}` when there is no room or no override. */
export const useRoomMediaPreviewLevel = (room?: Room | null): PartialMediaPreviewConfig => {
  const [level, setLevel] = useState(() => (room ? readRoom(room) : {}));

  useEffect(() => {
    if (!room) {
      setLevel({});
      return undefined;
    }
    setLevel(readRoom(room));
    const onAccountData = (event: MatrixEvent) => {
      if (isPreviewType(event.getType())) setLevel(readRoom(room));
    };
    room.on(RoomEvent.AccountData, onAccountData);
    return () => {
      room.removeListener(RoomEvent.AccountData, onAccountData);
    };
  }, [room]);

  return level;
};

const useJoinRule = (room?: Room | null): unknown => {
  const [joinRule, setJoinRule] = useState(() => (room ? readJoinRule(room) : undefined));

  useEffect(() => {
    if (!room) {
      setJoinRule(undefined);
      return undefined;
    }
    setJoinRule(readJoinRule(room));
    const onState = (event: MatrixEvent) => {
      if (event.getType() === StateEvent.RoomJoinRules) setJoinRule(readJoinRule(room));
    };
    room.on(RoomStateEvent.Events, onState);
    return () => {
      room.removeListener(RoomStateEvent.Events, onState);
    };
  }, [room]);

  return joinRule;
};

export const useMediaPreviewConfig = (room?: Room | null): MediaPreviewConfig => {
  const global = useGlobalMediaPreviewLevel();
  const roomLevel = useRoomMediaPreviewLevel(room);
  return useMemo(() => resolveMediaPreviewConfig(global, roomLevel), [global, roomLevel]);
};

/**
 * Whether media in `room` may load without a click (MSC4278 `media_previews`).
 * Without a room (profile text, say) the join rule is unknown, so "private"
 * counts as public and blocks, as the MSC requires.
 */
export const useMediaPreviewsAllowed = (room?: Room | null): boolean => {
  const { media_previews: value } = useMediaPreviewConfig(room);
  const joinRule = useJoinRule(room);
  const ready = useAccountDataReady();
  return ready && mediaPreviewsAllowed(value, joinRule);
};

/**
 * The value every renderer's `mediaAutoLoad` / `autoPlay` takes: the local
 * "load media automatically" setting, narrowed by MSC4278. Either one saying
 * no shows media behind click-to-view.
 */
export const useMediaAutoLoad = (room?: Room | null): boolean => {
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const allowed = useMediaPreviewsAllowed(room);
  return mediaAutoLoad && allowed;
};

/** MSC4278 `invite_avatars`: whether a room you are only invited to may show its avatar. */
export const useInviteAvatarsAllowed = (): boolean => {
  const global = useGlobalMediaPreviewLevel();
  const ready = useAccountDataReady();
  return ready && resolveMediaPreviewConfig(global).invite_avatars === 'on';
};
