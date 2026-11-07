import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { publishProfileStatus, saveChosenPresence, setShareStatus } from './ownPresence';
import { Presence } from '../hooks/useUserPresence';
import { MSC4426_STATUS, MSC4532_PERSISTENT } from '../utils/profileStatus';
import { AccountDataEvent } from '../../types/matrix/accountData';

const fakeClient = (saved: Record<string, unknown>) => {
  const client = {
    setSyncPresence: vi.fn(),
    setPresence: vi.fn().mockRejectedValue(
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

describe('profile status on a homeserver without profile fields', () => {
  // What matrix-js-sdk does when /versions does not advertise MSC4133: it
  // refuses before sending anything, with no HTTP status or errcode.
  const sdkRefusal = () => new Error('Server does not support extended profiles');

  const noProfileFields = () => ({
    setSyncPresence: vi.fn(),
    setPresence: vi.fn().mockResolvedValue({}),
    getAccountData: () => undefined,
    setAccountData: vi.fn().mockResolvedValue({}),
    doesServerSupportExtendedProfiles: vi.fn().mockResolvedValue(false),
    setExtendedProfileProperty: vi.fn().mockRejectedValue(sdkRefusal()),
    deleteExtendedProfileProperty: vi.fn().mockRejectedValue(sdkRefusal()),
    doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(false),
  });

  it('reports publishing as unsupported, not as a failure', async () => {
    const mx = noProfileFields();
    expect(
      await publishProfileStatus(
        mx as unknown as MatrixClient,
        { status: 'Lunch', emoji: '🍜', share_status: true },
        Presence.Online,
      ),
    ).toBe('unsupported');
    expect(
      await publishProfileStatus(
        mx as unknown as MatrixClient,
        { share_status: true },
        Presence.Online,
      ),
    ).toBe('unsupported');
  });

  it('reports turning sharing on and off as unsupported', async () => {
    const mx = noProfileFields();
    expect(await setShareStatus(mx as unknown as MatrixClient, true, Presence.Online)).toBe(
      'unsupported',
    );
    expect(await setShareStatus(mx as unknown as MatrixClient, false, Presence.Online)).toBe(
      'unsupported',
    );
  });

  it('still treats a 404 M_UNRECOGNIZED from the server as unsupported', async () => {
    const mx = {
      ...noProfileFields(),
      doesServerSupportExtendedProfiles: vi.fn().mockResolvedValue(true),
      deleteExtendedProfileProperty: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Unrecognized'), { httpStatus: 404, errcode: 'M_UNRECOGNIZED' }),
        ),
    };
    expect(
      await publishProfileStatus(
        mx as unknown as MatrixClient,
        { share_status: true },
        Presence.Online,
      ),
    ).toBe('unsupported');
  });
});
