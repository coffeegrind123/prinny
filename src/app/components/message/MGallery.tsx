import { ReactNode } from 'react';
import { Box } from 'folds';
import { IContent, MsgType } from 'matrix-js-sdk';
import { IGalleryContent, IGalleryItem } from '../../../types/matrix/common';
import * as css from './MGallery.css';

/**
 * One gallery item as the ordinary message content it stands for.
 *
 * The MSC renames `msgtype` to `itemtype` precisely so an item cannot be
 * mistaken for a message; putting it back is what lets every existing
 * attachment renderer be reused unchanged instead of gaining a gallery variant.
 */
export const galleryItemToContent = (item: IGalleryItem): IContent => {
  const { itemtype, ...rest } = item;
  return { ...rest, msgtype: itemtype } as IContent;
};

const isVisualItem = (item: IGalleryItem): boolean =>
  item.itemtype === MsgType.Image || item.itemtype === MsgType.Video;

/**
 * How many columns a given number of pictures reads best in.
 *
 * One is full width. Two and four are square-ish pairs, which is how a phone
 * camera roll lays out a small selection. Anything larger goes to three, the
 * point past which individual tiles stop being recognisable at message width.
 */
const columnsFor = (count: number): number => {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  return 3;
};

export type MGalleryProps = {
  content: IGalleryContent;
  /** Renders one item using the same renderers a standalone attachment uses. */
  renderItem: (content: IContent, index: number) => ReactNode;
};

/**
 * A message carrying several attachments (MSC4274).
 *
 * Pictures and clips go into a grid; files and voice notes keep their normal
 * cards underneath, because a file card is a row of text and a square tile of
 * one would be unreadable.
 */
export function MGallery({ content, renderItem }: MGalleryProps) {
  const items = Array.isArray(content.itemtypes) ? content.itemtypes : [];
  const visual = items.filter(isVisualItem);
  const listed = items.filter((item) => !isVisualItem(item));

  if (items.length === 0) return null;

  return (
    <Box direction="Column" gap="100">
      {visual.length > 0 && (
        <div
          className={css.Gallery}
          style={{ gridTemplateColumns: `repeat(${columnsFor(visual.length)}, 1fr)` }}
        >
          {visual.map((item, index) => (
            <div
              // Items have no ids of their own; their position in the event is
              // their identity, and the array is immutable once sent.
              key={`${item.url ?? item.file?.url ?? 'item'}-${index}`}
              className={css.GalleryItem}
            >
              <div className={css.GalleryItemMedia}>
                {renderItem(galleryItemToContent(item), index)}
              </div>
            </div>
          ))}
        </div>
      )}
      {listed.length > 0 && (
        <div className={css.GalleryColumn}>
          {listed.map((item, index) => (
            <div key={`${item.url ?? item.file?.url ?? 'file'}-${index}`}>
              {renderItem(galleryItemToContent(item), visual.length + index)}
            </div>
          ))}
        </div>
      )}
    </Box>
  );
}
