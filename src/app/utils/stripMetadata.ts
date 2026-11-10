/**
 * Removes privacy-relevant metadata from JPEG, PNG and WebP files without
 * re-encoding the pixels: GPS position, camera and lens, timestamps, XMP,
 * IPTC, comments and embedded extra images. Colour profiles are kept, and so
 * is a JPEG's orientation, as a minimal EXIF block, so photos do not turn
 * sideways.
 *
 * Anything unexpected makes the parser give up (`undefined`), and the caller
 * then uploads the original: a file that is sent unchanged is better than one
 * that is sent broken.
 *
 * Based on largelanguagemeowing/cinny 760e8df3, plus: data after the JPEG's
 * end-of-image marker is dropped (MPF secondary images, Ultra HDR gain maps
 * and motion-photo video, each of which can carry its own EXIF), the
 * orientation block goes after JFIF rather than before it, PNG stops at IEND
 * and keeps its orientation too, and WebP is handled.
 */

const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_SOS = 0xda;
const JPEG_APP0 = 0xe0;
const JPEG_APP1 = 0xe1; // EXIF, XMP
const JPEG_APP2 = 0xe2; // ICC profile (kept), MPF index (dropped)
const JPEG_APP11 = 0xeb; // JUMBF: C2PA content credentials
const JPEG_APP13 = 0xed; // Photoshop IRB / IPTC
const JPEG_COM = 0xfe;
const TIFF_ORIENTATION = 0x0112;

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
  });
  return out;
};

/** Orientation (1-8) from the IFD0 of the TIFF structure EXIF is stored as. */
const readOrientation = (view: DataView, tiff: number, end: number): number | undefined => {
  if (tiff + 8 > end) return undefined;
  const order = view.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return undefined;

  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return undefined;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (view.getUint16(entry, little) === TIFF_ORIENTATION) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
};

const keepsOrientation = (orientation: number | undefined): orientation is number =>
  orientation !== undefined && orientation !== 1;

/** A big-endian TIFF holding one IFD0 entry, Orientation, and nothing else. */
const orientationTiff = (orientation: number): Uint8Array => {
  const out = new Uint8Array(26);
  const view = new DataView(out.buffer);
  out.set([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]); // "MM", 42, IFD0 at 8
  view.setUint16(8, 1); // one entry
  view.setUint16(10, TIFF_ORIENTATION);
  view.setUint16(12, 3); // SHORT
  view.setUint32(14, 1); // count
  view.setUint16(18, orientation);
  // next-IFD offset (bytes 22-25) stays 0
  return out;
};

/** JPEG APP1 "Exif\0\0" segment carrying only the orientation. */
const orientationSegment = (orientation: number): Uint8Array => {
  const tiff = orientationTiff(orientation);
  const out = new Uint8Array(4 + 6 + tiff.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xff00 | JPEG_APP1);
  view.setUint16(2, out.length - 2);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
  out.set(tiff, 10);
  return out;
};

const isMetadataSegment = (bytes: Uint8Array, marker: number, pos: number, end: number) => {
  if (marker === JPEG_APP1 || marker === JPEG_APP11 || marker === JPEG_APP13) return true;
  if (marker === JPEG_COM) return true;
  // MPF points at the extra images after EOI, which are removed.
  return marker === JPEG_APP2 && end - pos >= 8 && ascii(bytes, pos + 4, 4) === 'MPF\0';
};

/**
 * Index just past the EOI that ends the entropy-coded data starting at `pos`,
 * or the index of the next marker segment when the scan is followed by more
 * tables and scans (progressive JPEG). In the scan, FF is followed by 00
 * (stuffing), D0-D7 (restart) or FF (fill); anything else is a marker.
 */
const scanEnd = (bytes: Uint8Array, pos: number): { next: number; eoi: boolean } | undefined => {
  for (let i = pos; i + 1 < bytes.length; i += 1) {
    if (bytes[i] !== 0xff) continue;
    const next = bytes[i + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      i += 1;
      continue;
    }
    if (next === 0xff) continue;
    if (next === JPEG_EOI) return { next: i + 2, eoi: true };
    return { next: i, eoi: false };
  }
  return undefined;
};

const stripJpeg = (bytes: Uint8Array): Uint8Array<ArrayBuffer> | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientation: number | undefined;
  // Where the orientation block goes: after SOI, or after a leading APP0.
  let insertAt = 1;
  let pos = 2;

  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return undefined;
    const marker = bytes[pos + 1];

    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === JPEG_EOI || marker === JPEG_SOI) return undefined; // no image data
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }

    const length = view.getUint16(pos + 2);
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) return undefined;

    if (marker === JPEG_SOS) {
      const scan = scanEnd(bytes, end);
      if (!scan) return undefined;
      parts.push(bytes.subarray(pos, scan.next));
      if (scan.eoi) {
        // Everything after the primary image's EOI is dropped.
        if (keepsOrientation(orientation)) {
          parts.splice(insertAt, 0, orientationSegment(orientation));
        }
        return concat(parts);
      }
      pos = scan.next;
      continue;
    }

    if (marker === JPEG_APP1 && length >= 8 && ascii(bytes, pos + 4, 4) === 'Exif') {
      orientation ??= readOrientation(view, pos + 10, end);
    }
    if (!isMetadataSegment(bytes, marker, pos, end)) {
      parts.push(bytes.subarray(pos, end));
      if (marker === JPEG_APP0 && parts.length === 2) insertAt = 2;
    }
    pos = end;
  }
  return undefined;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// eXIf: EXIF; tEXt/iTXt/zTXt: text including XMP; tIME: last edit;
// caBX: C2PA content credentials.
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME', 'caBX']);
const PNG_MAX_CHUNK = 0x7fffffff;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** PNG chunk CRC: CRC-32 over the type and data. */
const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  data.forEach((b) => {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  });
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(
    Array.from(type, (ch) => ch.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const stripPng = (bytes: Uint8Array): Uint8Array<ArrayBuffer> | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos);
    if (length > PNG_MAX_CHUNK) return undefined;
    const end = pos + 12 + length;
    if (end > bytes.length) return undefined;
    const type = ascii(bytes, pos + 4, 4);
    if (type === 'eXIf') {
      const orientation = readOrientation(view, pos + 8, end - 4);
      if (keepsOrientation(orientation)) parts.push(pngChunk('eXIf', orientationTiff(orientation)));
    } else if (!PNG_DROP.has(type)) {
      parts.push(bytes.subarray(pos, end));
    }
    if (type === 'IEND') return concat(parts);
    pos = end;
  }
  return undefined;
};

const WEBP_FLAG_EXIF = 0x08;
const WEBP_FLAG_XMP = 0x04;

const stripWebp = (bytes: Uint8Array): Uint8Array<ArrayBuffer> | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length) return undefined;

  const chunks: Uint8Array[] = [];
  let vp8x: Uint8Array | undefined;
  let keptExif = false;
  let pos = 12;
  while (pos + 8 <= riffEnd) {
    const fourcc = ascii(bytes, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const end = pos + 8 + size + (size % 2);
    if (end > riffEnd) return undefined;

    if (fourcc === 'VP8X' && size >= 1) {
      vp8x = bytes.slice(pos, end);
      chunks.push(vp8x);
    } else if (fourcc === 'EXIF') {
      // libwebp stores the bare TIFF; some writers keep JPEG's "Exif\0\0" prefix.
      const tiff = size >= 6 && ascii(bytes, pos + 8, 6) === 'Exif\0\0' ? pos + 14 : pos + 8;
      const orientation = readOrientation(view, tiff, pos + 8 + size);
      if (keepsOrientation(orientation)) {
        const data = orientationTiff(orientation);
        const exif = new Uint8Array(8 + data.length);
        exif.set([0x45, 0x58, 0x49, 0x46]); // "EXIF"
        new DataView(exif.buffer).setUint32(4, data.length, true);
        exif.set(data, 8);
        chunks.push(exif);
        keptExif = true;
      }
    } else if (fourcc !== 'XMP ') {
      chunks.push(bytes.subarray(pos, end));
    }
    pos = end;
  }
  if (pos !== riffEnd) return undefined;

  if (vp8x) {
    vp8x[8] &= ~(WEBP_FLAG_EXIF | WEBP_FLAG_XMP);
    if (keptExif) vp8x[8] |= WEBP_FLAG_EXIF;
  }

  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  const bodySize = 4 + chunks.reduce((n, c) => n + c.length, 0);
  new DataView(header.buffer).setUint32(4, bodySize, true);
  return concat([header, ...chunks]);
};

const startsWith = (bytes: Uint8Array, prefix: number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

/** Bytes needed to recognise every handled format. */
const SNIFF_BYTES = 12;

type Format = 'jpeg' | 'png' | 'webp';

const sniff = (bytes: Uint8Array): Format | undefined => {
  if (startsWith(bytes, [0xff, JPEG_SOI])) return 'jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }
  return undefined;
};

/** The bytes without metadata, or `undefined` for other formats and files that do not parse. */
export const stripMetadataBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> | undefined => {
  switch (sniff(bytes)) {
    case 'jpeg':
      return stripJpeg(bytes);
    case 'png':
      return stripPng(bytes);
    case 'webp':
      return stripWebp(bytes);
    default:
      return undefined;
  }
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The file without metadata. The original comes back unchanged when it is not
 * a JPEG, PNG or WebP, does not parse, or had nothing to remove.
 */
export const stripMetadata = async (file: File): Promise<File> => {
  try {
    // The type a picker reports is not trusted, so the content decides; a
    // video or archive is recognised from its first bytes, not read whole.
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    if (!sniff(head)) return file;

    const original = new Uint8Array(await file.arrayBuffer());
    const stripped = stripMetadataBytes(original);
    if (!stripped || sameBytes(stripped, original)) return file;
    return new File([stripped], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
};
