/**
 * Springs for CSS: the closed-form step response of a damped spring, sampled
 * into a `linear()` easing so the browser animates it on the compositor with
 * no per-frame JavaScript.
 *
 * Parameterised the way SwiftUI and UIKit describe springs: `response` is the
 * undamped period in seconds, `dampingRatio` is ζ (1 = critical, < 1 bounces).
 * Mass is fixed at 1, so stiffness k = (2π / response)² and the damping
 * coefficient c = 4π·ζ / response.
 *
 *   x(t) = 1 − e^(−ζω₀t) · (cos ω_d t + (ζω₀ / ω_d) · sin ω_d t)    ζ < 1
 *   x(t) = 1 − e^(−ω₀t) · (1 + ω₀t)                                  ζ = 1
 *   x(t) = 1 − (r₂e^(r₁t) − r₁e^(r₂t)) / (r₂ − r₁)                   ζ > 1
 */

export type SpringParams = {
  dampingRatio: number;
  /** Undamped period, seconds. */
  response: number;
};

export type CssSpring = {
  /** A CSS `linear()` timing function. */
  easing: string;
  /** Time until the spring has settled, milliseconds (rounded up). */
  durationMs: number;
};

/** Distance from the target at which a spring counts as at rest. */
const SETTLE_EPSILON = 0.001;

/** Upper bound on simulated time, so a pathological spring still ends. */
const MAX_SECONDS = 5;

/** Points per `linear()` curve. 50 keeps bounces smooth at 120 Hz. */
const SAMPLES = 50;

const SAMPLE_STEP_SECONDS = 1 / 1000;

/** Normalised position (0 → 1) of a spring released from rest at t seconds. */
export function springPosition({ dampingRatio, response }: SpringParams, t: number): number {
  if (response <= 0) {
    return 1;
  }

  const w0 = (2 * Math.PI) / response;
  const z = dampingRatio;

  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    const envelope = Math.exp(-z * w0 * t);
    return 1 - envelope * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }

  if (z === 1) {
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }

  const root = w0 * Math.sqrt(z * z - 1);
  const r1 = -z * w0 + root;
  const r2 = -z * w0 - root;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/**
 * Seconds until the spring stays within SETTLE_EPSILON of its target for good.
 * Scans backwards from MAX_SECONDS so a bounce that re-crosses the band late
 * is not mistaken for settling.
 */
export function settleTime(params: SpringParams): number {
  for (let t = MAX_SECONDS; t > 0; t -= SAMPLE_STEP_SECONDS) {
    if (Math.abs(1 - springPosition(params, t)) > SETTLE_EPSILON) {
      return Math.min(MAX_SECONDS, t + SAMPLE_STEP_SECONDS);
    }
  }
  return SAMPLE_STEP_SECONDS;
}

const fmt = (n: number): string => {
  const s = n.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
};

export function cssSpring(params: SpringParams): CssSpring {
  const total = settleTime(params);
  const points: string[] = [];

  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = (i / SAMPLES) * total;
    points.push(fmt(i === SAMPLES ? 1 : springPosition(params, t)));
  }

  return {
    easing: `linear(${points.join(', ')})`,
    durationMs: Math.ceil(total * 1000),
  };
}

/**
 * Named springs. Values follow the iOS system springs the Liquid design takes
 * its motion from (SwiftUI `.smooth`, `.snappy`, `.bouncy`; UIKit's
 * interactive and sheet springs).
 */
export const springs = {
  smooth: { dampingRatio: 1, response: 0.5 },
  snappy: { dampingRatio: 0.85, response: 0.5 },
  bouncy: { dampingRatio: 0.7, response: 0.5 },
  interactive: { dampingRatio: 0.85, response: 0.15 },
  sheet: { dampingRatio: 1, response: 0.3441 },
  menuOpen: { dampingRatio: 0.75, response: 0.35 },
  switchKnob: { dampingRatio: 1, response: 0.3 },
} satisfies Record<string, SpringParams>;
