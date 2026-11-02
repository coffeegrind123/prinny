import { describe, expect, it } from 'vitest';
import {
  INVITE_CONFIG_MSC4155,
  INVITE_CONFIG_STABLE,
  INVITE_CONFIG_UNSTABLE,
  blocksAllInvites,
  inviteBlockingWrites,
} from './inviteBlocking';

describe('blocksAllInvites', () => {
  it('reads MSC4380 stable or unstable, and MSC4155 block-everything', () => {
    expect(blocksAllInvites({ [INVITE_CONFIG_STABLE]: { default_action: 'block' } })).toBe(true);
    expect(blocksAllInvites({ [INVITE_CONFIG_UNSTABLE]: { default_action: 'block' } })).toBe(true);
    expect(blocksAllInvites({ [INVITE_CONFIG_MSC4155]: { blocked_users: ['*'] } })).toBe(true);
    expect(blocksAllInvites({ [INVITE_CONFIG_MSC4155]: { blocked_servers: ['*'] } })).toBe(true);
  });

  it('is off otherwise, and the stable key decides when present', () => {
    expect(blocksAllInvites({})).toBe(false);
    expect(blocksAllInvites({ [INVITE_CONFIG_STABLE]: { default_action: 'allow' } })).toBe(false);
    expect(
      blocksAllInvites({
        [INVITE_CONFIG_STABLE]: {},
        [INVITE_CONFIG_MSC4155]: { blocked_users: ['*'] },
      }),
    ).toBe(false);
    expect(
      blocksAllInvites({ [INVITE_CONFIG_MSC4155]: { enabled: false, blocked_users: ['*'] } }),
    ).toBe(false);
  });
});

describe('inviteBlockingWrites', () => {
  it('writes all three types and keeps MSC4155 lists the user built elsewhere', () => {
    const current = { blocked_users: ['@spam:hs'], allowed_servers: ['good.org'] };
    expect(inviteBlockingWrites(true, current)).toEqual({
      [INVITE_CONFIG_STABLE]: { default_action: 'block' },
      [INVITE_CONFIG_UNSTABLE]: { default_action: 'block' },
      [INVITE_CONFIG_MSC4155]: { blocked_users: ['@spam:hs', '*'], allowed_servers: ['good.org'] },
    });
    expect(inviteBlockingWrites(false, { blocked_users: ['@spam:hs', '*'] })).toEqual({
      [INVITE_CONFIG_STABLE]: { default_action: 'allow' },
      [INVITE_CONFIG_UNSTABLE]: { default_action: 'allow' },
      [INVITE_CONFIG_MSC4155]: { blocked_users: ['@spam:hs'] },
    });
  });
});
