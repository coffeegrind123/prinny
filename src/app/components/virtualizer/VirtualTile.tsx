import { VirtualItem } from '@tanstack/react-virtual';
import { as } from 'folds';
import classNames from 'classnames';
import * as css from './style.css';

type VirtualTileProps = {
  virtualItem: VirtualItem;
  /**
   * The `scrollMargin` given to the virtualizer, if any. `virtualItem.start` is
   * measured from the scroll container, so a list that does not begin there has
   * the margin folded into every offset; the tile is positioned inside that
   * list, and has to take it back out.
   */
  scrollMargin?: number;
};
export const VirtualTile = as<'div', VirtualTileProps>(
  ({ className, virtualItem, scrollMargin = 0, style, ...props }, ref) => (
    <div
      className={classNames(css.VirtualTile, className)}
      style={{ top: virtualItem.start - scrollMargin, ...style }}
      data-index={virtualItem.index}
      {...props}
      ref={ref}
    />
  ),
);
