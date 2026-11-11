import { describe, expect, it } from 'vitest';
import { addFocusRepair, parseFocusRepairs } from './composerFocusRepairs';

describe('addFocusRepair', () => {
  it('counts each trigger and remembers the last repair', () => {
    let stats = parseFocusRepairs(null);
    expect(stats).toEqual({ focus: 0, keydown: 0 });
    stats = addFocusRepair(stats, 'focus', 1000);
    stats = addFocusRepair(stats, 'keydown', 2000);
    stats = addFocusRepair(stats, 'keydown', 3000);
    expect(stats).toEqual({ focus: 1, keydown: 2, lastAt: 3000, lastTrigger: 'keydown' });
  });
});

describe('parseFocusRepairs', () => {
  it('reads back what was stored', () => {
    const stats = addFocusRepair(parseFocusRepairs(null), 'focus', 5);
    expect(parseFocusRepairs(JSON.stringify(stats))).toEqual(stats);
  });

  it('starts from zero on anything unreadable', () => {
    expect(parseFocusRepairs('nope')).toEqual({ focus: 0, keydown: 0 });
    expect(parseFocusRepairs('{"focus":"3"}')).toEqual({ focus: 0, keydown: 0 });
  });
});
