import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  CALL_NOTIFICATION_RULE_ID,
  CALL_NOTIFICATION_TYPE_PATTERN,
  ensureCallNotificationRule,
} from './callNotificationRule';

type Put = { path: string; query?: Record<string, string>; body: unknown };

const fakeClient = (overrideIds: string[], accountData: Record<string, unknown> = {}) => {
  const puts: Put[] = [];
  const data = { ...accountData };
  const mx = {
    puts,
    data,
    pushRules: { global: { override: overrideIds.map((rule_id) => ({ rule_id })) } },
    getAccountData: (type: string) =>
      data[type] === undefined ? undefined : { getContent: () => data[type] },
    setAccountData: (type: string, content: unknown) => {
      data[type] = content;
      return Promise.resolve({});
    },
    http: {
      authedRequest: (_m: string, path: string, query: Record<string, string>, body: unknown) => {
        puts.push({ path, query, body });
        return Promise.resolve({});
      },
    },
  };
  return mx as unknown as MatrixClient & { puts: Put[]; data: Record<string, unknown> };
};

const globMatches = (glob: string, value: string) =>
  new RegExp(`^${glob.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`).test(value);

describe('call notification push rule', () => {
  it('matches both call ring event types, and not a decline', () => {
    expect(globMatches(CALL_NOTIFICATION_TYPE_PATTERN, 'org.matrix.msc4075.rtc.notification')).toBe(
      true,
    );
    expect(globMatches(CALL_NOTIFICATION_TYPE_PATTERN, 'org.matrix.msc4075.call.notify')).toBe(
      true,
    );
    expect(globMatches(CALL_NOTIFICATION_TYPE_PATTERN, 'org.matrix.msc4310.rtc.decline')).toBe(
      false,
    );
  });

  it('installs a notify-without-highlight rule below the existing user overrides (mutes win)', async () => {
    const mx = fakeClient(['.m.rule.master', '!muted:hs', '.m.rule.suppress_notices']);
    await ensureCallNotificationRule(mx);
    expect(mx.puts).toHaveLength(1);
    expect(mx.puts[0].path).toBe(`/pushrules/global/override/${CALL_NOTIFICATION_RULE_ID}`);
    expect(mx.puts[0].query).toEqual({ after: '!muted:hs' });
    const { actions } = mx.puts[0].body as { actions: unknown[] };
    expect(actions).toContain('notify');
    expect(JSON.stringify(actions)).not.toContain('highlight');
    expect(mx.data['app.prinny.call_notification_rule']).toEqual({ installed: true });
  });

  it('installs once: not again after the user deleted it, nor when it already exists', async () => {
    const deleted = fakeClient([], { 'app.prinny.call_notification_rule': { installed: true } });
    await ensureCallNotificationRule(deleted);
    expect(deleted.puts).toHaveLength(0);

    const present = fakeClient([CALL_NOTIFICATION_RULE_ID]);
    await ensureCallNotificationRule(present);
    expect(present.puts).toHaveLength(0);
    expect(present.data['app.prinny.call_notification_rule']).toEqual({ installed: true });
  });

  it('puts it at the top of the user rules when there are none to go below', async () => {
    const mx = fakeClient(['.m.rule.master', '.m.rule.suppress_notices']);
    await ensureCallNotificationRule(mx);
    expect(mx.puts[0].query).toBeUndefined();
  });

  it('does nothing until push rules have loaded', async () => {
    const mx = fakeClient([]);
    (mx as unknown as { pushRules?: unknown }).pushRules = undefined;
    await ensureCallNotificationRule(mx);
    expect(mx.puts).toHaveLength(0);
  });
});
