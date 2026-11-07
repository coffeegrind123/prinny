/**
 * MSC4278 media preview controls (merged 08.2026).
 *
 *   m.media_preview_config                   stable, global or room account data
 *   io.element.msc4278.media_preview_config  unstable, what Element writes
 *     { "media_previews": "on" | "private" | "off",
 *       "invite_avatars": "on" | "off" }
 *
 * Resolution, per key:
 *   room account data  >  global account data  >  "on" (the default)
 * Within one level the stable type wins over the unstable one. A key that is
 * present with a value we do not know is "off": the MSC requires that so a
 * future value never falls back to showing media.
 *
 * "private" allows previews only where m.room.join_rules is invite, knock,
 * restricted or knock_restricted. A missing or unknown join rule is public.
 */

export const MEDIA_PREVIEW_STABLE = 'm.media_preview_config';
export const MEDIA_PREVIEW_UNSTABLE = 'io.element.msc4278.media_preview_config';
export const MEDIA_PREVIEW_TYPES = [MEDIA_PREVIEW_STABLE, MEDIA_PREVIEW_UNSTABLE] as const;

export type MediaPreviewValue = 'on' | 'private' | 'off';
export type InviteAvatarsValue = 'on' | 'off';

export type MediaPreviewConfig = {
  media_previews: MediaPreviewValue;
  invite_avatars: InviteAvatarsValue;
};

/** One level's keys as written; absent keys fall through to the next level. */
export type PartialMediaPreviewConfig = Partial<MediaPreviewConfig>;

export const DEFAULT_MEDIA_PREVIEW_CONFIG: MediaPreviewConfig = {
  media_previews: 'on',
  invite_avatars: 'on',
};

const PRIVATE_JOIN_RULES = new Set(['invite', 'knock', 'restricted', 'knock_restricted']);

type Content = Record<string, unknown>;

const isRecord = (value: unknown): value is Content =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toMediaPreviews = (value: unknown): MediaPreviewValue =>
  value === 'on' || value === 'private' ? value : 'off';

const toInviteAvatars = (value: unknown): InviteAvatarsValue => (value === 'on' ? 'on' : 'off');

/** One account-data content, normalised. Absent keys stay absent; unknown values become "off". */
export const parseMediaPreviewContent = (content: unknown): PartialMediaPreviewConfig => {
  if (!isRecord(content)) return {};
  const parsed: PartialMediaPreviewConfig = {};
  if ('media_previews' in content) parsed.media_previews = toMediaPreviews(content.media_previews);
  if ('invite_avatars' in content) parsed.invite_avatars = toInviteAvatars(content.invite_avatars);
  return parsed;
};

/**
 * One level (global or a room), from its contents keyed by type. The stable
 * event is the whole answer when it exists: a client that wrote stable owns
 * the setting, and mixing keys from an older unstable copy would resurrect a
 * value the user already changed.
 */
export const readMediaPreviewLevel = (
  contents: Partial<Record<string, unknown>>,
): PartialMediaPreviewConfig => {
  const stable = contents[MEDIA_PREVIEW_STABLE];
  if (isRecord(stable)) return parseMediaPreviewContent(stable);
  return parseMediaPreviewContent(contents[MEDIA_PREVIEW_UNSTABLE]);
};

export const resolveMediaPreviewConfig = (
  global: PartialMediaPreviewConfig,
  room?: PartialMediaPreviewConfig,
): MediaPreviewConfig => ({
  media_previews:
    room?.media_previews ?? global.media_previews ?? DEFAULT_MEDIA_PREVIEW_CONFIG.media_previews,
  invite_avatars:
    room?.invite_avatars ?? global.invite_avatars ?? DEFAULT_MEDIA_PREVIEW_CONFIG.invite_avatars,
});

export const isPrivateJoinRule = (joinRule: unknown): boolean =>
  typeof joinRule === 'string' && PRIVATE_JOIN_RULES.has(joinRule);

/** Whether media in a room may load without the user clicking first. */
export const mediaPreviewsAllowed = (value: MediaPreviewValue, joinRule: unknown): boolean => {
  if (value === 'on') return true;
  if (value === 'private') return isPrivateJoinRule(joinRule);
  return false;
};

/** Account data to write, by type, for one level. Stable first, then unstable. */
export const mediaPreviewWrites = (config: PartialMediaPreviewConfig): Record<string, Content> => ({
  [MEDIA_PREVIEW_STABLE]: { ...config },
  [MEDIA_PREVIEW_UNSTABLE]: { ...config },
});
