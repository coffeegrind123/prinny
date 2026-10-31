import type { ThemePalette } from '../derive';

// Source: https://github.com/catthode/discord (catthode.theme.css, :root palette).
// Warm OLED theme: black base, #141414 sidebar, #2d2d2d selection. Amber is the
// primary accent; the upstream theme keeps success inside the warm palette
// (green -> gold), so the same mapping is used here.
export const catthodePalettes: Record<'catthode', ThemePalette> = {
  catthode: {
    bg0: '#000000', // --base
    bg1: '#141414', // --sidebar
    bg2: '#2D2D2D', // --selection
    accent: '#FF9E3B', // --amber
    green: '#FFB86C', // --gold (upstream --green)
    yellow: '#D9B98C', // --tan
    orange: '#F08D49', // --clay
    red: '#FF6B6B', // --red
    fg: '#FFFFFF', // --text
  },
};
