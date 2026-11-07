import { useEffect } from 'react';
import { useMatrixLinkNavigate } from '../hooks/useMatrixLinkNavigate';
import { isTauri } from '../utils/desktop-notifications';
import { parseBotDeepLink } from '../plugins/bot-deeplink';

/**
 * Routes `matrix:` links to the room or user they name, instead of handing them
 * to the operating system.
 *
 * A document-level listener rather than a per-renderer prop: `matrix:` URIs turn
 * up in message bodies, room topics, profile fields and anywhere else HTML is
 * rendered, and threading a click handler through every one of those call sites
 * would guarantee some of them were missed.
 *
 * Without this the links were dead ends — the desktop shell's new-window handler
 * only passes http(s) to the OS and logs a refusal for anything else, so a
 * `matrix:` link did nothing at all when clicked.
 *
 * Capture phase, so this runs before any component-level handler; anything this
 * cannot resolve is left alone to behave as it did before.
 */
export function MatrixLinkHandler() {
  const navigateMatrixLink = useMatrixLinkNavigate();

  useEffect(() => {
    const handler = (evt: MouseEvent) => {
      // Let modified clicks (new tab/window, download) through untouched.
      if (evt.button !== 0 || evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey) return;

      const target = evt.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href^="matrix:"]') as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;
      // A bot start link is BotStartLinkHandler's. Both listen on the document,
      // where stopPropagation does not stop the other, so this one stands down.
      if (parseBotDeepLink(href)) return;

      if (navigateMatrixLink(href)) {
        evt.preventDefault();
        evt.stopPropagation();
      }
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [navigateMatrixLink]);

  // `matrix:` URIs opened from outside the app: another program, a browser, a
  // scanned code. The OS hands them to the shell, which forwards them here.
  useEffect(() => {
    if (!isTauri()) return undefined;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    import('@tauri-apps/plugin-deep-link')
      .then(async ({ onOpenUrl, getCurrent }) => {
        // A link that launched the app arrives before any listener exists, so
        // the pending one has to be drained explicitly — otherwise clicking a
        // matrix: link with the app closed opens it on the wrong screen.
        const current = await getCurrent().catch(() => undefined);
        const navigate = (url: string) => {
          if (!parseBotDeepLink(url)) navigateMatrixLink(url);
        };
        current?.forEach(navigate);

        const stop = await onOpenUrl((urls) => {
          urls.forEach(navigate);
        });
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Shell without the plugin, or a platform where it is unavailable.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigateMatrixLink]);

  return null;
}
