import type { ThemePalette } from '../derive';

// Source: https://www.nordtheme.com/docs/colors-and-palettes (Nord license).
// Polar Night supplies the surface stack; nord9 (frost) is the primary accent,
// readable on nord0 while keeping the Nord identity.
export const nordPalettes: Record<'nord', ThemePalette> = {
  nord: {
    bg0: '#2E3440', // nord0 (Polar Night)
    bg1: '#3B4252', // nord1
    bg2: '#434C5E', // nord2
    accent: '#81A1C1', // nord9 (Frost)
    green: '#A3BE8C', // nord14 (Aurora)
    yellow: '#EBCB8B', // nord13
    orange: '#D08770', // nord12
    red: '#BF616A', // nord11
    fg: '#ECEFF4', // nord6 (Snow Storm)
  },
};
