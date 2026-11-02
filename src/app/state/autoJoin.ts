import { useMemo } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getAccountData } from '../utils/room';
import { useAccountData } from '../hooks/useAccountData';
import { useSetting } from './hooks/settings';
import { settingsAtom } from './settings';
import {
  AutoJoinMode,
  AutoJoinPrefs,
  parseAutoJoin,
  withSpaceOverride,
} from '../utils/spaceAutoJoin';

const getContent = (mx: MatrixClient): Record<string, unknown> | undefined =>
  getAccountData(mx, AccountDataEvent.PrinnyAutoJoin)?.getContent();

/** The account's auto-join preference, falling back to this device's old switch. */
export const useAutoJoinPrefs = (): AutoJoinPrefs => {
  const event = useAccountData(AccountDataEvent.PrinnyAutoJoin);
  const [deviceSetting] = useSetting(settingsAtom, 'autoJoinSpaceRooms');
  return useMemo(() => parseAutoJoin(event?.getContent(), deviceSetting), [event, deviceSetting]);
};

/** Sets the mode for every device; per-space choices are kept. */
export const setAutoJoinMode = (mx: MatrixClient, mode: AutoJoinMode): Promise<unknown> =>
  mx.setAccountData(AccountDataEvent.PrinnyAutoJoin, { ...getContent(mx), mode });

/** true = always auto-join this space, false = never, undefined = follow the mode. */
export const setSpaceAutoJoin = (
  mx: MatrixClient,
  spaceId: string,
  choice: boolean | undefined,
  fallbackMode: AutoJoinMode,
): Promise<unknown> => {
  const content = getContent(mx);
  // A first write must carry the mode the user is currently getting from the
  // device switch, or other devices would read "off".
  const base = content ?? { mode: fallbackMode };
  return mx.setAccountData(
    AccountDataEvent.PrinnyAutoJoin,
    withSpaceOverride(base, spaceId, choice),
  );
};
