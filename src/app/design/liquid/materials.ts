import { design } from './LiquidTokens.css';

/** Chrome over content: the rail, the room list, the composer. */
export const regularGlass = {
  backgroundColor: design.Glass.Fill,
  backdropFilter: design.Glass.Filter,
  boxShadow: `${design.Glass.Edge}, ${design.Glass.Shadow}`,
  border: 'none',
};

/** Glass that must stay legible over anything: menus, popovers, tooltips. */
export const thickGlass = {
  backgroundColor: design.Glass.ThickFill,
  backdropFilter: design.Glass.ThickFilter,
  boxShadow: `${design.Glass.Edge}, ${design.Glass.Shadow}`,
  border: 'none',
};
