import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

/**
 * A class rather than an inline style, so a design layer can restyle the
 * quick switcher like any other modal (Liquid rounds it as a sheet).
 */
export const SearchModal = style({
  maxHeight: toRem(400),
  borderRadius: config.radii.R500,
});
