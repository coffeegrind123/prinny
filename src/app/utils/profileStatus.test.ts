import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_EMOJI,
  M_STATUS,
  MSC4426_CALL,
  MSC4426_STATUS,
  PresenceChoice,
  buildProfileStatus,
  formatProfileStatus,
  formatCallStatus,
  profileStatusLine,
  getProfileCallJoinedMs,
  getProfileStatus,
  parseProfileStatus,
  persistentPresenceContent,
  splitLeadingEmoji,
  touchesProfileStatus,
  truncateBytes,
} from './profileStatus';

describe('parseProfileStatus', () => {
  it('reads a well-formed status', () => {
    expect(parseProfileStatus({ text: ' On  holiday ', emoji: '🌴' })).toEqual({
      text: 'On holiday',
      emoji: '🌴',
    });
  });

  it('rejects missing fields, wrong types and oversize values', () => {
    expect(parseProfileStatus({ text: 'x' })).toBeUndefined();
    expect(parseProfileStatus({ text: 1, emoji: '🙂' })).toBeUndefined();
    expect(parseProfileStatus({ text: 'x'.repeat(257), emoji: '🙂' })).toBeUndefined();
    expect(parseProfileStatus({ text: 'x', emoji: '🙂'.repeat(9) })).toBeUndefined();
    expect(parseProfileStatus({ text: ' ', emoji: '' })).toBeUndefined();
    expect(parseProfileStatus(null)).toBeUndefined();
  });
});

describe('getProfileStatus', () => {
  it('prefers the stable key', () => {
    expect(
      getProfileStatus({
        [M_STATUS]: { text: 'stable', emoji: '✅' },
        [MSC4426_STATUS]: { text: 'unstable', emoji: '🧪' },
      }),
    ).toEqual({ text: 'stable', emoji: '✅' });
    expect(getProfileStatus({ [MSC4426_STATUS]: { text: 'u', emoji: '🧪' } })?.text).toBe('u');
    expect(getProfileStatus({})).toBeUndefined();
  });

  it('notices updates that touch either key, including deletions', () => {
    expect(touchesProfileStatus({ [MSC4426_STATUS]: null })).toBe(true);
    expect(touchesProfileStatus({ displayname: 'x' })).toBe(false);
  });
});

describe('getProfileCallJoinedMs', () => {
  it('converts seconds to ms and ignores junk', () => {
    expect(getProfileCallJoinedMs({ [MSC4426_CALL]: { call_joined_ts: 1770140640 } })).toBe(
      1770140640000,
    );
    expect(getProfileCallJoinedMs({ [MSC4426_CALL]: {} })).toBeUndefined();
    expect(getProfileCallJoinedMs({ [MSC4426_CALL]: { call_joined_ts: 'x' } })).toBeUndefined();
  });
});

describe('formatting and input', () => {
  it('formats emoji and text', () => {
    expect(formatProfileStatus({ text: 'Lunch', emoji: '🍜' })).toBe('🍜 Lunch');
    expect(formatProfileStatus({ text: 'Lunch', emoji: '' })).toBe('Lunch');
  });

  it('splits a leading emoji only when it stands alone', () => {
    expect(splitLeadingEmoji('🌴 On holiday')).toEqual({ emoji: '🌴', text: 'On holiday' });
    expect(splitLeadingEmoji('👩‍💻 coding')).toEqual({ emoji: '👩‍💻', text: 'coding' });
    expect(splitLeadingEmoji('🇫🇮 home')).toEqual({ emoji: '🇫🇮', text: 'home' });
    expect(splitLeadingEmoji('🙂ok')).toEqual({ text: '🙂ok' });
    expect(splitLeadingEmoji('Out for lunch')).toEqual({ text: 'Out for lunch' });
    expect(splitLeadingEmoji('🔴')).toEqual({ emoji: '🔴', text: '' });
  });

  it('truncates by bytes without splitting characters', () => {
    expect(truncateBytes('aé', 2)).toBe('a');
    expect(truncateBytes('👩‍💻x', 4)).toBe('');
    expect(truncateBytes('abc', 10)).toBe('abc');
  });
});

describe('buildProfileStatus', () => {
  it('always sends an emoji and respects the limits', () => {
    expect(buildProfileStatus('Lunch', undefined)).toEqual({
      text: 'Lunch',
      emoji: DEFAULT_STATUS_EMOJI,
    });
    expect(buildProfileStatus('Lunch', '🍜')).toEqual({ text: 'Lunch', emoji: '🍜' });
    const long = buildProfileStatus('é'.repeat(200), '🍜');
    expect(new TextEncoder().encode(long?.text).length).toBeLessThanOrEqual(256);
  });

  it('means clear when there is no text', () => {
    expect(buildProfileStatus('   ', '🍜')).toBeUndefined();
  });
});

describe('persistentPresenceContent', () => {
  it('maps choices to overrides', () => {
    expect(persistentPresenceContent({}, { presence: PresenceChoice.Away })).toEqual({
      state_override: 'idle',
    });
    expect(persistentPresenceContent({}, { presence: PresenceChoice.Invisible })).toEqual({
      state_override: 'offline',
    });
    expect(
      persistentPresenceContent({ state_override: 'busy' }, { presence: PresenceChoice.Online }),
    ).toEqual({});
  });

  it('touches only what changed and keeps unknown keys', () => {
    const current = { state_override: 'busy', status: { msg: 'old', extra: 1 }, other: true };
    expect(persistentPresenceContent(current, { statusMsg: ' new ' })).toEqual({
      state_override: 'busy',
      status: { msg: 'new', extra: 1 },
      other: true,
    });
    expect(persistentPresenceContent(current, { statusMsg: '' })).toEqual({
      state_override: 'busy',
      status: { extra: 1 },
      other: true,
    });
  });
});

describe('call status line', () => {
  const now = 1_000_000_000_000;
  it('formats the call duration', () => {
    expect(formatCallStatus(now - 20_000, now)).toBe('📞 In a call');
    expect(formatCallStatus(now - 12 * 60_000, now)).toBe('📞 In a call · 12 min');
    expect(formatCallStatus(now - 75 * 60_000, now)).toBe('📞 In a call · 1 h 15 min');
  });

  it('prefers the status over the call (MSC4426)', () => {
    const call = { [MSC4426_CALL]: { call_joined_ts: (now - 5 * 60_000) / 1000 } };
    expect(profileStatusLine(call, now)).toBe('📞 In a call · 5 min');
    expect(profileStatusLine({ ...call, [MSC4426_STATUS]: { text: 'x', emoji: '🙂' } }, now)).toBe(
      '🙂 x',
    );
    expect(profileStatusLine({}, now)).toBeUndefined();
  });
});
