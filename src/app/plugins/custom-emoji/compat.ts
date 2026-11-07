/**
 * Image packs exist under two names (Matrix v1.19 made MSC2545 stable):
 *
 *   room pack (state)        m.room.image_pack    im.ponies.room_emotes
 *   enabled-everywhere refs  m.image_pack.rooms   im.ponies.emote_rooms
 *
 * The shapes are identical. We read both and write both, so packs made in
 * clients that only know one name still show up, and packs made here show up
 * in both kinds of client.
 *
 * Same room and state_key under both names: the NEWER event wins, and the
 * stable one on a tie. "Stable always wins" would freeze a pack the moment a
 * client that only writes the old name (upstream Cinny, today) edits or
 * deletes it after we dual-wrote it: our stale stable copy would hide the edit.
 *
 * The personal pack (`im.ponies.user_emotes`) has no stable name and keeps
 * its old one.
 */
import { StateEvent } from '../../../types/matrix/room';
import { AccountDataEvent } from '../../../types/matrix/accountData';
import { RoomIdToStateKey } from './types';

export const ROOM_PACK_TYPES: readonly string[] = [
  StateEvent.RoomImagePack,
  StateEvent.PoniesRoomEmotes,
];

export const PACK_ROOMS_TYPES: readonly string[] = [
  AccountDataEvent.ImagePackRooms,
  AccountDataEvent.PoniesEmoteRooms,
];

export const isRoomPackType = (type: string): boolean => ROOM_PACK_TYPES.includes(type);

export const isPackRoomsType = (type: string): boolean => PACK_ROOMS_TYPES.includes(type);

/** The bits of a MatrixEvent the merge needs; a real MatrixEvent satisfies it. */
export type PackEventLike = {
  getType(): string;
  getStateKey(): string | undefined;
  getTs(): number;
};

const isStable = (event: PackEventLike): boolean => event.getType() === StateEvent.RoomImagePack;

/** One event per state_key, chosen as described at the top of this file. */
export function pickPackEvents<E extends PackEventLike>(events: E[]): E[] {
  const byStateKey = new Map<string, E>();

  events.forEach((event) => {
    const stateKey = event.getStateKey();
    if (typeof stateKey !== 'string' || !isRoomPackType(event.getType())) return;

    const current = byStateKey.get(stateKey);
    if (!current) {
      byStateKey.set(stateKey, event);
      return;
    }

    const newer = event.getTs() - current.getTs();
    if (newer > 0 || (newer === 0 && isStable(event) && !isStable(current))) {
      byStateKey.set(stateKey, event);
    }
  });

  return Array.from(byStateKey.values());
}

type Content = Record<string, unknown>;

const isRecord = (value: unknown): value is Content =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The union of every pack-rooms reference, from contents in priority order
 * (stable first). The innermost objects are reserved by the spec and must be
 * preserved, so the first copy seen of each one is kept as it is.
 */
export function mergePackRooms(contents: unknown[]): RoomIdToStateKey {
  const merged: RoomIdToStateKey = {};

  contents.forEach((content) => {
    if (!isRecord(content) || !isRecord(content.rooms)) return;

    Object.entries(content.rooms).forEach(([roomId, stateKeys]) => {
      if (!isRecord(stateKeys)) return;
      const target = merged[roomId] ?? {};

      Object.entries(stateKeys).forEach(([stateKey, reserved]) => {
        if (stateKey in target) return;
        target[stateKey] = isRecord(reserved) ? reserved : {};
      });

      merged[roomId] = target;
    });
  });

  return merged;
}

/** Writes for a new set of references: both names, identical content. */
export function packRoomsWrites(
  rooms: RoomIdToStateKey,
): Record<string, { rooms: RoomIdToStateKey }> {
  return Object.fromEntries(
    PACK_ROOMS_TYPES.map((type) => [type, { rooms: JSON.parse(JSON.stringify(rooms)) }]),
  );
}

/**
 * Shortcode grammar (spec): 1–100 of A–Z a–z 0–9 - _. Enforced when we create
 * or edit images; images that break it are still shown, as the spec asks.
 */
export const SHORTCODE_MAX_LENGTH = 100;
const SHORTCODE_REG = /^[A-Za-z0-9_-]{1,100}$/;
const SHORTCODE_INVALID_CHARS_G = /[^A-Za-z0-9_-]+/g;
const FALLBACK_SHORTCODE = 'image';

export const isValidShortcode = (shortcode: string): boolean => SHORTCODE_REG.test(shortcode);

/**
 * The nearest valid shortcode to `raw`, for names we make up ourselves (an
 * uploaded file's name). Accents are folded rather than dropped, so "café"
 * becomes "cafe" and not "caf"; whitespace and everything else outside the
 * grammar becomes one "-".
 */
export function toShortcode(raw: string): string {
  const folded = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const cleaned = folded
    .trim()
    .replace(SHORTCODE_INVALID_CHARS_G, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SHORTCODE_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : FALLBACK_SHORTCODE;
}

/**
 * `base` if free, else `base1`, `base2`, … — trimming `base` so the suffix
 * never pushes the result past the 100-character limit.
 */
export function uniqueShortcode(base: string, taken: (shortcode: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 1; ; n += 1) {
    const suffix = String(n);
    const candidate = base.slice(0, SHORTCODE_MAX_LENGTH - suffix.length) + suffix;
    if (!taken(candidate)) return candidate;
  }
}
