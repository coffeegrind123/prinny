import { IconName, IconSrc } from 'folds';

export const bytesToSize = (bytes: number): string => {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0KB';

  let sizeIndex = Math.floor(Math.log(bytes) / Math.log(1000));

  if (sizeIndex === 0) sizeIndex = 1;

  return `${(bytes / 1000 ** sizeIndex).toFixed(1)} ${sizes[sizeIndex]}`;
};

export const millisecondsToMinutesAndSeconds = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = Math.round(seconds % 60);
  return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
};

export const millisecondsToMinutes = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1000);
  const mm = Math.floor(seconds / 60);

  return mm.toString();
};

export const secondsToMinutesAndSeconds = (seconds: number): string => {
  const mm = Math.floor(seconds / 60);
  const ss = Math.round(seconds % 60);
  return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
};

export const getFileTypeIcon = (icons: Record<IconName, IconSrc>, fileType: string): IconSrc => {
  const type = fileType.toLowerCase();
  if (type.startsWith('audio')) {
    return icons.Play;
  }
  if (type.startsWith('video')) {
    return icons.Vlc;
  }
  if (type.startsWith('image')) {
    return icons.Photo;
  }
  return icons.File;
};

export const fulfilledPromiseSettledResult = <T>(prs: PromiseSettledResult<T>[]): T[] =>
  prs.reduce<T[]>((values, pr) => {
    if (pr.status === 'fulfilled') values.push(pr.value);
    return values;
  }, []);

export const promiseFulfilledResult = <T>(
  settledResult: PromiseSettledResult<T>,
): T | undefined => {
  if (settledResult.status === 'fulfilled') return settledResult.value;
  return undefined;
};
export const promiseRejectedResult = <T>(settledResult: PromiseSettledResult<T>): any => {
  if (settledResult.status === 'rejected') return settledResult.reason;
  return undefined;
};

export const binarySearch = <T>(items: T[], match: (item: T) => -1 | 0 | 1): T | undefined => {
  const search = (start: number, end: number): T | undefined => {
    if (start > end) return undefined;

    const mid = Math.floor((start + end) / 2);

    const result = match(items[mid]);
    if (result === 0) return items[mid];

    if (result === 1) return search(start, mid - 1);
    return search(mid + 1, end);
  };

  return search(0, items.length - 1);
};

export const randomNumberBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Largest height (in px) an attachment box may occupy in the timeline.
 *
 * `info.w`/`info.h` come from the sender and are never verified against the
 * actual media, so `{ w: 1, h: 1e9 }` used to produce a multi-million-pixel
 * placeholder that pushes every other message off screen and wrecks scroll
 * anchoring for everyone in the room. Well past any real portrait image at our
 * render widths (400px wide → 3200px tall is a 1:8 aspect ratio), so legitimate
 * media is unaffected.
 */
export const MAX_SCALED_Y_DIMENSION = 3200;

export const scaleYDimension = (x: number, scaledX: number, y: number): number => {
  // Guard the divisor too: a non-positive or non-finite `x` yields Infinity/NaN.
  if (!Number.isFinite(x) || x <= 0 || !Number.isFinite(y) || y <= 0) return scaledX;
  const scaleFactor = scaledX / x;
  return Math.min(scaleFactor * y, MAX_SCALED_Y_DIMENSION);
};

/**
 * Scales `w`x`h` to the largest size that fits inside `maxW`x`maxH`, keeping
 * the aspect ratio. Returns both dimensions, which is the point: giving a
 * container the image's own ratio means `object-fit` never has to crop.
 *
 * Dimensions we cannot trust (missing, non-finite, non-positive — all of which
 * arrive routinely in `info` written by other clients) fall back to the full
 * box, matching what the renderer did before it knew any better.
 */
export const fitWithin = (
  w: number | undefined,
  h: number | undefined,
  maxW: number,
  maxH: number,
): [number, number] => {
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return [maxW, maxH];
  }
  const scale = Math.min(maxW / w, maxH / h);
  return [w * scale, h * scale];
};

export const parseGeoUri = (location: string) => {
  try {
    const [, data] = location.split(':');
    const [cords] = data.split(';');
    const [latitude, longitude] = cords.split(',');

    if (typeof latitude === 'string' && typeof longitude === 'string') {
      return {
        latitude,
        longitude,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const START_SLASHES_REG = /^\/+/g;
const END_SLASHES_REG = /\/+$/g;
export const trimLeadingSlash = (str: string): string => str.replace(START_SLASHES_REG, '');
export const trimTrailingSlash = (str: string): string => str.replace(END_SLASHES_REG, '');

export const trimSlash = (str: string): string => trimLeadingSlash(trimTrailingSlash(str));

export const nameInitials = (str: string | undefined | null, len = 1): string => {
  if (!str) return '�';
  return [...str].slice(0, len).join('') || '�';
};

export const randomStr = (len = 12): string => {
  let str = '';
  const minCode = 'A'.charCodeAt(0);
  const maxCode = 'Z'.charCodeAt(0);

  for (let i = 0; i < len; i += 1) {
    const code = Math.floor(Math.random() * (maxCode - minCode + 1) + minCode);
    str += String.fromCharCode(code);
  }
  return str;
};

export const suffixRename = (name: string, validator: (newName: string) => boolean): string => {
  let suffix = 1;
  let newName: string;
  do {
    newName = name + suffix;
    suffix += 1;
  } while (validator(newName));

  return newName;
};

export const replaceSpaceWithDash = (str: string): string => str.replace(/ /g, '-');

export const splitWithSpace = (content: string): string[] => {
  const trimmedContent = content.trim();
  if (trimmedContent === '') return [];
  return trimmedContent.split(' ');
};
