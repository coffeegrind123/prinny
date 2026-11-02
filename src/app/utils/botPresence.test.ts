import { describe, expect, it } from 'vitest';
import { withoutDepartedBots } from './botPresence';

describe('withoutDepartedBots', () => {
  it('keeps only bots that are still joined', () => {
    const bots = new Map([
      ['@joined:hs', { commands: [] }],
      ['@left:hs', { commands: [] }],
      ['@kicked:hs', { commands: [] }],
      ['@unknown:hs', { commands: [] }],
    ]);
    const membership: Record<string, string> = {
      '@joined:hs': 'join',
      '@left:hs': 'leave',
      '@kicked:hs': 'ban',
    };
    const kept = withoutDepartedBots(bots, (id) => membership[id]);
    expect([...kept.keys()]).toEqual(['@joined:hs']);
    expect(bots.size).toBe(4);
  });
});
