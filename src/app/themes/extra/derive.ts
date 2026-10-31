import chroma from 'chroma-js';

/**
 * Raw palette roles sourced from each upstream theme family. State colors
 * (hover/active/line/containers) are derived deterministically from these;
 * deriveColorData below holds the rules.
 */
export type ThemePalette = {
  /** Base background. */
  bg0: string;
  /** Elevated surface (panels, sidebars, cards). */
  bg1: string;
  /** Further elevated surface (inputs, menus); derived when absent. */
  bg2?: string;
  /** Primary accent: interactive controls and highlights. */
  accent: string;
  /** Success accent. */
  green: string;
  /** Warning accent; falls back to `yellow` when the palette has no distinct orange. */
  orange?: string;
  yellow: string;
  /** Critical accent. */
  red: string;
  /** Main text color. */
  fg: string;
};

const WHITE = '#FFFFFF';
const BLACK = '#000000';

/** WCAG 2.1 contrast ratio between two colors. */
export const contrastRatio = (a: string, b: string): number => chroma.contrast(a, b);

const mix = (from: string, to: string, amount: number): string =>
  chroma.mix(from, to, amount, 'rgb').hex();

const lighten = (hex: string, amount: number): string => mix(hex, WHITE, amount);

// Choose one foreground for every state; unsupported palettes fail during the build.
const readableText = (backgrounds: string[], candidates: string[]): string => {
  const readable = [...candidates, BLACK, WHITE].find((candidate) =>
    backgrounds.every((background) => contrastRatio(candidate, background) >= 4.5),
  );
  if (!readable) throw new Error(`No AA text color for backgrounds: ${backgrounds.join(', ')}`);
  return readable;
};

const containerData = (
  container: string,
  hover: string,
  active: string,
  line: string,
  candidates: string[],
) => ({
  Container: container,
  ContainerHover: hover,
  ContainerActive: active,
  ContainerLine: line,
  OnContainer: readableText([container, hover, active], candidates),
});

const surfaceData = (container: string, fg: string) =>
  containerData(
    container,
    lighten(container, 0.05),
    lighten(container, 0.1),
    lighten(container, 0.15),
    [fg, lighten(fg, 0.25), lighten(fg, 0.5)],
  );

const accentData = (accent: string, bg: string) => {
  const onMain = readableText([accent], [mix(accent, BLACK, 0.88), mix(accent, WHITE, 0.85)]);
  // RGB mixing away from the text increases contrast monotonically.
  const interactionTarget = chroma(onMain).luminance() < chroma(accent).luminance() ? WHITE : BLACK;

  return {
    Main: accent,
    MainHover: mix(accent, interactionTarget, 0.05),
    MainActive: mix(accent, interactionTarget, 0.1),
    MainLine: mix(accent, interactionTarget, 0.15),
    OnMain: onMain,
    ...containerData(
      mix(accent, bg, 0.72),
      mix(accent, bg, 0.66),
      mix(accent, bg, 0.6),
      mix(accent, bg, 0.54),
      [0.55, 0.7, 0.85].map((amount) => lighten(accent, amount)),
    ),
  };
};

const secondaryData = (fg: string, bg: string) => ({
  Main: fg,
  MainHover: mix(fg, bg, 0.1),
  MainActive: mix(fg, bg, 0.2),
  MainLine: mix(fg, bg, 0.3),
  OnMain: readableText([fg, mix(fg, bg, 0.1), mix(fg, bg, 0.2)], [bg]),
  ...containerData(mix(bg, fg, 0.16), mix(bg, fg, 0.2), mix(bg, fg, 0.24), mix(bg, fg, 0.28), [
    fg,
    lighten(fg, 0.25),
    lighten(fg, 0.5),
  ]),
});

export const deriveColorData = (palette: ThemePalette) => {
  const { bg0, bg1 } = palette;
  const bg2 = palette.bg2 ?? lighten(bg1, 0.05);

  return {
    Background: surfaceData(bg0, palette.fg),
    Surface: surfaceData(bg1, palette.fg),
    SurfaceVariant: surfaceData(bg2, palette.fg),
    Primary: accentData(palette.accent, bg0),
    Secondary: secondaryData(palette.fg, bg0),
    Success: accentData(palette.green, bg0),
    Warning: accentData(palette.orange ?? palette.yellow, bg0),
    Critical: accentData(palette.red, bg0),
    Other: {
      FocusRing: 'rgba(255, 255, 255, 0.5)',
      Shadow: 'rgba(0, 0, 0, 1)',
      Overlay: 'rgba(0, 0, 0, 0.8)',
    },
  };
};
