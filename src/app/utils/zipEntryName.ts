import { mimeTypeToExt } from './mimeTypes';

// A plain extension: what image/png, image/webp or image/svg+xml give. Anything
// else in a mimetype (which the pack's editor sets) is dropped, not cleaned.
const SAFE_EXT = /^[a-z0-9][a-z0-9+]{0,9}$/i;
// Path separators, Windows-reserved characters (":" also names a drive or an
// NTFS stream) and control characters.
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const FALLBACK_BASE = 'image';

/**
 * The file name for one image in a downloaded pack zip.
 *
 * The shortcode and the mimetype both come from whoever edits the pack, and
 * the extension used to be everything after the mimetype's last "/". A
 * mimetype of `x/..\..\evil` made the entry `smile..\..\evil`, a path that
 * leaves the extraction folder in extractors that treat "\" as a separator.
 * The name is now one path segment: no separators, no reserved characters,
 * no leading dots, and an extension only when it is a plain one.
 */
export const zipEntryName = (shortcode: string, mimeType: string): string => {
  const base =
    shortcode.replace(UNSAFE_NAME_CHARS, '_').replace(/^\.+/, '').replace(/\.+$/, '') ||
    FALLBACK_BASE;
  const ext = mimeTypeToExt(mimeType);
  return SAFE_EXT.test(ext) ? `${base}.${ext}` : base;
};
