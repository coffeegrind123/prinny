import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { MsgType } from 'matrix-js-sdk';

export const MATRIX_BLUR_HASH_PROPERTY_NAME = 'xyz.amorgan.blurhash';
export const MATRIX_SPOILER_PROPERTY_NAME = 'page.codeberg.everypizza.msc4193.spoiler';
export const MATRIX_SPOILER_REASON_PROPERTY_NAME =
  'page.codeberg.everypizza.msc4193.spoiler.reason';
// Marks an m.video we sent as a GIF, so it renders and favourites as one
// rather than as a silent clip.
export const MATRIX_GIF_PROPERTY_NAME = 'io.cinny.gif';

// MSC4230 — whether an m.image / m.sticker is animated. Stable since Matrix
// 1.18; the unstable prefix is written alongside it because Element still reads
// only that one, and a receiver that believes an animation is a still will
// happily request a flattened server-side thumbnail of it. Drop the unstable
// write once Element ships the stable key.
export const MATRIX_ANIMATED_PROPERTY_NAME = 'is_animated';
export const MATRIX_ANIMATED_UNSTABLE_PROPERTY_NAME = 'org.matrix.msc4230.is_animated';

export type IImageInfo = {
  w?: number;
  h?: number;
  mimetype?: string;
  size?: number;
  [MATRIX_BLUR_HASH_PROPERTY_NAME]?: string;
  /** MSC4230, stable in Matrix 1.18. */
  [MATRIX_ANIMATED_PROPERTY_NAME]?: boolean;
  /** MSC4230 unstable prefix — still the only one Element reads. */
  [MATRIX_ANIMATED_UNSTABLE_PROPERTY_NAME]?: boolean;
};

export type IVideoInfo = {
  w?: number;
  h?: number;
  mimetype?: string;
  size?: number;
  duration?: number;
};

export type IAudioInfo = {
  mimetype?: string;
  size?: number;
  duration?: number;
};

export type IFileInfo = {
  mimetype?: string;
  size?: number;
};

export type IEncryptedFile = EncryptedAttachmentInfo & {
  url: string;
};

export type IThumbnailContent = {
  thumbnail_info?: IImageInfo;
  thumbnail_file?: IEncryptedFile;
  thumbnail_url?: string;
};

export type IImageContent = {
  msgtype: MsgType.Image;
  body?: string;
  filename?: string;
  url?: string;
  info?: IImageInfo & IThumbnailContent;
  file?: IEncryptedFile;
  [MATRIX_SPOILER_PROPERTY_NAME]?: boolean;
  [MATRIX_SPOILER_REASON_PROPERTY_NAME]?: string;
};

export type IVideoContent = {
  msgtype: MsgType.Video;
  body?: string;
  filename?: string;
  url?: string;
  info?: IVideoInfo & IThumbnailContent;
  file?: IEncryptedFile;
  [MATRIX_GIF_PROPERTY_NAME]?: boolean;
  [MATRIX_SPOILER_PROPERTY_NAME]?: boolean;
  [MATRIX_SPOILER_REASON_PROPERTY_NAME]?: string;
};

export type IAudioContent = {
  msgtype: MsgType.Audio;
  body?: string;
  filename?: string;
  url?: string;
  info?: IAudioInfo;
  file?: IEncryptedFile;
};

export type IFileContent = {
  msgtype: MsgType.File;
  body?: string;
  filename?: string;
  url?: string;
  info?: IFileInfo & IThumbnailContent;
  file?: IEncryptedFile;
};

export type ILocationContent = {
  msgtype: MsgType.Location;
  body?: string;
  geo_uri?: string;
  info?: IThumbnailContent;
};

/**
 * MSC4274 — several attachments as one message.
 *
 * Sending four photos is one action to the person doing it and, until this,
 * four messages to everyone else: four rows, four timestamps, four notification
 * lines. The MSC keeps them in one event, with each attachment's usual content
 * under `itemtypes` and its `msgtype` renamed to `itemtype` so the item cannot
 * be mistaken for a message in its own right.
 *
 * The identifier is still the unstable one; `m.gallery` replaces it if and when
 * the MSC lands, and both are accepted on the receiving side.
 */
export const GALLERY_MSGTYPE = 'dm.filament.gallery';
export const GALLERY_MSGTYPE_STABLE = 'm.gallery';

export type IGalleryImageItem = Omit<IImageContent, 'msgtype'> & { itemtype: 'm.image' };
export type IGalleryVideoItem = Omit<IVideoContent, 'msgtype'> & { itemtype: 'm.video' };
export type IGalleryAudioItem = Omit<IAudioContent, 'msgtype'> & { itemtype: 'm.audio' };
export type IGalleryFileItem = Omit<IFileContent, 'msgtype'> & { itemtype: 'm.file' };
export type IGalleryItem =
  IGalleryImageItem | IGalleryVideoItem | IGalleryAudioItem | IGalleryFileItem;

export type IGalleryContent = {
  msgtype: typeof GALLERY_MSGTYPE | typeof GALLERY_MSGTYPE_STABLE;
  body: string;
  format?: string;
  formatted_body?: string;
  itemtypes: IGalleryItem[];
};

export const isGalleryMsgType = (msgtype: unknown): boolean =>
  msgtype === GALLERY_MSGTYPE || msgtype === GALLERY_MSGTYPE_STABLE;
