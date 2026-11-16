import { describe, expect, it } from 'vitest';
import { fxTweetToVx } from './fxtwitter';

// Trimmed from real api.fxtwitter.com and api.vxtwitter.com answers for the
// same tweets, captured 16.11.2026. Each case checks the converted fxtwitter
// answer against what vxtwitter itself returned, field by field.

const video = {
  code: 200,
  message: 'OK',
  tweet: {
    url: 'https://x.com/someone/status/2100884296617890168',
    id: '2100884296617890168',
    text: 'clip',
    author: { name: 'Some One', screen_name: 'someone' },
    replies: 117,
    retweets: 14440,
    likes: 182032,
    media: {
      all: [
        {
          id: '2100882818276675584',
          url: 'https://video.twimg.com/amplify_video/2100882818276675584/vid/avc1/1080x1620/V6Uj.mp4?tag=29',
          thumbnail_url:
            'https://pbs.twimg.com/amplify_video_thumb/2100882818276675584/img/o0tL.jpg',
          duration: 80.085,
          width: 1080,
          height: 1620,
          format: 'video/mp4',
          type: 'video',
        },
      ],
    },
  },
};

const mixed = {
  code: 200,
  tweet: {
    url: 'https://x.com/brewer/status/1760638922084741177',
    id: '1760638922084741177',
    text: 'beer',
    author: { name: 'Brewer', screen_name: 'brewer' },
    media: {
      all: [
        {
          type: 'photo',
          url: 'https://pbs.twimg.com/media/GG8LwfuWoAANKhs.jpg?name=orig',
          width: 858,
          height: 960,
          altText: 'a glass',
        },
        {
          url: 'https://video.twimg.com/tweet_video/GG8LwqWX0AAZch0.mp4',
          thumbnail_url: 'https://pbs.twimg.com/tweet_video_thumb/GG8LwqWX0AAZch0.jpg',
          duration: 0,
          width: 500,
          height: 500,
          type: 'gif',
        },
      ],
    },
  },
};

const quote = {
  code: 200,
  tweet: {
    url: 'https://x.com/dev/status/1674561759422578690',
    id: '1674561759422578690',
    text: 'good',
    author: { name: 'Dev', screen_name: 'dev' },
    media: null,
    quote: {
      url: 'https://x.com/Teazu/status/1674197531301904388',
      id: '1674197531301904388',
      text: 'ok',
      author: { name: 'Teazu', screen_name: 'Teazu' },
      media: {
        all: [
          {
            url: 'https://video.twimg.com/ext_tw_video/1674197418978557955/pu/vid/854x480/bpsc.mp4?tag=12',
            duration: 12.5,
            width: 854,
            height: 480,
            type: 'video',
          },
        ],
      },
      quote: { id: 'deeper', text: 'never drawn' },
    },
  },
};

describe('fxTweetToVx', () => {
  it('converts a video tweet into the vxtwitter shape', () => {
    expect(fxTweetToVx(video)).toEqual({
      tweetID: '2100884296617890168',
      tweetURL: 'https://x.com/someone/status/2100884296617890168',
      text: 'clip',
      user_name: 'Some One',
      user_screen_name: 'someone',
      likes: 182032,
      replies: 117,
      retweets: 14440,
      hasMedia: true,
      media_extended: [
        {
          type: 'video',
          url: 'https://video.twimg.com/amplify_video/2100882818276675584/vid/avc1/1080x1620/V6Uj.mp4?tag=29',
          thumbnail_url:
            'https://pbs.twimg.com/amplify_video_thumb/2100882818276675584/img/o0tL.jpg',
          duration_millis: 80085,
          size: { width: 1080, height: 1620 },
          altText: null,
        },
      ],
      qrt: null,
      qrtURL: null,
    });
  });

  it('maps photo to image and keeps a GIF as a zero-length gif', () => {
    const vx = fxTweetToVx(mixed);
    expect(vx.media_extended).toEqual([
      {
        type: 'image',
        url: 'https://pbs.twimg.com/media/GG8LwfuWoAANKhs.jpg?name=orig',
        thumbnail_url: undefined,
        duration_millis: undefined,
        size: { width: 858, height: 960 },
        altText: 'a glass',
      },
      {
        type: 'gif',
        url: 'https://video.twimg.com/tweet_video/GG8LwqWX0AAZch0.mp4',
        thumbnail_url: 'https://pbs.twimg.com/tweet_video_thumb/GG8LwqWX0AAZch0.jpg',
        duration_millis: 0,
        size: { width: 500, height: 500 },
        altText: null,
      },
    ]);
  });

  it('nests a quoted tweet one level deep, like vxtwitter', () => {
    const vx = fxTweetToVx(quote);
    expect(vx.hasMedia).toBe(false);
    expect(vx.media_extended).toEqual([]);
    expect(vx.qrtURL).toBe('https://x.com/Teazu/status/1674197531301904388');
    expect(vx.qrt.tweetID).toBe('1674197531301904388');
    expect(vx.qrt.user_screen_name).toBe('Teazu');
    expect(vx.qrt.media_extended[0].duration_millis).toBe(12500);
    expect(vx.qrt.qrt).toBeNull();
  });

  it('rejects an answer with no tweet in it', () => {
    expect(() => fxTweetToVx({ code: 404, message: 'NOT_FOUND', tweet: null })).toThrow();
    expect(() => fxTweetToVx('nope')).toThrow();
    expect(() => fxTweetToVx({ code: 200, tweet: { text: 'no id' } })).toThrow();
  });

  it('drops media without a usable https url', () => {
    const vx = fxTweetToVx({
      code: 200,
      tweet: {
        id: '1',
        media: { all: [{ type: 'photo', url: 'javascript:alert(1)' }, { type: 'photo' }] },
      },
    });
    expect(vx.media_extended).toEqual([]);
    expect(vx.hasMedia).toBe(false);
  });
});
