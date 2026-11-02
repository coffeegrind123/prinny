import { isRoomId } from './matrix';

/**
 * Whether this client joins a space's rooms on its own.
 *
 * Two inputs, and the user's always decides:
 *
 *   space admin ── state `app.prinny.space.auto_join {auto_join}` ── "this space asks"
 *   user ───────── account data `app.prinny.auto_join {mode, spaces}`
 *
 *   per-space choice (spaces[id])   true → join     false → never
 *   otherwise mode                  all → join      requested → join if the space asks
 *                                   off → never
 *
 * The space's event can only ever matter in "requested" mode. Anyone with
 * state power in a space (PL 50 by default) can set it and name any rooms on
 * any servers through `m.space.child` `via`, so it must never be able to make
 * a client join on its own.
 *
 * The account preference follows the user to every device. A device that has
 * never seen it falls back to the old per-device switch, so turning that on
 * keeps meaning "all spaces" until the user picks a mode.
 */

export enum AutoJoinMode {
  Off = 'off',
  /** Only spaces whose admins turned auto-join on. */
  Requested = 'requested',
  All = 'all',
}

const MODES: readonly string[] = Object.values(AutoJoinMode);

export type AutoJoinPrefs = {
  mode: AutoJoinMode;
  /** Per-space choices that beat the mode: true always joins, false never does. */
  spaces: Record<string, boolean>;
};

export const parseAutoJoin = (content: unknown, deviceSetting: boolean): AutoJoinPrefs => {
  if (typeof content !== 'object' || content === null) {
    return { mode: deviceSetting ? AutoJoinMode.All : AutoJoinMode.Off, spaces: {} };
  }

  const { mode, spaces } = content as Record<string, unknown>;
  const parsedSpaces: Record<string, boolean> = {};
  if (typeof spaces === 'object' && spaces !== null) {
    Object.entries(spaces).forEach(([spaceId, value]) => {
      if (isRoomId(spaceId) && typeof value === 'boolean') {
        parsedSpaces[spaceId] = value;
      }
    });
  }

  return {
    // An unknown mode written by a newer client fails safe.
    mode:
      typeof mode === 'string' && MODES.includes(mode) ? (mode as AutoJoinMode) : AutoJoinMode.Off,
    spaces: parsedSpaces,
  };
};

export const autoJoinsSpace = (
  prefs: AutoJoinPrefs,
  spaceId: string,
  spaceRequests: boolean,
): boolean => {
  const choice = prefs.spaces[spaceId];
  if (choice !== undefined) {
    return choice;
  }
  if (prefs.mode === AutoJoinMode.All) {
    return true;
  }
  return prefs.mode === AutoJoinMode.Requested && spaceRequests;
};

/** New account data content with one space's choice set, or cleared with undefined. */
export const withSpaceOverride = (
  content: Record<string, unknown> | undefined,
  spaceId: string,
  choice: boolean | undefined,
): Record<string, unknown> => {
  const current =
    typeof content?.spaces === 'object' && content.spaces !== null
      ? (content.spaces as Record<string, unknown>)
      : {};
  const spaces = { ...current };
  if (choice === undefined) {
    delete spaces[spaceId];
  } else {
    spaces[spaceId] = choice;
  }
  return { ...content, spaces };
};
