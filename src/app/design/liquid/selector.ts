/**
 * Selector for a vanilla-extract class. A composed style (`style([Reset, {…}])`,
 * and every recipe base) is a space-separated list whose first entry is its own
 * identifier; the rest are the styles it composes, which other components
 * share, so only the first may be used to target it.
 */
export const sel = (className: string): string => `.${className.split(' ')[0]}`;

/** Selector for a recipe's base class. */
export const base = (recipe: { classNames: { base: string } }): string =>
  sel(recipe.classNames.base);
