import { describe, expect, it } from 'vitest';
import { stripMetadata, stripMetadataBytes } from './stripMetadata';

const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array<ArrayBuffer> => {
  const arrays = parts.map((p) =>
    typeof p === 'string' ? new TextEncoder().encode(p) : Uint8Array.from(p),
  );
  const out = new Uint8Array(new ArrayBuffer(arrays.reduce((n, a) => n + a.length, 0)));
  let offset = 0;
  arrays.forEach((a) => {
    out.set(a, offset);
    offset += a.length;
  });
  return out;
};

/** A JPEG marker segment: FF <marker> <length incl. itself> <payload>. */
const segment = (marker: number, payload: Uint8Array): Uint8Array =>
  bytes([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff], payload);

/** "Exif\0\0" + a little-endian TIFF IFD0 with Orientation and a GPS-looking ASCII tag. */
const exifPayload = (orientation: number): Uint8Array => {
  const tiff = new Uint8Array(8 + 2 + 2 * 12 + 4 + 16);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, 8, true);
  view.setUint16(8, 2, true);
  // Orientation, SHORT, count 1
  view.setUint16(10, 0x0112, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 1, true);
  view.setUint16(18, orientation, true);
  // ImageDescription, ASCII, 16 bytes at offset 38
  view.setUint16(22, 0x010e, true);
  view.setUint16(24, 2, true);
  view.setUint32(26, 16, true);
  view.setUint32(30, 38, true);
  tiff.set(new TextEncoder().encode('GPS 60.1N 24.9E\0'), 38);
  return bytes('Exif\0\0', tiff);
};

/** The TIFF part alone, as PNG eXIf and WebP EXIF chunks carry it. */
const tiffPayload = (orientation: number): Uint8Array => exifPayload(orientation).subarray(6);

/** Orientation from a big- or little-endian TIFF holding IFD0 entries. */
const tiffOrientation = (tiff: Uint8Array): number | undefined => {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = view.getUint16(0) === 0x4949;
  const ifd = view.getUint32(4, little);
  for (let i = 0; i < view.getUint16(ifd, little); i += 1) {
    const entry = ifd + 2 + i * 12;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return undefined;
};

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const JFIF = segment(0xe0, bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const DQT = segment(0xdb, bytes([0], new Uint8Array(64).fill(1)));
const SOS = segment(0xda, bytes([1, 1, 0, 0, 0x3f, 0]));
// Entropy-coded data with a stuffed FF00, a restart marker and a byte run
// that looks like a marker only if the stuffing is ignored.
const SCAN = bytes([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0x00, 0xd9, 0x78]);
const XMP = segment(0xe1, bytes('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPS</x:xmpmeta>'));
const IPTC = segment(0xed, bytes('Photoshop 3.0\0GPS'));
const COM = segment(0xfe, bytes('GPS comment'));
const ICC = segment(0xe2, bytes('ICC_PROFILE\0\x01\x01keepme'));

const contains = (haystack: Uint8Array, needle: string): boolean =>
  new TextDecoder('latin1').decode(haystack).includes(needle);

describe('stripMetadataBytes: JPEG', () => {
  const photo = (orientation: number, trailer: Uint8Array = new Uint8Array()) =>
    bytes(
      SOI,
      JFIF,
      segment(0xe1, exifPayload(orientation)),
      XMP,
      IPTC,
      COM,
      ICC,
      DQT,
      SOS,
      SCAN,
      EOI,
      trailer,
    );

  it('drops EXIF, XMP, IPTC and comments, and keeps the ICC profile and the image data', () => {
    const out = stripMetadataBytes(photo(1));
    expect(out).toBeDefined();
    expect(contains(out!, 'GPS')).toBe(false);
    expect(contains(out!, 'keepme')).toBe(true);
    expect(out).toEqual(bytes(SOI, JFIF, ICC, DQT, SOS, SCAN, EOI));
  });

  it('keeps a non-default orientation as a minimal EXIF block right after JFIF', () => {
    const out = stripMetadataBytes(photo(6))!;
    expect(contains(out, 'GPS')).toBe(false);
    // SOI, then JFIF must stay the first segment, then the new APP1.
    expect(Array.from(out.subarray(0, 2 + JFIF.length))).toEqual(Array.from(bytes(SOI, JFIF)));
    const app1 = out.subarray(2 + JFIF.length);
    expect(app1[0]).toBe(0xff);
    expect(app1[1]).toBe(0xe1);
    expect(contains(app1.subarray(4, 10), 'Exif')).toBe(true);
    // Big-endian TIFF, one IFD entry: Orientation = 6.
    const view = new DataView(app1.buffer, app1.byteOffset + 10);
    expect(view.getUint16(0)).toBe(0x4d4d);
    expect(view.getUint16(8)).toBe(1);
    expect(view.getUint16(10)).toBe(0x0112);
    expect(view.getUint16(18)).toBe(6);
  });

  it('puts the orientation block first when there is no JFIF segment', () => {
    const out = stripMetadataBytes(bytes(SOI, segment(0xe1, exifPayload(8)), DQT, SOS, SCAN, EOI))!;
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe1);
  });

  it('drops everything after the end of the primary image (MPF images, gain maps, motion photos)', () => {
    // A second embedded JPEG with its own EXIF, as MPF and Ultra HDR append.
    const secondary = bytes(SOI, segment(0xe1, exifPayload(1)), DQT, SOS, SCAN, EOI);
    const motion = bytes('....ftypmp42 GPS video');
    const out = stripMetadataBytes(photo(1, bytes(secondary, motion)))!;
    expect(contains(out, 'GPS')).toBe(false);
    expect(out).toEqual(bytes(SOI, JFIF, ICC, DQT, SOS, SCAN, EOI));
  });

  it('keeps every scan of a progressive JPEG', () => {
    const DHT = segment(0xc4, bytes([0], new Uint8Array(16)));
    const input = bytes(SOI, segment(0xe1, exifPayload(1)), DQT, SOS, SCAN, DHT, SOS, SCAN, EOI);
    expect(stripMetadataBytes(input)).toEqual(bytes(SOI, DQT, SOS, SCAN, DHT, SOS, SCAN, EOI));
  });

  it('refuses a truncated or malformed file instead of guessing', () => {
    expect(stripMetadataBytes(bytes(SOI, [0xff, 0xe1, 0x00, 0xff]))).toBeUndefined();
    expect(stripMetadataBytes(bytes(SOI, [0x00, 0x00]))).toBeUndefined();
    // No end-of-image marker after the scan.
    expect(stripMetadataBytes(bytes(SOI, DQT, SOS, SCAN))).toBeUndefined();
  });
});

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  data.forEach((b) => {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  });
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array | string = new Uint8Array()): Uint8Array => {
  const body = bytes(type, data);
  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length - 4);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
};
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('stripMetadataBytes: PNG', () => {
  const IHDR = chunk('IHDR', new Uint8Array(13));
  const IDAT = chunk('IDAT', bytes([1, 2, 3]));
  const IEND = chunk('IEND');
  const iCCP = chunk('iCCP', 'keepme\0\0x');

  it('drops eXIf, text and time chunks, and keeps colour and image chunks', () => {
    const input = bytes(
      PNG_SIG,
      IHDR,
      iCCP,
      chunk('eXIf', 'MM\0*GPS'),
      chunk('tEXt', 'Comment\0GPS'),
      chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0GPS'),
      chunk('zTXt', 'Raw profile\0\0GPS'),
      chunk('tIME', bytes([7, 234, 11, 11, 0, 0, 0])),
      IDAT,
      IEND,
    );
    const out = stripMetadataBytes(input)!;
    expect(contains(out, 'GPS')).toBe(false);
    expect(out).toEqual(bytes(PNG_SIG, IHDR, iCCP, IDAT, IEND));
  });

  it('keeps a non-default orientation as a minimal eXIf chunk with a valid CRC', () => {
    const input = bytes(PNG_SIG, IHDR, chunk('eXIf', tiffPayload(6)), IDAT, IEND);
    const out = stripMetadataBytes(input)!;
    expect(contains(out, 'GPS')).toBe(false);
    const exif = out.subarray(PNG_SIG.length + IHDR.length);
    const length = new DataView(exif.buffer, exif.byteOffset).getUint32(0);
    expect(contains(exif.subarray(4, 8), 'eXIf')).toBe(true);
    const data = exif.subarray(8, 8 + length);
    expect(tiffOrientation(data)).toBe(6);
    expect(exif.subarray(8 + length, 12 + length)).toEqual(
      chunk('eXIf', data).subarray(8 + length, 12 + length),
    );
    expect(out.subarray(PNG_SIG.length + IHDR.length + 12 + length)).toEqual(bytes(IDAT, IEND));
  });

  it('drops anything appended after IEND', () => {
    const out = stripMetadataBytes(bytes(PNG_SIG, IHDR, IDAT, IEND, 'trailing GPS'))!;
    expect(out).toEqual(bytes(PNG_SIG, IHDR, IDAT, IEND));
  });

  it('refuses a chunk that runs past the end of the file', () => {
    expect(stripMetadataBytes(bytes(PNG_SIG, IHDR, [0, 0, 1, 0], 'IDAT'))).toBeUndefined();
  });
});

const riffChunk = (fourcc: string, data: Uint8Array): Uint8Array => {
  const pad = data.length % 2;
  const out = new Uint8Array(8 + data.length + pad);
  out.set(new TextEncoder().encode(fourcc));
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
};
const webp = (...chunks: Uint8Array[]): Uint8Array => {
  const body = bytes('WEBP', ...chunks);
  const header = bytes('RIFF', [0, 0, 0, 0]);
  new DataView(header.buffer).setUint32(4, body.length, true);
  return bytes(header, body);
};

describe('stripMetadataBytes: WebP', () => {
  // VP8X flags: ICC 0x20, EXIF 0x08, XMP 0x04.
  const vp8x = (flags: number) => riffChunk('VP8X', bytes([flags, 0, 0, 0, 9, 0, 0, 9, 0, 0]));
  const ICCP = riffChunk('ICCP', bytes('keepme'));
  const VP8 = riffChunk('VP8 ', bytes([1, 2, 3]));

  it('drops EXIF and XMP chunks, clears their VP8X flags and fixes the RIFF size', () => {
    const input = webp(
      vp8x(0x20 | 0x08 | 0x04),
      ICCP,
      VP8,
      riffChunk('EXIF', bytes('MM\0*GPS')),
      riffChunk('XMP ', bytes('<x>GPS</x>')),
    );
    const out = stripMetadataBytes(input)!;
    expect(contains(out, 'GPS')).toBe(false);
    expect(out).toEqual(webp(vp8x(0x20), ICCP, VP8));
  });

  it('keeps a non-default orientation as a minimal EXIF chunk, with its flag', () => {
    // Some encoders prefix the TIFF with "Exif\0\0"; the orientation is read either way.
    for (const payload of [tiffPayload(6), exifPayload(6)]) {
      const input = webp(
        vp8x(0x08 | 0x04),
        VP8,
        riffChunk('EXIF', payload),
        riffChunk('XMP ', bytes('GPS')),
      );
      const out = stripMetadataBytes(input)!;
      expect(contains(out, 'GPS')).toBe(false);
      expect(out[20] & 0x0c).toBe(0x08);
      const exifAt = 12 + vp8x(0).length + VP8.length;
      expect(contains(out.subarray(exifAt, exifAt + 4), 'EXIF')).toBe(true);
      const size = new DataView(out.buffer, out.byteOffset).getUint32(exifAt + 4, true);
      expect(tiffOrientation(out.subarray(exifAt + 8, exifAt + 8 + size))).toBe(6);
      expect(new DataView(out.buffer, out.byteOffset).getUint32(4, true)).toBe(out.length - 8);
    }
  });

  it('refuses a chunk that runs past the end of the file', () => {
    const broken = webp(VP8);
    new DataView(broken.buffer).setUint32(16, 1000, true);
    expect(stripMetadataBytes(broken)).toBeUndefined();
  });
});

describe('stripMetadata', () => {
  it('reads only the first bytes of a file that is not an image', async () => {
    const file = new File([new Uint8Array(1 << 20)], 'video.mp4', { type: 'video/mp4' });
    let read = 0;
    const realSlice = file.slice.bind(file);
    file.slice = (...args: Parameters<Blob['slice']>) => {
      const part = realSlice(...args);
      read += part.size;
      return part;
    };
    let wholeRead = false;
    const realArrayBuffer = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => {
      wholeRead = true;
      return realArrayBuffer();
    };
    expect(await stripMetadata(file)).toBe(file);
    expect(wholeRead).toBe(false);
    expect(read).toBeLessThanOrEqual(16);
  });

  it('returns other files untouched', async () => {
    const file = new File(['plain text'], 'a.txt', { type: 'text/plain' });
    expect(await stripMetadata(file)).toBe(file);
  });

  it('returns a stripped copy with the same name, type and date', async () => {
    const input = bytes(SOI, segment(0xe1, exifPayload(1)), DQT, SOS, SCAN, EOI);
    const file = new File([input], 'photo.jpg', { type: 'image/jpeg', lastModified: 1234 });
    const out = await stripMetadata(file);
    expect(out).not.toBe(file);
    expect(out.name).toBe('photo.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(out.lastModified).toBe(1234);
    expect(contains(new Uint8Array(await out.arrayBuffer()), 'GPS')).toBe(false);
  });

  it('returns the original when the file has nothing to strip', async () => {
    const clean = bytes(SOI, DQT, SOS, SCAN, EOI);
    const file = new File([clean], 'clean.jpg', { type: 'image/jpeg' });
    expect(await stripMetadata(file)).toBe(file);
  });
});
