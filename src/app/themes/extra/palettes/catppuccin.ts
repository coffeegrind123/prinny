import type { ThemePalette } from '../derive';

// Source: https://github.com/catppuccin/palette (MIT), palette.json schema 1.8.0.
// Layering per the Catppuccin style guide: base < surface0 < surface1 < surface2.
// `peach` fills the warning slot (distinct orange accent).
export const catppuccinPalettes: Record<
  'catppuccin-frappe' | 'catppuccin-macchiato' | 'catppuccin-mocha',
  ThemePalette
> = {
  'catppuccin-frappe': {
    bg0: '#303446', // base
    bg1: '#414559', // surface0
    bg2: '#51576D', // surface1
    accent: '#8CAAEE', // blue
    green: '#A6D189',
    yellow: '#E5C890',
    orange: '#EF9F76', // peach
    red: '#E78284',
    fg: '#C6D0F5', // text
  },
  'catppuccin-macchiato': {
    bg0: '#24273A', // base
    bg1: '#363A4F', // surface0
    bg2: '#494D64', // surface1
    accent: '#8AADF4', // blue
    green: '#A6DA95',
    yellow: '#EED49F',
    orange: '#F5A97F', // peach
    red: '#ED8796',
    fg: '#CAD3F5', // text
  },
  'catppuccin-mocha': {
    bg0: '#1E1E2E', // base
    bg1: '#313244', // surface0
    bg2: '#45475A', // surface1
    accent: '#89B4FA', // blue
    green: '#A6E3A1',
    yellow: '#F9E2AF',
    orange: '#FAB387', // peach
    red: '#F38BA8',
    fg: '#CDD6F4', // text
  },
};
