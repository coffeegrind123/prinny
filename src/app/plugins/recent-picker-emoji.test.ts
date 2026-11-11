import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { PackImageReader } from './custom-emoji/PackImageReader';
import { recordPickerRecent, resolvePickerRecents } from './recent-picker-emoji';

const fakeClient = (data: Record<string, unknown> = {}) => {
  const store = { ...data };
  return {
    store,
    getAccountData: (type: string) =>
      store[type] === undefined ? undefined : { getContent: () => store[type] },
    setAccountData: (type: string, content: unknown) => {
      store[type] = content;
      return Promise.resolve({});
    },
  } as unknown as MatrixClient & { store: Record<string, unknown> };
};

const image = (shortcode: string) =>
  new PackImageReader(shortcode, `mxc://hs/${shortcode}`, { body: shortcode });

describe('picker recents', () => {
  it('interleaves custom and unicode emoji by when they were last used', () => {
    const mx = fakeClient();
    recordPickerRecent(mx, '😀');
    recordPickerRecent(mx, 'mxc://hs/blob');
    recordPickerRecent(mx, '🐳');
    const items = resolvePickerRecents(mx, [image('blob')], 10);
    expect(items.map((i) => ('url' in i ? i.url : i.unicode))).toEqual([
      '🐳',
      'mxc://hs/blob',
      '😀',
    ]);
  });

  it('keeps writing unicode picks to the shared recent list other clients read', () => {
    const mx = fakeClient();
    recordPickerRecent(mx, '😀');
    recordPickerRecent(mx, 'mxc://hs/blob');
    expect(mx.store['m.recent_emoji']).toEqual({ recent_emoji: [{ emoji: '😀', total: 1 }] });
  });

  it('skips custom emoji whose pack is gone, and appends unicode recents from other clients', () => {
    const mx = fakeClient({ 'm.recent_emoji': { recent_emoji: [{ emoji: '🎉', total: 3 }] } });
    recordPickerRecent(mx, 'mxc://hs/gone');
    recordPickerRecent(mx, '😀');
    const items = resolvePickerRecents(mx, [], 10);
    expect(items.map((i) => ('url' in i ? i.url : i.unicode))).toEqual(['😀', '🎉']);
  });

  it('counts a toned and an untoned pick of the same emoji as one entry', () => {
    const mx = fakeClient();
    recordPickerRecent(mx, '✋🏽');
    recordPickerRecent(mx, '✋');
    expect(resolvePickerRecents(mx, [], 10)).toHaveLength(1);
  });
});
