import { describe, expect, it } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { hasActiveCallMembership } from './callMembers';

const roomWithCallState = (contents: Record<string, unknown>[]): Room =>
  ({
    currentState: {
      getStateEvents: (type: string) =>
        type === 'org.matrix.msc3401.call.member'
          ? contents.map((content) => ({ getContent: () => content }))
          : [],
    },
  }) as unknown as Room;

describe('hasActiveCallMembership', () => {
  it('is false for a room that never had a call', () => {
    expect(hasActiveCallMembership(roomWithCallState([]))).toBe(false);
  });

  it('is false when every membership was left (empty content), as after a call ends', () => {
    expect(hasActiveCallMembership(roomWithCallState([{}, { msc4354_sticky_key: 'k' }]))).toBe(
      false,
    );
  });

  it('is false for the deprecated "memberships" list format the SDK ignores', () => {
    expect(hasActiveCallMembership(roomWithCallState([{ memberships: [] }]))).toBe(false);
  });

  it('is true when someone is in the call', () => {
    const joined = { application: 'm.call', call_id: '', device_id: 'D', focus_active: {} };
    expect(hasActiveCallMembership(roomWithCallState([{}, joined]))).toBe(true);
  });
});
