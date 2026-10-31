import type { ThemePalette } from '../derive';

// Source: https://github.com/ayu-theme/ayu-colors (MIT), themes/dark.yaml and
// themes/mirage.yaml. `editor.fg` is the main text color; `ui.fg` is dimmer and
// unused here. Ayu computes syntax ramp steps at runtime, so the stored base
// palette hexes are used as-is.
export const ayuPalettes: Record<'ayu-dark' | 'ayu-mirage', ThemePalette> = {
  'ayu-dark': {
    bg0: '#0D1017', // surface.base
    bg1: '#10141C', // surface.lift
    bg2: '#141821', // ui.panel.bg
    accent: '#59C2FF', // palette.blue
    green: '#AAD94C', // palette.green
    yellow: '#FFB454', // palette.yellow
    orange: '#FF8F40', // palette.orange
    red: '#F07178', // palette.red
    fg: '#BFBDB6', // editor.fg
  },
  'ayu-mirage': {
    bg0: '#1F2430', // surface.base
    bg1: '#242936', // surface.lift
    bg2: '#282E3B', // ui.panel.bg
    accent: '#73D0FF', // palette.blue
    green: '#D5FF80', // palette.green
    yellow: '#FFCD66', // palette.yellow
    orange: '#FFA659', // palette.orange
    red: '#F28779', // palette.red
    fg: '#CCCAC2', // editor.fg
  },
};
