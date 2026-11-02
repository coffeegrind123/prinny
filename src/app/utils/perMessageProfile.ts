import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';

/**
 * Per-message sender profiles: one account posting as "CI", "Deploy",
 * "Alerts", the way a Discord webhook does.
 *
 * Read from, in order:
 *   `m.per_message_profile`            MSC4144 stable (not yet accepted)
 *   `com.beeper.per_message_profile`   MSC4144 unstable: mautrix bridges
 *                                      (Discord webhooks too), Sable, gomuks
 *   `in.prinny.webhook`                Prinny's own pre-MSC key, still in
 *                                      room history
 *
 *   { "id": "<opaque, ≤255 bytes, no NUL>",       required
 *     "displayname": "<≤255 bytes>",              optional
 *     "avatar_url": "mxc://…" | "avatar_file": EncryptedFile,
 *     "has_fallback": true,                        name is prefixed into the body
 *     "in.prinny.webhook": { "id": "<webhook>" }   our extension: show WEBHOOK }
 *
 * Everything here is self-asserted by the sender, like a display name, so
 * the UI always marks it (WEBHOOK badge, or "via" the real account).
 */

export const PER_MESSAGE_PROFILE_KEY = 'm.per_message_profile';
export const PER_MESSAGE_PROFILE_KEY_UNSTABLE = 'com.beeper.per_message_profile';
export const WEBHOOK_PROFILE_KEY = 'in.prinny.webhook';

/** MSC4144's limits for `id` and `displayname`. */
const MAX_FIELD_BYTES = 255;
/** A name is chrome; one that runs on pushes the rest of the header away. */
const DISPLAY_NAME_MAX_CHARS = 80;

export type PerMessageProfile = {
  id: string;
  displayname?: string;
  avatarUrl?: string;
  avatarFile?: EncryptedAttachmentInfo & { url: string };
  /** The body starts with the name; strip it before rendering. */
  hasFallback: boolean;
  /** Posted through a Discord-style webhook. */
  isWebhook: boolean;
};

type Content = Record<string, unknown>;

const isRecord = (value: unknown): value is Content =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

const validField = (value: unknown): value is string =>
  typeof value === 'string' && !value.includes('\0') && byteLength(value) <= MAX_FIELD_BYTES;

const cleanName = (value: unknown): string | undefined => {
  if (!validField(value)) return undefined;
  const name = value.replace(/\s+/g, ' ').trim();
  return name ? Array.from(name).slice(0, DISPLAY_NAME_MAX_CHARS).join('') : undefined;
};

/** Rendering a remote URL would leak every reader's address to whoever chose it. */
const mxcOnly = (value: unknown): string | undefined =>
  typeof value === 'string' && value.startsWith('mxc://') ? value : undefined;

const parseMsc4144 = (raw: unknown): PerMessageProfile | undefined => {
  if (!isRecord(raw) || !validField(raw.id) || raw.id === '') return undefined;

  const profile: PerMessageProfile = {
    id: raw.id,
    hasFallback: raw.has_fallback === true,
    isWebhook: isRecord(raw[WEBHOOK_PROFILE_KEY]),
  };
  const displayname = cleanName(raw.displayname);
  if (displayname) profile.displayname = displayname;
  const avatarUrl = mxcOnly(raw.avatar_url);
  if (avatarUrl) profile.avatarUrl = avatarUrl;
  if (!avatarUrl && isRecord(raw.avatar_file) && mxcOnly(raw.avatar_file.url)) {
    profile.avatarFile = raw.avatar_file as unknown as PerMessageProfile['avatarFile'];
  }
  return profile;
};

const parseLegacyWebhook = (raw: unknown): PerMessageProfile | undefined => {
  if (!isRecord(raw)) return undefined;
  const displayname = cleanName(raw.username);
  const avatarUrl = mxcOnly(raw.avatar_url);
  if (!displayname && !avatarUrl) return undefined;

  const id = validField(raw.id) && raw.id ? raw.id : (displayname ?? avatarUrl ?? '');
  const profile: PerMessageProfile = { id, hasFallback: false, isWebhook: true };
  if (displayname) profile.displayname = displayname;
  if (avatarUrl) profile.avatarUrl = avatarUrl;
  return profile;
};

/** The per-message profile an event's (current, edited) content carries. */
export const getPerMessageProfile = (content: Content): PerMessageProfile | undefined =>
  parseMsc4144(content[PER_MESSAGE_PROFILE_KEY]) ??
  parseMsc4144(content[PER_MESSAGE_PROFILE_KEY_UNSTABLE]) ??
  parseLegacyWebhook(content[WEBHOOK_PROFILE_KEY]);

/** Content as it should be displayed: the name fallback removed when there is one. */
export const contentForDisplay = <T extends Content>(content: T): T => {
  const profile = getPerMessageProfile(content);
  return profile ? stripProfileFallback(content, profile) : content;
};

/**
 * What, besides the sender, decides whether two messages share a header.
 * Empty for an ordinary message. Different profiles of one account must never
 * merge, or later messages would show under the first one's name.
 */
export const profileGroupKey = (content: Content): string => {
  const profile = getPerMessageProfile(content);
  return profile ? `profile:${profile.id}` : '';
};

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes the `Name: ` fallback MSC4144 puts at the start of `body` and as a
 * `<strong data-mx-profile-fallback>` in `formatted_body`. Must run before the
 * HTML sanitiser, which drops the attribute but keeps the text.
 */
export const stripProfileFallback = <T extends Content>(
  content: T,
  profile: PerMessageProfile,
): T => {
  if (!profile.hasFallback || !profile.displayname) return content;

  const next: Content = { ...content };
  const prefix = `${profile.displayname}: `;
  if (typeof content.body === 'string' && content.body.startsWith(prefix)) {
    next.body = content.body.slice(prefix.length);
  }
  if (typeof content.formatted_body === 'string') {
    const name = escapeRegExp(escapeHtml(profile.displayname));
    const fallback = new RegExp(
      `<strong\\s+data-mx-profile-fallback(?:="")?\\s*>${name}: </strong\\s*>`,
    );
    next.formatted_body = content.formatted_body.replace(fallback, '');
  }
  return next as T;
};
