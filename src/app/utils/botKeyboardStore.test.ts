import { describe, expect, it } from 'vitest';
import {
  latestInstruction,
  parseStoredKeyboards,
  recordInstruction,
  setKeyboardFlag,
} from './botKeyboardStore';

const kb = (eventId: string, ts: number) => ({ kind: 'keyboard' as const, eventId, ts });

describe('parseStoredKeyboards', () => {
  it('keeps well-formed entries keyed by user id', () => {
    expect(
      parseStoredKeyboards({
        '@bot:hs': { event_id: '$a', ts: 5, kind: 'keyboard', dismissed: true },
        '@rm:hs': { event_id: '$b', ts: 6, kind: 'remove' },
        '@bad:hs': { event_id: 3, ts: 1, kind: 'keyboard' },
        notauser: { event_id: '$c', ts: 1, kind: 'keyboard' },
        '@kind:hs': { event_id: '$d', ts: 1, kind: 'mystery' },
      }),
    ).toEqual({
      '@bot:hs': { eventId: '$a', ts: 5, kind: 'keyboard', dismissed: true, used: false },
      '@rm:hs': { eventId: '$b', ts: 6, kind: 'remove', dismissed: false, used: false },
    });
  });

  it('reads nothing from garbage', () => {
    expect(parseStoredKeyboards(undefined)).toEqual({});
    expect(parseStoredKeyboards([1])).toEqual({});
  });
});

describe('recordInstruction', () => {
  it('records a newer instruction and resets the flags', () => {
    const content = { '@bot:hs': { event_id: '$old', ts: 1, kind: 'keyboard', used: true } };
    expect(recordInstruction(content, '@bot:hs', kb('$new', 2))).toEqual({
      '@bot:hs': { event_id: '$new', ts: 2, kind: 'keyboard' },
    });
  });

  it('returns undefined when nothing would change, so no write happens', () => {
    const content = { '@bot:hs': { event_id: '$same', ts: 2, kind: 'keyboard', used: true } };
    expect(recordInstruction(content, '@bot:hs', kb('$same', 2))).toBeUndefined();
    expect(recordInstruction(content, '@bot:hs', kb('$older', 1))).toBeUndefined();
  });

  it('keeps other bots and unknown fields', () => {
    const content = { '@a:hs': { event_id: '$a', ts: 1, kind: 'keyboard' }, 'x.y': 1 };
    expect(recordInstruction(content, '@b:hs', { kind: 'remove', eventId: '$r', ts: 3 })).toEqual({
      '@a:hs': { event_id: '$a', ts: 1, kind: 'keyboard' },
      '@b:hs': { event_id: '$r', ts: 3, kind: 'remove' },
      'x.y': 1,
    });
  });
});

describe('setKeyboardFlag', () => {
  it('flags only the instruction it names', () => {
    const content = { '@bot:hs': { event_id: '$k', ts: 1, kind: 'keyboard' } };
    expect(setKeyboardFlag(content, '@bot:hs', '$k', 'dismissed')).toEqual({
      '@bot:hs': { event_id: '$k', ts: 1, kind: 'keyboard', dismissed: true },
    });
    expect(setKeyboardFlag(content, '@bot:hs', '$other', 'used')).toBeUndefined();
  });
});

describe('latestInstruction', () => {
  it('picks the most recent instruction across bots', () => {
    const stored = parseStoredKeyboards({
      '@a:hs': { event_id: '$a', ts: 5, kind: 'keyboard' },
      '@b:hs': { event_id: '$b', ts: 9, kind: 'remove' },
    });
    expect(latestInstruction(stored)).toEqual({
      botUserId: '@b:hs',
      eventId: '$b',
      ts: 9,
      kind: 'remove',
      dismissed: false,
      used: false,
    });
    expect(latestInstruction({})).toBeUndefined();
  });
});
