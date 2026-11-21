/**
 * The design layer: which design language the UI is drawn in. Orthogonal to
 * the colour theme (`useTheme`): Prinny keeps the picked theme's colours,
 * Liquid brings its own light and dark palettes and only follows the theme's
 * light/dark kind.
 *
 * Liquid's rules are scoped under a body class rather than swapped in as a
 * second set of components, so the Prinny design is the unmodified stylesheet
 * and switching designs is one class change, with no remount.
 *
 *   body.prinny-liquid                 every Liquid rule
 *   body.prinny-liquid.prinny-liquid-dark   dark-appearance overrides
 */
export enum Design {
  Prinny = 'prinny',
  Liquid = 'liquid',
}

export const LIQUID_CLASS = 'prinny-liquid';
export const LIQUID_DARK_CLASS = 'prinny-liquid-dark';

/**
 * Selector prefixes for Liquid rules (`${LIQUID} ${SomeClass}`). Qualified
 * with `body` so a Liquid rule outranks the folds rule it overrides even when
 * that rule stacks two classes (a recipe base plus a variant), whatever order
 * the stylesheets load in.
 */
export const LIQUID = `body.${LIQUID_CLASS}`;
export const LIQUID_DARK = `body.${LIQUID_CLASS}.${LIQUID_DARK_CLASS}`;

/** Narrow screens, matching ScreenSize.Mobile and the 640px rule in index.css. */
export const MOBILE_MEDIA = 'screen and (max-width: 640px)';

export const isDesign = (value: unknown): value is Design =>
  value === Design.Prinny || value === Design.Liquid;

/** Body classes for a design at a given appearance. */
export const designClassNames = (design: Design, dark: boolean): string[] => {
  if (design !== Design.Liquid) {
    return [];
  }
  return dark ? [LIQUID_CLASS, LIQUID_DARK_CLASS] : [LIQUID_CLASS];
};
