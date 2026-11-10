import { describe, expect, it } from 'vitest';
import { uniqueZipEntryName, zipEntryName } from './zipEntryName';

describe('zipEntryName (image pack download)', () => {
  it('keeps an ordinary shortcode and extension', () => {
    expect(zipEntryName('smile', 'image/png')).toBe('smile.png');
    expect(zipEntryName('party_parrot', 'image/gif')).toBe('party_parrot.gif');
  });

  it('cannot leave the extraction folder through a crafted mimetype', () => {
    // The pack editor sets the mimetype. Everything after the last "/" used to become the
    // extension, so "x/..\\..\\evil" produced "smile..\\..\\evil", a backslash path on Windows.
    const name = zipEntryName('smile', 'x/..\\..\\evil');
    expect(name).not.toMatch(/[\\/]/);
    expect(name).not.toContain('..');
    expect(name).toBe('smile');
  });

  it('cannot carry path or Windows-reserved characters in the shortcode', () => {
    for (const shortcode of ['../up', '..\\up', 'C:evil', 'a:stream', 'q?*"<>|', '..']) {
      const name = zipEntryName(shortcode, 'image/png');
      expect(name).not.toMatch(/[\\/:*?"<>|]/);
      expect(name.startsWith('.')).toBe(false);
      expect(name.endsWith('.png')).toBe(true);
    }
  });

  it('drops control characters and falls back to "image" when nothing is left', () => {
    expect(zipEntryName('a\u0000b\u001fc', 'image/png')).toBe('a_b_c.png');
    expect(zipEntryName('', 'image/png')).toBe('image.png');
    expect(zipEntryName('...', 'image/webp')).toBe('image.webp');
  });
});

describe('uniqueZipEntryName', () => {
  it('treats names differing only in case as the same file', () => {
    // Windows and macOS extract Smile.png and smile.png to one file, so the second
    // silently replaced the first.
    const used = new Set<string>();
    expect(uniqueZipEntryName('Smile', 'image/png', used)).toBe('Smile.png');
    expect(uniqueZipEntryName('smile', 'image/png', used)).toBe('smile-1.png');
    expect(uniqueZipEntryName('SMILE', 'image/png', used)).toBe('SMILE-2.png');
  });
});
