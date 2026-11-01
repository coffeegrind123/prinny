import { ConnectionError, HTTPError, MatrixError } from 'matrix-js-sdk';
import { ErrorCode } from '../cs-errorcode';

/*
 * Turns any thrown value into one sentence a person can read.
 *
 * matrix-js-sdk bakes transport detail into `MatrixError.message`:
 *
 *   MatrixError: [400] Adding an email to your account is disabled on this server
 *     (https://hs.example:8448/_matrix/client/v3/account/3pid/email/requestToken)
 *
 * The server's own sentence is kept separately in `data.error`, so a MatrixError
 * is read from there. The status, errcode and URL stay on the error object for
 * the console; none of them belong on screen.
 *
 * The same prefixed text also turns up inside plain `Error`s, because code that
 * re-wraps a MatrixError copies its message (uploadContent's catch did exactly
 * that). `stripSdkDecoration` handles those.
 */

const ERRCODE_TEXT: Partial<Record<string, string>> = {
  [ErrorCode.M_FORBIDDEN]: "You don't have permission to do that.",
  [ErrorCode.M_UNKNOWN_TOKEN]: 'Your session has expired. Sign in again.',
  [ErrorCode.M_MISSING_TOKEN]: 'You need to be signed in to do that.',
  [ErrorCode.M_NOT_FOUND]: "That doesn't exist on the server.",
  [ErrorCode.M_UNRECOGNIZED]: "Your homeserver doesn't support this.",
  [ErrorCode.M_TOO_LARGE]: 'That is too large for your homeserver.',
  [ErrorCode.M_USER_DEACTIVATED]: 'This account has been deactivated.',
  [ErrorCode.M_USER_IN_USE]: 'That username is already taken.',
  [ErrorCode.M_INVALID_USERNAME]: "That username isn't valid.",
  [ErrorCode.M_WEAK_PASSWORD]: 'That password is too weak.',
  [ErrorCode.M_PASSWORD_TOO_SHORT]: 'That password is too short.',
  [ErrorCode.M_ROOM_IN_USE]: 'That room address is already taken.',
  [ErrorCode.M_THREEPID_IN_USE]: 'That address is already linked to an account.',
  [ErrorCode.M_THREEPID_NOT_FOUND]: "That address isn't linked to any account.",
  [ErrorCode.M_THREEPID_AUTH_FAILED]: "That address hasn't been verified yet.",
  [ErrorCode.M_THREEPID_DENIED]: "Your homeserver doesn't allow that address.",
  [ErrorCode.M_UNSUPPORTED_ROOM_VERSION]: "Your homeserver doesn't support that room version.",
  [ErrorCode.M_INCOMPATIBLE_ROOM_VERSION]: "Your homeserver doesn't support this room's version.",
  [ErrorCode.M_GUEST_ACCESS_FORBIDDEN]: "Guests can't do that here.",
  [ErrorCode.M_RESOURCE_LIMIT_EXCEEDED]: 'Your homeserver has reached a usage limit.',
  [ErrorCode.M_CANNOT_LEAVE_SERVER_NOTICE_ROOM]: "You can't leave the server notices room.",
};

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'The server rejected the request.',
  401: 'Your session has expired. Sign in again.',
  403: "You don't have permission to do that.",
  404: "That doesn't exist on the server.",
  413: 'That is too large for your homeserver.',
  429: 'Too many requests. Wait a moment and try again.',
};

const SERVER_FAULT = 'The server ran into a problem. Try again later.';
const CONNECTION_FAULT = "Couldn't reach the server. Check your connection and try again.";
export const UNKNOWN_ERROR = 'Something went wrong.';

// The SDK's placeholder when the server sent an errcode but no sentence.
const SDK_NO_MESSAGE = 'Unknown message';

// "MatrixError: " (possibly repeated), an optional "[NNN] ", the text, and an
// optional trailing " (https://…)".
const SDK_DECORATION =
  /^(?:MatrixError:\s*)+(?:\[\d{3}\]\s*)?([\s\S]*?)(?:\s*\(https?:\/\/[^\s)]*\))?$/;

export const stripSdkDecoration = (message: string): string => {
  const match = SDK_DECORATION.exec(message.trim());
  if (!match) {
    return message.trim();
  }
  return match[1].trim();
};

const statusText = (status: number | undefined): string | undefined => {
  if (status === undefined) {
    return undefined;
  }
  if (status >= 500) {
    return SERVER_FAULT;
  }
  return HTTP_STATUS_TEXT[status];
};

const rateLimitText = (error: HTTPError): string => {
  let ms: number | null;
  try {
    ms = error.getRetryAfterMs();
  } catch {
    ms = null;
  }
  if (ms === null || ms <= 0) {
    return HTTP_STATUS_TEXT[429];
  }
  const seconds = Math.ceil(ms / 1000);
  return `Too many requests. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
};

const usable = (text: string | undefined): text is string =>
  typeof text === 'string' && text.trim() !== '' && text.trim() !== SDK_NO_MESSAGE;

const fromMatrixError = (error: MatrixError): string | undefined => {
  if (error.isRateLimitError()) {
    return rateLimitText(error);
  }

  const serverText = error.data?.error ?? error.error;
  if (usable(serverText)) {
    return stripSdkDecoration(serverText);
  }

  const errcode = error.errcode ?? error.data?.errcode;
  if (errcode && ERRCODE_TEXT[errcode]) {
    return ERRCODE_TEXT[errcode];
  }

  return statusText(error.httpStatus);
};

/**
 * A short, human sentence describing `error`, with no SDK prefix, HTTP status
 * or request URL in it. `fallback` is used when nothing better can be derived.
 */
export const errorMessage = (error: unknown, fallback: string = UNKNOWN_ERROR): string => {
  if (error instanceof MatrixError) {
    return fromMatrixError(error) ?? fallback;
  }

  if (error instanceof ConnectionError) {
    return CONNECTION_FAULT;
  }

  // A non-JSON HTTP error's message is "Server returned 502 error: <body>",
  // and the body is often a whole HTML page from a reverse proxy.
  if (error instanceof HTTPError) {
    if (error.isRateLimitError()) {
      return rateLimitText(error);
    }
    return statusText(error.httpStatus) ?? fallback;
  }

  if (typeof error === 'string') {
    return usable(error) ? stripSdkDecoration(error) : fallback;
  }

  if (error instanceof Error) {
    return usable(error.message) ? stripSdkDecoration(error.message) || fallback : fallback;
  }

  // Plain objects that look like a Matrix error body ({ errcode, error }),
  // e.g. what a widget or worker hands back across postMessage.
  if (typeof error === 'object' && error !== null) {
    const body = error as { error?: unknown; errcode?: unknown; message?: unknown };
    if (typeof body.error === 'string' && usable(body.error)) {
      return stripSdkDecoration(body.error);
    }
    if (typeof body.message === 'string' && usable(body.message)) {
      return stripSdkDecoration(body.message);
    }
    if (typeof body.errcode === 'string' && ERRCODE_TEXT[body.errcode]) {
      return ERRCODE_TEXT[body.errcode] as string;
    }
  }

  return fallback;
};
