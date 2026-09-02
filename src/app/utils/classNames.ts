/**
 * The `classnames` package, as the ~20 lines of it this app actually uses.
 *
 * Bare `classnames` resolves here through an alias in `vite.config.js` and
 * `tsconfig.json`, the same way `folds` resolves to its shim — so all 65 call
 * sites still read `import classNames from 'classnames'` and none of them had
 * to change. That is deliberate: this is a fork, and rewriting an import in 65
 * files buys a merge conflict in 65 files on every upstream sync, forever, in
 * exchange for a dependency worth 44 KB.
 *
 * Behaviour matches the real package for every input shape that reaches it:
 * strings, the `cond && css.Thing` idiom, `{ [css.Thing]: cond }` objects,
 * nested arrays, and numbers. The one documented difference is that the real
 * package also walks `toString` on foreign objects; nothing here passes one,
 * and silently stringifying an arbitrary object into a class attribute is not
 * a behaviour worth reproducing.
 */

export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | { [key: string]: unknown };

const push = (out: string[], value: ClassValue): void => {
  // Plain falsiness, which is what the real package tests. That drops `''`,
  // `false`, `null` and `undefined` — and also `0` and `NaN`, so
  // `classNames(0)` is `''` and not `'0'`. Worth stating because it is the one
  // rule here that is easy to get backwards: an earlier draft of this file
  // treated `0` as a usable class name and differential testing caught it.
  if (!value) return;

  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => push(out, item));
    return;
  }
  Object.keys(value).forEach((key) => {
    if (value[key]) out.push(key);
  });
};

export default function classNames(...values: ClassValue[]): string {
  const out: string[] = [];
  values.forEach((value) => push(out, value));
  return out.join(' ');
}
