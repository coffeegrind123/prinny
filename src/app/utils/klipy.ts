// GIF search: Klipy by default, Tenor or Giphy when a key is configured.
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

export type GifProviderId = 'klipy' | 'tenor' | 'giphy';

/**
 * Keys for the providers that ship without one. Tenor and Giphy each need a
 * key of their own, from `gifApiKeys` in config.json or the VITE_TENOR_API_KEY /
 * VITE_GIPHY_API_KEY build variables; without one the provider is unavailable.
 */
export type GifApiKeys = { tenor?: string; giphy?: string };

export const GIF_PROVIDERS: { id: GifProviderId; label: string; host: string }[] = [
  { id: 'klipy', label: 'Klipy', host: 'klipy.com' },
  { id: 'tenor', label: 'Tenor', host: 'tenor.googleapis.com' },
  { id: 'giphy', label: 'Giphy', host: 'giphy.com' },
];

export type GifSource = { id: GifProviderId; key: string };

export const gifProviderKey = (id: GifProviderId, keys?: GifApiKeys): string | undefined => {
  if (id === 'klipy') return KLIPY_API_KEY;
  if (id === 'tenor') return keys?.tenor || import.meta.env.VITE_TENOR_API_KEY || undefined;
  return keys?.giphy || import.meta.env.VITE_GIPHY_API_KEY || undefined;
};

/** The chosen provider, or Klipy when the chosen one has no key. */
export const resolveGifSource = (id: GifProviderId, keys?: GifApiKeys): GifSource => {
  const key = gifProviderKey(id, keys);
  return key ? { id, key } : { id: 'klipy', key: KLIPY_API_KEY };
};

// Klipy's v2 API is Tenor's v2 API, so both share a request and a shape.
const TENOR_STYLE_BASE: Record<'klipy' | 'tenor', string> = {
  klipy: KLIPY_BASE_URL,
  tenor: 'https://tenor.googleapis.com/v2',
};

const doRequest = async (url: URL, signal?: AbortSignal): Promise<unknown> => {
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    throw new Error(`GIF request failed: HTTP ${resp.status}`);
  }
  return resp.json();
};

export type KlipyPage = {
  gifs: KlipyGif[];
  next: string | undefined;
};

const PAGE_SIZE = 40;

type GiphyRendition = { mp4?: string; mp4_size?: string; width?: string; height?: string };
type GiphyResponse = {
  data?: {
    id: string;
    title?: string;
    url?: string;
    images?: { original?: GiphyRendition; fixed_width?: GiphyRendition };
  }[];
  pagination?: { total_count?: number; count?: number; offset?: number };
};

const giphyFormat = (r?: GiphyRendition): KlipyMediaFormat | undefined => {
  if (!r?.mp4) return undefined;
  const width = Number(r.width);
  const height = Number(r.height);
  const size = Number(r.mp4_size);
  return {
    url: r.mp4,
    dims: width > 0 && height > 0 ? [width, height] : undefined,
    size: size > 0 ? size : undefined,
  };
};

/** Giphy in the Tenor shape the picker and favourites already store. */
const fromGiphy = (data: GiphyResponse): KlipyPage => {
  const gifs = (data.data ?? []).map((item): KlipyGif => ({
    id: `giphy:${item.id}`,
    title: item.title ?? '',
    itemurl: item.url,
    media_formats: {
      mp4: giphyFormat(item.images?.original),
      tinymp4: giphyFormat(item.images?.fixed_width),
    },
  }));
  const { offset = 0, count = 0, total_count: total = 0 } = data.pagination ?? {};
  const nextOffset = offset + count;
  return { gifs, next: count > 0 && nextOffset < total ? String(nextOffset) : undefined };
};

const fetchPage = async (
  source: GifSource,
  query: string,
  pos: string | undefined,
  signal?: AbortSignal,
): Promise<KlipyPage> => {
  if (source.id === 'giphy') {
    const url = new URL(`https://api.giphy.com/v1/gifs/${query ? 'search' : 'trending'}`);
    url.searchParams.set('api_key', source.key);
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (pos) url.searchParams.set('offset', pos);
    return fromGiphy((await doRequest(url, signal)) as GiphyResponse);
  }

  const url = new URL(`${TENOR_STYLE_BASE[source.id]}/${query ? 'search' : 'featured'}`);
  url.searchParams.set('key', source.key);
  if (query) url.searchParams.set('q', query);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('media_filter', MEDIA_FILTER);
  if (pos) url.searchParams.set('pos', pos);
  const data = (await doRequest(url, signal)) as KlipyResponse;
  return { gifs: data.results ?? [], next: data.next || undefined };
};

export const fetchTrendingGifs = (
  source: GifSource,
  pos?: string,
  signal?: AbortSignal,
): Promise<KlipyPage> => fetchPage(source, '', pos, signal);

export const searchGifs = (
  source: GifSource,
  query: string,
  pos?: string,
  signal?: AbortSignal,
): Promise<KlipyPage> => fetchPage(source, query, pos, signal);

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
