/**
 * Whether this browser can be handed an image on the clipboard.
 *
 * Needs a secure context for `navigator.clipboard`, so it is absent on a
 * plain-HTTP deployment rather than merely failing when used.
 */
export const clipboardCanHoldImages = (): boolean =>
  typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

/**
 * `ClipboardItem` is only dependable for PNG, so anything else is redrawn as
 * one. An animated GIF is flattened to its first frame by this — a still of the
 * right picture beats a copy that silently does nothing.
 */
const asPngBlob = async (blob: Blob): Promise<Blob> => {
  if (blob.type === 'image/png') return blob;

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d canvas context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('Could not convert the image');
  return png;
};

/** Puts an image on the clipboard as PNG, converting it first if needed. */
export const copyImageBlob = async (blob: Blob): Promise<void> => {
  const png = await asPngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
};
