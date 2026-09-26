# folds (vendored)

Source of [cinnyapp/folds](https://github.com/cinnyapp/folds) **v2.7.2**
(Apache-2.0, see `LICENSE` and `NOTICE.md`), minus Storybook stories. Imported through
`src/folds/index.ts`, never directly.

Vendored rather than installed because the npm package ships compiled
vanilla-extract CSS with hashed class and variable names baked in. Compiled
here, folds goes through the same readable-identifier rule as the app
(`scripts/vite-readable-css.mjs`), which the custom-CSS feature depends on:
`.folds-Button_Button_variant_Primary`, `--folds-color_Background-Container`.

Local changes against v2.7.2 — only what React 19 types / TS 6 require; the
emitted CSS is rule-for-rule identical to the npm build:

- `components/as.tsx` — cast `fc` to `ForwardRefRenderFunction` before
  `forwardRef` (React 19's `PropsWithoutRef` no longer unifies with the
  generic props). The public signature of `as` is unchanged.
- `components/icon/Icons.tsx` — `JSX.Element` -> `React.JSX.Element` (global
  `JSX` namespace removed in @types/react 19).
- `components/scroll/Scroll.tsx` — `useRef<HTMLDivElement>(undefined)`
  (React 19 requires the initial value).

To update: replace `src/` with the new tag's `src/` (drop `*.stories.*` and
`*.mdx`), re-apply the list above, and diff the built CSS against the previous
build.
