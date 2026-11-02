import { describe, expect, it } from 'vitest';
import { AutoJoinMode, autoJoinsSpace, parseAutoJoin, withSpaceOverride } from './spaceAutoJoin';

describe('autoJoinsSpace', () => {
  const prefs = (mode: AutoJoinMode, spaces: Record<string, boolean> = {}) => ({ mode, spaces });

  it('joins nothing when off, whatever the space asks', () => {
    expect(autoJoinsSpace(prefs(AutoJoinMode.Off), '!s', true)).toBe(false);
  });

  it('joins only spaces that ask, in "requested" mode', () => {
    expect(autoJoinsSpace(prefs(AutoJoinMode.Requested), '!s', true)).toBe(true);
    expect(autoJoinsSpace(prefs(AutoJoinMode.Requested), '!s', false)).toBe(false);
  });

  it('joins every space in "all" mode', () => {
    expect(autoJoinsSpace(prefs(AutoJoinMode.All), '!s', false)).toBe(true);
  });

  it('lets a per-space choice beat the mode in both directions', () => {
    expect(autoJoinsSpace(prefs(AutoJoinMode.Off, { '!s': true }), '!s', false)).toBe(true);
    expect(autoJoinsSpace(prefs(AutoJoinMode.All, { '!s': false }), '!s', true)).toBe(false);
    expect(autoJoinsSpace(prefs(AutoJoinMode.All, { '!other': false }), '!s', false)).toBe(true);
  });
});

describe('parseAutoJoin', () => {
  it('falls back to the device setting when the account has no preference', () => {
    expect(parseAutoJoin(undefined, true)).toEqual({ mode: AutoJoinMode.All, spaces: {} });
    expect(parseAutoJoin(undefined, false)).toEqual({ mode: AutoJoinMode.Off, spaces: {} });
  });

  it('reads the account preference over the device setting', () => {
    expect(parseAutoJoin({ mode: 'requested', spaces: { '!a': false } }, true)).toEqual({
      mode: AutoJoinMode.Requested,
      spaces: { '!a': false },
    });
  });

  it('treats an unknown mode as off and drops malformed overrides', () => {
    expect(
      parseAutoJoin({ mode: 'sometimes', spaces: { '!a': 'yes', '!b': true, nope: true } }, true),
    ).toEqual({ mode: AutoJoinMode.Off, spaces: { '!b': true } });
  });
});

describe('withSpaceOverride', () => {
  it('sets, replaces and clears one space without touching others', () => {
    const base = { mode: 'all', spaces: { '!a': true }, 'x.unknown': 1 };
    expect(withSpaceOverride(base, '!b', false)).toEqual({
      mode: 'all',
      spaces: { '!a': true, '!b': false },
      'x.unknown': 1,
    });
    expect(withSpaceOverride(base, '!a', undefined)).toEqual({
      mode: 'all',
      spaces: {},
      'x.unknown': 1,
    });
    expect(base.spaces).toEqual({ '!a': true });
  });
});
