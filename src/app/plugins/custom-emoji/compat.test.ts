import { describe, expect, it } from 'vitest';
import {
  isValidShortcode,
  mergePackRooms,
  packRoomsWrites,
  pickPackEvents,
  toShortcode,
  uniqueShortcode,
} from './compat';

const STABLE = 'm.room.image_pack';
const LEGACY = 'im.ponies.room_emotes';

const ev = (
  type: string,
  stateKey: string | undefined,
  ts: number,
  id = `${type}:${stateKey}`,
) => ({
  id,
  getType: () => type,
  getStateKey: () => stateKey,
  getTs: () => ts,
});

describe('pickPackEvents', () => {
  it('keeps packs that exist under only one name', () => {
    const picked = pickPackEvents([ev(STABLE, 'a', 1), ev(LEGACY, 'b', 1)]);
    expect(picked.map((e) => e.id).sort()).toEqual([`${LEGACY}:b`, `${STABLE}:a`]);
  });

  it('takes the newer event for the same state_key', () => {
    expect(pickPackEvents([ev(STABLE, 'a', 1), ev(LEGACY, 'a', 2)]).map((e) => e.id)).toEqual([
      `${LEGACY}:a`,
    ]);
    expect(pickPackEvents([ev(LEGACY, 'a', 1), ev(STABLE, 'a', 2)]).map((e) => e.id)).toEqual([
      `${STABLE}:a`,
    ]);
  });

  it('prefers stable on a tie, whatever the order', () => {
    expect(pickPackEvents([ev(LEGACY, '', 5), ev(STABLE, '', 5)]).map((e) => e.id)).toEqual([
      `${STABLE}:`,
    ]);
    expect(pickPackEvents([ev(STABLE, '', 5), ev(LEGACY, '', 5)]).map((e) => e.id)).toEqual([
      `${STABLE}:`,
    ]);
  });

  it('ignores other types and missing state keys', () => {
    expect(pickPackEvents([ev('m.room.name', '', 1), ev(STABLE, undefined, 1)])).toEqual([]);
  });
});

describe('mergePackRooms', () => {
  it('unions both contents', () => {
    expect(
      mergePackRooms([
        { rooms: { '!a': { '': {} } } },
        { rooms: { '!a': { cats: {} }, '!b': { '': {} } } },
      ]),
    ).toEqual({ '!a': { '': {}, cats: {} }, '!b': { '': {} } });
  });

  it('keeps the first copy of the reserved inner object', () => {
    expect(
      mergePackRooms([{ rooms: { '!a': { '': { future: 1 } } } }, { rooms: { '!a': { '': {} } } }]),
    ).toEqual({ '!a': { '': { future: 1 } } });
  });

  it('skips malformed input', () => {
    expect(
      mergePackRooms([undefined, { rooms: [] }, { rooms: { '!a': 'x', '!b': { k: 3 } } }]),
    ).toEqual({ '!b': { k: {} } });
  });
});

describe('packRoomsWrites', () => {
  it('writes both names with independent copies', () => {
    const rooms = { '!a': { '': {} } };
    const writes = packRoomsWrites(rooms);
    expect(Object.keys(writes)).toEqual(['m.image_pack.rooms', 'im.ponies.emote_rooms']);
    expect(writes['m.image_pack.rooms']).toEqual({ rooms });
    expect(writes['m.image_pack.rooms'].rooms).not.toBe(writes['im.ponies.emote_rooms'].rooms);
  });
});

describe('shortcodes', () => {
  it('validates the spec grammar', () => {
    expect(isValidShortcode('cat_wave-2')).toBe(true);
    expect(isValidShortcode('a'.repeat(100))).toBe(true);
    expect(isValidShortcode('a'.repeat(101))).toBe(false);
    for (const bad of ['', 'cat wave', 'cat:wave', 'cat/wave', 'cat.png', 'café']) {
      expect(isValidShortcode(bad)).toBe(false);
    }
  });

  it('derives a valid shortcode from a file name', () => {
    expect(toShortcode('Cat Wave (1)')).toBe('Cat-Wave-1');
    expect(toShortcode('café.au.lait')).toBe('cafe-au-lait');
    expect(toShortcode('  ')).toBe('image');
    expect(toShortcode('🐱')).toBe('image');
    expect(toShortcode('x'.repeat(150))).toHaveLength(100);
    expect(isValidShortcode(toShortcode('weird//:name'))).toBe(true);
  });

  it('suffixes taken shortcodes without exceeding the limit', () => {
    const taken = new Set(['cat', 'cat1']);
    expect(uniqueShortcode('dog', (s) => taken.has(s))).toBe('dog');
    expect(uniqueShortcode('cat', (s) => taken.has(s))).toBe('cat2');
    const long = 'y'.repeat(100);
    const result = uniqueShortcode(long, (s) => s === long);
    expect(result).toHaveLength(100);
    expect(result.endsWith('1')).toBe(true);
  });
});
