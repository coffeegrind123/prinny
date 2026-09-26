// Re-exports everything from folds but overrides the `Icons` enum with
// lucide-react icons (see ./icons). Wired via the bare-`folds` alias in
// vite.config.js and the matching `paths` entry in tsconfig.json, so every
// `import {...} from 'folds'` resolves here.
//
// folds is compiled from source (vendor/folds, v2.7.2) rather than taken from
// the npm package's prebuilt dist: the dist ships vanilla-extract hashes baked
// in (`._5z5e2h3`, `--oq6d070`), which the custom-CSS feature cannot target
// stably. Built here, its classes and theme variables go through the same
// readable `identifiers` rule as the app's own styles (see vite.config.js).
//
// The two exports below both carry the name `Icons`, which import/export reads
// as a conflict. It is not: an explicit export always shadows a name coming
// from `export *` (a star-exported name that clashes with a local export is
// excluded from the star, per the module spec), so `Icons` resolves to ours and
// everything else to folds'. That shadowing IS the mechanism here.
/* eslint-disable import/export */
export * from '../../vendor/folds/src';
export { Icons } from './icons';
