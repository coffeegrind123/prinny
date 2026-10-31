import type { ThemePalette } from '../derive';

// Pure-black OLED palette modelled on Discord's "Midnight" (AMOLED) theme:
// true #000000 base so OLED pixels switch off, near-black elevated surfaces,
// Discord's blurple primary and its status colors (Discord brand palette).
export const oledPalettes: Record<'oled-midnight', ThemePalette> = {
  'oled-midnight': {
    bg0: '#000000', // Midnight base
    bg1: '#0A0A0B', // panels / sidebars
    bg2: '#141416', // inputs / menus
    accent: '#7983F5', // blurple tinted for contrast on black
    green: '#23A55A',
    yellow: '#F0B232',
    orange: '#F0B232',
    red: '#F23F42',
    fg: '#F2F3F5',
  },
};
