export enum EmojiBoardTab {
  Emoji = 'Emoji',
  Sticker = 'Sticker',
  Gif = 'Gif',
  Mashup = 'Mashup',
}

export enum EmojiType {
  Emoji = 'emoji',
  CustomEmoji = 'customEmoji',
  Sticker = 'sticker',
}

export type EmojiItemInfo = {
  type: EmojiType;
  data: string;
  shortcode: string;
  label: string;
};
