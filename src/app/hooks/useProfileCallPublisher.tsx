import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { callEmbedAtom } from '../state/callEmbed';
import { useCallJoined } from './useCallEmbed';
import { useMatrixClient } from './useMatrixClient';
import { useChosenPresence, useShareStatus } from '../state/ownPresence';
import { Presence } from './useUserPresence';
import { MSC4426_CALL } from '../utils/profileStatus';

const isUnsupportedProfileWrite = (err: unknown): boolean => {
  const { httpStatus, errcode } = (err ?? {}) as { httpStatus?: number; errcode?: string };
  return httpStatus === 404 || httpStatus === 405 || errcode === 'M_UNRECOGNIZED';
};

/**
 * Publishes MSC4426 `org.matrix.msc4426.call` ({ call_joined_ts }, seconds)
 * while the user is in a call, and deletes it when they leave.
 *
 * Under the same opt-in as the status ("Share status on my profile"): a
 * profile field says "in a call" to anyone who looks, room or no room. Also
 * withheld while invisible, for the same reason the status is.
 *
 * Reads the call state only (callEmbedAtom, useCallJoined); nothing in the
 * call code changes.
 */
export function ProfileCallPublisher() {
  const mx = useMatrixClient();
  const callEmbed = useAtomValue(callEmbedAtom);
  const joined = useCallJoined(callEmbed);
  const share = useShareStatus();
  const chosen = useChosenPresence();
  const publish = joined && share && chosen !== Presence.Offline;

  const joinedAt = useRef<number | undefined>(undefined);
  const published = useRef(false);
  const unsupported = useRef(false);

  // Declared first so the join time is set before the publish effect reads it.
  useEffect(() => {
    joinedAt.current = joined ? Date.now() : undefined;
  }, [joined]);

  useEffect(() => {
    if (unsupported.current) return;
    if (publish && !published.current && joinedAt.current !== undefined) {
      published.current = true;
      mx.setExtendedProfileProperty(MSC4426_CALL, {
        call_joined_ts: Math.floor(joinedAt.current / 1000),
      }).catch((err) => {
        published.current = false;
        if (isUnsupportedProfileWrite(err)) unsupported.current = true;
        else console.warn('[status] could not publish the call field', err);
      });
    }
    if (!publish && published.current) {
      published.current = false;
      mx.deleteExtendedProfileProperty(MSC4426_CALL).catch((err) =>
        console.warn('[status] could not remove the call field', err),
      );
    }
  }, [mx, publish]);

  return null;
}
