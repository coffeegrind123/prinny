import { useEffect } from 'react';
import { useIsAndroid } from './useIsAndroid';

const toHex = (cssColor: string): string | undefined => {
  const m = cssColor.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (!m) {
    return undefined;
  }

  const alpha = m[4];
  if (alpha !== undefined && parseFloat(alpha) === 0) {
    return undefined;
  }

  return `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * Keeps the Android Activity window background in the colour of `<body>`.
 *
 * While the keyboard opens or closes the WebView is resized a frame after the
 * window, and the window background shows through in between. It defaults to
 * the system DayNight colour, so an in-app theme unlike the system one flashed
 * a wrong-colour band above the keyboard (WindowBackgroundPlugin.kt).
 *
 * Watches body attributes (theme classes, filters) and `<head>` (custom CSS
 * layers) rather than the theme setting, so whatever actually paints the body
 * is what the window gets.
 */
export function useAndroidWindowBackground(): void {
  const android = useIsAndroid();

  useEffect(() => {
    if (!android) {
      return undefined;
    }

    let last: string | undefined;
    let frame = 0;

    const sync = () => {
      frame = 0;
      const color = toHex(getComputedStyle(document.body).backgroundColor);
      if (!color || color === last) {
        return;
      }
      last = color;
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('plugin:window-background|set_color', { color }))
        .catch((err) => {
          last = undefined;
          console.warn('[window-background] could not set the window colour:', err);
        });
    };

    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(sync);
      }
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { attributes: true });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', schedule);
    schedule();

    return () => {
      observer.disconnect();
      scheme.removeEventListener('change', schedule);
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, [android]);
}
