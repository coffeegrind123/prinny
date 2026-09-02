import { MatrixClient } from 'matrix-js-sdk';
import { ImagePack } from '../plugins/custom-emoji';
import { downloadMedia, mxcUrlToHttp } from './matrix';
import { mimeTypeToExt, safeDownloadFilename } from './mimeTypes';
import { createZip, ZipEntry } from './zip';
import FileSaver from './save-file';

const sanitizeSetName = (name: string): string => {
  const cleaned = name.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 64) || 'set';
};

/**
 * Downloads every image in a set as one .zip.
 *
 * Entries are named by shortcode, which is what the set is addressed by
 * everywhere else, with the extension taken from the declared mimetype and the
 * fetched blob as fallback. Shortcodes are unique within a set by definition,
 * but the collision counter stays because the extension is not part of the
 * shortcode — two entries can still collide once one is named.
 */
export const downloadImagePackZip = async (
  mx: MatrixClient,
  useAuthentication: boolean,
  pack: ImagePack,
): Promise<void> => {
  const images = Array.from(pack.images.collection.values());
  if (images.length === 0) return;

  const usedNames = new Set<string>();

  const entries: ZipEntry[] = await Promise.all(
    images.map(async (image) => {
      const httpUrl = mxcUrlToHttp(mx, image.url, useAuthentication);
      if (!httpUrl) throw new Error(`Could not resolve URL for ${image.shortcode}`);

      const blob = await downloadMedia(httpUrl);
      const ext = mimeTypeToExt(image.info?.mimetype || blob.type || '');
      const base = (image.shortcode || 'image').replace(/[/\\]/g, '_');
      let name = ext ? `${base}.${ext}` : base;

      let suffix = 1;
      while (usedNames.has(name)) {
        name = ext ? `${base}-${suffix}.${ext}` : `${base}-${suffix}`;
        suffix += 1;
      }
      usedNames.add(name);

      return { name, data: new Uint8Array(await blob.arrayBuffer()) };
    }),
  );

  // Same save path as every other download in the app, so the desktop and
  // Android shells route it the way they already know how to.
  const url = URL.createObjectURL(createZip(entries));
  FileSaver.saveAs(url, safeDownloadFilename(`${sanitizeSetName(pack.meta.name ?? pack.id)}.zip`));
  // The shells consume the blob asynchronously; revoking immediately can
  // cancel the save before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
