/**
 * Two questions about the host: is this a Mac, and is this a small touch
 * device.
 *
 * These were answered by `ua-parser-js` — 1.7 MB of device database, pulled in
 * to produce two booleans that nothing outside this file ever asked in any
 * other form.
 *
 * It also answered one of them wrongly. `ua-parser-js` v2 renamed its macOS
 * label from `Mac OS` to `macOS`; the comparison here was never updated when
 * the dependency was bumped, so `isMacOS()` returned false on every Mac and
 * every shortcut hint in the app — ⌘K in search, the shortcuts sheet, the
 * settings row, `key-display.ts` — showed `Ctrl`, `Alt` and `Meta` to Mac
 * users. A wrong answer from a library is not obviously wrong at the call
 * site, which is the argument for keeping this small enough to read.
 *
 * `mobileOrTablet()` matches what the library returned for the cases that
 * reach it, including reporting false for an iPad in desktop mode: that
 * request arrives as a Mac, and Safari means it to be treated as one.
 * `navigator.maxTouchPoints` would see through the disguise, and is
 * deliberately not consulted — changing that answer is a UI decision, not a
 * dependency cleanup.
 */

type UADataNavigator = Navigator & {
  userAgentData?: { platform?: string; mobile?: boolean };
};

const nav = (): UADataNavigator => window.navigator as UADataNavigator;

/**
 * iOS proper.
 *
 * An iPad in desktop mode identifies as a Macintosh and is deliberately not
 * caught here — see the note above.
 */
const isIOSUA = (ua: string): boolean => /iPhone|iPad|iPod/i.test(ua);

export const isMacOS = (): boolean => {
  // User-Agent Client Hints where the browser offers them: a structured
  // platform beats pattern-matching a string designed to lie.
  const platform = nav().userAgentData?.platform;
  if (platform) return platform === 'macOS';

  const ua = nav().userAgent;
  return /Mac OS X|Macintosh/i.test(ua) && !isIOSUA(ua);
};

export const mobileOrTablet = (): boolean => {
  // Only ever read as a positive signal. UA-CH reports `mobile: false` for
  // Android tablets, which are very much tablets, so a false here means
  // "no opinion" rather than "desktop".
  if (nav().userAgentData?.mobile === true) return true;

  const ua = nav().userAgent;
  if (isIOSUA(ua)) return true;
  if (/Android/i.test(ua)) return true;
  return /Mobile|Tablet|Silk|Kindle|PlayBook|BlackBerry|Opera Mini|IEMobile|webOS|Windows Phone/i.test(
    ua,
  );
};
