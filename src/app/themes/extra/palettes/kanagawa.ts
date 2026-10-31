import type { ThemePalette } from '../derive';

// Source: https://github.com/rebelot/kanagawa.nvim (MIT), lua/kanagawa/colors.lua
// and lua/kanagawa/themes.lua.
//
// Wave: sumiInk3/4/5 are the editor/mid/popup background stack; diagnostics
// roles map to springBlue (info), roninYellow (warning) and peachRed (error).
export const kanagawaWave: ThemePalette = {
  bg0: '#1F1F28', // sumiInk3 (bg)
  bg1: '#2A2A37', // sumiInk4 (bg_m2)
  bg2: '#363646', // sumiInk5 (bg_m3)
  accent: '#7E9CD8', // crystalBlue
  green: '#98BB6C', // springGreen
  yellow: '#E6C384', // carpYellow
  orange: '#FF9E3B', // roninYellow
  red: '#FF5D62', // peachRed
  fg: '#DCD7BA', // fujiWhite
};

// Dragon: dragonBlack3 is the theme background, black2/black4 the mid and popup
// levels; dragonBlue2/dragonGreen/dragonYellow/dragonOrange/dragonRed are the
// theme's syntax accents.
export const kanagawaDragon: ThemePalette = {
  bg0: '#181616', // dragonBlack3 (bg)
  bg1: '#1D1C19', // dragonBlack2 (bg_m1)
  bg2: '#282727', // dragonBlack4 (bg_p1)
  accent: '#8BA4B0', // dragonBlue2
  green: '#87A987', // dragonGreen
  yellow: '#C4B28A', // dragonYellow
  orange: '#B6927B', // dragonOrange
  red: '#C4746E', // dragonRed
  fg: '#C5C9C5', // dragonWhite
};

export const kanagawaPalettes: Record<'kanagawa-dragon' | 'kanagawa-wave', ThemePalette> = {
  'kanagawa-dragon': kanagawaDragon,
  'kanagawa-wave': kanagawaWave,
};
