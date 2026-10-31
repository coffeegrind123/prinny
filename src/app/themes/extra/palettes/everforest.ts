import type { ThemePalette } from '../derive';

// Source: https://github.com/sainnhe/everforest (MIT), palette.md. Accents,
// greys, and foreground are shared across dark variants; only the background
// group differs between hard/medium/soft.
const shared = {
  accent: '#7FBBB3', // blue
  green: '#A7C080',
  yellow: '#DBBC7F',
  orange: '#E69875',
  red: '#E67E80',
  fg: '#D3C6AA',
};

export const everforestPalettes: Record<
  'everforest-dark-hard' | 'everforest-dark-medium' | 'everforest-dark-soft',
  ThemePalette
> = {
  'everforest-dark-hard': {
    ...shared,
    bg0: '#272E33', // bg0
    bg1: '#2E383C', // bg1
    bg2: '#374145', // bg2
  },
  'everforest-dark-medium': {
    ...shared,
    bg0: '#2D353B', // bg0
    bg1: '#343F44', // bg1
    bg2: '#3D484D', // bg2
  },
  'everforest-dark-soft': {
    ...shared,
    bg0: '#333C43', // bg0
    bg1: '#3A464C', // bg1
    bg2: '#434F55', // bg2
  },
};
