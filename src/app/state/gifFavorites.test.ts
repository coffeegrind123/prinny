import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { FavoriteGif, getGifFavorites, toggleGifFavorite } from './gifFavorites';

/** A client whose account data writes land a tick later, as the sync echo does. */
const fakeClient = (initial: unknown) => {
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

const urlFav = (n: number): FavoriteGif => ({
  kind: 'url',
  title: `gif ${n}`,
  videoUrl: `https://example.com/${n}.mp4`,
});

describe('toggleGifFavorite', () => {
  it('keeps both of two quick toggles instead of the second overwriting the first', async () => {
    const mx = fakeClient({ favorites: [] });
    await Promise.all([toggleGifFavorite(mx, urlFav(1)), toggleGifFavorite(mx, urlFav(2))]);
    expect(getGifFavorites(mx).map((f) => f.id)).toEqual([
      'https://example.com/2.mp4',
      'https://example.com/1.mp4',
    ]);
  });

  it('keeps going after a failed write', async () => {
    const mx = fakeClient({ favorites: [] });
    const failing = { ...mx, setAccountData: () => Promise.reject(new Error('offline')) };
    await expect(toggleGifFavorite(failing as unknown as MatrixClient, urlFav(1))).rejects.toThrow(
      'offline',
    );
    await toggleGifFavorite(mx, urlFav(2));
    expect(getGifFavorites(mx)).toHaveLength(1);
  });
});

describe('stored favourites', () => {
  it('drops entries whose fields are the wrong shape instead of trusting them', () => {
    const now = 1;
    const mx = fakeClient({
      favorites: [
        { id: 'a', addedAt: now, fav: { kind: 'url', title: 't', videoUrl: 'https://x/a.mp4' } },
        { id: 'b', addedAt: now, fav: { kind: 'url', title: 't' } },
        {
          id: 'c',
          addedAt: now,
          fav: { kind: 'url', title: 't', videoUrl: 'javascript:alert(1)' },
        },
        { id: 'd', addedAt: now, fav: { kind: 'mxc', mxc: 'mxc://hs/d', body: 'd.gif' } },
        { id: 'e', addedAt: now, fav: { kind: 'mxc', mxc: 'https://hs/e', body: 'e.gif' } },
        { id: 'f', addedAt: now, fav: { kind: 'klipy', gif: { id: 'f', media_formats: {} } } },
        { id: 'g', addedAt: now, fav: { kind: 'klipy', gif: { id: 'g' } } },
        { id: 'h', addedAt: now, gif: { id: 'h', media_formats: {} } },
        { id: 'i', addedAt: now, gif: 'nope' },
        'junk',
      ],
    });
    expect(getGifFavorites(mx).map((f) => f.id)).toEqual(['a', 'd', 'f', 'h']);
  });
});
