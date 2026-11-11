import { describe, expect, it } from 'vitest';
import { isGifVideoContent } from './common';
import { MSC4320_RPC_ACTIVITY, parseRichPresence } from './richPresence';

describe('isGifVideoContent', () => {
  it('reads the GIF marker under every name in use', () => {
    expect(isGifVideoContent({ 'io.cinny.gif': true })).toBe(true);
    expect(isGifVideoContent({ 'club.stablecat.pinniped.gif': true })).toBe(true);
    expect(isGifVideoContent({ info: { 'fi.mau.gif': true } })).toBe(true);
  });

  it('is false without a marker, or with a marker that is not true', () => {
    expect(isGifVideoContent({})).toBe(false);
    expect(isGifVideoContent({ 'io.cinny.gif': 'yes' })).toBe(false);
    expect(isGifVideoContent({ info: 'x' })).toBe(false);
  });
});

describe('rich presence expiry', () => {
  it("honours Pinniped's current expiry key as well as its old one", () => {
    const past = Date.now() - 60 * 60 * 1000;
    const activity = { type: MSC4320_RPC_ACTIVITY, name: 'Game' };
    expect(parseRichPresence(activity)).toBeDefined();
    expect(
      parseRichPresence({ ...activity, 'club.stablecat.pinniped.expires_at': past }),
    ).toBeUndefined();
    expect(
      parseRichPresence({ ...activity, 'de.mreow.pinniped.expires_at': past }),
    ).toBeUndefined();
  });
});
