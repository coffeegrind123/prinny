// Klipy GIF API client.
// Klipy is a free GIF API service: https://docs.klipy.com
//
// The key is a free-tier, client-side key — it identifies the app, not the
// user, and Klipy expects it in the query string. Set `VITE_KLIPY_API_KEY` at
// build time to use your own; the fallback below is the one the upstream fork
// ships, and it is shared with every deployment that never set the variable,
// so it will be rate-limited accordingly. Get one at https://docs.klipy.com
const KLIPY_API_KEY =
  import.meta.env.VITE_KLIPY_API_KEY ||
  'Qy1TVEgEphESxOxmLkKghRD6O0ZZB7TOBTEKZavPBoZcmfUWv2ydB3NzjKguRvTR';

const KLIPY_BASE_URL = 'https://api.klipy.com/v2';

// We only request the formats we actually use: tinymp4 for the picker
// thumbnails and mp4 for the file we upload and send.
const MEDIA_FILTER = 'tinymp4,mp4';

export type KlipyMediaFormat = {
  url: string;
  duration?: number;
  preview?: string;
  dims?: [number, number];
  size?: number;
};

export type KlipyGif = {
  id: string;
  title: string;
  media_formats: {
    tinymp4?: KlipyMediaFormat;
    mp4?: KlipyMediaFormat;
    tinygif?: KlipyMediaFormat;
    mediumgif?: KlipyMediaFormat;
    [key: string]: KlipyMediaFormat | undefined;
  };
  url?: string;
  itemurl?: string;
  tags?: string[];
};

type KlipyResponse = {
  results?: KlipyGif[];
  next?: string;
};

const doRequest = async (url: URL, signal?: AbortSignal): Promise<KlipyResponse> => {
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    throw new Error(`Klipy request failed: HTTP ${resp.status}`);
  }
  return (await resp.json()) as KlipyResponse;
};

export type KlipyPage = {
  gifs: KlipyGif[];
  next: string | undefined;
};

export const fetchTrendingGifs = async (pos?: string, signal?: AbortSignal): Promise<KlipyPage> => {
  const url = new URL(`${KLIPY_BASE_URL}/featured`);
  url.searchParams.set('key', KLIPY_API_KEY);
  url.searchParams.set('limit', '40');
  url.searchParams.set('media_filter', MEDIA_FILTER);
  if (pos) url.searchParams.set('pos', pos);
  const data = await doRequest(url, signal);
  return { gifs: data.results ?? [], next: data.next };
};

export const searchGifs = async (
  query: string,
  pos?: string,
  signal?: AbortSignal,
): Promise<KlipyPage> => {
  const url = new URL(`${KLIPY_BASE_URL}/search`);
  url.searchParams.set('key', KLIPY_API_KEY);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '40');
  url.searchParams.set('media_filter', MEDIA_FILTER);
  if (pos) url.searchParams.set('pos', pos);
  const data = await doRequest(url, signal);
  return { gifs: data.results ?? [], next: data.next };
};

// Old saved favourites can still contain GIF-only formats, so retain those as
// fallbacks even though new API requests only load MP4s.
export const getGifToSend = (gif: KlipyGif): KlipyMediaFormat | undefined =>
  gif.media_formats.mp4 ??
  gif.media_formats.tinymp4 ??
  gif.media_formats.mediumgif ??
  gif.media_formats.tinygif;

// Pick the format to display as a thumbnail in the picker grid.
export const getGifPreview = (gif: KlipyGif): KlipyMediaFormat | undefined =>
  gif.media_formats.tinymp4 ??
  gif.media_formats.mp4 ??
  gif.media_formats.tinygif ??
  gif.media_formats.mediumgif;

export const isGifVideo = (format: KlipyMediaFormat): boolean =>
  /\.mp4(?:$|[?#])/i.test(format.url);
