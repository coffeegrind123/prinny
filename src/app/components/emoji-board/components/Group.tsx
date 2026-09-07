import { as, Box, Text } from 'folds';
import { ReactNode } from 'react';
import classNames from 'classnames';
import * as css from './styles.css';

export const getDOMGroupId = (id: string): string => `EmojiBoardGroup-${id}`;

export const EmojiGroup = as<
  'div',
  {
    id: string;
    label: string;
    children: ReactNode;
  }
>(({ className, id, label, children, ...props }, ref) => (
  <Box
    id={getDOMGroupId(id)}
    data-group-id={id}
    className={classNames(css.EmojiGroup, className)}
    direction="Column"
    gap="200"
    {...props}
    ref={ref}
  >
    <Text id={`EmojiGroup-${id}-label`} as="label" className={css.EmojiGroupLabel} size="O400">
      {label}
    </Text>
    <div aria-labelledby={`EmojiGroup-${id}-label`} className={css.EmojiGroupContent}>
      <Box wrap="Wrap" justifyContent="Center">
        {children}
      </Box>
    </div>
  </Box>
));

/**
 * A group's heading, as its own row in the virtual list.
 *
 * The board virtualizes rows rather than whole groups, so a group is no longer
 * one element that can hold its heading — the heading is a row like any other,
 * and the sticky behaviour that used to come free from `position: sticky`
 * inside the group is supplied by the board instead (see `EmojiBoard`).
 */
export const EmojiGroupLabelRow = as<
  'div',
  {
    id: string;
    label: string;
  }
>(({ className, id, label, ...props }, ref) => (
  <Box
    data-group-id={id}
    className={classNames(css.EmojiGroupLabelRow, className)}
    justifyContent="Center"
    shrink="No"
    {...props}
    ref={ref}
  >
    <Text id={`EmojiGroup-${id}-label`} as="label" className={css.EmojiGroupLabel} size="O400">
      {label}
    </Text>
  </Box>
));

/**
 * One row of items.
 *
 * `wrap` is kept even though the board slices rows to fit: the slice is derived
 * from a measured width, and if that measurement is ever a pixel out it should
 * cost a taller row that the virtualizer then measures, not items overflowing
 * the board.
 */
export const EmojiItemRow = as<'div', { groupId: string; children: ReactNode }>(
  ({ className, groupId, children, ...props }, ref) => (
    <div
      data-group-id={groupId}
      aria-labelledby={`EmojiGroup-${groupId}-label`}
      className={classNames(css.EmojiItemRow, className)}
      {...props}
      ref={ref}
    >
      <Box wrap="Wrap" justifyContent="Center">
        {children}
      </Box>
    </div>
  ),
);
