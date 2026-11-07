import { MatrixEvent } from 'matrix-js-sdk';
import { PackAddress } from './PackAddress';
import { PackImageReader } from './PackImageReader';
import { PackImagesReader } from './PackImagesReader';
import { PackMetaReader } from './PackMetaReader';
import { ImageUsage, PackContent } from './types';

/**
 * What the spec says to show for a room pack without its own `display_name`
 * or `avatar_url`: the room's. Kept apart from `meta`, which is what gets
 * written back on edit, so the room's name is never saved into the pack.
 */
export type PackFallback = {
  name?: string;
  avatarUrl?: string;
};

export class ImagePack {
  public readonly id: string;

  public readonly deleted: boolean;

  public readonly address: PackAddress | undefined;

  public readonly meta: PackMetaReader;

  public readonly images: PackImagesReader;

  private emoticonMemo: PackImageReader[] | undefined;

  private stickerMemo: PackImageReader[] | undefined;

  private readonly fallback: PackFallback;

  constructor(
    id: string,
    content: PackContent,
    address: PackAddress | undefined,
    fallback: PackFallback = {},
  ) {
    this.id = id;

    this.fallback = fallback;

    this.address = address;

    this.deleted = content.pack === undefined && content.images === undefined;

    this.meta = new PackMetaReader(content.pack ?? {});
    this.images = new PackImagesReader(content.images ?? {});
  }

  static fromMatrixEvent(id: string, matrixEvent: MatrixEvent, fallback?: PackFallback) {
    const roomId = matrixEvent.getRoomId();
    const stateKey = matrixEvent.getStateKey();

    const address =
      roomId && typeof stateKey === 'string' ? new PackAddress(roomId, stateKey) : undefined;

    const content = matrixEvent.getContent<PackContent>();

    const imagePack: ImagePack = new ImagePack(id, content, address, fallback);

    return imagePack;
  }

  public getImages(usage: ImageUsage): PackImageReader[] {
    if (usage === ImageUsage.Emoticon && this.emoticonMemo) {
      return this.emoticonMemo;
    }
    if (usage === ImageUsage.Sticker && this.stickerMemo) {
      return this.stickerMemo;
    }

    const images = Array.from(this.images.collection.values()).filter((image) => {
      const usg = image.usage ?? this.meta.usage;
      return usg.includes(usage);
    });

    if (usage === ImageUsage.Emoticon) {
      this.emoticonMemo = images;
    }
    if (usage === ImageUsage.Sticker) {
      this.stickerMemo = images;
    }

    return images;
  }

  /** The name to show: the pack's own, else its room's. */
  get name(): string | undefined {
    return this.meta.name ?? this.fallback.name;
  }

  public getAvatarUrl(usage: ImageUsage): string | undefined {
    if (this.meta.avatar) return this.meta.avatar;
    if (this.fallback.avatarUrl) return this.fallback.avatarUrl;
    const images = this.getImages(usage);
    const firstImage = images[0];
    if (firstImage) return firstImage.url;
    return undefined;
  }
}
