import type { ThemePalette } from '../derive';

// Source: https://github.com/morhetz/gruvbox (MIT/X11), colors/gruvbox.vim.
// Only bg0 differs between dark variants (hard/medium/soft); the bright accent
// tier is used, matching the dark-mode mappings in the colorscheme.
const shared = {
  bg1: '#3C3836', // bg1
  bg2: '#504945', // bg2
  accent: '#83A598', // blue (bright)
  green: '#B8BB26', // green (bright)
  yellow: '#FABD2F', // yellow (bright)
  orange: '#FE8019', // orange (bright)
  red: '#FB4934', // red (bright)
  fg: '#FBF1C7', // fg0
};

export const gruvboxPalettes: Record<
  'gruvbox-dark-hard' | 'gruvbox-dark-medium' | 'gruvbox-dark-soft',
  ThemePalette
> = {
  'gruvbox-dark-hard': { ...shared, bg0: '#1D2021' }, // dark0_hard
  'gruvbox-dark-medium': { ...shared, bg0: '#282828' }, // dark0
  'gruvbox-dark-soft': { ...shared, bg0: '#32302F' }, // dark0_soft
};
