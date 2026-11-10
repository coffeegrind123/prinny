import { describe, expect, it } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { stripOptionalText, stripUnsafeTextChars } from './unsafeText';
import { getMemberDisplayName, getRoomName } from './room';

describe('stripUnsafeTextChars', () => {
  it('removes a right-to-left override that would reverse the text after it', () => {
    // "gpj.exe" after U+202E shows as "exe.jpg" in most renderers.
    expect(stripUnsafeTextChars('invoice‮gpj.exe')).toBe('invoicegpj.exe');
  });

  it('removes every embedding, override and isolate control', () => {
    expect(stripUnsafeTextChars('‪‫‬‭‮')).toBe('');
    expect(stripUnsafeTextChars('⁦⁧⁨⁩')).toBe('');
  });

  it('removes C0 and C1 controls such as the bell, NUL, DEL and NEL', () => {
    expect(stripUnsafeTextChars('bell:\u0007 nul:\u0000 del:\u007F nel:\u0085')).toBe(
      'bell: nul: del: nel:',
    );
  });

  it('keeps tab, newline and carriage return', () => {
    expect(stripUnsafeTextChars('a\tb\nc\r\nd')).toBe('a\tb\nc\r\nd');
  });

  it('keeps the left-to-right and right-to-left marks that RTL text needs', () => {
    expect(stripUnsafeTextChars('‎abc‏')).toBe('‎abc‏');
  });

  it('leaves ordinary text, emoji and non-Latin scripts unchanged', () => {
    const text = 'abc é مرحبا 日本語 👍🏽 a‍b';
    expect(stripUnsafeTextChars(text)).toBe(text);
  });
});

describe('stripOptionalText', () => {
  it('passes undefined through and strips text otherwise', () => {
    expect(stripOptionalText(undefined)).toBeUndefined();
    expect(stripOptionalText('Topic‮')).toBe('Topic');
  });
});

const roomWith = (name: string, members: Record<string, string> = {}): Room =>
  ({
    name,
    getMember: (userId: string) =>
      userId in members ? { userId, rawDisplayName: members[userId] } : null,
  }) as unknown as Room;

describe('display names', () => {
  it('getRoomName strips override characters from the room name', () => {
    expect(getRoomName(roomWith('General‮latot'))).toBe('Generallatot');
  });

  it('getMemberDisplayName strips override characters from a member name', () => {
    const room = roomWith('r', { '@a:hs': 'adm‮nimi' });
    expect(getMemberDisplayName(room, '@a:hs')).toBe('admnimi');
  });

  it('getMemberDisplayName treats a name of only invisible characters as no name', () => {
    const room = roomWith('r', { '@a:hs': '‮⁦\u0007' });
    expect(getMemberDisplayName(room, '@a:hs')).toBeUndefined();
  });

  it('getMemberDisplayName still returns undefined for a name equal to the user id', () => {
    const room = roomWith('r', { '@a:hs': '@a:hs' });
    expect(getMemberDisplayName(room, '@a:hs')).toBeUndefined();
  });
});
