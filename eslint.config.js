import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// eslint 10 removed the deprecated `context.getFilename()` and
// `context.getSourceCode()` accessors in favour of `context.filename` and
// `context.sourceCode`. eslint-plugin-react 7.37.5 — its newest release, from
// April 2025, peer-capped at eslint ^9.7 — still calls them in exactly two
// reachable places, and both are load-bearing here:
//
//   1. `util/version.js` -> resolveBasedir(), on the `settings.react.version:
//      'detect'` path this config uses. This is the one that crashes first:
//      `TypeError: contextOrFilename.getFilename is not a function`, aborting
//      the whole run before a single file is reported.
//   2. `rules/jsx-filename-extension.js`, a rule this config enables.
//
// Every other call it makes is already guarded by a fallback
// (`sourceCode.getScope ? ... : context.getScope()` and friends), and the
// unguarded `rules/forward-ref-uses-ref.js` is not in `recommended` and is not
// enabled here. eslint-plugin-jsx-a11y and eslint-plugin-import declare the
// same conservative `^9` peer ceiling but call none of the removed APIs at all.
//
// So the entire incompatibility is one missing method, and re-supplying it to
// this plugin only is both smaller and less lossy than the alternatives:
// staying on an eslint 9 line where every published version is deprecated, or
// dropping the React rules this config deliberately tunes. `Reflect.get` reads
// through with `target` as the receiver and functions are bound to `target`, so
// `context.report` and the rest keep their original `this`.
const restoreRemovedContextAccessors = (plugin) => ({
  ...plugin,
  rules: Object.fromEntries(
    Object.entries(plugin.rules).map(([name, rule]) => [
      name,
      {
        ...rule,
        create(context) {
          return rule.create(
            new Proxy(context, {
              get(target, prop) {
                if (prop === 'getFilename') return () => target.filename;
                if (prop === 'getSourceCode') return () => target.sourceCode;
                const value = Reflect.get(target, prop, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          );
        },
      },
    ]),
  ),
});

const reactCompat = restoreRemovedContextAccessors(reactPlugin);

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'src/sw.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ...reactPlugin.configs.flat.recommended, plugins: { react: reactCompat } },
  { ...reactPlugin.configs.flat['jsx-runtime'], plugins: { react: reactCompat } },
  jsxA11y.flatConfigs.recommended,
  importPlugin.flatConfigs?.recommended,
  prettier,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        JSX: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
    rules: {
      'linebreak-style': 'off',
      'no-underscore-dangle': 'off',
      'no-shadow': 'off',
      'import/prefer-default-export': 'off',
      'import/extensions': 'off',
      'import/no-unresolved': 'off',
      'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
      'react/jsx-filename-extension': ['error', { extensions: ['.tsx', '.jsx'] }],
      'react/require-default-props': 'off',
      'react/jsx-props-no-spreading': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // A leading underscore is the conventional marker for a binding that
      // must exist to satisfy a signature but is deliberately not read — e.g.
      // `getResponseHeader(_name: string)` implementing an interface. Deleting
      // those would break the signature, so honour the convention instead.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Every hit is `export const X = forwardRef(...)` or folds' `as(...)`,
      // which is this codebase's component idiom throughout. The components are
      // named exports, so their identity is obvious in source and React infers
      // the name from the binding in dev builds. Setting displayName on 27
      // components to satisfy a rule that is describing an idiom, not a defect,
      // buys nothing.
      'react/display-name': 'off',
      // Autofocus is flagged wholesale, but every occurrence is the primary
      // input of a dialog, prompt or search popover. Moving focus into a
      // dialog on open is what the WAI-ARIA dialog pattern asks for; not doing
      // it is the accessibility bug.
      'jsx-a11y/no-autofocus': 'off',
      // The media elements here play third-party and user-sent files — Twitter
      // clips, a raw .mp4 someone linked. No caption track exists or could,
      // so the rule cannot be satisfied by anything except not rendering media.
      'jsx-a11y/media-has-caption': 'off',
      // `while (true)` in the vendored E2E key crypto is a deliberate loop, not
      // an accidental constant test.
      'no-constant-condition': ['error', { checkLoops: false }],
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    rules: { 'no-undef': 'off' },
  },
  {
    // `import/named` cannot see TypeScript's type-only exports, so it reports
    // every one of them as missing — `RectCords` from folds, `AuthDict` and
    // `UIAFlow` from matrix-js-sdk, and 285 more. They all exist; the rule is
    // resolving JavaScript exports against a TypeScript surface. eslint-plugin-import
    // documents turning it off for TS precisely because the compiler already
    // enforces this, and `npm run typecheck` is what actually catches a genuinely
    // missing export.
    files: ['**/*.{ts,tsx}'],
    rules: { 'import/named': 'off' },
  },
];
