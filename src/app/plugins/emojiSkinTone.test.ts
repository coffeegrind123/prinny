import { describe, expect, it } from 'vitest';
import { findEmojiByUnicode, getEmojiUnicodeForTone } from './emoji';

const hand = () => findEmojiByUnicode('✋')!;

describe('emoji skin tone', () => {
  it('leaves the default tone, and emoji without variants, unchanged', () => {
    expect(getEmojiUnicodeForTone(hand(), 0)).toBe(hand().unicode);
    const smile = findEmojiByUnicode('😀')!;
    expect(getEmojiUnicodeForTone(smile, 3)).toBe('😀');
  });

  it('picks the variant with the wanted modifier, light (1) to dark (5)', () => {
    expect(getEmojiUnicodeForTone(hand(), 1)).toBe('✋🏻');
    expect(getEmojiUnicodeForTone(hand(), 5)).toBe('✋🏿');
  });

  it('picks the single-tone variant for an emoji showing several people', () => {
    const couple = findEmojiByUnicode('💑')!;
    const toned = getEmojiUnicodeForTone(couple, 2);
    expect(toned).toContain('🏼');
    expect(toned.match(/[\u{1F3FB}-\u{1F3FF}]/gu)?.every((m) => m === '🏼')).toBe(true);
  });

  it('maps a toned variant back to its base emoji, so recents still resolve', () => {
    expect(findEmojiByUnicode('✋🏾')?.unicode).toBe(hand().unicode);
  });

  it('ignores an out-of-range tone', () => {
    expect(getEmojiUnicodeForTone(hand(), 9)).toBe(hand().unicode);
  });
});
