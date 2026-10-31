import { MatrixClient, SetPresence } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getAccountData } from '../utils/room';
import { useAccountData } from '../hooks/useAccountData';
import { Presence, useUserPresence } from '../hooks/useUserPresence';

export type OwnPresenceContent = {
  /** The status message the user last saved, kept across presence changes. */
  status?: string;
  /** The presence picked in the profile menu; absent means online. */
  presence?: Presence;
};

const PRESENCE_VALUES: readonly string[] = Object.values(Presence);

const parseContent = (content: unknown): OwnPresenceContent => {
  if (typeof content !== 'object' || content === null) {
    return {};
  }
  const { status, presence } = content as Record<string, unknown>;
  return {
    status: typeof status === 'string' ? status : undefined,
    presence:
      typeof presence === 'string' && PRESENCE_VALUES.includes(presence)
        ? (presence as Presence)
        : undefined,
  };
};

const getContent = (mx: MatrixClient): OwnPresenceContent =>
  parseContent(getAccountData(mx, AccountDataEvent.PrinnyPresence)?.getContent());

// PUT /presence replaces the whole presence state, and servers drop status_msg
// when presence goes offline or is set without one. So the user's message is
// kept in account data and re-sent with every presence change.
export const getRememberedStatus = (mx: MatrixClient): string => getContent(mx).status ?? '';

export const sendPresence = (
  mx: MatrixClient,
  presence: Presence,
  statusMsg: string = getRememberedStatus(mx),
): Promise<void> => mx.setPresence({ presence, status_msg: statusMsg });

const SYNC_PRESENCE: Record<Presence, SetPresence | undefined> = {
  // Left unset, /sync marks the user online, which is what online wants.
  [Presence.Online]: undefined,
  [Presence.Unavailable]: SetPresence.Unavailable,
  [Presence.Offline]: SetPresence.Offline,
};

/**
 * Sets the user's presence so that it sticks. A PUT /presence on its own is
 * undone by the next /sync, which (with no `set_presence`) tells the server
 * the user is online again; so the sync loop is switched to send the same
 * state from now on.
 */
export const applyOwnPresence = (mx: MatrixClient, presence: Presence): Promise<void> => {
  mx.setSyncPresence(SYNC_PRESENCE[presence]);
  return sendPresence(mx, presence);
};

/** Stores the status message and applies it to the current presence. */
export const saveStatusMessage = async (
  mx: MatrixClient,
  presence: Presence,
  status: string,
): Promise<void> => {
  await mx.setAccountData(AccountDataEvent.PrinnyPresence, { ...getContent(mx), status });
  await sendPresence(mx, presence, status);
};

export const getChosenPresence = (mx: MatrixClient): Presence =>
  getContent(mx).presence ?? Presence.Online;

/** Applies a presence picked by the user and remembers it for the next start. */
export const saveChosenPresence = async (mx: MatrixClient, presence: Presence): Promise<void> => {
  await applyOwnPresence(mx, presence);
  await mx.setAccountData(AccountDataEvent.PrinnyPresence, { ...getContent(mx), presence });
};

export const useChosenPresence = (): Presence => {
  const event = useAccountData(AccountDataEvent.PrinnyPresence);
  return parseContent(event?.getContent()).presence ?? Presence.Online;
};

/** The user's own status: what the server reports, else the remembered message. */
export const useOwnStatus = (userId: string): string => {
  const presence = useUserPresence(userId);
  const event = useAccountData(AccountDataEvent.PrinnyPresence);
  return presence?.status?.trim() || parseContent(event?.getContent()).status?.trim() || '';
};
