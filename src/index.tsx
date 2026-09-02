/* eslint-disable import/first */
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import '@fontsource-variable/inter';
import 'folds/dist/style.css';
import { configClass, varsClass } from 'folds';

enableMapSet();

import './index.css';
import './app/styles/SafeArea.css';

import { trimTrailingSlash } from './app/utils/common';
import App from './app/pages/App';
import { initBlobLinkHandler } from './app/utils/blob-links';

// import i18n (needs to be bundled ;))
import './app/i18n';
import { ensureSWControl, pushSessionToSW } from './sw-session';
import { getFallbackSession } from './app/state/sessions';

document.body.classList.add(configClass, varsClass);

// A tab left open across a deploy is holding an index.html whose hashed chunks
// the server has already pruned. Nothing fails until the app lazily imports one
// — which for the crypto chunk is the moment someone signs in — and then the
// import 404s and the whole app dies on "Failed to fetch dynamically imported
// module". The service worker cannot save us here: it caches nothing, it only
// injects auth headers on Matrix media.
//
// Vite fires `vite:preloadError` for exactly this case. Reloading pulls the
// current index.html and its live chunk hashes, so the tab heals itself. The
// timestamp guard matters: if a chunk is genuinely missing from the deploy,
// reloading cannot fix it, and without the guard the tab would reload forever.
// After one attempt we stop and let the error surface so the failure is
// visible rather than an infinite spinner.
const CHUNK_RELOAD_GUARD = 'cinny:chunk-reload-at';
const CHUNK_RELOAD_COOLDOWN = 30 * 1000;

window.addEventListener('vite:preloadError', (event) => {
  let lastAttempt = 0;
  try {
    lastAttempt = Number(sessionStorage.getItem(CHUNK_RELOAD_GUARD) ?? 0);
  } catch {
    // sessionStorage throws in some privacy modes; treat as "never tried".
  }

  if (Date.now() - lastAttempt < CHUNK_RELOAD_COOLDOWN) return;

  try {
    sessionStorage.setItem(CHUNK_RELOAD_GUARD, String(Date.now()));
  } catch {
    // Without a usable guard, reloading risks a loop — let the error surface.
    return;
  }

  event.preventDefault();
  window.location.reload();
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  const swUrl =
    import.meta.env.MODE === 'production'
      ? `${trimTrailingSlash(import.meta.env.BASE_URL)}/sw.js`
      : `/dev-sw.js?dev-sw`;

  const sendSessionToSW = () => {
    const session = getFallbackSession();
    pushSessionToSW(session?.baseUrl, session?.accessToken);
  };

  navigator.serviceWorker.register(swUrl).then((registration) => {
    sendSessionToSW();

    // SW update detection — the web equivalent of the Tauri auto-updater.
    // When the server has a new sw.js (i.e. someone ran `git pull` on the
    // host), `updatefound` fires after the next `registration.update()` call.
    // The SW does `skipWaiting + clients.claim` on install, so the new
    // worker takes over immediately; the page just needs to reload to load
    // the new JS bundle. Surface the event so useUpdateCheck can show a
    // banner.
    registration.addEventListener('updatefound', () => {
      // First install (no existing controller) is not an update.
      if (!navigator.serviceWorker.controller) return;
      window.dispatchEvent(new CustomEvent('cinny:web-update-available'));
    });

    // Browsers only auto-check for SW updates on navigation or once per
    // day. A SPA that stays loaded for hours won't see updates without
    // explicit polling.
    setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
  });
  navigator.serviceWorker.ready.then(() => {
    sendSessionToSW();
    // A page that did not install this worker — most often one loaded with a
    // shift-reload — is never claimed, because `clients.claim()` lives in the
    // worker's `activate` handler and that does not re-run for a worker which
    // is already active. Such a page has ITS media fetches go straight to the
    // network with no Authorization header, so every image and avatar 401s with
    // M_MISSING_TOKEN for the whole life of the page and reloading does not help.
    // Ask for the claim explicitly; `controllerchange` below then delivers the
    // token to the worker that just took over.
    ensureSWControl();
  });

  // Both sends above are no-ops on a page that is not controlled yet, which is
  // exactly the page that installed the worker. Without this the worker would
  // hold no token until something happened to make it ask for one.
  navigator.serviceWorker.addEventListener('controllerchange', sendSessionToSW);

  navigator.serviceWorker.addEventListener('message', (ev) => {
    const { type } = ev.data ?? {};

    if (type === 'requestSession') {
      sendSessionToSW();
    }

    if (type === 'notificationClick' && ev.data.roomId) {
      // Surface to the React tree as a window event. ClientNonUIFeatures
      // (and a small handler on the auth shell) listens for this and
      // routes via React Router — we can't navigate() from here because
      // the router isn't mounted yet at this file's scope.
      window.dispatchEvent(
        new CustomEvent('cinny:notification-click', {
          detail: { roomId: ev.data.roomId, eventId: ev.data.eventId },
        }),
      );
    }
  });
}

const mountApp = () => {
  const rootContainer = document.getElementById('root');

  if (rootContainer === null) {
    console.error('Root container element not found!');
    return;
  }

  const root = createRoot(rootContainer);
  root.render(<App />);
};

mountApp();

// Intercept blob: link clicks to trigger download instead of
// trying to open them externally (OS doesn't know blob: scheme)
initBlobLinkHandler();
