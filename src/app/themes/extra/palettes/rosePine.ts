import type { ThemePalette } from '../derive';

// Source: https://github.com/rose-pine/neovim (MIT), lua/rose-pine/palette.lua,
// cross-checked against rosepinetheme.com. iris is the primary accent; foam
// (not the dimmer pine) carries success for readability on the dark base.
export const rosePinePalettes: Record<'rose-pine' | 'rose-pine-moon', ThemePalette> = {
  'rose-pine': {
    bg0: '#191724', // base
    bg1: '#1F1D2E', // surface
    bg2: '#26233A', // overlay
    accent: '#C4A7E7', // iris
    green: '#9CCFD8', // foam
    yellow: '#F6C177', // gold
    red: '#EB6F92', // love
    fg: '#E0DEF4', // text
  },
  'rose-pine-moon': {
    bg0: '#232136', // base
    bg1: '#2A273F', // surface
    bg2: '#393552', // overlay
    accent: '#C4A7E7', // iris
    green: '#9CCFD8', // foam
    yellow: '#F6C177', // gold
    red: '#EB6F92', // love
    fg: '#E0DEF4', // text
  },
};
