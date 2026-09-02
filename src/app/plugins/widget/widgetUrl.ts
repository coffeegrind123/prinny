/**
 * Validation for third-party widget URLs.
 *
 * This is the load-bearing security check for widgets, and the reason it exists
 * is worth stating in full.
 *
 * A widget runs in an iframe with `allow-scripts allow-same-origin`. For a
 * CROSS-origin widget that combination is safe: "same origin" there means the
 * widget's own origin, so it gets its own storage and cannot touch ours. For a
 * SAME-origin widget it is the documented sandbox-escape combination — the
 * frame can reach `window.parent`, strip the sandbox attribute, and read the
 * access token and megolm key store straight out of our localStorage/IndexedDB.
 * See the same warning at CallEmbed.getIframe, which accepts that risk for the
 * Element Call bundle specifically because it is pinned first-party code.
 *
 * Widget URLs come from room state, which means anybody with permission to send
 * state in a room chooses them. If one could name our own origin, adding a
 * widget to a room would be a full account takeover of everyone who opens it.
 * So: same-origin URLs are rejected outright, and only https is accepted.
 */

const ALLOWED_PROTOCOLS = new Set(['https:']);

export type WidgetUrlRejection =
  'invalid' | 'scheme' | 'same-origin' | 'credentials' | 'private-host';

export type WidgetUrlCheck =
  { ok: true; url: URL } | { ok: false; reason: WidgetUrlRejection; message: string };

// Hosts that resolve back to the user's own machine or network. A widget served
// from one of those is either our own app (see same-origin above) or something
// on the user's LAN that a remote room member should not be able to make their
// browser reach.
const PRIVATE_HOST_REG =
  /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[?::1\]?|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|.*\.local|.*\.localhost)$/i;

export const checkWidgetUrl = (rawUrl: string): WidgetUrlCheck => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid', message: 'That is not a valid URL.' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: 'scheme',
      message: 'Widgets must be served over https.',
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'credentials',
      message: 'Widget URLs must not contain credentials.',
    };
  }

  // The check this whole module exists for.
  if (url.origin === window.location.origin) {
    return {
      ok: false,
      reason: 'same-origin',
      message:
        'This widget is served from the same address as the app itself, which would give it access to your account. Refusing to load it.',
    };
  }

  if (PRIVATE_HOST_REG.test(url.hostname)) {
    return {
      ok: false,
      reason: 'private-host',
      message: 'Widgets cannot be loaded from local or private addresses.',
    };
  }

  return { ok: true, url };
};

export type WidgetTemplateValues = {
  widgetId: string;
  roomId: string;
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  deviceId?: string;
  baseUrl?: string;
};

/**
 * Fills the `$variable` placeholders a widget URL may contain.
 *
 * Values are URI-encoded, so a display name containing `&` or `#` cannot inject
 * extra query parameters into the widget's URL.
 */
export const fillWidgetUrlTemplate = (rawUrl: string, values: WidgetTemplateValues): string => {
  const replacements: Record<string, string> = {
    $matrix_widget_id: values.widgetId,
    $matrix_room_id: values.roomId,
    $matrix_user_id: values.userId,
    $matrix_display_name: values.displayName ?? '',
    $matrix_avatar_url: values.avatarUrl ?? '',
    $matrix_device_id: values.deviceId ?? '',
    $matrix_base_url: values.baseUrl ?? '',
  };

  return Object.entries(replacements).reduce(
    (acc, [key, value]) => acc.split(key).join(encodeURIComponent(value)),
    rawUrl,
  );
};
