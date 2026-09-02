import { IEvent, MatrixEvent, Room } from 'matrix-js-sdk';
import { useCallback, useMemo } from 'react';
import to from '../utils/await-to';
import { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { useQuery } from '@tanstack/react-query';
import { useMatrixClient } from './useMatrixClient';

const useFetchEvent = (room: Room, eventId: string) => {
  const mx = useMatrixClient();

  const fetchEventCallback = useCallback(async () => {
    const evt = await mx.fetchRoomEvent(room.roomId, eventId);
    const mEvent = new MatrixEvent(evt);

    if (evt.unsigned?.['m.relations'] && evt.unsigned?.['m.relations']['m.replace']) {
      const replaceEvt = evt.unsigned?.['m.relations']['m.replace'] as IEvent;
      const replaceEvent = new MatrixEvent(replaceEvt);
      mEvent.makeReplaced(replaceEvent);
    }

    // shouldAttemptDecryption, not isEncrypted: a redacted m.room.encrypted
    // keeps its type but loses `algorithm`, and the crypto backend rejects it.
    // This path fetches whatever a reply or a permalink points at, which is
    // exactly the kind of event that gets deleted.
    if (mEvent.shouldAttemptDecryption() && mx.getCrypto()) {
      await to(mEvent.attemptDecryption(mx.getCrypto() as CryptoBackend));
    }

    return mEvent;
  }, [mx, room.roomId, eventId]);

  return fetchEventCallback;
};

/**
 *
 * @param room
 * @param eventId
 * @returns `MatrixEvent`, `undefined` means loading, `null` means failure
 */
export const useRoomEvent = (
  room: Room,
  eventId: string,
  getLocally?: () => MatrixEvent | undefined,
) => {
  const event = useMemo(() => {
    if (getLocally) return getLocally();
    return room.findEventById(eventId);
  }, [room, eventId, getLocally]);

  const fetchEvent = useFetchEvent(room, eventId);

  const { data, error } = useQuery({
    // An empty/absent eventId (e.g. PinnedMessageBanner passing `eventId ?? ''`
    // when nothing is pinned) would otherwise fire fetchRoomEvent(roomId, '')
    // → GET /rooms/{roomId}/event/ → 404, which react-query then retries,
    // spamming the network log on every room with no pin.
    enabled: event === undefined && Boolean(eventId),
    queryKey: [room.roomId, eventId],
    queryFn: fetchEvent,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000, // 1hour
  });

  if (event) return event;
  if (data) return data;
  if (error) return null;

  return undefined;
};
