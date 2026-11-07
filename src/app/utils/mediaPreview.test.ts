import { describe, expect, it } from 'vitest';
import {
  MEDIA_PREVIEW_STABLE,
  MEDIA_PREVIEW_UNSTABLE,
  isPrivateJoinRule,
  mediaPreviewWrites,
  mediaPreviewsAllowed,
  parseMediaPreviewContent,
  readMediaPreviewLevel,
  resolveMediaPreviewConfig,
} from './mediaPreview';

describe('parseMediaPreviewContent', () => {
  it('keeps known values', () => {
    expect(parseMediaPreviewContent({ media_previews: 'private', invite_avatars: 'on' })).toEqual({
      media_previews: 'private',
      invite_avatars: 'on',
    });
  });

  it('treats unknown values as off', () => {
    expect(
      parseMediaPreviewContent({ media_previews: 'friends', invite_avatars: 'private' }),
    ).toEqual({
      media_previews: 'off',
      invite_avatars: 'off',
    });
    expect(parseMediaPreviewContent({ media_previews: null })).toEqual({ media_previews: 'off' });
  });

  it('leaves absent keys absent', () => {
    expect(parseMediaPreviewContent({})).toEqual({});
    expect(parseMediaPreviewContent(undefined)).toEqual({});
    expect(parseMediaPreviewContent(['on'])).toEqual({});
  });
});

describe('readMediaPreviewLevel', () => {
  it('prefers the stable type over the unstable one', () => {
    expect(
      readMediaPreviewLevel({
        [MEDIA_PREVIEW_STABLE]: { media_previews: 'off' },
        [MEDIA_PREVIEW_UNSTABLE]: { media_previews: 'on', invite_avatars: 'off' },
      }),
    ).toEqual({ media_previews: 'off' });
  });

  it('falls back to the unstable type', () => {
    expect(readMediaPreviewLevel({ [MEDIA_PREVIEW_UNSTABLE]: { invite_avatars: 'off' } })).toEqual({
      invite_avatars: 'off',
    });
  });
});

describe('resolveMediaPreviewConfig', () => {
  it('defaults to on', () => {
    expect(resolveMediaPreviewConfig({})).toEqual({ media_previews: 'on', invite_avatars: 'on' });
  });

  it('lets room keys override global keys one by one (the MSC example)', () => {
    expect(
      resolveMediaPreviewConfig(
        { media_previews: 'off', invite_avatars: 'off' },
        { media_previews: 'on' },
      ),
    ).toEqual({ media_previews: 'on', invite_avatars: 'off' });
  });
});

describe('mediaPreviewsAllowed', () => {
  it('on allows everywhere, off nowhere', () => {
    expect(mediaPreviewsAllowed('on', undefined)).toBe(true);
    expect(mediaPreviewsAllowed('off', 'invite')).toBe(false);
  });

  it('private allows only private join rules', () => {
    for (const rule of ['invite', 'knock', 'restricted', 'knock_restricted']) {
      expect(isPrivateJoinRule(rule)).toBe(true);
      expect(mediaPreviewsAllowed('private', rule)).toBe(true);
    }
    for (const rule of ['public', 'private', 'something_new', undefined, null, 3]) {
      expect(mediaPreviewsAllowed('private', rule)).toBe(false);
    }
  });
});

describe('mediaPreviewWrites', () => {
  it('writes stable and unstable with the same content', () => {
    const writes = mediaPreviewWrites({ media_previews: 'private', invite_avatars: 'off' });
    expect(Object.keys(writes)).toEqual([MEDIA_PREVIEW_STABLE, MEDIA_PREVIEW_UNSTABLE]);
    expect(writes[MEDIA_PREVIEW_STABLE]).toEqual({
      media_previews: 'private',
      invite_avatars: 'off',
    });
    expect(writes[MEDIA_PREVIEW_UNSTABLE]).toEqual(writes[MEDIA_PREVIEW_STABLE]);
    expect(writes[MEDIA_PREVIEW_UNSTABLE]).not.toBe(writes[MEDIA_PREVIEW_STABLE]);
  });
});
