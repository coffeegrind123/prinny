/**
 * "Block all invites", in every form a homeserver may enforce:
 *
 *   m.invite_permission_config                  MSC4380 (merged), stable
 *   org.matrix.msc4380.invite_permission_config MSC4380 unstable
 *     { "default_action": "block" }             anything else means allow
 *   org.matrix.msc4155.invite_permission_config MSC4155, the older, richer
 *     { "blocked_users": ["*"], … }             proposal some servers implement
 *
 * The server enforces it; the client only writes it. All three are written so
 * whichever one the user's server understands takes effect. Lists the user
 * built in MSC4155 with another client are kept; only the "*" entry is ours.
 */

export const INVITE_CONFIG_STABLE = 'm.invite_permission_config';
export const INVITE_CONFIG_UNSTABLE = 'org.matrix.msc4380.invite_permission_config';
export const INVITE_CONFIG_MSC4155 = 'org.matrix.msc4155.invite_permission_config';

const BLOCK = 'block';
const ALLOW = 'allow';
const EVERYONE = '*';

type Content = Record<string, unknown>;

const isRecord = (value: unknown): value is Content =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const listHas = (value: unknown, entry: string): boolean =>
  Array.isArray(value) && value.includes(entry);

/** Whether the account currently blocks every invite. `contents` is keyed by type. */
export const blocksAllInvites = (contents: Record<string, unknown>): boolean => {
  const stable = contents[INVITE_CONFIG_STABLE] ?? contents[INVITE_CONFIG_UNSTABLE];
  if (isRecord(stable)) return stable.default_action === BLOCK;

  const msc4155 = contents[INVITE_CONFIG_MSC4155];
  if (!isRecord(msc4155) || msc4155.enabled === false) return false;
  return listHas(msc4155.blocked_users, EVERYONE) || listHas(msc4155.blocked_servers, EVERYONE);
};

/** Account data to write, by type, to turn blocking on or off. */
export const inviteBlockingWrites = (
  block: boolean,
  currentMsc4155: unknown,
): Record<string, Content> => {
  const msc4155 = isRecord(currentMsc4155) ? { ...currentMsc4155 } : {};
  const users = Array.isArray(msc4155.blocked_users)
    ? msc4155.blocked_users.filter((u) => u !== EVERYONE)
    : [];
  if (block) users.push(EVERYONE);
  if (users.length > 0) {
    msc4155.blocked_users = users;
  } else {
    delete msc4155.blocked_users;
  }

  const action = { default_action: block ? BLOCK : ALLOW };
  return {
    [INVITE_CONFIG_STABLE]: action,
    [INVITE_CONFIG_UNSTABLE]: { ...action },
    [INVITE_CONFIG_MSC4155]: msc4155,
  };
};
