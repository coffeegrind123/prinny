import { describe, expect, it } from 'vitest';
import { getNavPathname } from './navPathname';

describe('getNavPathname', () => {
  it('drops a trailing event id, raw or percent-encoded, keeping the trailing slash', () => {
    expect(getNavPathname('/home/!room:hs/$event123/')).toBe('/home/!room:hs/');
    expect(getNavPathname('/home/!room:hs/%24event123/')).toBe('/home/!room:hs/');
    expect(getNavPathname('/direct/!dm:hs/$ev')).toBe('/direct/!dm:hs');
  });

  it('leaves room paths and other paths alone', () => {
    expect(getNavPathname('/home/!room:hs/')).toBe('/home/!room:hs/');
    expect(getNavPathname('/space/%23space:hs/search/')).toBe('/space/%23space:hs/search/');
    expect(getNavPathname('/')).toBe('/');
  });
});
