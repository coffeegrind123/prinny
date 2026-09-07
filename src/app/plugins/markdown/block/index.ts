export * from './parser';
// `canonicalFencedCodeBlocks` — the editor's plain-text fallback needs it, and
// it has to be the same matcher the HTML rule uses. See rules.ts.
export { canonicalFencedCodeBlocks } from './rules';
