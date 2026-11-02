import { describe, expect, it } from 'vitest';
import { getPerMessageProfile, profileGroupKey, stripProfileFallback } from './perMessageProfile';

const MSC = 'com.beeper.per_message_profile';

describe('getPerMessageProfile', () => {
  it('reads MSC4144 and validates it', () => {
    expect(
      getPerMessageProfile({
        [MSC]: {
          id: 'p1',
          displayname: '  Alice   the  Bot ',
          avatar_url: 'mxc://hs/a',
          has_fallback: true,
        },
      }),
    ).toEqual({
      id: 'p1',
      displayname: 'Alice the Bot',
      avatarUrl: 'mxc://hs/a',
      hasFallback: true,
      isWebhook: false,
    });
  });

  it('prefers the stable key, then the unstable one, then the legacy webhook key', () => {
    const legacy = { 'in.prinny.webhook': { id: 'w', username: 'Legacy' } };
    expect(getPerMessageProfile(legacy)?.displayname).toBe('Legacy');
    expect(
      getPerMessageProfile({ ...legacy, [MSC]: { id: 'u', displayname: 'Unstable' } })?.displayname,
    ).toBe('Unstable');
    expect(
      getPerMessageProfile({
        ...legacy,
        [MSC]: { id: 'u', displayname: 'Unstable' },
        'm.per_message_profile': { id: 's', displayname: 'Stable' },
      })?.displayname,
    ).toBe('Stable');
  });

  it('marks webhooks: legacy key, or our extension inside the MSC object', () => {
    expect(getPerMessageProfile({ 'in.prinny.webhook': { username: 'CI' } })).toEqual({
      id: 'CI',
      displayname: 'CI',
      hasFallback: false,
      isWebhook: true,
    });
    expect(
      getPerMessageProfile({
        [MSC]: { id: 'x', displayname: 'CI', 'in.prinny.webhook': { id: '9' } },
      })?.isWebhook,
    ).toBe(true);
  });

  it('rejects what the MSC rules out', () => {
    expect(getPerMessageProfile({ [MSC]: { displayname: 'no id' } })).toBeUndefined();
    expect(
      getPerMessageProfile({ [MSC]: { id: 'a'.repeat(256), displayname: 'x' } }),
    ).toBeUndefined();
    expect(getPerMessageProfile({ [MSC]: { id: 'a\0b' } })).toBeUndefined();
    const longName = getPerMessageProfile({ [MSC]: { id: 'x', displayname: 'é'.repeat(200) } });
    expect(longName?.displayname).toBeUndefined();
  });

  it('only honours mxc avatars, and accepts an encrypted avatar_file', () => {
    expect(
      getPerMessageProfile({ [MSC]: { id: 'x', avatar_url: 'https://evil.example/a.png' } })
        ?.avatarUrl,
    ).toBeUndefined();
    const file = {
      url: 'mxc://hs/enc',
      key: { k: 'k' },
      iv: 'iv',
      hashes: { sha256: 'h' },
      v: 'v2',
    };
    expect(getPerMessageProfile({ [MSC]: { id: 'x', avatar_file: file } })?.avatarFile).toEqual(
      file,
    );
    expect(
      getPerMessageProfile({ [MSC]: { id: 'x', avatar_file: { url: 'https://x' } } })?.avatarFile,
    ).toBeUndefined();
  });

  it('clamps a display name for the header', () => {
    expect(
      getPerMessageProfile({ [MSC]: { id: 'x', displayname: 'n'.repeat(120) } })?.displayname,
    ).toHaveLength(80);
  });

  it('returns undefined for ordinary messages', () => {
    expect(getPerMessageProfile({ body: 'hi' })).toBeUndefined();
  });
});

describe('profileGroupKey', () => {
  it('separates profiles of one sender and keeps plain messages apart from them', () => {
    expect(profileGroupKey({ [MSC]: { id: 'a' } })).not.toBe(
      profileGroupKey({ [MSC]: { id: 'b' } }),
    );
    expect(profileGroupKey({ body: 'x' })).toBe('');
    expect(profileGroupKey({ [MSC]: { id: 'a' } })).not.toBe('');
  });
});

describe('stripProfileFallback', () => {
  const profile = (name: string, hasFallback = true) => ({
    id: 'x',
    displayname: name,
    hasFallback,
    isWebhook: false,
  });

  it('removes the plain and HTML fallbacks', () => {
    expect(
      stripProfileFallback(
        {
          body: 'Deploy: shipped',
          formatted_body: '<strong data-mx-profile-fallback>Deploy: </strong>shipped',
        },
        profile('Deploy'),
      ),
    ).toEqual({ body: 'shipped', formatted_body: 'shipped' });
  });

  it('finds the HTML fallback inside a leading paragraph and with escaped names', () => {
    expect(
      stripProfileFallback(
        {
          body: 'A & B: hi',
          formatted_body: '<p><strong data-mx-profile-fallback="">A &amp; B: </strong>hi</p>',
        },
        profile('A & B'),
      ),
    ).toEqual({ body: 'hi', formatted_body: '<p>hi</p>' });
  });

  it('leaves content alone without has_fallback, or when the prefix does not match', () => {
    const content = { body: 'Deploy: shipped' };
    expect(stripProfileFallback(content, profile('Deploy', false))).toEqual(content);
    expect(stripProfileFallback({ body: 'Other: x' }, profile('Deploy'))).toEqual({
      body: 'Other: x',
    });
  });
});
