import { getBasePart, getEyesPart, getMouthPart, getSpecialPart } from './parts';

/**
 * Edge length of the PNG uploaded to the media repo. Custom emoji render at
 * around 24px inline and reactions smaller still, so 128 covers every display
 * density with room to spare and keeps each upload a few KB.
 */
export const MASHUP_PNG_SIZE = 128;

export const MASHUP_MIME_TYPE = 'image/png';

/**
 * Stacks four Twemoji layers into one SVG document.
 *
 * Concatenating the parts' markup works because they all share the 36×36
 * viewBox and carry no ids — see `assets/README.md`. Width and height are
 * stated explicitly so an `<img>` gets a deterministic intrinsic size; an SVG
 * with only a viewBox falls back to the browser's default object size, which
 * is not the same everywhere.
 *
 * Returns undefined when either half lacks the parts it is being asked for,
 * rather than composing a face with no eyes or no mouth.
 */
export const composeMashupSvg = (faceCode: string, mouthCode: string): string | undefined => {
  const base = getBasePart(faceCode);
  const eyes = getEyesPart(faceCode);
  if (!base || !eyes) return undefined;

  const mouth = getMouthPart(mouthCode);
  const special = getSpecialPart(mouthCode);
  if (!mouth && !special) return undefined;

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">' +
    `${base}${eyes}${mouth ?? ''}${special ?? ''}` +
    '</svg>'
  );
};

const MAX_CACHED_URIS = 512;
const uriCache = new Map<string, string>();

const cacheKey = (faceCode: string, mouthCode: string): string => `${faceCode}_${mouthCode}`;

/**
 * A `data:` URI for the composed mashup, ready for an `<img src>`.
 *
 * The picker draws a whole grid of these at once, so they are memoised. An
 * `encodeURIComponent` payload rather than base64: it is smaller for markup
 * and avoids a UTF-8 round trip through `btoa`, which throws on the non-ASCII
 * a re-vendored part could reintroduce.
 */
export const mashupDataUri = (faceCode: string, mouthCode: string): string | undefined => {
  const key = cacheKey(faceCode, mouthCode);
  const cached = uriCache.get(key);
  if (cached !== undefined) return cached;

  const svg = composeMashupSvg(faceCode, mouthCode);
  if (!svg) return undefined;

  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  if (uriCache.size >= MAX_CACHED_URIS) {
    // Oldest first — Map iterates in insertion order.
    const oldest = uriCache.keys().next();
    if (!oldest.done) uriCache.delete(oldest.value);
  }
  uriCache.set(key, uri);

  return uri;
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('emoji-mashup: the composed SVG failed to decode'));
    img.src = src;
  });

/**
 * Rasterises a mashup for upload. The canvas never becomes tainted: the source
 * is a `data:` URI built from markup that references nothing external.
 */
export const renderMashupPng = async (
  faceCode: string,
  mouthCode: string,
  size: number = MASHUP_PNG_SIZE
): Promise<Blob> => {
  const uri = mashupDataUri(faceCode, mouthCode);
  if (!uri) {
    throw new Error(`emoji-mashup: no parts for ${faceCode} + ${mouthCode}`);
  }

  const img = await loadImage(uri);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('emoji-mashup: no 2d canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, MASHUP_MIME_TYPE);
  });
  if (!blob) throw new Error('emoji-mashup: canvas produced no image');

  return blob;
};
