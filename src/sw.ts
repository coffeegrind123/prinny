/// <reference lib="WebWorker" />

export type {};
declare const self: ServiceWorkerGlobalScope;

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

const clientToResolve = new Map<string, (value: SessionInfo | undefined) => void>();
const clientToSessionPromise = new Map<string, Promise<SessionInfo | undefined>>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
      clientToResolve.delete(id);
      clientToSessionPromise.delete(id);
    }
  });
}

function setSession(clientId: string, accessToken: any, baseUrl: any) {
  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    sessions.set(clientId, { accessToken, baseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
  }

  const resolveSession = clientToResolve.get(clientId);
  if (resolveSession) {
    resolveSession(sessions.get(clientId));
    clientToResolve.delete(clientId);
    clientToSessionPromise.delete(clientId);
  }
}

function requestSession(client: Client): Promise<SessionInfo | undefined> {
  const promise =
    clientToSessionPromise.get(client.id) ??
    new Promise((resolve) => {
      clientToResolve.set(client.id, resolve);
      client.postMessage({ type: 'requestSession' });
    });

  if (!clientToSessionPromise.has(client.id)) {
    clientToSessionPromise.set(client.id, promise);
  }

  return promise;
}

async function requestSessionWithTimeout(
  clientId: string,
  timeoutMs = 3000,
): Promise<SessionInfo | undefined> {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  const sessionPromise = requestSession(client);

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });

  const session = await Promise.race([sessionPromise, timeout]);
  clearTimeout(timer!);

  // The client did not answer in time. `requestSession` memoises its promise per
  // client so a burst of media fetches shares one round trip — but that promise
  // only ever settles from `setSession`, so an unanswered request would sit in
  // the map forever and EVERY later media fetch in this tab would await the same
  // dead promise, time out, and go out unauthenticated. Drop it so the next
  // fetch asks again.
  //
  // An answer of "no session" (logged out) is not this case: `setSession` has
  // already cleared both maps, which is what the `has` check distinguishes.
  if (session === undefined && clientToSessionPromise.has(clientId)) {
    clientToResolve.delete(clientId);
    clientToSessionPromise.delete(clientId);
  }

  return session;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await cleanupDeadClients();
    })(),
  );
});

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl } = event.data || {};

  if (type === 'setSession') {
    setSession(client.id, accessToken, baseUrl);
    cleanupDeadClients();
  }

  // A page loaded with a shift-reload is not controlled by this worker and never
  // becomes controlled on its own: `clients.claim()` runs in `activate`, which
  // does not re-run for a worker that is already active. Uncontrolled means no
  // fetch is intercepted, so every media request goes out without an
  // Authorization header and comes back 401 M_MISSING_TOKEN. Claiming on request
  // is what lets such a page recover — see `ensureSWControl` in sw-session.ts.
  if (type === 'claimClients') {
    self.clients.claim();
  }
});

const MEDIA_PATHS = ['/_matrix/client/v1/media/download', '/_matrix/client/v1/media/thumbnail'];

function mediaPath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return MEDIA_PATHS.some((p) => pathname.startsWith(p));
  } catch {
    return false;
  }
}

function validMediaRequest(url: string, baseUrl: string): boolean {
  return MEDIA_PATHS.some((p) => {
    const validUrl = new URL(p, baseUrl);
    return url.startsWith(validUrl.href);
  });
}

function fetchConfig(token: string, request: Request): RequestInit {
  // Carry the original request's headers over and add Authorization on top,
  // rather than sending Authorization alone. Range is the one that matters:
  // dropping it made the server answer 200 with the whole file instead of 206
  // with the requested slice, so seeking inside authenticated audio and video
  // silently did nothing.
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);

  return {
    headers,
    cache: 'default',
  };
}

// ── Web Push ──────────────────────────────────────────────────────────
//
// Triggered when a Matrix push gateway (e.g. Sygnal's webpush pushkin)
// delivers a notification while the tab is closed/backgrounded. The
// payload shape depends on the gateway — we cover the common cases:
//
//   {                                       // Sygnal webpush format
//     notification: { event_id, room_id, sender, room_name, content: { body }, ... }
//   }
//
//   { title, body, roomId, eventId }        // flat custom-gateway format
//
// With Matrix's `format: "event_id_only"` pusher option, the gateway
// strips the message body for privacy — we show "New message" instead.

interface MatrixPushNotification {
  event_id?: string;
  room_id?: string;
  sender?: string;
  sender_display_name?: string;
  room_name?: string;
  room_alias?: string;
  content?: { body?: string; msgtype?: string };
  counts?: { unread?: number; missed_calls?: number };
}

// The push payload is written by the push gateway, which relays whatever the
// homeserver sent — neither is trusted here. Two sinks make the shape matter:
// the notification body (rendered by the OS) and the room id, which is handed
// back to the app and used to build a router path. So every field is checked
// for type, length and — for identifiers — grammar before it is used.

const MAX_NOTIFICATION_TEXT = 500;

// Matrix identifier grammar: a sigil, an opaque localpart, and a server name.
// Deliberately narrow — the characters excluded from the localpart (`/ ? # \`
// and whitespace) are exactly the ones that would let a room id escape its path
// segment. Server names allow `[` `]` `:` for IPv6 literals and ports.
const ROOM_ID_REG = /^[!#][^\s:\/?#\\]{1,255}:[A-Za-z0-9.\-\[\]:]{1,255}$/;
// Event ids are unpadded url-safe base64 since room v3; v1/v2 use the
// `$localpart:server` form, still accepted here.
const EVENT_ID_REG = /^\$[A-Za-z0-9+\/=_-]{1,255}(?::[A-Za-z0-9.\-\[\]:]{1,255})?$/;

const asRoomId = (value: unknown): string | undefined =>
  typeof value === 'string' && ROOM_ID_REG.test(value) ? value : undefined;

const asEventId = (value: unknown): string | undefined =>
  typeof value === 'string' && EVENT_ID_REG.test(value) ? value : undefined;

/** A non-empty string, trimmed of control characters and capped in length. */
const asText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean.length === 0 ? undefined : clean.slice(0, MAX_NOTIFICATION_TEXT);
};

// Notification artwork, resolved against the worker's own scope.
//
// `public/res/…` is the SOURCE layout and does not survive the build: the only
// thing vite.config.js copies out of it is `public/res/android/**` ->
// `public/android/`, everything else reaches `dist/` only as a hashed
// `assets/…` file emitted from a bundler import, which a plain string cannot
// name. The previous '/public/res/svg/prinny.svg' therefore 404'd on every push
// and the browser silently substituted its own generic icon.
//
// Scope-relative rather than base-relative on purpose: the same source builds
// at '/' (self-hosters) and at '/app/' (prinny.app), and `registration.scope`
// is whichever one this worker was actually registered under — no build-time
// value to keep in sync. PNG rather than the brand SVG because SVG notification
// icons are not reliably rendered outside Firefox.
const notificationAsset = (path: string): string => new URL(path, self.registration.scope).href;

self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event: PushEvent) {
  let payload: any = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    // Some gateways send plain text or empty payload
    payload = { title: 'New message' };
  }
  if (typeof payload !== 'object' || payload === null) payload = {};

  const rawNotif = payload.notification ?? payload;
  const notif: MatrixPushNotification =
    typeof rawNotif === 'object' && rawNotif !== null ? rawNotif : {};
  const roomName = asText(notif.room_name);
  const sender = asText(notif.sender_display_name) ?? asText(notif.sender);
  const title =
    roomName ?? asText(notif.room_alias) ?? sender ?? asText(payload.title) ?? 'New message';
  const body =
    asText(notif.content?.body) ??
    asText(payload.body) ??
    (sender && roomName ? `${sender}: …` : 'You have a new message');

  const roomId = asRoomId(notif.room_id) ?? asRoomId(payload.roomId);
  const eventId = asEventId(notif.event_id) ?? asEventId(payload.eventId);

  await self.registration.showNotification(title, {
    body,
    icon: notificationAsset('public/android/android-chrome-192x192.png'),
    badge: notificationAsset('public/android/android-chrome-96x96.png'),
    tag: eventId ?? 'matrix-push',
    renotify: true,
    data: {
      roomId,
      eventId,
    },
  } as NotificationOptions);
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  // Re-validated rather than trusted: a notification posted by a previous
  // service worker build outlives that build, so `data` is not guaranteed to
  // have come from the version of handlePush above.
  const data = (event.notification.data || {}) as { roomId?: unknown; eventId?: unknown };
  const roomId = asRoomId(data.roomId);
  const eventId = asEventId(data.eventId);

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Focus an existing tab and let it route — avoids opening duplicates.
      const existing = allClients.find((c) => c.url.startsWith(self.registration.scope));
      if (existing) {
        try {
          await (existing as WindowClient).focus();
        } catch {
          // focus() can reject on some browsers if not user-activated
        }
        existing.postMessage({ type: 'notificationClick', roomId, eventId });
        return;
      }

      // No open tab — launch fresh. Pass the roomId via hash so the
      // bootstrapping app code can route once it's mounted.
      const url = roomId
        ? `${self.registration.scope}#/notification-target?roomId=${encodeURIComponent(roomId)}`
        : self.registration.scope;
      await self.clients.openWindow(url);
    })(),
  );
});

function invalidateSession(clientId: string) {
  sessions.delete(clientId);
  clientToResolve.delete(clientId);
  clientToSessionPromise.delete(clientId);
}

async function handleMediaRequest(request: Request, clientId: string): Promise<Response> {
  const { url } = request;

  const session = sessions.get(clientId) ?? (await requestSessionWithTimeout(clientId));

  if (!session || !validMediaRequest(url, session.baseUrl)) {
    // No usable session (e.g. logged out, the request is for a different
    // homeserver than this client is signed into, or the client had not answered
    // yet) — let it go out unmodified. It may already carry an Authorization
    // header of its own: `getMediaAuthHeaders` in sw-session.ts attaches one to
    // every fetch-based media download, so those succeed here regardless of what
    // this worker knows.
    const passthrough = await fetch(request);
    if (passthrough.status !== 401) return passthrough;

    // It did not. An `<img>` cannot carry a header, so this is the only place
    // that can rescue it: ask the client once more — the earlier attempt may
    // have raced a login, a token refresh, or this worker being restarted with
    // an empty session map — and retry with whatever comes back.
    invalidateSession(clientId);
    const late = await requestSessionWithTimeout(clientId);
    if (late && validMediaRequest(url, late.baseUrl)) {
      return fetch(url, fetchConfig(late.accessToken, request));
    }
    return passthrough;
  }

  const res = await fetch(url, fetchConfig(session.accessToken, request));

  // A 401 here almost always means the cached token is stale: the client
  // refreshed its access token (or re-logged-in in the same tab) after we
  // cached the old one, and the service worker holds the map per client id and
  // never revalidates. Left alone, EVERY media fetch 401s until the tab is
  // reloaded — which surfaces to the user as a broken image / "failed to load
  // voice message", because downloadMedia would otherwise feed the 401 body to
  // the attachment decryptor ("Mismatched SHA-256 digest"). So drop the cached
  // token, ask the client for its current one, and retry once. The retry only
  // fires when the fresh token actually differs, so a genuinely-invalid token
  // (real 401) is returned as-is rather than looping.
  if (res.status === 401) {
    const staleToken = session.accessToken;
    invalidateSession(clientId);
    const fresh = await requestSessionWithTimeout(clientId);
    if (fresh && fresh.accessToken !== staleToken && validMediaRequest(url, fresh.baseUrl)) {
      return fetch(url, fetchConfig(fresh.accessToken, request));
    }
  }

  return res;
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET' || !mediaPath(url)) return;

  const { clientId } = event;
  if (!clientId) return;

  event.respondWith(handleMediaRequest(event.request, clientId));
});
