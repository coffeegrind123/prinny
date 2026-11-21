import { assignVars, createThemeContract, globalStyle } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { LIQUID, LIQUID_DARK } from '../scope';
import { cssSpring, springs } from '../spring';

/**
 * Tokens the Liquid design adds on top of folds' `color` and `config`
 * contracts. Prinny never assigns them: every rule that reads one is scoped
 * under `LIQUID`, so the default design's stylesheet is untouched.
 *
 * Material model, after liquid-gpu's CSS glass renderer (nshelia/liquid-gpu,
 * packages/gpu/src/fallback.ts), re-derived here rather than copied:
 *
 *   ┌──────────────── glass shape ────────────────┐
 *   │ backdrop-filter: blur · saturate            │  frosts what is behind
 *   │ background: Fill (white/black at α)         │  tints it
 *   │ box-shadow: Edge (inset rim + hairline)     │  the lit edge
 *   │           + Shadow (drop, offset y)         │  lifts it off the page
 *   └─────────────────────────────────────────────┘
 *
 * Regular glass is for chrome over content (bars, rails, the composer);
 * Thick is for things that must stay legible over anything (menus, popovers,
 * sheets).
 */
export const design = createThemeContract({
  Backdrop: {
    Page: '',
  },
  Glass: {
    Fill: '',
    Filter: '',
    ThickFill: '',
    ThickFilter: '',
    Edge: '',
    Shadow: '',
    /** Fill of the selection lens: the selected row, tab or rail item. */
    Lens: '',
    /** Text and icons on the lens. */
    OnLens: '',
  },
  Separator: {
    Line: '',
  },
  Control: {
    /** Track of a switch that is on: the bright system green, not the text green. */
    SwitchOn: '',
  },
  Motion: {
    Smooth: '',
    SmoothDuration: '',
    Snappy: '',
    SnappyDuration: '',
    Bouncy: '',
    BouncyDuration: '',
    Interactive: '',
    InteractiveDuration: '',
    Sheet: '',
    SheetDuration: '',
    Menu: '',
    MenuDuration: '',
  },
  Radius: {
    /** Inset grouped sections, panels, cards. */
    Panel: '',
    /** Modals presented as sheets. */
    Sheet: '',
    /** Menus and popovers. */
    Menu: '',
    /** Rows inside a panel or menu. */
    Row: '',
    /** Text fields. */
    Field: '',
    /** Message bubbles. */
    Bubble: '',
  },
  Space: {
    /** Gap between the floating panels, and between them and the window edge. */
    Gutter: '',
  },
});

const motion = (() => {
  const entry = (params: (typeof springs)[keyof typeof springs]) => cssSpring(params);
  const smooth = entry(springs.smooth);
  const snappy = entry(springs.snappy);
  const bouncy = entry(springs.bouncy);
  const interactive = entry(springs.interactive);
  const sheet = entry(springs.sheet);
  const menu = entry(springs.menuOpen);
  return {
    Smooth: smooth.easing,
    SmoothDuration: `${smooth.durationMs}ms`,
    Snappy: snappy.easing,
    SnappyDuration: `${snappy.durationMs}ms`,
    Bouncy: bouncy.easing,
    BouncyDuration: `${bouncy.durationMs}ms`,
    Interactive: interactive.easing,
    InteractiveDuration: `${interactive.durationMs}ms`,
    Sheet: sheet.easing,
    SheetDuration: `${sheet.durationMs}ms`,
    Menu: menu.easing,
    MenuDuration: `${menu.durationMs}ms`,
  };
})();

// Corner radii from the iOS 26 metrics liquid-gpu cites (packages/core/src/
// tokens.ts): inset grouped section 26, menu 32 (24 here: desktop menus are
// denser), sheet 38 (28: a desktop modal is smaller than a phone sheet), bar
// item capsule 22.
const radius = {
  Panel: toRem(26),
  Sheet: toRem(28),
  Menu: toRem(22),
  Row: toRem(12),
  Field: toRem(14),
  Bubble: toRem(20),
};

const space = {
  Gutter: toRem(8),
};

const LIGHT_BACKDROP = [
  'radial-gradient(70rem 50rem at 0% 0%, rgba(0, 122, 255, 0.34), transparent 60%)',
  'radial-gradient(60rem 50rem at 100% 0%, rgba(175, 82, 222, 0.28), transparent 60%)',
  'radial-gradient(80rem 60rem at 60% 110%, rgba(48, 176, 199, 0.3), transparent 60%)',
  '#E4E8F2',
].join(', ');

const DARK_BACKDROP = [
  'radial-gradient(70rem 50rem at 0% 0%, rgba(10, 132, 255, 0.22), transparent 60%)',
  'radial-gradient(60rem 50rem at 100% 0%, rgba(191, 90, 242, 0.16), transparent 60%)',
  'radial-gradient(80rem 60rem at 60% 110%, rgba(64, 200, 224, 0.12), transparent 60%)',
  '#060608',
].join(', ');

// Light rim: a hairline dark ring with a bright line inside it, as on device
// (fallback.ts: 0.67 px at 14 %, 1.33 px white at 90 %), softened for the
// larger, flatter shapes of a desktop window.
const LIGHT_EDGE = [
  'inset 0 0 0 0.67px rgba(0, 0, 0, 0.08)',
  'inset 0 0 0 1.33px rgba(255, 255, 255, 0.7)',
  'inset 0 1px 0.5px rgba(255, 255, 255, 0.8)',
].join(', ');

// Dark rim: key light from above, fill from below, faint uniform ring.
const DARK_EDGE = [
  'inset 0 1px 0.5px rgba(255, 255, 255, 0.28)',
  'inset 0 -1px 0.5px rgba(255, 255, 255, 0.08)',
  'inset 0 0 0 0.5px rgba(255, 255, 255, 0.12)',
].join(', ');

globalStyle(LIQUID, {
  vars: {
    ...assignVars(design, {
      Backdrop: { Page: LIGHT_BACKDROP },
      Glass: {
        Fill: 'rgba(255, 255, 255, 0.58)',
        Filter: 'blur(20px) saturate(1.8)',
        ThickFill: 'rgba(249, 249, 251, 0.84)',
        ThickFilter: 'blur(32px) saturate(1.8)',
        Edge: LIGHT_EDGE,
        Shadow: '0 8px 28px rgba(0, 0, 0, 0.09), 0 1px 3px rgba(0, 0, 0, 0.05)',
        Lens: 'rgba(0, 122, 255, 0.13)',
        OnLens: '#0066D6',
      },
      Separator: { Line: 'rgba(60, 60, 67, 0.16)' },
      Control: { SwitchOn: '#34C759' },
      Motion: motion,
      Radius: radius,
      Space: space,
    }),
  },
});

globalStyle(LIQUID_DARK, {
  vars: assignVars(design.Glass, {
    Fill: 'rgba(40, 40, 44, 0.52)',
    Filter: 'blur(20px) saturate(1.6)',
    ThickFill: 'rgba(34, 34, 38, 0.84)',
    ThickFilter: 'blur(32px) saturate(1.6)',
    Edge: DARK_EDGE,
    Shadow: '0 8px 28px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.3)',
    Lens: 'rgba(10, 132, 255, 0.24)',
    OnLens: '#64B0FF',
  }),
});

globalStyle(LIQUID_DARK, {
  vars: {
    [design.Backdrop.Page]: DARK_BACKDROP,
    [design.Separator.Line]: 'rgba(84, 84, 88, 0.5)',
    [design.Control.SwitchOn]: '#30D158',
  },
});

// folds' own tokens, reassigned. `body.prinny-liquid` outranks the single
// theme and config classes on <body>, so these win whatever order the
// stylesheets load in.
globalStyle(LIQUID, {
  vars: {
    ...assignVars(config.radii, {
      R0: '0',
      R300: toRem(8),
      R400: toRem(12),
      R500: toRem(18),
      Round: '50%',
      Pill: '9999px',
    }),
    ...assignVars(config.shadow, {
      E100: `0 1px 4px ${color.Other.Shadow}`,
      E200: `0 4px 14px ${color.Other.Shadow}`,
      E300: `0 8px 28px ${color.Other.Shadow}`,
      E400: `0 16px 48px ${color.Other.Shadow}`,
    }),
    [config.font.Inter]:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', InterVariable, 'Inter', 'Segoe UI', 'Helvetica', 'Arial', sans-serif",
    [config.letterSpacing.D400]: '-0.02em',
    [config.letterSpacing.H1]: '-0.02em',
    [config.letterSpacing.H2]: '-0.015em',
    [config.letterSpacing.H3]: '-0.01em',
    [config.letterSpacing.H4]: '-0.01em',
  },
});

/* Palettes. The content layer is opaque (system background colours); the
   chrome layer (`Background`) is translucent so the glass it sits on shows
   through. Text colours are the accessible variants of the iOS system colours
   (systemBlue #007AFF reads at 4.0:1 on white; #0066D6 does not need to). */

globalStyle(LIQUID, {
  vars: assignVars(color, {
    Background: {
      Container: 'rgba(255, 255, 255, 0.4)',
      ContainerHover: 'rgba(120, 120, 128, 0.12)',
      ContainerActive: 'rgba(120, 120, 128, 0.2)',
      ContainerLine: 'rgba(60, 60, 67, 0.14)',
      OnContainer: '#000000',
    },
    Surface: {
      Container: '#FFFFFF',
      ContainerHover: '#F2F2F7',
      ContainerActive: '#E5E5EA',
      ContainerLine: '#E3E3E8',
      OnContainer: '#000000',
    },
    SurfaceVariant: {
      Container: '#F2F2F7',
      ContainerHover: '#E9E9EE',
      ContainerActive: '#DEDEE3',
      ContainerLine: '#D1D1D6',
      OnContainer: '#000000',
    },
    Primary: {
      Main: '#007AFF',
      MainHover: '#0071EB',
      MainActive: '#0066D6',
      MainLine: '#005FC7',
      OnMain: '#FFFFFF',
      Container: '#E5F0FF',
      ContainerHover: '#D8E8FF',
      ContainerActive: '#CADFFF',
      ContainerLine: '#B8D3FF',
      OnContainer: '#0050B0',
    },
    Secondary: {
      Main: '#1C1C1E',
      MainHover: '#2C2C2E',
      MainActive: '#3A3A3C',
      MainLine: '#48484A',
      OnMain: '#FFFFFF',
      Container: '#E9E9EE',
      ContainerHover: '#DEDEE3',
      ContainerActive: '#D1D1D6',
      ContainerLine: '#C7C7CC',
      OnContainer: '#1C1C1E',
    },
    Success: {
      Main: '#248A3D',
      MainHover: '#1F7A35',
      MainActive: '#1B6D2F',
      MainLine: '#175F29',
      OnMain: '#FFFFFF',
      Container: '#E3F6E8',
      ContainerHover: '#D5F1DC',
      ContainerActive: '#C6EBD0',
      ContainerLine: '#B5E5C3',
      OnContainer: '#1A6B2E',
    },
    Warning: {
      Main: '#C93400',
      MainHover: '#B52F00',
      MainActive: '#A82C00',
      MainLine: '#9A2800',
      OnMain: '#FFFFFF',
      Container: '#FFEDE0',
      ContainerHover: '#FFE2CF',
      ContainerActive: '#FFD7BE',
      ContainerLine: '#FFCBAA',
      OnContainer: '#8A2400',
    },
    Critical: {
      Main: '#D70015',
      MainHover: '#C20013',
      MainActive: '#B50012',
      MainLine: '#A80010',
      OnMain: '#FFFFFF',
      Container: '#FFE7E9',
      ContainerHover: '#FFD9DC',
      ContainerActive: '#FFCACE',
      ContainerLine: '#FFBAC0',
      OnContainer: '#96000F',
    },
    Other: {
      FocusRing: 'rgba(0, 122, 255, 0.55)',
      Shadow: 'rgba(0, 0, 0, 0.1)',
      Overlay: 'rgba(0, 0, 0, 0.28)',
    },
  }),
});

globalStyle(LIQUID_DARK, {
  vars: assignVars(color, {
    Background: {
      Container: 'rgba(28, 28, 30, 0.42)',
      ContainerHover: 'rgba(120, 120, 128, 0.24)',
      ContainerActive: 'rgba(120, 120, 128, 0.34)',
      ContainerLine: 'rgba(84, 84, 88, 0.45)',
      OnContainer: '#FFFFFF',
    },
    Surface: {
      Container: '#1C1C1E',
      ContainerHover: '#262628',
      ContainerActive: '#2C2C2E',
      ContainerLine: '#2F2F32',
      OnContainer: '#FFFFFF',
    },
    SurfaceVariant: {
      Container: '#2C2C2E',
      ContainerHover: '#333336',
      ContainerActive: '#3A3A3C',
      ContainerLine: '#48484A',
      OnContainer: '#FFFFFF',
    },
    Primary: {
      Main: '#0A84FF',
      MainHover: '#2E95FF',
      MainActive: '#4DA3FF',
      MainLine: '#66B1FF',
      OnMain: '#FFFFFF',
      Container: '#0B2A4D',
      ContainerHover: '#0E335E',
      ContainerActive: '#113C6F',
      ContainerLine: '#144680',
      OnContainer: '#A9D2FF',
    },
    Secondary: {
      Main: '#F2F2F7',
      MainHover: '#E5E5EA',
      MainActive: '#D1D1D6',
      MainLine: '#C7C7CC',
      OnMain: '#1C1C1E',
      Container: '#3A3A3C',
      ContainerHover: '#48484A',
      ContainerActive: '#545458',
      ContainerLine: '#636366',
      OnContainer: '#F2F2F7',
    },
    Success: {
      Main: '#30D158',
      MainHover: '#4CD96F',
      MainActive: '#66DF85',
      MainLine: '#7FE59A',
      OnMain: '#002A0D',
      Container: '#0F3B1D',
      ContainerHover: '#134825',
      ContainerActive: '#17552C',
      ContainerLine: '#1B6233',
      OnContainer: '#B8F2C8',
    },
    Warning: {
      Main: '#FF9F0A',
      MainHover: '#FFAD33',
      MainActive: '#FFBA57',
      MainLine: '#FFC778',
      OnMain: '#3A2000',
      Container: '#4A2C00',
      ContainerHover: '#5A3600',
      ContainerActive: '#6A4000',
      ContainerLine: '#7A4A00',
      OnContainer: '#FFE0B2',
    },
    Critical: {
      Main: '#FF453A',
      MainHover: '#FF6259',
      MainActive: '#FF7B73',
      MainLine: '#FF948D',
      OnMain: '#FFFFFF',
      Container: '#4D1412',
      ContainerHover: '#5E1916',
      ContainerActive: '#6F1E1A',
      ContainerLine: '#80231F',
      OnContainer: '#FFD0CC',
    },
    Other: {
      FocusRing: 'rgba(10, 132, 255, 0.7)',
      Shadow: 'rgba(0, 0, 0, 0.55)',
      Overlay: 'rgba(0, 0, 0, 0.5)',
    },
  }),
});
