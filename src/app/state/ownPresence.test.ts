import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { saveChosenPresence } from './ownPresence';
import { Presence } from '../hooks/useUserPresence';
import { MSC4426_STATUS, MSC4532_PERSISTENT } from '../utils/profileStatus';
import { AccountDataEvent } from '../../types/matrix/accountData';

const fakeClient = (saved: Record<string, unknown>) => {
  const client = {
    setSyncPresence: vi.fn(),
    setPresence: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Too Many Requests'), {
          httpStatus: 429,
          errcode: 'M_LIMIT_EXCEEDED',
        }),
      ),
    getAccountData: (type: string) =>
      type === AccountDataEvent.PrinnyPresence ? { getContent: () => saved } : undefined,
    setAccountData: vi.fn().mockResolvedValue({}),
    setExtendedProfileProperty: vi.fn().mockResolvedValue({}),
    deleteExtendedProfileProperty: vi.fn().mockResolvedValue({}),
    doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(true),
  };
  return client;
};

describe('saveChosenPresence', () => {
  it('still saves the choice, hides the shared status and writes MSC4532 when the presence update is refused', async () => {
    const mx = fakeClient({ status: 'Out for lunch', emoji: '🍜', share_status: true });

    await expect(
      saveChosenPresence(mx as unknown as MatrixClient, Presence.Offline),
    ).rejects.toThrow('Too Many Requests');

    // The choice is remembered, so the next start applies it
    expect(mx.setAccountData).toHaveBeenCalledWith(
      AccountDataEvent.PrinnyPresence,
      expect.objectContaining({ presence: Presence.Offline }),
    );
    // Invisible must take the public status down, whatever happened to presence
    expect(mx.deleteExtendedProfileProperty).toHaveBeenCalledWith(MSC4426_STATUS);
    expect(mx.setAccountData).toHaveBeenCalledWith(MSC4532_PERSISTENT, {
      state_override: 'offline',
    });
  });
});
