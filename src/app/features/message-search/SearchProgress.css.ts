import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Indeterminate sweep for a search whose end is not predictable — a server
// `/search` round-trip, or a local scan whose remaining history is unknown.
const SweepAnime = keyframes({
  '0%': {
    transform: 'translateX(-100%)',
  },
  '100%': {
    transform: 'translateX(250%)',
  },
});

export const ProgressTrack = style({
  position: 'relative',
  overflow: 'hidden',
  width: '100%',
  height: toRem(3),
  flexShrink: 0,
  borderRadius: config.radii.Pill,
  backgroundColor: color.Surface.ContainerLine,
});

export const ProgressSweep = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  width: '40%',
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Main,
  animation: `${SweepAnime} 1100ms ease-in-out infinite`,
});

// Placeholder cards breathe while a search is running. Opacity rather than a
// gradient shimmer so it reads the same on every theme, and so low animation
// mode — which collapses the duration and drops the element back to its base
// style — leaves plain, fully opaque cards rather than a frozen half-lit sweep.
const PulseAnime = keyframes({
  '0%': {
    opacity: 0.4,
  },
  '50%': {
    opacity: 1,
  },
  '100%': {
    opacity: 0.4,
  },
});

export const SkeletonPulse = style({
  animation: `${PulseAnime} 1400ms ease-in-out infinite`,
});
