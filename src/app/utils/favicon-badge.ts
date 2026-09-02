/**
 * Draws the unread count onto the favicon.
 *
 * The desktop shell already does this properly: `TaskbarBadgeUpdater` sums
 * `unread.total` across rooms and hands the number to `set_badge_count`, so a
 * Tauri user sees "17" on the dock icon. The web build computes the very same
 * number from the very same atom and then throws it away, picking between two
 * static images on a pair of booleans. This closes that gap — same count, same
 * meaning, rendered where a browser can show it.
 *
 * The mechanism is borrowed from the notification icon pipeline in
 * `desktop-notifications.ts`, which is the other place this app has to hand a
 * platform an image it generated. Desktop cannot take a data URI — Windows'
 * winrt-notification does `Path::new(icon)` on the string, so the Rust side
 * writes the bytes to the cache dir and passes back an absolute path. The web
 * has no such restriction, and `resolveBrowserIcon` there already relies on it:
 * fetch, encode, hand over a `data:` URI. `setFavicon` takes any URL, so the
 * same trick applies with a canvas standing in for the fetch.
 *
 * Verified rather than assumed, because this fails silently in two ways:
 *
 *  - Drawing an image into a canvas and calling `toDataURL` throws
 *    SecurityError if the canvas is tainted. Measured in Chromium: over
 *    `file://` it IS tainted and throws, because every file there is its own
 *    opaque origin; over http(s) the bundled SVG is same-origin and it works.
 *    The app is only ever served over http(s), but the failure is caught below
 *    regardless, because a favicon is not worth an exception on the unread path.
 *  - The base image is an SVG wrapping a base64 PNG. That embedded data URI
 *    does not taint the canvas, which is the reason this works at all.
 */

const BADGE_SIZE = 64;

// color.Primary.Main and color.Critical.Main from `colors.css.ts`. Hardcoded
// rather than imported: those are vanilla-extract theme contract values that
// resolve to CSS custom properties at runtime, and a canvas needs a real colour.
const UNREAD_COLOR = '#1245A8';
const HIGHLIGHT_COLOR = '#9D0F0F';

/** Keyed by everything that changes the pixels, so a re-render is a Map hit. */
const renderCache = new Map<string, string>();

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`favicon base image failed to load: ${src}`));
    img.src = src;
  });

/**
 * The base favicon with `count` badged onto it, as a PNG data URI.
 *
 * Resolves `undefined` when it cannot be produced, which the caller should read
 * as "use the static image" rather than as an error worth surfacing.
 */
export const renderFaviconWithBadge = async (
  baseSrc: string,
  count: number,
  highlight: boolean,
): Promise<string | undefined> => {
  if (count <= 0) return undefined;

  const cacheKey = `${baseSrc}|${count}|${highlight}`;
  const cached = renderCache.get(cacheKey);
  if (cached) return cached;

  try {
    const img = await loadImage(baseSrc);

    const canvas = document.createElement('canvas');
    canvas.width = BADGE_SIZE;
    canvas.height = BADGE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(img, 0, 0, BADGE_SIZE, BADGE_SIZE);

    // Three digits is where a tab-sized favicon stops being readable, so the
    // count saturates rather than shrinking the type until it is a smudge.
    const label = count > 99 ? '99+' : String(count);
    const wide = label.length > 2;
    const radius = wide ? 22 : 19;
    const cx = BADGE_SIZE - radius - 2;
    const cy = BADGE_SIZE - radius - 2;

    // A ring in the page background colour, so the badge still separates from
    // whatever part of the artwork it lands on at 16px.
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = highlight ? HIGHLIGHT_COLOR : UNREAD_COLOR;
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${wide ? 20 : 26}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 1);

    const dataUrl = canvas.toDataURL('image/png');
    renderCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    // Tainted canvas, a base image that would not decode, no 2d context —
    // whatever it was, the caller falls back to the static favicon.
    return undefined;
  }
};
