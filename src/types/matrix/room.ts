import { IImageInfo } from './common';

export enum Membership {
  Invite = 'invite',
  Knock = 'knock',
  Join = 'join',
  Leave = 'leave',
  Ban = 'ban',
}

export type IMemberContent = {
  avatar_url?: string;
  displayname?: string;
  membership?: Membership;
  reason?: string;
  is_direct?: boolean;
};

export enum StateEvent {
  RoomCanonicalAlias = 'm.room.canonical_alias',
  RoomCreate = 'm.room.create',
  RoomJoinRules = 'm.room.join_rules',
  RoomMember = 'm.room.member',
  RoomThirdPartyInvite = 'm.room.third_party_invite',
  RoomPowerLevels = 'm.room.power_levels',
  RoomName = 'm.room.name',
  RoomTopic = 'm.room.topic',
  RoomAvatar = 'm.room.avatar',
  RoomPinnedEvents = 'm.room.pinned_events',
  RoomEncryption = 'm.room.encryption',
  RoomHistoryVisibility = 'm.room.history_visibility',
  RoomGuestAccess = 'm.room.guest_access',
  RoomServerAcl = 'm.room.server_acl',
  RoomTombstone = 'm.room.tombstone',
  GroupCallPrefix = 'org.matrix.msc3401.call',
  GroupCallMemberPrefix = 'org.matrix.msc3401.call.member',

  SpaceChild = 'm.space.child',
  SpaceParent = 'm.space.parent',

  PoniesRoomEmotes = 'im.ponies.room_emotes',
  /** Matrix v1.19 (MSC2545): stable name of `im.ponies.room_emotes`, same shape. */
  RoomImagePack = 'm.room.image_pack',
  PowerLevelTags = 'in.cinny.room.power_level_tags',

  /**
   * A bot's advertised commands, descriptions and menu button, with the bot's
   * MXID as the state key. See `src/types/matrix/bot/` and the protocol spec.
   */
  BotInfo = 'app.prinny.bot.info',

  /** Per-space opt-in to joining every room the space lists. */
  SpaceAutoJoin = 'app.prinny.space.auto_join',
}

export enum MessageEvent {
  RoomMessage = 'm.room.message',
  RoomMessageEncrypted = 'm.room.encrypted',
  Sticker = 'm.sticker',
  RoomRedaction = 'm.room.redaction',
  Reaction = 'm.reaction',

  /**
   * A bot advertising itself without power to set state. Same content as the
   * `BotInfo` state event; the state event wins where both exist.
   */
  BotInfo = 'app.prinny.bot.info',
  /** A button press, sent by us. */
  BotCallback = 'app.prinny.bot.callback',
  /** The bot's answer to a press. */
  BotCallbackAnswer = 'app.prinny.bot.callback_answer',
}

/**
 * Account data scoped to a single room, as opposed to the user-wide keys in
 * `types/matrix/accountData.ts`.
 */
export enum RoomAccountDataEvent {
  /**
   * MSC2867 "marking rooms as unread". Content is `{ unread: boolean }`.
   *
   * Stable since **Matrix 1.12** (October 2024) — this is ordinary spec, not a
   * proposal, and matrix-js-sdk types it natively as `EventType.MarkedUnread`.
   */
  MarkedUnread = 'm.marked_unread',
  /**
   * The pre-spec identifier for the same thing, still written by older clients
   * (Element used it for years, and famedly's Dart SDK, matrix-rust-sdk and
   * palpo all still read it). Read-only for us: we write the stable key, but a
   * room a user flagged from an older client must still look unread here.
   */
  MarkedUnreadLegacy = 'com.famedly.marked_unread',
}

export type MarkedUnreadContent = {
  unread?: boolean;
};

export enum RoomType {
  Space = 'm.space',
  Call = 'org.matrix.msc3417.call',
}

export type MSpaceChildContent = {
  via: string[];
  suggested?: boolean;
  order?: string;
};

export type SpaceAutoJoinContent = {
  auto_join?: boolean;
};

export enum NotificationType {
  Default = 'default',
  AllMessages = 'all_messages',
  MentionsAndKeywords = 'mentions_and_keywords',
  Mute = 'mute',
}

export type IRoomCreateContent = {
  creator?: string;
  ['m.federate']?: boolean;
  room_version: string;
  type?: string;
  additional_creators?: string[];
  predecessor?: {
    event_id?: string;
    room_id: string;
  };
};

export type GetContentCallback = <T>() => T;

export type RoomToParents = Map<string, Set<string>>;
export type Unread = {
  total: number;
  highlight: number;
  from: Set<string> | null;
  /**
   * MSC2867: the user asked for this room to look unread regardless of what
   * the receipts say. Deliberately a separate channel from `total` rather than
   * a synthetic count of 1 — a badge that claims one unread message when there
   * are none is a lie, and the counts feed the app badge and the favicon.
   * For a parent space this is true when ANY room under it is marked.
   */
  marked: boolean;
};
export type RoomToUnread = Map<string, Unread>;
export type UnreadInfo = {
  roomId: string;
  total: number;
  highlight: number;
  marked: boolean;
};

export type MuteChanges = {
  added: string[];
  removed: string[];
};

export type MemberPowerTagIcon = {
  key?: string;
  info?: IImageInfo;
};
export type MemberPowerTag = {
  name: string;
  color?: string;
  icon?: MemberPowerTagIcon;
};
