/**
 * Android share-sheet target — the JS half.
 *
 * The Kotlin half is `ShareTargetPlugin.kt` in the Tauri shell, reached through
 * the manifest's `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intent filters. Read its
 * class comment before changing anything here; in particular, the file tokens
 * below are one-shot capabilities minted per share, NOT content URIs, and
 * that is deliberate.
 *
 * Everything that arrives here was authored by another app on the device and
 * has to be treated as such. It is validated for shape at the boundary and
 * never acted on automatically: the payload ends up staged in a composer that
 * the user still has to send.
 */
import { isTauri } from './desktop-notifications';

/** A file the OS handed us, addressable only by its one-shot token. */
export type SharedFileRef = {
  token: string;
};

export type SharePayload = {
  /** `Intent.EXTRA_TEXT` — usually the URL or the selected text. */
  text: string;
  /** `Intent.EXTRA_SUBJECT` — usually the page title, often absent. */
  subject: string;
  files: SharedFileRef[];
};

const isSharePayload = (value: unknown): value is SharePayload => {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  if (typeof p.text !== 'string' || typeof p.subject !== 'string') return false;
  if (!Array.isArray(p.files)) return false;
  return p.files.every(
    (f) => typeof f === 'object' && f !== null && typeof (f as SharedFileRef).token === 'string',
  );
};

/**
 * The text to seed the composer with.
 *
 * Senders are inconsistent: a browser typically sets subject to the page title
 * and text to the URL, while a plain text selection sets only text and some
 * apps repeat the title inside the text. Joining blindly produces a duplicated
 * title often enough to be worth the check.
 */
export const shareText = (payload: SharePayload): string => {
  const { text, subject } = payload;
  if (!subject) return text;
  if (!text) return subject;
  if (text.includes(subject)) return text;
  return `${subject}\n${text}`;
};

/**
 * Reads one shared file by token.
 *
 * The token is consumed by the read, so this cannot be retried and must not be
 * called twice for the same file. Bytes come over the bridge as base64 — see
 * the size cap and reasoning in ShareTargetPlugin.kt.
 */
export const readSharedFile = async (token: string): Promise<File> => {
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<{ name: string; mime: string; base64: string }>(
    'plugin:share-target|read_shared_file',
    { token },
  );

  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], result.name, { type: result.mime });
};

/**
 * Listens for shares. Returns an unlisten function.
 *
 * Also signals the plugin that a listener exists, which replays a share that
 * arrived during cold start — on Android the intent is delivered in
 * `MainActivity.onCreate`, long before React has mounted. Same arrangement as
 * `onNotificationAction`'s `js_ready` call.
 */
export const onShareReceived = async (
  callback: (payload: SharePayload) => void,
): Promise<() => void> => {
  if (!isTauri()) return () => {};

  try {
    // addPluginListener, NOT listen(): the Kotlin side emits through
    // `Plugin.trigger`, which only feeds channels registered by the plugin's
    // own `registerListener` command. A global `listen('share-received')`
    // subscribes to a bus nothing publishes to.
    const { addPluginListener, invoke } = await import('@tauri-apps/api/core');
    const listener = await addPluginListener<unknown>(
      'share-target',
      'share-received',
      (payload) => {
        if (!isSharePayload(payload)) {
          // Loud on purpose. This event comes from our own Kotlin, so a shape
          // mismatch means the two halves have drifted — which would otherwise
          // present as "sharing into Prinny silently does nothing".
          console.error('[share] Ignoring share payload of unexpected shape:', payload);
          return;
        }
        callback(payload);
      },
    );

    try {
      await invoke('plugin:share-target|js_ready');
    } catch {
      // Plugin not present (desktop / web) — nothing shares into those.
    }

    return () => {
      listener.unregister();
    };
  } catch (err) {
    console.error('[share] Failed to register share-received listener:', err);
    return () => {};
  }
};
