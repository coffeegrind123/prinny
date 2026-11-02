export enum AccountDataEvent {
  PushRules = 'm.push_rules',
  Direct = 'm.direct',
  IgnoredUserList = 'm.ignored_user_list',

  CinnySpaces = 'in.cinny.spaces',

  PrinnyRoomOrder = 'app.prinny.room_order',
  PrinnyGifFavorites = 'app.prinny.gif_favorites',
  PrinnyEmojiMashups = 'app.prinny.emoji_mashups',
  /** Rooms the user left, which space auto-join must not join again. */
  PrinnyLeftRooms = 'app.prinny.left_rooms',
  /** Whether this account auto-joins space rooms: a mode plus per-space choices. */
  PrinnyAutoJoin = 'app.prinny.auto_join',
  /** The user's own status message (and chosen presence), kept across presence changes. */
  PrinnyPresence = 'app.prinny.presence',

  /**
   * MSC4356, stable since Matrix 1.18. Content is
   * `{ recent_emoji: [{ emoji, total }] }` — note the OBJECT entries; the
   * `io.element.*` key below stores the same list as positional tuples.
   */
  RecentEmoji = 'm.recent_emoji',
  /** Element's pre-spec key, still the only one Element itself reads. */
  ElementRecentEmoji = 'io.element.recent_emoji',

  PoniesUserEmotes = 'im.ponies.user_emotes',
  PoniesEmoteRooms = 'im.ponies.emote_rooms',

  SecretStorageDefaultKey = 'm.secret_storage.default_key',

  CrossSigningMaster = 'm.cross_signing.master',
  CrossSigningSelf = 'm.cross_signing.self',
  CrossSigningUser = 'm.cross_signing.user',
  MegolmBackupV1 = 'm.megolm_backup.v1',

  /** MSC4287: whether the user wants a server key backup. Element reads this first. */
  KeyBackup = 'm.key_backup',
  /** MSC4287's unstable key, with the opposite sense; Element still writes both. */
  KeyBackupDisabledUnstable = 'm.org.matrix.custom.backup_disabled',
}

export type MDirectContent = Record<string, string[]>;

export type SecretStorageDefaultKeyContent = {
  key: string;
};

export type SecretStoragePassphraseContent = {
  algorithm: string;
  salt: string;
  iterations: number;
  bits?: number;
};

export type SecretStorageKeyContent = {
  name?: string;
  algorithm: string;
  iv?: string;
  mac?: string;
  passphrase?: SecretStoragePassphraseContent;
};

export type SecretContent = {
  iv: string;
  ciphertext: string;
  mac: string;
};

export type SecretAccountData = {
  encrypted: Record<string, SecretContent>;
};

/**
 * How rooms within a space are ordered in the per-user sidebar nav.
 * - `default`: canonical order from the `m.space.child` state events
 * - `custom`: user-defined manual order, persisted in `RoomOrderContent.orders`
 */
export type RoomSortMode = 'default' | 'custom';

type StoredRoomSortMode = RoomSortMode | 'alpha' | 'activity';

/**
 * Per-user room ordering, synced across devices via account data.
 * `sortModes` maps a root space roomId to the selected sort mode for that space.
 * `orders` maps a parent space roomId to the ordered list of child roomIds,
 * used only while that parent's section is in `custom` sort mode.
 */
export type RoomOrderContent = {
  sortModes?: Record<string, StoredRoomSortMode>;
  orders?: Record<string, string[]>;
};
