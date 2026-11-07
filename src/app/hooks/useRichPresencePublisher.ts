import { useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { useMatrixClient } from './useMatrixClient';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import {
  appPresenceServerStatusAtom,
  richPresenceBridgeStatusAtom,
} from '../state/richPresenceBridge';
import {
  MEOW_RICH_PRESENCE_EXPIRES_AT,
  MSC4320_RPC,
  MSC4544_MAX_ENTRIES,
  MSC4544_RPC,
  RICH_PRESENCE_EXPIRES_AT,
  RICH_PRESENCE_TTL,
} from '../../types/matrix/richPresence';
import {
  activityIdentity,
  isMediaPayload,
  mapDiscordActivity,
  sameActivityPayload,
  toMsc4544Entry,
  withCoverArt,
  type ActivityPayload,
  type DiscordRichPresenceActivity,
} from '../utils/discordActivity';
import { isTauriDesktop } from '../utils/platform';
import {
  applyAppMessage,
  isAppAllowed,
  newSocketSalt,
  notedApp,
  opaqueSocketId,
  parseAppMessage,
  publishableEntries,
  type AppEntry,
} from '../utils/appPresence';

/** Event the Rust app server emits for each message: `{ connection, message }`. */
const APP_MESSAGE_EVENT = 'app-presence-message';

type AppPresenceStarted = { port: number | null; socket: string | null };

// Minimum interval between profile writes. Discord-RPC clients can fire
// SET_ACTIVITY on every progress tick; coalesce to avoid hammering the HS.
const MIN_WRITE_INTERVAL = 5000;

// How often an unchanged activity is re-written to push its expiry forward.
// Well inside RICH_PRESENCE_TTL, so a reader never sees a live activity lapse.
const EXPIRY_REFRESH_INTERVAL = 60 * 1000;

/** Longest a failing write waits before being tried again. */
const MAX_WRITE_BACKOFF = 5 * 60 * 1000;

/**
 * A rejection that will never come good: the homeserver does not implement
 * MSC4133 extended profiles, so this property cannot be written at all.
 *
 * Worth telling apart from a transient failure, because only a success advances
 * `lastWritten` — an endpoint that is simply absent therefore leaves the
 * unchanged-payload guard permanently unsatisfied, and the write was retried on
 * every interval tick for as long as anything was playing. Toggling the setting
 * re-runs the effect and tries again, which is the escape hatch if a homeserver
 * gains support without the client restarting.
 */
const isUnsupportedProfileWrite = (err: unknown): boolean => {
  const { httpStatus, errcode } = (err ?? {}) as { httpStatus?: number; errcode?: string };
  return httpStatus === 404 || httpStatus === 405 || errcode === 'M_UNRECOGNIZED';
};

/** Event the Rust bridge emits whenever the current activity changes. */
const ACTIVITY_EVENT = 'rich-presence-activity';

type BridgeStarted = { path: string; index: number };

/**
 * Publishes whatever the local Discord-RPC bridge captures as the user's
 * MSC4320 rich presence. Desktop-only and off by default; on web and mobile the
 * effect returns immediately, because there is no pipe to listen on.
 *
 * The socket server itself is Rust — `start_rich_presence_bridge` in the
 * prinny-client repo — because a webview cannot bind a named pipe or a unix
 * socket. This half owns only the mapping and the throttled profile write.
 *
 * Cover art is resolved through the homeserver's preview_url endpoint: it
 * fetches and caches the external image and returns an mxc://, which the reader
 * renders natively. No client-side download or upload, and no SSRF surface here.
 */
export const useRichPresencePublisher = () => {
  const mx = useMatrixClient();
  const [enabled] = useSetting(settingsAtom, 'publishRichPresence');
  const setStatus = useSetAtom(richPresenceBridgeStatusAtom);
  const setAppServerStatus = useSetAtom(appPresenceServerStatusAtom);
  const [appPolicy] = useSetting(settingsAtom, 'appPresencePolicy');
  const [knownApps, setKnownApps] = useSetting(settingsAtom, 'appPresenceApps');
  const [socketSalt, setSocketSalt] = useSetting(settingsAtom, 'appPresenceSalt');

  // Read by the running effect without restarting it (and with it, the
  // servers) whenever the user allows or denies an app.
  const allowedRef = useRef<(appId: string) => boolean>(() => false);
  const knownAppsRef = useRef(knownApps);
  const saltRef = useRef(socketSalt);
  const rewriteRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    knownAppsRef.current = knownApps;
    allowedRef.current = (appId) => isAppAllowed(knownApps, appPolicy, appId);
    // An app just allowed or denied: publish or withdraw its entries now.
    rewriteRef.current();
  }, [knownApps, appPolicy]);
  useEffect(() => {
    saltRef.current = socketSalt;
  }, [socketSalt]);

  useEffect(() => {
    if (!enabled) {
      setStatus(undefined);
      setAppServerStatus(undefined);
      return undefined;
    }

    let stopped = false;
    let started = false;
    let pending: ActivityPayload | null = null;
    let lastWritten: ActivityPayload | null = null;
    let lastWriteAt = 0;
    let inFlight = false;
    let unlisten: (() => void) | undefined;
    let boundPath: string | undefined;
    // Write-failure state: see isUnsupportedProfileWrite.
    let writeFailures = 0;
    let retryWritesAt = 0;
    let writesUnsupported = false;
    // MSC4544 entry id: kept while the same track/game continues.
    let entryIdentity: string | undefined;
    let entryId = '';
    // MSC4544 entries from local apps, and what was last published of them.
    const appEntries = new Map<string, AppEntry>();
    let lastAppsWritten = '[]';
    let msc4320Written = false;
    let appServerStarted = false;
    let unlistenApps: (() => void) | undefined;

    // Cover-art resolution: turn an external image URL into an MXC via the
    // homeserver's preview_url endpoint. Deduped by URL so a repeated cover
    // (same album) never re-fetches.
    const coverCache = new Map<string, string | null>(); // url -> mxc, or null if unavailable
    const resolving = new Set<string>();
    let currentCoverUrl: string | undefined;

    const tick = async () => {
      if (stopped || inFlight || writesUnsupported) return;
      if (Date.now() < retryWritesAt) return;
      // Allowed apps' live entries; expired ones leave the map here.
      const apps = publishableEntries(undefined, appEntries, allowedRef.current, Date.now());
      const appsKey = JSON.stringify(apps);
      if (
        sameActivityPayload(pending, lastWritten) &&
        (!pending || Date.now() - lastWriteAt < EXPIRY_REFRESH_INTERVAL) &&
        appsKey === lastAppsWritten
      ) {
        return;
      }
      // Captured so an activity that changes during the request is written next.
      const writing = pending;
      inFlight = true;
      try {
        // Written one after the other (MSC4544 asks for serialised writes):
        // the MSC4320 object our clients and meow's read, with both forks'
        // expiry keys so each hides the other's stale activity, holding the
        // Discord-bridge activity only; and the MSC4544 array Extera and Zam
        // read, holding that activity first and then local apps' entries, up
        // to four. An empty array is a DELETE: MSC4544 forbids PUTting one.
        const list: Record<string, unknown>[] = [];
        if (writing) {
          const expiresAt = Date.now() + RICH_PRESENCE_TTL;
          const identity = activityIdentity(writing);
          if (identity !== entryIdentity) {
            entryIdentity = identity;
            entryId = crypto.randomUUID();
          }
          await mx.setExtendedProfileProperty(MSC4320_RPC, {
            ...writing,
            [RICH_PRESENCE_EXPIRES_AT]: expiresAt,
            [MEOW_RICH_PRESENCE_EXPIRES_AT]: expiresAt,
          });
          msc4320Written = true;
          list.push(toMsc4544Entry(writing, entryId, expiresAt));
        } else if (msc4320Written || lastWritten) {
          await mx.deleteExtendedProfileProperty(MSC4320_RPC);
          msc4320Written = false;
        }
        list.push(...apps);
        if (list.length > 0) {
          await mx.setExtendedProfileProperty(MSC4544_RPC, list.slice(0, MSC4544_MAX_ENTRIES));
        } else {
          await mx.deleteExtendedProfileProperty(MSC4544_RPC);
        }
        // The cleanup's delete may have raced this write and landed first.
        if (stopped && list.length > 0) {
          await mx.deleteExtendedProfileProperty(MSC4320_RPC);
          await mx.deleteExtendedProfileProperty(MSC4544_RPC);
        }
        lastWritten = writing;
        lastAppsWritten = appsKey;
        lastWriteAt = Date.now();
        writeFailures = 0;
        retryWritesAt = 0;
      } catch (err) {
        // matrix-js-sdk refuses the write itself, with a plain Error and no
        // status code, when /versions does not advertise MSC4133; ask it.
        const unsupported =
          isUnsupportedProfileWrite(err) ||
          !(await mx.doesServerSupportExtendedProfiles().catch(() => true));
        if (unsupported) {
          // Said out loud rather than swallowed. The bridge is still listening
          // and still capturing activity, so "nothing is being published" is
          // otherwise indistinguishable from "nothing is playing" — the exact
          // silence this used to sit in while retrying every five seconds.
          writesUnsupported = true;
          if (!stopped) {
            setStatus({
              state: 'error',
              error: boundPath
                ? `listening on ${boundPath}, but this homeserver does not support MSC4133 extended profiles, so activity cannot be published`
                : 'this homeserver does not support MSC4133 extended profiles, so activity cannot be published',
            });
          }
        } else {
          // Transient — a flaky link, a rate limit, a server restart. Backed
          // off so a persistent one does not become a five-second heartbeat of
          // failing requests for as long as a track is playing.
          writeFailures += 1;
          retryWritesAt =
            Date.now() + Math.min(MIN_WRITE_INTERVAL * 2 ** writeFailures, MAX_WRITE_BACKOFF);
        }
      }
      inFlight = false;
    };

    const applyCover = (url: string, mxc: string | null) => {
      if (stopped || !mxc || currentCoverUrl !== url || !pending) return;
      const hasCover = isMediaPayload(pending) ? !!pending.cover_art : !!pending.image;
      if (hasCover) return;
      pending = withCoverArt(pending, mxc);
      tick();
    };

    const resolveCover = (url: string) => {
      if (coverCache.has(url)) {
        applyCover(url, coverCache.get(url) ?? null);
        return;
      }
      if (resolving.has(url)) return;
      resolving.add(url);
      mx.getUrlPreview(url, Date.now())
        .then((prev) => {
          const img = prev?.['og:image'];
          const mxc = typeof img === 'string' && img.startsWith('mxc://') ? img : null;
          coverCache.set(url, mxc);
          resolving.delete(url);
          applyCover(url, mxc);
        })
        .catch(() => {
          // Preview disabled / blocked / unreachable: skip the cover silently.
          coverCache.set(url, null);
          resolving.delete(url);
        });
    };

    const handleActivity = (activity: DiscordRichPresenceActivity | null) => {
      if (stopped) return;
      if (!activity) {
        pending = null;
        currentCoverUrl = undefined;
      } else {
        const { payload, coverUrl } = mapDiscordActivity(activity);
        pending = payload;
        currentCoverUrl = coverUrl;
        // Synchronous apply when the cover was resolved on a previous track.
        if (coverUrl) resolveCover(coverUrl);
      }
      // Leading-edge write when the throttle window has elapsed; otherwise the
      // interval tick below flushes it within MIN_WRITE_INTERVAL.
      if (Date.now() - lastWriteAt >= MIN_WRITE_INTERVAL) tick();
    };

    const interval = setInterval(() => {
      tick();
    }, MIN_WRITE_INTERVAL);
    rewriteRef.current = () => {
      if (!stopped && Date.now() - lastWriteAt >= MIN_WRITE_INTERVAL) tick();
    };

    const handleAppMessage = (raw: unknown) => {
      if (stopped) return;
      const now = Date.now();
      const message = parseAppMessage(raw, now);
      if (!message) return;
      // Every app that reaches us is listed in settings, so the user can
      // allow it; until then the default policy (deny) keeps it unpublished.
      const noted = notedApp(knownAppsRef.current, message.appId, message.appName, now);
      if (noted) setKnownApps((apps) => ({ ...apps, [message.appId]: noted }));
      applyAppMessage(appEntries, message, now);
      if (now - lastWriteAt >= MIN_WRITE_INTERVAL) tick();
    };

    // The app server is independent of the Discord bridge: either can fail to
    // bind without taking the other down.
    const initApps = async () => {
      if (!(await isTauriDesktop())) return;
      const userId = mx.getUserId();
      if (stopped || !userId) return;
      let salt = saltRef.current;
      if (!salt) {
        salt = newSocketSalt();
        setSocketSalt(salt);
      }
      const opaqueId = await opaqueSocketId(salt, userId);
      const [{ invoke }, { listen }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ]);
      if (stopped) return;
      const unlistenFn = await listen<{ connection: number; message: unknown }>(
        APP_MESSAGE_EVENT,
        (event) => handleAppMessage(event.payload.message),
      );
      if (stopped) {
        unlistenFn();
        return;
      }
      unlistenApps = unlistenFn;
      try {
        const bound = await invoke<AppPresenceStarted>('start_app_presence_server', { opaqueId });
        appServerStarted = true;
        if (stopped) return;
        setAppServerStatus({
          state: 'running',
          port: bound.port ?? undefined,
          socket: bound.socket ?? undefined,
        });
      } catch (err) {
        if (!stopped) setAppServerStatus({ state: 'error', error: String(err) });
      }
    };
    initApps().catch((err) => {
      if (!stopped) setAppServerStatus({ state: 'error', error: String(err) });
    });

    const init = async () => {
      if (!(await isTauriDesktop())) {
        // Not an error: the web and mobile builds simply have no bridge.
        setStatus(undefined);
        return;
      }
      if (stopped) return;
      setStatus({ state: 'starting' });

      const [{ invoke }, { listen }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ]);
      if (stopped) return;

      let bound: BridgeStarted;
      try {
        bound = await invoke<BridgeStarted>('start_rich_presence_bridge');
      } catch (err) {
        if (!stopped) setStatus({ state: 'error', error: String(err) });
        return;
      }
      started = true;
      boundPath = bound.path;
      if (stopped) return;

      const unlistenFn = await listen<DiscordRichPresenceActivity | null>(ACTIVITY_EVENT, (event) =>
        handleActivity(event.payload),
      );
      if (stopped) {
        unlistenFn();
        return;
      }
      unlisten = unlistenFn;
      // Unless a write has already reported that this homeserver cannot take
      // one — a listener registered above can have fired before this line.
      if (!writesUnsupported) {
        setStatus({ state: 'running', path: bound.path, index: bound.index });
      }
    };
    init().catch((err) => {
      if (!stopped) setStatus({ state: 'error', error: String(err) });
    });

    return () => {
      stopped = true;
      clearInterval(interval);
      rewriteRef.current = () => undefined;
      unlisten?.();
      unlistenApps?.();
      if (appServerStarted) {
        import('@tauri-apps/api/core')
          .then(({ invoke }) => invoke('stop_app_presence_server'))
          .catch(() => undefined);
      }
      setAppServerStatus(undefined);
      // Leave no stale presence behind when disabling or tearing down.
      mx.deleteExtendedProfileProperty(MSC4320_RPC).catch(() => undefined);
      mx.deleteExtendedProfileProperty(MSC4544_RPC).catch(() => undefined);
      if (started) {
        import('@tauri-apps/api/core')
          .then(({ invoke }) => invoke('stop_rich_presence_bridge'))
          .catch(() => undefined);
      }
      setStatus({ state: 'stopped' });
    };
  }, [mx, enabled, setStatus, setAppServerStatus, setKnownApps, setSocketSalt]);
};

/** Renders nothing; exists to host the publisher hook inside the client tree. */
export function RichPresencePublisher() {
  useRichPresencePublisher();
  return null;
}
