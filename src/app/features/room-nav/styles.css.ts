import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const CategoryButton = style({
  flexGrow: 1,
});

/**
 * A DM's presence line, on the row under the name in the chat list.
 *
 * Height is pinned to the T200 line box rather than left to the content. The
 * line can be prefixed by an icon, and letting the tallest thing on it decide
 * the row height means two chats with the same amount of writing get different
 * heights depending on which icon they drew — a raggedness the eye picks up
 * immediately down a list, and one the virtualiser has to re-measure to place
 * the rows after it.
 *
 * No negative offset here. The nav row already carries a 36px minimum against
 * ~19px of name, so the second line lands in space the row was reserving
 * anyway and the pair sits centred without being pulled about.
 */
export const DmStatus = style({
  height: config.lineHeight.T200,
});
export const CategoryButtonIcon = style({
  opacity: config.opacity.P400,
});

// Matches the horizontal inset a Chip gives CategoryButton, so a nav with a
// plain label lines up with one that has a collapse chevron.
export const CategoryLabel = style({
  padding: `0 ${config.space.S200}`,
  minWidth: 0,
});

export const CallNavItemMember = style({
  width: '100%',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: `${config.space.S100} ${config.space.S200}`,
  textAlign: 'left',
  color: 'inherit',
  font: 'inherit',
  borderRadius: config.radii.R300,
  selectors: {
    '&:hover': {
      backgroundColor: color.Background.ContainerHover,
    },
  },
});

export const SortableNavItem = style({
  position: 'relative',
  cursor: 'grab',
  selectors: {
    '&[data-dragging=true]': {
      opacity: config.opacity.P500,
    },
    '&[data-drop-target=before]::before': {
      content: '',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 2,
      borderTop: `${config.borderWidth.B300} solid ${color.Success.Main}`,
    },
  },
});

/**
 * The unread badge on a collapsed rail row.
 *
 * In the expanded row the badge sits at the end of the line, after the name.
 * There is no line here, so it rides the corner of the avatar the way an app
 * icon's badge does — which is the only place it can go and still be legible
 * next to a 24px avatar.
 */
export const CollapsedUnread = style([
  DefaultReset,
  {
    position: 'absolute',
    top: toRem(-2),
    right: toRem(-4),
    pointerEvents: 'none',
  },
]);
