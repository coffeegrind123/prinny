import { describe, expect, it } from 'vitest';
import {
  M_RPC,
  MSC4320_RPC,
  MSC4544_RPC,
  getProfileRichPresence,
  parseMsc4544RichPresence,
} from '../../types/matrix/richPresence';
import { activityIdentity, mapDiscordActivity, toMsc4544Entry } from './discordActivity';

const NOW = 1_800_000_000_000;

describe('MSC4544 reading', () => {
  it('reads a music entry, converting progress to our model', () => {
    const rp = parseMsc4544RichPresence(
      [
        {
          id: 'a',
          type: 'xyz.extera.msc4544.rpc.music',
          expiry: NOW + 60_000,
          track: 'Hated by Life',
          artist: 'Iori Kanzaki',
          player_name: 'YouTube Music',
          cover_url: 'mxc://example.com/c',
          progress: { since: NOW - 100_000, until: NOW + 168_000 },
          buttons: [{ label: 'x', url: 'https://example.com' }],
        },
      ],
      NOW,
    );
    expect(rp).toEqual({
      type: 'media',
      expiresAt: NOW + 60_000,
      track: 'Hated by Life',
      artist: 'Iori Kanzaki',
      album: undefined,
      player: 'YouTube Music',
      coverArt: 'mxc://example.com/c',
      progress: { length: 268, timeComplete: NOW + 168_000 },
      buttons: [{ label: 'x', url: 'https://example.com', requestOpenId: false }],
    });
  });

  it('reads stable type names and folds state into details', () => {
    expect(
      parseMsc4544RichPresence(
        [
          {
            id: 'g',
            type: 'm.rpc.activity',
            expiry: NOW + 1,
            name: 'Minecraft',
            state: 'Playing',
            details: 'Overworld',
          },
        ],
        NOW,
      ),
    ).toMatchObject({ type: 'activity', name: 'Minecraft', details: 'Overworld · Playing' });
  });

  it('skips expired and malformed entries and takes the first good one', () => {
    const value = [
      { id: 'old', type: 'm.rpc.activity', expiry: NOW - 10 * 60_000, name: 'Old' },
      { type: 'm.rpc.activity', expiry: NOW + 1, name: 'No id' },
      { id: 'x', type: 'm.rpc.music', expiry: NOW + 1 },
      { id: 'ok', type: 'm.rpc.activity', expiry: NOW + 1, name: 'Current' },
    ];
    expect(parseMsc4544RichPresence(value, NOW)).toMatchObject({ name: 'Current' });
    expect(parseMsc4544RichPresence({ id: 'not-array' }, NOW)).toBeUndefined();
  });

  it('tells MSC4320 objects and MSC4544 arrays apart under m.rpc', () => {
    const later = Date.now() + 60_000;
    expect(
      getProfileRichPresence({
        [M_RPC]: [{ id: 'a', type: 'm.rpc.activity', expiry: later, name: 'Array' }],
      }),
    ).toMatchObject({ name: 'Array' });
    expect(
      getProfileRichPresence({ [M_RPC]: { type: 'm.rpc.activity', name: 'Object' } }),
    ).toMatchObject({ name: 'Object' });
  });

  it('prefers MSC4320, then the MSC4544 unstable field', () => {
    const later = Date.now() + 60_000;
    expect(
      getProfileRichPresence({
        [MSC4320_RPC]: { type: 'com.ip-logger.msc4320.rpc.activity', name: 'Ours' },
        [MSC4544_RPC]: [
          { id: 'a', type: 'xyz.extera.msc4544.rpc.activity', expiry: later, name: 'Theirs' },
        ],
      }),
    ).toMatchObject({ name: 'Ours' });
  });
});

describe('MSC4544 writing', () => {
  it('maps a Discord listening activity and round-trips through the reader', () => {
    const { payload } = mapDiscordActivity({
      type: 2,
      name: 'Spotify',
      details: 'Track',
      state: 'Artist',
      assets: { large_text: 'Album' },
      timestamps: { start: NOW - 60_000, end: NOW + 120_000 },
    });
    const entry = toMsc4544Entry(
      { ...payload, cover_art: 'mxc://x/y' } as never,
      'id1',
      NOW + 300_000,
    );
    expect(entry).toEqual({
      id: 'id1',
      type: 'xyz.extera.msc4544.rpc.music',
      expiry: NOW + 300_000,
      track: 'Track',
      artist: 'Artist',
      album: 'Album',
      player_name: 'Spotify',
      cover_url: 'mxc://x/y',
      progress: { since: NOW - 60_000, until: NOW + 120_000 },
    });
    expect(parseMsc4544RichPresence([entry], NOW)).toMatchObject({
      type: 'media',
      track: 'Track',
      artist: 'Artist',
      player: 'Spotify',
      progress: { length: 180, timeComplete: NOW + 120_000 },
    });
  });

  it('maps a game and keeps one identity while its details change', () => {
    const a = mapDiscordActivity({ type: 0, name: 'Game', details: 'Level 1' }).payload;
    const b = mapDiscordActivity({ type: 0, name: 'Game', details: 'Level 2' }).payload;
    expect(activityIdentity(a)).toBe(activityIdentity(b));
    expect(toMsc4544Entry(a, 'g', NOW)).toEqual({
      id: 'g',
      type: 'xyz.extera.msc4544.rpc.activity',
      expiry: NOW,
      name: 'Game',
      details: 'Level 1',
    });
  });
});
