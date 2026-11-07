import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  APP_ENTRY_MAX_LIFETIME,
  applyAppMessage,
  isAppAllowed,
  notedApp,
  opaqueSocketId,
  parseAppMessage,
  publishableEntries,
  sanitizeAppEntry,
  type AppEntry,
} from './appPresence';
import { MSC4544_RPC_ACTIVITY, MSC4544_RPC_MUSIC } from '../../types/matrix/richPresence';

const NOW = 1_800_000_000_000;
const APP = { id: '0fbaf247-2e0c-4bae-be93-5f40aa71e604', name: 'Super Tux Kart' };

// The add_presence example from MSC4544, with an expiry relative to NOW
const addMessage = (overrides: Record<string, unknown> = {}) => ({
  type: 'add_presence',
  data: {
    id: 'ed6f7005-77db-4fc0-8644-9ac18120cd40',
    type: 'm.rpc.activity',
    name: 'Super Tux Kart',
    state: 'Playing',
    details: 'Character: Tux',
    expiry: NOW + 60_000,
    ...overrides,
  },
  app_id: APP,
});

describe('parseAppMessage', () => {
  it("reads the MSC's add_presence example", () => {
    expect(parseAppMessage(addMessage(), NOW)).toEqual({
      kind: 'add',
      appId: APP.id,
      appName: APP.name,
      entry: {
        id: 'ed6f7005-77db-4fc0-8644-9ac18120cd40',
        type: MSC4544_RPC_ACTIVITY,
        expiry: NOW + 60_000,
        name: 'Super Tux Kart',
        state: 'Playing',
        details: 'Character: Tux',
      },
    });
  });

  it("reads the MSC's remove_presence example", () => {
    expect(
      parseAppMessage({ type: 'remove_presence', data: { id: 'ed6f7005' }, app_id: APP }, NOW),
    ).toEqual({ kind: 'remove', appId: APP.id, appName: APP.name, entryId: 'ed6f7005' });
  });

  it('ignores messages without an app, data or a known type', () => {
    expect(parseAppMessage({ type: 'add_presence', data: addMessage().data }, NOW)).toBeUndefined();
    expect(parseAppMessage({ ...addMessage(), type: 'set_presence' }, NOW)).toBeUndefined();
    expect(parseAppMessage('hello', NOW)).toBeUndefined();
  });
});

describe('sanitizeAppEntry', () => {
  it('drops entries that are expired, have no id or no name', () => {
    expect(sanitizeAppEntry({ ...addMessage().data, expiry: NOW }, NOW)).toBeUndefined();
    expect(sanitizeAppEntry({ ...addMessage().data, id: '' }, NOW)).toBeUndefined();
    expect(sanitizeAppEntry({ ...addMessage().data, name: '  ' }, NOW)).toBeUndefined();
    expect(sanitizeAppEntry({ ...addMessage().data, type: 'm.rpc.other' }, NOW)).toBeUndefined();
  });

  it('caps how long an entry may claim to last', () => {
    const entry = sanitizeAppEntry({ ...addMessage().data, expiry: NOW + 86_400_000 }, NOW);
    expect(entry?.expiry).toBe(NOW + APP_ENTRY_MAX_LIFETIME);
  });

  it('keeps only fields MSC4544 defines, and only mxc icons', () => {
    const entry = sanitizeAppEntry(
      {
        ...addMessage().data,
        large_icon_url: 'https://tracker.example/pixel.png',
        small_icon_url: 'mxc://hs/small',
        secret: 'not published',
      },
      NOW,
    );
    expect(entry).not.toHaveProperty('secret');
    expect(entry).not.toHaveProperty('large_icon_url');
    // A small icon needs a large one, as the MSC says
    expect(entry).not.toHaveProperty('small_icon_url');
  });

  it('strips control and bidi override characters', () => {
    expect(sanitizeAppEntry({ ...addMessage().data, name: 'Ka‮rt\u0007' }, NOW)?.name).toBe('Kart');
  });

  it('reads music with progress and buttons, dropping unsafe buttons', () => {
    expect(
      sanitizeAppEntry(
        {
          id: 'm1',
          type: 'm.rpc.music',
          expiry: NOW + 1000,
          track: 'Song',
          artist: 'Band',
          cover_url: 'mxc://hs/cover',
          progress: { since: NOW - 10_000, until: NOW + 100_000 },
          buttons: [
            { label: 'Listen', url: 'https://music.example/1' },
            { label: 'Bad', url: 'javascript:alert(1)' },
          ],
        },
        NOW,
      ),
    ).toEqual({
      id: 'm1',
      type: MSC4544_RPC_MUSIC,
      expiry: NOW + 1000,
      track: 'Song',
      artist: 'Band',
      cover_url: 'mxc://hs/cover',
      progress: { since: NOW - 10_000, until: NOW + 100_000 },
      buttons: [{ label: 'Listen', url: 'https://music.example/1' }],
    });
  });
});

describe('policy', () => {
  it('denies an app nobody has decided on, as MSC4544 requires by default', () => {
    expect(isAppAllowed({}, 'deny', APP.id)).toBe(false);
    expect(isAppAllowed({}, 'allow', APP.id)).toBe(true);
    expect(
      isAppAllowed({ [APP.id]: { name: 'x', allowed: true, lastSeen: 0 } }, 'deny', APP.id),
    ).toBe(true);
    expect(
      isAppAllowed({ [APP.id]: { name: 'x', allowed: false, lastSeen: 0 } }, 'allow', APP.id),
    ).toBe(false);
  });

  it('records an app once, and again only when something visible changed', () => {
    const first = notedApp({}, APP.id, APP.name, NOW);
    expect(first).toEqual({ name: APP.name, lastSeen: NOW });
    expect(notedApp({ [APP.id]: first! }, APP.id, APP.name, NOW + 1000)).toBeUndefined();
    expect(
      notedApp({ [APP.id]: { ...first!, allowed: true } }, APP.id, 'Renamed', NOW + 1000),
    ).toEqual({ name: 'Renamed', allowed: true, lastSeen: NOW + 1000 });
  });
});

describe('publishableEntries', () => {
  const discord = { id: 'discord', type: MSC4544_RPC_MUSIC, expiry: NOW + 1, track: 'x' };

  const add = (
    entries: Map<string, AppEntry>,
    appId: string,
    id: string,
    at: number,
    expiry = NOW + 60_000,
  ) =>
    applyAppMessage(
      entries,
      {
        kind: 'add',
        appId,
        appName: appId,
        entry: { id, type: MSC4544_RPC_ACTIVITY, expiry, name: id },
      },
      at,
    );

  it('puts the Discord entry first, then allowed apps newest first, at most four', () => {
    const entries = new Map<string, AppEntry>();
    add(entries, 'a', 'a1', NOW - 5);
    add(entries, 'a', 'a2', NOW - 1);
    add(entries, 'blocked', 'b1', NOW);
    add(entries, 'a', 'a3', NOW - 3);
    add(entries, 'a', 'a4', NOW - 4);
    const ids = publishableEntries(discord, entries, (app) => app !== 'blocked', NOW).map(
      (entry) => entry.id,
    );
    expect(ids).toEqual(['discord', 'a2', 'a3', 'a4']);
  });

  it('drops expired entries from memory, as MSC4544 asks before a write', () => {
    const entries = new Map<string, AppEntry>();
    add(entries, 'a', 'old', NOW - 10, NOW - 1);
    add(entries, 'a', 'live', NOW - 10);
    expect(publishableEntries(undefined, entries, () => true, NOW).map((e) => e.id)).toEqual([
      'live',
    ]);
    expect(entries.size).toBe(1);
  });

  it('does not let one app remove or replace another app’s entry', () => {
    const entries = new Map<string, AppEntry>();
    add(entries, 'a', 'shared', NOW);
    applyAppMessage(entries, { kind: 'remove', appId: 'b', appName: 'b', entryId: 'shared' }, NOW);
    add(entries, 'b', 'shared', NOW + 1);
    expect([...entries.values()].map((value) => value.appId).sort()).toEqual(['a', 'b']);
  });
});

describe('opaqueSocketId', () => {
  it('is HMAC-SHA256 of the user ID under the salt, as 32 hex characters', async () => {
    const expected = createHmac('sha256', 'salt').update('@alice:example.org').digest('hex');
    expect(await opaqueSocketId('salt', '@alice:example.org')).toBe(expected.slice(0, 32));
  });
});
