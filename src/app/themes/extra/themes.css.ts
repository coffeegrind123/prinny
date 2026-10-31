import { createTheme } from '@vanilla-extract/css';
import { color } from 'folds';
import { onDarkFontWeight } from '../../../config.css';
import { deriveColorData } from './derive';
import { darkVariablesClass } from './darkVariables';
import { extraThemeRegistry } from './registry';

/**
 * One theme class per registry entry. The debug id is passed explicitly: these
 * are made in a loop, so there is no variable name for the readable-CSS build
 * to name them by, and a hash-named class would change whenever the palette
 * did, breaking custom CSS written against it. The colour variables are
 * folds' own (`--folds-color_*`), so custom CSS that redefines them works on
 * these themes as on the built-in ones.
 */
export const extraThemes = extraThemeRegistry.map((entry) => ({
  id: `${entry.id}-theme`,
  name: entry.name,
  classNames: [
    `${entry.id}-theme`,
    createTheme(color, deriveColorData(entry.palette), entry.id),
    onDarkFontWeight,
    'prism-dark',
    darkVariablesClass,
  ],
}));
