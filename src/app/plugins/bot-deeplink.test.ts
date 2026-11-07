import { describe, expect, it } from 'vitest';
import { parseBotDeepLink } from './bot-deeplink';

describe('parseBotDeepLink', () => {
  it('keeps reading the https and prinny:// forms', () => {
    expect(parseBotDeepLink('https://prinny.app/bot/%40a%3Ab.org?start=x')).toEqual({
      userId: '@a:b.org',
      payload: 'x',
    });
    expect(parseBotDeepLink('prinny://bot/@a:b.org')).toEqual({ userId: '@a:b.org' });
  });

  it('reads a matrix: chat link carrying our payload', () => {
    expect(
      parseBotDeepLink('matrix:u/helper:example.org?action=chat&app.prinny.bot.start=invite_abc'),
    ).toEqual({ userId: '@helper:example.org', payload: 'invite_abc' });
  });

  it('leaves other matrix: links to the ordinary link handler', () => {
    // A bare chat link can name a person: following it must not send /start.
    expect(parseBotDeepLink('matrix:u/a:b.org?action=chat')).toBeNull();
    expect(parseBotDeepLink('matrix:u/a:b.org')).toBeNull();
    expect(parseBotDeepLink('matrix:u/a:b.org?app.prinny.bot.start=x')).toBeNull();
    expect(parseBotDeepLink('matrix:r/room:b.org?action=chat&app.prinny.bot.start=x')).toBeNull();
    expect(
      parseBotDeepLink('matrix:u/a:b.org?action=chat&app.prinny.bot.start=has%20spaces'),
    ).toBeNull();
  });

  it('decodes a matrix: link exactly once', () => {
    expect(parseBotDeepLink('matrix:u/a%253Ab.org?action=chat&app.prinny.bot.start=x')).toBeNull();
  });
});
