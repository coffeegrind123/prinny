/**
 * MSC4544's local transport, webview side: what apps (games, media players)
 * send over the desktop app's WebSocket, which of them may publish, and how
 * their entries join the user's `m.rpc` profile field.
 *
 * The Rust server (`app_presence.rs` in prinny-client) only frames and
 * forwards; every message is untrusted here. MSC4544 requires a per-app
 * allow/deny choice whose default is deny, so nothing an app sends is
 * published until the user allows that app.
 */

import {
  MSC4544_MAX_BUTTONS,
  MSC4544_MAX_ENTRIES,
  MSC4544_RPC_ACTIVITY,
  MSC4544_RPC_MUSIC,
  parseMsc4544Buttons,
} from '../../types/matrix/richPresence';

/** An app as the user sees it in settings. Stored per device: apps are local. */
export type KnownApp = {
  name: string;
  /** Undefined until the user decides; the default policy applies meanwhile. */
  allowed?: boolean;
  lastSeen: number;
};

export type KnownApps = Record<string, KnownApp>;

export type AppPresencePolicy = 'deny' | 'allow';

export type AppEntry = {
  appId: string;
  /** Sanitized MSC4544 PresenceDataObject, ready to publish. */
  entry: Record<string, unknown> & { id: string; expiry: number };
  receivedAt: number;
};

export type AppMessage =
  | { kind: 'add'; appId: string; appName: string; entry: AppEntry['entry'] }
  | { kind: 'remove'; appId: string; appName: string; entryId: string };

/**
 * Longest an app entry may stay published, whatever expiry the app asked
 * for. MSC4544 asks senders for "seconds to a few minutes"; an app that
 * crashes after claiming a day would otherwise be "playing" until then.
 */
export const APP_ENTRY_MAX_LIFETIME = 15 * 60 * 1000;

const STRING_MAX = 256;
const ID_MAX = 128;
const APP_NAME_MAX = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, max = STRING_MAX): string | undefined => {
  if (typeof value !== 'string') return undefined;
  // Control and bidi override characters have no business in a status line.
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '');
  const trimmed = clean.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const timestamp = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

const mxc = (value: unknown): string | undefined => {
  const url = text(value, 512);
  return url && /^mxc:\/\/[^/\s]+\/[^/\s]+$/.test(url) ? url : undefined;
};

const ACTIVITY_TYPES = new Set(['m.rpc.activity', MSC4544_RPC_ACTIVITY]);
const MUSIC_TYPES = new Set(['m.rpc.music', MSC4544_RPC_MUSIC]);

/**
 * An app's PresenceDataObject, keeping only fields MSC4544 defines, or
 * undefined when it is unusable. Written back under the unstable type names,
 * as Prinny's own entries are.
 */
export const sanitizeAppEntry = (raw: unknown, now: number): AppEntry['entry'] | undefined => {
  if (!isRecord(raw)) return undefined;
  const id = text(raw.id, ID_MAX);
  const requested = timestamp(raw.expiry);
  if (!id || requested === undefined || requested <= now) return undefined;
  const expiry = Math.min(requested, now + APP_ENTRY_MAX_LIFETIME);

  const put = (out: Record<string, unknown>, key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };

  let entry: Record<string, unknown>;
  if (typeof raw.type === 'string' && ACTIVITY_TYPES.has(raw.type)) {
    const name = text(raw.name);
    if (!name) return undefined;
    entry = { id, type: MSC4544_RPC_ACTIVITY, expiry, name };
    put(entry, 'state', text(raw.state));
    put(entry, 'details', text(raw.details));
    put(entry, 'since', timestamp(raw.since));
    put(entry, 'until', timestamp(raw.until));
    const largeIcon = mxc(raw.large_icon_url);
    if (largeIcon) {
      entry.large_icon_url = largeIcon;
      put(entry, 'large_icon_tooltip', text(raw.large_icon_tooltip));
      const smallIcon = mxc(raw.small_icon_url);
      if (smallIcon) {
        entry.small_icon_url = smallIcon;
        put(entry, 'small_icon_tooltip', text(raw.small_icon_tooltip));
      }
    }
  } else if (typeof raw.type === 'string' && MUSIC_TYPES.has(raw.type)) {
    const track = text(raw.track);
    if (!track) return undefined;
    entry = { id, type: MSC4544_RPC_MUSIC, expiry, track };
    put(entry, 'artist', text(raw.artist));
    put(entry, 'album', text(raw.album));
    put(entry, 'player_name', text(raw.player_name));
    put(entry, 'cover_url', mxc(raw.cover_url));
    if (isRecord(raw.progress)) {
      const since = timestamp(raw.progress.since);
      const until = timestamp(raw.progress.until);
      if (since !== undefined && until !== undefined && until > since) {
        entry.progress = { since, until };
      }
    }
  } else {
    return undefined;
  }

  const buttons = parseMsc4544Buttons(raw.buttons);
  if (buttons) {
    entry.buttons = buttons.slice(0, MSC4544_MAX_BUTTONS).map((button) => ({
      label: button.label,
      url: button.url,
      ...(button.requestOpenId ? { request_openid: true } : {}),
    }));
  }
  return entry as AppEntry['entry'];
};

/** One WebSocket message from an app, or undefined when it is not a valid one. */
export const parseAppMessage = (raw: unknown, now: number): AppMessage | undefined => {
  if (!isRecord(raw) || !isRecord(raw.app_id) || !isRecord(raw.data)) return undefined;
  const appId = text(raw.app_id.id, ID_MAX);
  const appName = text(raw.app_id.name, APP_NAME_MAX) ?? appId;
  if (!appId || !appName) return undefined;

  if (raw.type === 'add_presence') {
    const entry = sanitizeAppEntry(raw.data, now);
    return entry ? { kind: 'add', appId, appName, entry } : undefined;
  }
  if (raw.type === 'remove_presence') {
    const entryId = text(raw.data.id, ID_MAX);
    return entryId ? { kind: 'remove', appId, appName, entryId } : undefined;
  }
  return undefined;
};

/** Whether an app may publish: its own choice, else the default (deny). */
export const isAppAllowed = (apps: KnownApps, policy: AppPresencePolicy, appId: string): boolean =>
  apps[appId]?.allowed ?? policy === 'allow';

/**
 * Apply a message to the in-memory entries. Entries are keyed by app and
 * entry id together, so one app cannot replace or remove another app's entry
 * by reusing its id.
 */
export const applyAppMessage = (
  entries: Map<string, AppEntry>,
  message: AppMessage,
  now: number,
): void => {
  if (message.kind === 'add') {
    entries.set(`${message.appId}\n${message.entry.id}`, {
      appId: message.appId,
      entry: message.entry,
      receivedAt: now,
    });
  } else {
    entries.delete(`${message.appId}\n${message.entryId}`);
  }
};

/**
 * The MSC4544 array to publish: the Discord-bridge entry first, then allowed
 * apps' entries, newest first, without expired ones, at most four in all.
 * Expired entries are also dropped from `entries`, as MSC4544 asks senders to
 * remove them before writing.
 */
export const publishableEntries = (
  discordEntry: Record<string, unknown> | undefined,
  entries: Map<string, AppEntry>,
  allowed: (appId: string) => boolean,
  now: number,
): Record<string, unknown>[] => {
  [...entries].forEach(([key, value]) => {
    if (value.entry.expiry <= now) entries.delete(key);
  });
  const fromApps = [...entries.values()]
    .filter((value) => allowed(value.appId))
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .map((value) => value.entry);
  return [...(discordEntry ? [discordEntry] : []), ...fromApps].slice(0, MSC4544_MAX_ENTRIES);
};

/**
 * The record of an app after hearing from it, or undefined when nothing the
 * user sees has changed (so settings are not rewritten on every message).
 */
export const notedApp = (
  apps: KnownApps,
  appId: string,
  appName: string,
  now: number,
): KnownApp | undefined => {
  const known = apps[appId];
  if (known && known.name === appName && now - known.lastSeen < 24 * 60 * 60 * 1000) {
    return undefined;
  }
  return { ...known, name: appName, lastSeen: now };
};

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * MSC4544's `[opaque_id]` for the unix socket path: HMAC-SHA256 of the user
 * ID under a per-installation salt, truncated to 32 hex characters. The path
 * then neither reveals who is logged in nor can be predicted by another local
 * user to squat it.
 */
export const opaqueSocketId = async (salt: string, userId: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(userId));
  return toHex(mac).slice(0, 32);
};

/** A new random salt, 32 bytes as hex. */
export const newSocketSalt = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
};
