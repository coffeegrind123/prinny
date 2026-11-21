import { describe, expect, it } from 'vitest';
import { cssSpring, settleTime, springPosition, springs } from './spring';

describe('springPosition', () => {
  it('starts at rest at 0', () => {
    for (const params of Object.values(springs)) {
      expect(springPosition(params, 0)).toBeCloseTo(0, 10);
    }
  });

  it('never overshoots when critically damped or overdamped', () => {
    for (const dampingRatio of [1, 1.5, 3]) {
      for (let t = 0; t < 2; t += 0.005) {
        expect(springPosition({ dampingRatio, response: 0.4 }, t)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('overshoots when underdamped', () => {
    let peak = 0;
    for (let t = 0; t < 2; t += 0.001) {
      peak = Math.max(peak, springPosition(springs.bouncy, t));
    }
    // ζ = 0.7: overshoot e^(−πζ/√(1−ζ²)) ≈ 4.6 %
    expect(peak).toBeGreaterThan(1.04);
    expect(peak).toBeLessThan(1.05);
  });

  it('treats a zero response as an instant jump', () => {
    expect(springPosition({ dampingRatio: 1, response: 0 }, 0)).toBe(1);
  });
});

describe('settleTime', () => {
  it('stays inside the settle band from then on', () => {
    for (const params of Object.values(springs)) {
      const end = settleTime(params);
      for (let t = end; t < end + 1; t += 0.01) {
        expect(Math.abs(1 - springPosition(params, t))).toBeLessThanOrEqual(0.001);
      }
    }
  });

  it('is longer for a slower spring', () => {
    expect(settleTime({ dampingRatio: 1, response: 0.6 })).toBeGreaterThan(
      settleTime({ dampingRatio: 1, response: 0.3 }),
    );
  });
});

describe('cssSpring', () => {
  it('emits a linear() curve from 0 to exactly 1', () => {
    const { easing, durationMs } = cssSpring(springs.snappy);
    const points = easing
      .replace(/^linear\(|\)$/g, '')
      .split(', ')
      .map(Number);

    expect(easing.startsWith('linear(')).toBe(true);
    expect(points[0]).toBe(0);
    expect(points[points.length - 1]).toBe(1);
    expect(points.length).toBe(51);
    expect(durationMs).toBeGreaterThan(300);
    expect(durationMs).toBeLessThan(2000);
  });

  it('keeps the overshoot of a bouncy spring in the curve', () => {
    const points = cssSpring(springs.bouncy)
      .easing.replace(/^linear\(|\)$/g, '')
      .split(', ')
      .map(Number);
    expect(Math.max(...points)).toBeGreaterThan(1);
  });
});
