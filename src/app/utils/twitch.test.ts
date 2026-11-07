import { describe, expect, it } from 'vitest';
import { getTwitchTarget, twitchEmbedUrl } from './twitch';

describe('getTwitchTarget', () => {
  it('reads channels, VODs and clips in the forms people share', () => {
    expect(getTwitchTarget('https://www.twitch.tv/SomeStreamer')).toEqual({
      kind: 'channel',
      channel: 'somestreamer',
    });
    expect(getTwitchTarget('https://m.twitch.tv/somestreamer?sr=a')).toEqual({
      kind: 'channel',
      channel: 'somestreamer',
    });
    expect(getTwitchTarget('https://www.twitch.tv/videos/2291234567?t=1h2m')).toEqual({
      kind: 'video',
      id: '2291234567',
    });
    expect(getTwitchTarget('https://www.twitch.tv/somestreamer/v/12345')).toEqual({
      kind: 'video',
      id: '12345',
    });
    expect(getTwitchTarget('https://www.twitch.tv/somestreamer/clip/Funny-Clip_ab12')).toEqual({
      kind: 'clip',
      slug: 'Funny-Clip_ab12',
    });
    expect(getTwitchTarget('https://clips.twitch.tv/FunnyClipAb12')).toEqual({
      kind: 'clip',
      slug: 'FunnyClipAb12',
    });
    expect(getTwitchTarget('https://clips.twitch.tv/embed?clip=FunnyClipAb12&parent=x')).toEqual({
      kind: 'clip',
      slug: 'FunnyClipAb12',
    });
    expect(getTwitchTarget('https://player.twitch.tv/?video=v12345&parent=x')).toEqual({
      kind: 'video',
      id: '12345',
    });
  });

  it('leaves Twitch pages that are not a stream, VOD or clip alone', () => {
    for (const url of [
      'https://www.twitch.tv/',
      'https://www.twitch.tv/directory',
      'https://www.twitch.tv/directory/category/just-chatting',
      'https://www.twitch.tv/settings/profile',
      'https://www.twitch.tv/somestreamer/about',
      'https://www.twitch.tv/videos/notanumber',
      'https://www.twitch.tv/some.one',
      'https://www.twitch.tv/somestreamer/clip/bad%20slug',
      'https://dev.twitch.tv/docs',
      'https://twitch.tv.evil.example/somestreamer',
      'javascript:alert(1)//twitch.tv/x',
      'not a url',
    ]) {
      expect(getTwitchTarget(url), url).toBeNull();
    }
  });
});

describe('twitchEmbedUrl', () => {
  it('builds the player URL for the embedding host, without autoplay', () => {
    expect(twitchEmbedUrl({ kind: 'channel', channel: 'somestreamer' }, 'prinny.app')).toBe(
      'https://player.twitch.tv/?channel=somestreamer&parent=prinny.app&autoplay=false',
    );
    expect(twitchEmbedUrl({ kind: 'video', id: '12345' }, 'localhost')).toBe(
      'https://player.twitch.tv/?video=12345&parent=localhost&autoplay=false',
    );
    expect(twitchEmbedUrl({ kind: 'clip', slug: 'Funny-Clip' }, 'prinny.app')).toBe(
      'https://clips.twitch.tv/embed?clip=Funny-Clip&parent=prinny.app&autoplay=false',
    );
  });
});
