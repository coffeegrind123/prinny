import { describe, expect, it } from 'vitest';
import { parseSearchQuery, removeQueryToken, resolveSearchQuery } from './searchQuery';
import { emptyPageStreak } from './autoPaging';

const resolve = (input: string) =>
  resolveSearchQuery(parseSearchQuery(input, 0), { users: [], rooms: [] }, undefined);

describe('has:link', () => {
  // The server's contains_url means "content.url is set": media, not a link in
  // the text. Sending it for has:link would return only uploads.
  it('is filtered in the client', () => {
    const resolved = resolve('release has:link');
    expect(resolved.has).toEqual(['link']);
    expect(resolved.needsClientFilter).toBe(true);
  });
});

describe('removeQueryToken', () => {
  it('keeps whitespace inside a quoted phrase elsewhere in the query', () => {
    const input = '"two   spaces" has:link   rest';
    const token = parseSearchQuery(input, 0).tokens.find((t) => t.raw === 'has:link');
    expect(token).toBeDefined();
    expect(removeQueryToken(input, token!)).toBe('"two   spaces" rest');
  });

  it('leaves no stray space at either end', () => {
    const input = 'has:image cats';
    const token = parseSearchQuery(input, 0).tokens.find((t) => t.raw === 'has:image');
    expect(removeQueryToken(input, token!)).toBe('cats');
  });
});

describe('emptyPageStreak', () => {
  it('counts trailing pages that added nothing visible', () => {
    expect(emptyPageStreak([3, 0, 0], 0)).toBe(2);
    expect(emptyPageStreak([3, 0, 2], 0)).toBe(0);
    expect(emptyPageStreak([0, 0, 0, 0], 0)).toBe(4);
    expect(emptyPageStreak([], 0)).toBe(0);
  });

  it('only counts pages after the point the user asked to search further', () => {
    expect(emptyPageStreak([3, 0, 0, 0, 0], 3)).toBe(2);
    expect(emptyPageStreak([3, 0, 0], 3)).toBe(0);
  });
});
