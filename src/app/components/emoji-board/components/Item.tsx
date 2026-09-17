import { Box } from 'folds';
import classNames from 'classnames';
import { MatrixClient } from 'matrix-js-sdk';
import { EmojiItemInfo, EmojiType } from '../types';
import * as css from './styles.css';
import { PackImageReader } from '../../../plugins/custom-emoji';
import { IEmoji } from '../../../plugins/emoji';
import { mxcUrlToHttp } from '../../../utils/matrix';

export const getEmojiItemInfo = (element: Element): EmojiItemInfo | undefined => {
  const label = element.getAttribute('title');
  const type = element.getAttribute('data-emoji-type') as EmojiType | undefined;
  const data = element.getAttribute('data-emoji-data');
  const shortcode = element.getAttribute('data-emoji-shortcode');

  if (type && data && shortcode && label)
    return {
      type,
      data,
      shortcode,
      label,
    };
  return undefined;
};

/**
 * `selected` is the board's keyboard selection — the one item the arrow keys
 * are on and Enter would pick. It is a virtual selection, not focus: focus can
 * stay in the search box while it moves. The `data-selected` attribute is how
 * the board finds the selected button in the DOM when it does want to focus it.
 */
type EmojiItemProps = {
  emoji: IEmoji;
  selected?: boolean;
};
export function EmojiItem({ emoji, selected }: EmojiItemProps) {
  return (
    <Box
      as="button"
      type="button"
      alignItems="Center"
      justifyContent="Center"
      className={classNames(css.EmojiItem, selected && css.EmojiItemSelected)}
      title={emoji.label}
      aria-label={`${emoji.label} emoji`}
      data-selected={selected ? 'true' : undefined}
      data-emoji-type={EmojiType.Emoji}
      data-emoji-data={emoji.unicode}
      data-emoji-shortcode={emoji.shortcode}
    >
      {emoji.unicode}
    </Box>
  );
}

type CustomEmojiItemProps = {
  mx: MatrixClient;
  useAuthentication?: boolean;
  image: PackImageReader;
  selected?: boolean;
};
export function CustomEmojiItem({ mx, useAuthentication, image, selected }: CustomEmojiItemProps) {
  return (
    <Box
      as="button"
      type="button"
      alignItems="Center"
      justifyContent="Center"
      className={classNames(css.EmojiItem, selected && css.EmojiItemSelected)}
      title={image.body || image.shortcode}
      aria-label={`${image.body || image.shortcode} emoji`}
      data-selected={selected ? 'true' : undefined}
      data-emoji-type={EmojiType.CustomEmoji}
      data-emoji-data={image.url}
      data-emoji-shortcode={image.shortcode}
    >
      <img
        loading="lazy"
        className={css.CustomEmojiImg}
        alt={image.body || image.shortcode}
        src={mxcUrlToHttp(mx, image.url, useAuthentication) ?? ''}
      />
    </Box>
  );
}

type StickerItemProps = {
  mx: MatrixClient;
  useAuthentication?: boolean;
  image: PackImageReader;
  selected?: boolean;
};

export function StickerItem({ mx, useAuthentication, image, selected }: StickerItemProps) {
  return (
    <Box
      as="button"
      type="button"
      alignItems="Center"
      justifyContent="Center"
      className={classNames(css.StickerItem, selected && css.EmojiItemSelected)}
      title={image.body || image.shortcode}
      aria-label={`${image.body || image.shortcode} emoji`}
      data-selected={selected ? 'true' : undefined}
      data-emoji-type={EmojiType.Sticker}
      data-emoji-data={image.url}
      data-emoji-shortcode={image.shortcode}
    >
      <img
        loading="lazy"
        className={css.StickerImg}
        alt={image.body || image.shortcode}
        src={mxcUrlToHttp(mx, image.url, useAuthentication) ?? ''}
      />
    </Box>
  );
}
