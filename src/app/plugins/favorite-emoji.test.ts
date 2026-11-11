import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { getFavoriteEmojis, toggleFavoriteEmoji } from './favorite-emoji';

const fakeClient = (initial?: unknown) => {
  let content: unknown = initial;
  return {
    getAccountData: () => (content === undefined ? undefined : { getContent: () => content }),
    setAccountData: (_type: string, next: unknown) =>
      new Promise((resolve) => {
        setTimeout(() => {
          content = next;
          resolve({});
        }, 5);
      }),
  } as unknown as MatrixClient;
};

describe('favourite emoji', () => {
  it('stores the base emoji when a toned one is favourited, and unfavourites it the same way', async () => {
    const mx = fakeClient();
    await toggleFavoriteEmoji(mx, '✋🏽');
    expect(getFavoriteEmojis(mx).map((e) => e.label)).toEqual(['raised hand']);
    await toggleFavoriteEmoji(mx, '✋🏿');
    expect(getFavoriteEmojis(mx)).toEqual([]);
  });

  it('keeps both of two quick toggles', async () => {
    const mx = fakeClient({ favorites: [] });
    await Promise.all([toggleFavoriteEmoji(mx, '😀'), toggleFavoriteEmoji(mx, '🐳')]);
    expect(getFavoriteEmojis(mx)).toHaveLength(2);
  });

  it('ignores stored entries that are not known emoji', () => {
    const mx = fakeClient({ favorites: ['😀', 42, 'not an emoji', '😀'] });
    expect(getFavoriteEmojis(mx).map((e) => e.unicode)).toEqual(['😀']);
  });
});
