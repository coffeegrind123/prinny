import { describe, expect, it } from 'vitest';
import { Design, LIQUID_CLASS, LIQUID_DARK_CLASS, designClassNames, isDesign } from './scope';

describe('designClassNames', () => {
  it('adds nothing for Prinny, so the default stylesheet applies untouched', () => {
    expect(designClassNames(Design.Prinny, false)).toEqual([]);
    expect(designClassNames(Design.Prinny, true)).toEqual([]);
  });

  it('scopes Liquid, with the dark class only in dark appearance', () => {
    expect(designClassNames(Design.Liquid, false)).toEqual([LIQUID_CLASS]);
    expect(designClassNames(Design.Liquid, true)).toEqual([LIQUID_CLASS, LIQUID_DARK_CLASS]);
  });
});

describe('isDesign', () => {
  it('accepts only known designs', () => {
    expect(isDesign('prinny')).toBe(true);
    expect(isDesign('liquid')).toBe(true);
    expect(isDesign('glass')).toBe(false);
    expect(isDesign(undefined)).toBe(false);
    expect(isDesign(1)).toBe(false);
  });
});
