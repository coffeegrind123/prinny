import { useCallback, useEffect, useRef, useState } from 'react';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from './useMatrixClient';
import { useDeviceListChange } from './useDeviceList';

/**
 * Whether another device of the same account could approve this one. It has to be signed by
 * the account's own cross-signing key, because only a device the identity already trusts can
 * sign a new one. `signedByOwner` is the right test while this device is still untrusted:
 * unlike `crossSigningVerified` it does not need this device to trust the identity first.
 * Dehydrated devices (MSC3814) are offline backups that cannot answer a request, and a device
 * without an identity key is not a usable device at all.
 */
export const hasOtherVerifiedDevices = async (
  crypto: CryptoApi,
  userId: string,
  ownDeviceId: string,
): Promise<boolean> => {
  const devices = (await crypto.getUserDeviceInfo([userId])).get(userId);
  if (!devices) return false;

  const candidates = [...devices.values()].filter(
    (device) =>
      device.deviceId !== ownDeviceId &&
      !device.dehydrated &&
      device.getIdentityKey() !== undefined,
  );
  const statuses = await Promise.all(
    candidates.map((device) => crypto.getDeviceVerificationStatus(userId, device.deviceId)),
  );
  return statuses.some((status) => !!status?.signedByOwner);
};

/**
 * `checking` until the answer is known. If it cannot be worked out the answer is `available`:
 * offering a method that may not work is better than hiding one that does.
 *
 * The SDK waits only a second for a device list request that is still in flight, so on a slow
 * first sign-in the first answer can be wrong. It is checked again whenever the account's device
 * list changes, so a late answer corrects the screen.
 */
export type OtherDevices = 'checking' | 'available' | 'none';

export const useOtherVerifiedDevices = (): OtherDevices => {
  const mx = useMatrixClient();
  const [state, setState] = useState<OtherDevices>('checking');
  const latest = useRef(0);

  const check = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    // Only the newest check may set the state, so a slow old answer cannot undo a newer one.
    const settle = (next: OtherDevices) => {
      if (request === latest.current) setState(next);
    };

    const crypto = mx.getCrypto();
    const deviceId = mx.getDeviceId();
    if (!crypto || !deviceId) {
      settle('available');
      return;
    }
    hasOtherVerifiedDevices(crypto, mx.getSafeUserId(), deviceId)
      .then((has) => settle(has ? 'available' : 'none'))
      .catch(() => settle('available'));
  }, [mx]);

  useEffect(() => {
    check();
    return () => {
      // Invalidate any check still running, so nothing is set after unmount.
      latest.current += 1;
    };
  }, [check]);

  useDeviceListChange(
    useCallback(
      (userIds) => {
        if (userIds.includes(mx.getSafeUserId())) check();
      },
      [mx, check],
    ),
  );

  return state;
};
