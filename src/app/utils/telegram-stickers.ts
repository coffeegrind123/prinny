/**
 * Import a Telegram sticker pack into a Matrix image pack.
 *
 * Why a bot token is required, and why there is no way around it: the
 * `t.me/addstickers/<name>` link is a deep link, not a data source. That page
 * carries a generic title, Telegram's own logo as its og:image, an empty
 * description, and not a single reference to any sticker file — so there is
 * nothing to scrape. Telegram exposes sticker sets only through the Bot API,
 * which returns 401 without a token.
 *
 * The one piece of good news is that no server or proxy is needed: both
 * `api.telegram.org/bot<TOKEN>/...` and the file host
 * `api.telegram.org/file/bot<TOKEN>/...` answer with
 * `access-control-allow-origin: *`, so the whole import runs in the browser.
 *
 * Only static WebP stickers are imported. A Telegram pack can also hold
 * animated (`.tgs`, gzipped Lottie JSON) and video (`.webm`) stickers, and a
 * Matrix image pack stores plain images by mxc URI — neither of those would
 * render. They are counted and reported rather than silently dropped.
 */

const TELEGRAM_API = 'https://api.telegram.org';

/** Matches t.me/addstickers/<name> and the addemoji variant, http or https. */
const ADD_STICKERS_RE =
  /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/add(?:stickers|emoji)\/([A-Za-z0-9_]+)/;

export type TelegramSticker = {
  file_id: string;
  file_unique_id: string;
  emoji?: string;
  is_animated: boolean;
  is_video: boolean;
};

export type TelegramStickerSet = {
  name: string;
  title: string;
  stickers: TelegramSticker[];
};

export type TelegramImportResult = {
  /** Pack title as Telegram reports it, for naming the Matrix pack. */
  title: string;
  files: File[];
  /** Stickers left behind because Matrix image packs cannot render them. */
  skippedAnimated: number;
  skippedVideo: number;
};

/**
 * Extract the sticker set name from a t.me link, or from a bare set name typed
 * on its own. Returns null when the input is neither.
 */
export const parseStickerSetName = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(ADD_STICKERS_RE);
  if (match) return match[1];

  // A bare set name is what Telegram itself shows people, so accept it too.
  if (/^[A-Za-z0-9_]+$/.test(trimmed)) return trimmed;

  return null;
};

class TelegramApiError extends Error {}

const callTelegram = async <T>(token: string, method: string, params: string): Promise<T> => {
  const resp = await fetch(`${TELEGRAM_API}/bot${token}/${method}?${params}`);
  const data = await resp.json().catch(() => null);

  if (!resp.ok || !data?.ok) {
    // Telegram's own description is far more useful than the status code
    // ("STICKERSET_INVALID", "Unauthorized"), so surface it verbatim.
    const description = data?.description ?? `HTTP ${resp.status}`;
    throw new TelegramApiError(description);
  }

  return data.result as T;
};

const sanitizeShortcode = (value: string, fallback: string): string => {
  // Shortcodes address an emote in a room; keep them to a conservative set
  // rather than trusting a pack author's naming.
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
};

/**
 * Fetch a sticker set and download its static stickers as `File`s, ready to go
 * through the pack's normal upload path.
 *
 * `onProgress` reports completed downloads so a long pack can show movement.
 */
export const fetchTelegramStickerPack = async (
  token: string,
  setName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<TelegramImportResult> => {
  const set = await callTelegram<TelegramStickerSet>(
    token,
    'getStickerSet',
    `name=${encodeURIComponent(setName)}`,
  );

  const stickers = Array.isArray(set.stickers) ? set.stickers : [];
  const staticStickers = stickers.filter((s) => !s.is_animated && !s.is_video);
  const skippedAnimated = stickers.filter((s) => s.is_animated).length;
  const skippedVideo = stickers.filter((s) => s.is_video && !s.is_animated).length;

  const files: File[] = [];
  let done = 0;

  // Sequential on purpose. Telegram rate-limits the Bot API per token, and a
  // pack can hold 120 stickers; firing all of them at once earns a 429 that
  // fails the whole import rather than slowing it down.
  for (let i = 0; i < staticStickers.length; i += 1) {
    const sticker = staticStickers[i];

    const fileInfo = await callTelegram<{ file_path?: string }>(
      token,
      'getFile',
      `file_id=${encodeURIComponent(sticker.file_id)}`,
    );

    if (fileInfo.file_path) {
      const resp = await fetch(`${TELEGRAM_API}/file/bot${token}/${fileInfo.file_path}`);
      if (resp.ok) {
        const blob = await resp.blob();
        const shortcode = sanitizeShortcode(sticker.emoji ?? '', `${setName}_${i + 1}`);
        files.push(new File([blob], `${shortcode}.webp`, { type: blob.type || 'image/webp' }));
      }
    }

    done += 1;
    onProgress?.(done, staticStickers.length);
  }

  return {
    title: set.title || setName,
    files,
    skippedAnimated,
    skippedVideo,
  };
};
