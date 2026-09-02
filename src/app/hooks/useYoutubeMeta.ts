import { useEffect, useState } from 'react';
import { pipedStreamsUrl } from '../utils/piped';

export type YoutubeMeta = {
  title?: string;
  /** Channel name, shown where the card would otherwise print `og:site_name`. */
  author?: string;
};

/**
 * The title of a YouTube video, fetched from whichever host the card is
 * already embedding from.
 *
 * The homeserver's own preview is not a reliable source here and never was:
 * YouTube serves Synapse's fetcher a consent interstitial or a 403 far more
 * often than it serves the watch page, so `og:title` arrives empty, generic
 * ("YouTube"), or not at all — and the card then draws a player with no idea
 * what is in it.
 *
 * Which host is asked is decided by the same setting that decides the embed,
 * so this discloses nothing the iframe below it was not about to disclose
 * anyway:
 *
 *  - Piped on  → `<instance API>/streams/<id>`, the instance already in the
 *    iframe src. Never the frontend origin: that answers `/streams/<id>` with
 *    the SPA's HTML, so it would parse as a failure at best.
 *  - Piped off → `youtube.com/oembed`, the origin already in the iframe src.
 *
 * Both were verified against the live endpoints, including CORS and (for
 * oEmbed) the preflight. A failure is not reported: the caller falls back to
 * whatever the homeserver managed to scrape, which is what it used to do for
 * every video.
 */
export function useYoutubeMeta(
  videoId: string | null,
  usePiped: boolean,
  pipedBase: string,
): YoutubeMeta {
  const [meta, setMeta] = useState<YoutubeMeta>({});

  useEffect(() => {
    setMeta({});
    if (!videoId) return undefined;

    const endpoint = usePiped
      ? pipedStreamsUrl(pipedBase, videoId)
      : `https://www.youtube.com/oembed?url=${encodeURIComponent(
          `https://www.youtube.com/watch?v=${videoId}`,
        )}&format=json`;
    // No API host on file for this instance — asking the frontend origin would
    // return HTML, so we do not ask at all.
    if (!endpoint) return undefined;

    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Metadata request failed: ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (typeof data !== 'object' || data === null) return;
        const record = data as Record<string, unknown>;
        // Piped calls them `title`/`uploader`; oEmbed `title`/`author_name`.
        const title = record.title;
        const author = record.uploader ?? record.author_name;
        setMeta({
          title: typeof title === 'string' && title ? title : undefined,
          author: typeof author === 'string' && author ? author : undefined,
        });
      })
      .catch(() => {
        // Including AbortError on unmount. The card renders without us.
      });

    return () => controller.abort();
  }, [videoId, usePiped, pipedBase]);

  return meta;
}
