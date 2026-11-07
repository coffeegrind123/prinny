/**
 * Bot deep links — Telegram's `https://t.me/bot?start=payload`, for Matrix.
 *
 * Three forms, all accepted:
 *
 *     https://prinny.app/bot/@helper:example.org?start=invite_abc
 *     prinny://bot/@helper:example.org?start=invite_abc
 *     matrix:u/helper:example.org?action=chat&app.prinny.bot.start=invite_abc
 *
 * The `matrix:` one is a standard MSC2312 chat link with our payload
 * parameter, so other clients still open the DM. It counts as a bot link only
 * with that parameter: a bare chat link can name a person, and following it
 * must not send them `/start`.
 *
 * The https form is the shareable one and is what a user clicks inside the
 * app or on the web. The `prinny:` form exists because an https link opened
 * from *outside* the app goes to the browser: reaching the desktop or Android
 * app needs a registered scheme, and registering one is far less work than the
 * hosted-file dance that Android App Links and Apple universal links require.
 *
 * Mirrors `parseDeepLink` in the `@prinny/bot` package; see the deep links
 * section of the protocol spec.
 */

// Taken from the vendored protocol module rather than restated here: these
// four values have to match what bots build, and a second copy is a second
// thing to forget to update.
import {
  DEEP_LINK_MATRIX_START_PARAM,
  DEEP_LINK_ORIGIN as BOT_LINK_ORIGIN,
  DEEP_LINK_PATH_PREFIX as BOT_LINK_PATH_PREFIX,
  DEEP_LINK_SCHEME as BOT_LINK_SCHEME,
  DEEP_LINK_SCHEME_HOST as BOT_LINK_SCHEME_HOST,
  Limits,
} from '../../types/matrix/bot';

export { BOT_LINK_ORIGIN, BOT_LINK_PATH_PREFIX, BOT_LINK_SCHEME, BOT_LINK_SCHEME_HOST };

export type BotDeepLink = {
  userId: string;
  payload?: string;
};

const MXID_PATTERN = /^@[^\s:]+:[^\s/]+$/;

/** `matrix:u/<user>?action=chat&app.prinny.bot.start=<payload>`, or null. */
const parseMatrixChatLink = (url: URL): BotDeepLink | null => {
  // Non-special scheme: everything after `matrix:` up to `?` is the path.
  const match = /^u\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  if (url.searchParams.get('action') !== 'chat') return null;

  let userId: string;
  try {
    userId = `@${decodeURIComponent(match[1])}`;
  } catch {
    return null;
  }
  if (!MXID_PATTERN.test(userId)) return null;

  const payload = url.searchParams.get(DEEP_LINK_MATRIX_START_PARAM);
  if (payload === null || !Limits.DEEP_LINK_PAYLOAD_PATTERN.test(payload)) return null;
  return { userId, payload };
};

/**
 * Parse a bot deep link, or return null.
 *
 * Strict on purpose. Following one of these makes the client send a message on
 * the user's behalf, so an out-of-spec payload is rejected rather than passed
 * through — "be liberal in what you accept" is the wrong rule when what you
 * accept becomes something you say.
 */
export const parseBotDeepLink = (link: string): BotDeepLink | null => {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }

  if (url.protocol === 'matrix:') return parseMatrixChatLink(url);

  let encodedUserId: string;
  if (url.protocol === BOT_LINK_SCHEME) {
    // A custom scheme has no meaningful `origin` — it parses as "null" — so
    // the host is checked directly instead.
    if (url.host !== BOT_LINK_SCHEME_HOST) return null;
    encodedUserId = url.pathname.replace(/^\//, '');
  } else {
    if (url.origin !== BOT_LINK_ORIGIN) return null;
    if (!url.pathname.startsWith(BOT_LINK_PATH_PREFIX)) return null;
    encodedUserId = url.pathname.slice(BOT_LINK_PATH_PREFIX.length);
  }

  // Exactly one decode. Decoding twice would let `%2540` smuggle an `@`
  // through this check.
  let userId: string;
  try {
    userId = decodeURIComponent(encodedUserId);
  } catch {
    return null;
  }
  if (!MXID_PATTERN.test(userId)) return null;

  const payload = url.searchParams.get('start');
  if (payload === null) return { userId };
  if (!Limits.DEEP_LINK_PAYLOAD_PATTERN.test(payload)) return null;

  return { userId, payload };
};

/** The message sent after the user confirms. */
export const botStartMessage = (payload?: string): string =>
  payload ? `/start ${payload}` : '/start';
