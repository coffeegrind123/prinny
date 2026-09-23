/**
 * The CSS model behind custom CSS: parse, flatten, diff, merge, format.
 *
 * The user edits a copy of the app's COMPLETE stylesheet, but only what they
 * changed is stored. Storing the whole edited file would freeze every other
 * rule at the version it was exported from and quietly undo later style
 * updates; storing the difference keeps untouched rules following the app.
 *
 *   base (what the page loaded)  --diff-->  overrides (stored, applied last)
 *        \                                      |
 *         `----------- merge ------------------'--> the text shown in the editor
 *
 * Both sides are parsed by the browser's own CSS engine, so the comparison is
 * between canonical serialisations (`color: #FFF` and `color: rgb(255,255,255)`
 * come out the same) and never between two spellings of one value.
 *
 * Semantics, chosen so an emptied or partial file is harmless:
 * - a declaration whose value differs from the base, or is new, is an override;
 * - a rule, at-rule or selector the base does not have is an override;
 * - anything DELETED from the file reverts to the default. Deleting never
 *   removes base styling - that takes `display: none` / `unset` explicitly.
 */

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export type Declaration = {
  value: string;
  important: boolean;
};

/** A style rule, keyed by its conditional context plus selector. */
export type StyleEntry = {
  kind: 'style';
  key: string;
  ctx: string[];
  selector: string;
  // Insertion-ordered, as the engine serialised them.
  decls: Map<string, Declaration>;
  /** Which stylesheet it came from, for section headers in the formatted file. */
  source?: string;
};

/** Any other rule (@keyframes, @font-face, @property, ...), compared as a whole. */
export type AtEntry = {
  kind: 'at';
  key: string;
  ctx: string[];
  text: string;
  source?: string;
};

/** `@import` - only valid at the top of a sheet, so it is kept apart. */
export type ImportEntry = {
  kind: 'import';
  key: string;
  ctx: string[];
  text: string;
  source?: string;
};

export type CssEntry = StyleEntry | AtEntry | ImportEntry;

const CTX_SEPARATOR = '\u0000';

const entryKey = (ctx: string[], id: string): string => [...ctx, id].join(CTX_SEPARATOR);

// ---------------------------------------------------------------------------
// Low-level text helpers (quote- and paren-aware)
// ---------------------------------------------------------------------------

/**
 * Splits `text` on `separator` wherever it is not inside a string, `( )` or
 * `[ ]`. Needed because `;` and `,` legally appear inside `url(data:...;base64,...)`,
 * `:is(a, b)`, attribute selectors and quoted strings.
 */
export const splitTopLevel = (text: string, separator: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = undefined;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth += 1;
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
    } else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
};

const IMPORTANT_SUFFIX = /\s*!\s*important$/i;

/**
 * Reads declarations from `style.cssText` rather than walking longhands.
 *
 * Walking `style.item(i)` expands shorthands, and a shorthand written with a
 * variable (`padding: var(--gap)`) expands to longhands whose value is the empty
 * "pending substitution" string - so two different `var()`s would compare
 * equal. `cssText` keeps the engine's canonical shorthand serialisation.
 */
export const readDeclarations = (style: CSSStyleDeclaration): Map<string, Declaration> => {
  const decls = new Map<string, Declaration>();

  splitTopLevel(style.cssText, ';').forEach((raw) => {
    const colon = raw.indexOf(':');
    if (colon <= 0) {
      return;
    }
    const prop = raw.slice(0, colon).trim();
    let value = raw.slice(colon + 1).trim();
    const important = IMPORTANT_SUFFIX.test(value);
    if (important) {
      value = value.replace(IMPORTANT_SUFFIX, '').trim();
    }
    decls.set(prop, { value, important });
  });

  return decls;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParsedCss = {
  entries: CssEntry[];
};

/** The header of a grouping rule, e.g. `@media (max-width: 750px)`. */
const groupHeader = (rule: CSSRule): string => {
  const text = rule.cssText;
  const brace = text.indexOf('{');
  return (brace === -1 ? text : text.slice(0, brace)).trim();
};

const hasChildRules = (rule: CSSRule): rule is CSSRule & { cssRules: CSSRuleList } =>
  'cssRules' in rule && (rule as { cssRules?: unknown }).cssRules instanceof CSSRuleList;

const atKey = (rule: CSSRule): string => {
  if (rule instanceof CSSKeyframesRule) {
    return `@keyframes ${rule.name}`;
  }
  if (typeof CSSPropertyRule !== 'undefined' && rule instanceof CSSPropertyRule) {
    return `@property ${rule.name}`;
  }
  if (typeof CSSCounterStyleRule !== 'undefined' && rule instanceof CSSCounterStyleRule) {
    return `@counter-style ${rule.name}`;
  }
  // @font-face and anything else has no identity beyond its content: a
  // different one is a new one.
  return rule.cssText;
};

export const flattenRules = (
  rules: CSSRuleList,
  ctx: string[],
  out: CssEntry[],
  source?: string,
): CssEntry[] => {
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];

    if (rule instanceof CSSStyleRule) {
      const { selectorText } = rule;
      out.push({
        kind: 'style',
        key: entryKey(ctx, selectorText),
        ctx,
        selector: selectorText,
        decls: readDeclarations(rule.style),
        source,
      });
      // CSS nesting: children are relative to this selector, so it becomes
      // part of their context.
      if (hasChildRules(rule) && rule.cssRules.length > 0) {
        flattenRules(rule.cssRules, [...ctx, selectorText], out, source);
      }
      continue;
    }

    if (rule instanceof CSSImportRule) {
      out.push({ kind: 'import', key: rule.cssText, ctx: [], text: rule.cssText, source });
      continue;
    }

    if (!(rule instanceof CSSKeyframesRule) && hasChildRules(rule)) {
      flattenRules(rule.cssRules, [...ctx, groupHeader(rule)], out, source);
      continue;
    }

    out.push({
      kind: 'at',
      key: entryKey(ctx, atKey(rule)),
      ctx,
      text: rule.cssText,
      source,
    });
  }

  return out;
};

/**
 * Parses CSS text with the browser's engine, without applying it to the page.
 *
 * A style element in an inert document (no browsing context) is parsed but
 * never matched against the page and never fetches `@import`s, and - unlike a
 * constructable stylesheet's `replaceSync` - keeps `@import` rules in its CSSOM,
 * so they survive the round trip.
 */
export const parseCss = (text: string): ParsedCss => {
  const doc = document.implementation.createHTMLDocument('');
  const style = doc.createElement('style');
  style.textContent = text;
  doc.head.appendChild(style);

  let rules: CSSRuleList | undefined = style.sheet?.cssRules;

  if (!rules && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
    // Fallback for an engine that does not build sheets in inert documents.
    // `@import` is dropped on this path.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    rules = sheet.cssRules;
  }
  if (!rules) {
    throw new Error('This browser cannot parse CSS outside the page.');
  }

  return { entries: flattenRules(rules, [], []) };
};

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

type StyleIndex = Map<string, Map<string, Declaration>>;

/** Later rules with the same key win, exactly as the cascade does. */
const indexStyles = (entries: CssEntry[]): StyleIndex => {
  const index: StyleIndex = new Map();
  entries.forEach((entry) => {
    if (entry.kind !== 'style') {
      return;
    }
    const merged = index.get(entry.key) ?? new Map<string, Declaration>();
    entry.decls.forEach((decl, prop) => merged.set(prop, decl));
    index.set(entry.key, merged);
  });
  return index;
};

const sameDecl = (a: Declaration | undefined, b: Declaration): boolean =>
  a !== undefined && a.value === b.value && a.important === b.important;

/**
 * Everything in `edited` that differs from `base`, as entries in edited order.
 * Per-key: one style entry carrying only the changed/new declarations.
 */
export const diffCss = (base: CssEntry[], edited: CssEntry[]): CssEntry[] => {
  const baseStyles = indexStyles(base);
  const baseOther = new Map<string, string>();
  base.forEach((entry) => {
    if (entry.kind !== 'style') {
      baseOther.set(entry.key, entry.text);
    }
  });

  const editedStyles = indexStyles(edited);
  const out: CssEntry[] = [];
  const emitted = new Set<string>();

  edited.forEach((entry) => {
    if (emitted.has(entry.key)) {
      return;
    }

    if (entry.kind !== 'style') {
      if (baseOther.get(entry.key) !== entry.text) {
        out.push({ ...entry, source: undefined });
      }
      emitted.add(entry.key);
      return;
    }

    // Compare the key's effective declarations, not this one occurrence: the
    // same selector can appear several times and only the cascade result counts.
    const effective = editedStyles.get(entry.key);
    const baseDecls = baseStyles.get(entry.key);
    const changed = new Map<string, Declaration>();
    effective?.forEach((decl, prop) => {
      if (!sameDecl(baseDecls?.get(prop), decl)) {
        changed.set(prop, decl);
      }
    });
    emitted.add(entry.key);

    if (changed.size > 0) {
      out.push({ ...entry, decls: changed, source: undefined });
    }
  });

  return out;
};

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * The base with `overrides` folded in, for the editor: changed declarations
 * are patched into the LAST occurrence of their rule (the one that wins), and
 * anything the base does not have is appended in a section of its own.
 *
 * Invariant relied on by the round trip: diffCss(base, mergeCss(base, o)) is o
 * (up to the order of appended entries).
 */
export const mergeCss = (base: CssEntry[], overrides: CssEntry[]): CssEntry[] => {
  const styleOverrides = indexStyles(overrides);
  const otherOverrides = new Map<string, CssEntry>();
  overrides.forEach((entry) => {
    if (entry.kind !== 'style') {
      otherOverrides.set(entry.key, entry);
    }
  });

  const lastIndex = new Map<string, number>();
  base.forEach((entry, i) => lastIndex.set(entry.key, i));

  const used = new Set<string>();
  const merged: CssEntry[] = base.map((entry, i) => {
    if (lastIndex.get(entry.key) !== i) {
      return entry;
    }

    if (entry.kind === 'style') {
      const patch = styleOverrides.get(entry.key);
      if (!patch) {
        return entry;
      }
      used.add(entry.key);
      const decls = new Map(entry.decls);
      patch.forEach((decl, prop) => decls.set(prop, decl));
      return { ...entry, decls };
    }

    const replacement = otherOverrides.get(entry.key);
    if (!replacement) {
      return entry;
    }
    used.add(entry.key);
    return { ...replacement, source: entry.source };
  });

  const added = overrides.filter((entry) => !used.has(entry.key));
  const imports = added.filter((entry) => entry.kind === 'import');
  const rest = added
    .filter((entry) => entry.kind !== 'import')
    .map((entry) => ({ ...entry, source: ADDED_SOURCE }));

  return [...imports, ...merged, ...rest];
};

export const ADDED_SOURCE = 'Added by you';

/** Counts declarations and whole rules an override set changes. */
export const countOverrides = (overrides: CssEntry[]): number =>
  overrides.reduce((n, entry) => n + (entry.kind === 'style' ? entry.decls.size : 1), 0);

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const INDENT = '  ';

const pad = (depth: number): string => INDENT.repeat(depth);

/** `a, b:is(c, d)` -> one selector per line. */
const formatSelector = (selector: string, depth: number): string =>
  splitTopLevel(selector, ',').join(`,\n${pad(depth)}`);

const formatDecls = (decls: Map<string, Declaration>, depth: number): string => {
  const lines: string[] = [];
  decls.forEach((decl, prop) => {
    lines.push(`${pad(depth)}${prop}: ${decl.value}${decl.important ? ' !important' : ''};`);
  });
  return lines.join('\n');
};

/**
 * Re-indents a one-line serialisation such as
 * `@keyframes x { 0% { opacity: 0; } 100% { opacity: 1; } }`.
 */
export const formatBlock = (text: string, depth: number): string => {
  let out = '';
  let level = depth;
  let quote: string | undefined;
  let parens = 0;
  let line = '';

  const flush = () => {
    const trimmed = line.trim();
    if (trimmed) {
      out += `${pad(level)}${trimmed}\n`;
    }
    line = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      line += ch;
      if (ch === '\\' && i + 1 < text.length) {
        i += 1;
        line += text[i];
      } else if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      line += ch;
    } else if (ch === '(') {
      parens += 1;
      line += ch;
    } else if (ch === ')') {
      parens = Math.max(0, parens - 1);
      line += ch;
    } else if (ch === '{' && parens === 0) {
      line = `${line.trimEnd()} {`;
      flush();
      level += 1;
    } else if (ch === '}' && parens === 0) {
      flush();
      level = Math.max(depth, level - 1);
      out += `${pad(level)}}\n`;
    } else if (ch === ';' && parens === 0) {
      line += ';';
      flush();
    } else {
      line += ch;
    }
  }
  flush();

  return out.replace(/\n$/, '');
};

/** First vanilla-extract scope in a selector: `.folds-Button_Button_variant_Primary` -> `folds-Button`. */
const scopeOf = (entry: CssEntry): string | undefined => {
  if (entry.kind !== 'style') {
    return undefined;
  }
  const match = /\.([A-Za-z][A-Za-z0-9-]*)_[A-Za-z0-9]/.exec(entry.selector);
  return match?.[1];
};

const sectionRule = (title: string): string => {
  const line = '='.repeat(Math.max(8, 72 - title.length - 8));
  return `/* ===== ${title} ${line} */`;
};

export type FormatOptions = {
  /** Emit section/scope comments. Off for the stored override text. */
  headers?: boolean;
};

export const formatCss = (entries: CssEntry[], options: FormatOptions = {}): string => {
  const chunks: string[] = [];
  let open: string[] = [];
  let source: string | undefined;
  let scope: string | undefined;

  const closeTo = (depth: number) => {
    while (open.length > depth) {
      open = open.slice(0, -1);
      chunks.push(`${pad(open.length)}}`);
    }
  };

  entries.forEach((entry) => {
    if (options.headers && entry.source !== source) {
      closeTo(0);
      source = entry.source;
      scope = undefined;
      if (source) {
        chunks.push('', sectionRule(source), '');
      }
    }

    const entryScope = scopeOf(entry);
    if (options.headers && entryScope && entryScope !== scope && entry.ctx.length === 0) {
      closeTo(0);
      scope = entryScope;
      chunks.push('', `/* --- ${entryScope} --- */`);
    }

    // Keep the longest shared context open; close the rest, open the new tail.
    let shared = 0;
    while (
      shared < open.length &&
      shared < entry.ctx.length &&
      open[shared] === entry.ctx[shared]
    ) {
      shared += 1;
    }
    closeTo(shared);
    entry.ctx.slice(shared).forEach((header) => {
      chunks.push(`${pad(open.length)}${header} {`);
      open = [...open, header];
    });

    const depth = open.length;
    if (entry.kind === 'style') {
      const body = formatDecls(entry.decls, depth + 1);
      chunks.push(
        body
          ? `${pad(depth)}${formatSelector(entry.selector, depth)} {\n${body}\n${pad(depth)}}`
          : `${pad(depth)}${formatSelector(entry.selector, depth)} {}`,
      );
    } else {
      chunks.push(formatBlock(entry.text, depth));
    }
  });
  closeTo(0);

  return `${chunks
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n')}\n`;
};
