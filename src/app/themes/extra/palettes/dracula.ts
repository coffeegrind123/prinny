import type { ThemePalette } from '../derive';

// Source: https://github.com/dracula/dracula-theme (MIT), README "Color Palette
// (OSS)". The palette defines only Background (#282A36) and Current Line
// (#44475A) as surfaces, so SurfaceVariant is derived from Current Line and
// purple stands in as the primary accent (no blue in the palette).
export const draculaPalettes: Record<'dracula', ThemePalette> = {
  dracula: {
    bg0: '#282A36', // Background
    bg1: '#44475A', // Current Line / Selection
    accent: '#BD93F9', // purple
    green: '#50FA7B',
    yellow: '#F1FA8C',
    orange: '#FFB86C',
    red: '#FF5555',
    fg: '#F8F8F2', // Foreground
  },
};
