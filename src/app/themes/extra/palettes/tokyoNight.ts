import type { ThemePalette } from '../derive';

// Source: https://github.com/folke/tokyonight.nvim (Apache-2.0),
// lua/tokyonight/colors/{night,storm,moon}.lua. night inherits every color
// except its darker backgrounds from storm in the upstream source itself.
// bg_highlight is the elevated surface; a third level is derived (the palettes
// define no further background step).
export const tokyoNightPalettes: Record<
  'tokyo-night-moon' | 'tokyo-night-night' | 'tokyo-night-storm',
  ThemePalette
> = {
  'tokyo-night-night': {
    bg0: '#1A1B26', // bg
    bg1: '#292E42', // bg_highlight (inherited from storm upstream)
    accent: '#7AA2F7', // blue
    green: '#9ECE6A',
    yellow: '#E0AF68',
    orange: '#FF9E64',
    red: '#F7768E',
    fg: '#C0CAF5',
  },
  'tokyo-night-storm': {
    bg0: '#24283B', // bg
    bg1: '#292E42', // bg_highlight
    accent: '#7AA2F7', // blue
    green: '#9ECE6A',
    yellow: '#E0AF68',
    orange: '#FF9E64',
    red: '#F7768E',
    fg: '#C0CAF5',
  },
  'tokyo-night-moon': {
    bg0: '#222436', // bg
    bg1: '#2F334D', // bg_highlight
    accent: '#82AAFF', // blue
    green: '#C3E88D',
    yellow: '#FFC777',
    orange: '#FF966C',
    red: '#FF757F',
    fg: '#C8D3F5',
  },
};
