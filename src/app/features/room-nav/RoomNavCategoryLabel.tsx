import { ReactNode } from 'react';
import { as, Box, Text } from 'folds';
import classNames from 'classnames';
import * as css from './styles.css';

/**
 * A category heading with no collapse control.
 *
 * For navs that have exactly one category — Direct and Home — where collapsing
 * never hid anything: it filtered the list down to unread rooms, duplicating
 * the "Show unread only" menu item with a second, independent state. Same
 * typography and inset as `RoomNavCategoryButton` so the two navs still look
 * alike next to a space nav, which does have real categories to collapse.
 */
export const RoomNavCategoryLabel = as<'div', { children: ReactNode }>(
  ({ className, children, ...props }, ref) => (
    <Box
      className={classNames(css.CategoryLabel, className)}
      alignItems="Center"
      grow="Yes"
      {...props}
      ref={ref}
    >
      <Text size="O400" priority="300" truncate>
        {children}
      </Text>
    </Box>
  ),
);
