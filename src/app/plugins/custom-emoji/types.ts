import { IImageInfo } from '../../../types/matrix/common';

// Matrix v1.19 image packs (MSC2545): https://spec.matrix.org/v1.19/client-server-api/#image-packs

/**
 * m.image_pack.rooms / im.ponies.emote_rooms content (same shape, see compat.ts)
 */
export type PackStateKeyToObject = Record<string, object>;
export type RoomIdToStateKey = Record<string, PackStateKeyToObject>;
export type EmoteRoomsContent = {
  rooms?: RoomIdToStateKey;
};

/**
 * Pack
 */
export enum ImageUsage {
  Emoticon = 'emoticon',
  Sticker = 'sticker',
}

export type PackImage = {
  url: string;
  body?: string;
  usage?: ImageUsage[];
  info?: IImageInfo;
};

export type PackImages = Record<string, PackImage>;

export type PackMeta = {
  display_name?: string;
  avatar_url?: string;
  attribution?: string;
  usage?: ImageUsage[];
};

export type PackContent = {
  pack?: PackMeta;
  images?: PackImages;
};
