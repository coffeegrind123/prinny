/**
 * Custom CSS state: what is stored, and keeping it applied.
 *
 * Two independent layers, applied after every app stylesheet, in this order:
 *
 *   app CSS  ->  overrides (diffed from the edited full file)  ->  snippets (the settings box, verbatim)
 *
 * Both live in localStorage on this device only. They are deliberately NOT
 * synced through account data: CSS can read page content out through
 * attribute selectors that load URLs, so CSS arriving from the account would
 * turn an account compromise into a way to read every client's screen.
 */
import { CUSTOM_CSS_ATTR, loadBaseStylesheet } from './baseStylesheet';
import { countOverrides, diffCss, formatCss, mergeCss, parseCss } from './cssModel';

const OVERRIDES_KEY = 'prinny.customCss.overrides';
const SNIPPETS_KEY = 'prinny.customCss.snippets';

// Order matters: later wins.
const LAYERS = [
  { key: OVERRIDES_KEY, id: 'prinny-custom-css-overrides' },
  { key: SNIPPETS_KEY, id: 'prinny-custom-css-snippets' },
] as const;

export type CustomCssState = {
  overrides: string;
  snippets: string;
};

const read = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

const write = (key: string, value: string) => {
  if (value) {
    localStorage.setItem(key, value);
  } else {
    localStorage.removeItem(key);
  }
};

let state: CustomCssState = { overrides: read(OVERRIDES_KEY), snippets: read(SNIPPETS_KEY) };
const listeners = new Set<() => void>();

export const getCustomCssState = (): CustomCssState => state;

export const subscribeCustomCss = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

const layerElement = (id: string): HTMLStyleElement => {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLStyleElement) {
    return existing;
  }
  const el = document.createElement('style');
  el.id = id;
  el.setAttribute(CUSTOM_CSS_ATTR, '');
  document.head.appendChild(el);
  return el;
};

/**
 * Our layers must stay the LAST stylesheets in <head>: overrides use the same
 * selectors as the rules they override, so on equal specificity the later
 * sheet wins. The app appends lazily loaded CSS (maps, math, code highlighting,
 * and every module in the dev server) long after startup, which would put base
 * rules back on top - so any stylesheet added after ours moves ours to the end.
 */
const keepLast = () => {
  const elements = LAYERS.map(({ id }) => document.getElementById(id)).filter(
    (el): el is HTMLElement => el !== null,
  );
  if (elements.length === 0) {
    return;
  }

  const { head } = document;
  const tail = Array.from(head.children).slice(-elements.length);
  if (tail.every((el, i) => el === elements[i])) {
    return;
  }
  elements.forEach((el) => head.appendChild(el));
};

let observer: MutationObserver | undefined;

const applyState = () => {
  LAYERS.forEach(({ key, id }) => {
    const css = key === OVERRIDES_KEY ? state.overrides : state.snippets;
    if (!css) {
      document.getElementById(id)?.remove();
      return;
    }
    const el = layerElement(id);
    if (el.textContent !== css) {
      el.textContent = css;
    }
  });
  keepLast();

  if (!observer) {
    observer = new MutationObserver(keepLast);
    observer.observe(document.head, { childList: true });
  }
};

const setState = (next: CustomCssState) => {
  state = next;
  applyState();
  listeners.forEach((listener) => listener());
};

const persist = (next: CustomCssState) => {
  // Write before applying, so a quota failure surfaces to the caller and the
  // page never shows CSS that will be gone after a reload.
  write(OVERRIDES_KEY, next.overrides);
  write(SNIPPETS_KEY, next.snippets);
  setState(next);
};

/** Applies what is stored. Called once at startup, before the first render. */
export const initCustomCss = () => {
  applyState();

  // Another tab (web) changed it.
  window.addEventListener('storage', (evt) => {
    if (evt.key !== OVERRIDES_KEY && evt.key !== SNIPPETS_KEY && evt.key !== null) {
      return;
    }
    setState({ overrides: read(OVERRIDES_KEY), snippets: read(SNIPPETS_KEY) });
  });
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const FILE_HEADER = `/*
 * Prinny custom CSS
 *
 * This is Prinny's complete stylesheet, with your changes already in it.
 * Edit anything and save. Prinny keeps ONLY what you changed or added, so
 * everything you leave alone keeps following Prinny's defaults after updates.
 *
 * - Deleting a rule or a line does not remove that styling; it reverts it to
 *   the default. To hide something, use display: none; to drop a property,
 *   set it to unset.
 * - Colours come from theme variables (--folds-color_...). Each theme class
 *   (.colors_darkTheme, .folds-color_lightTheme, ...) sets its own values.
 * - Some styles are set inline by components and need !important to override.
 * - The small snippet box in Settings is applied after this file.
 */
`;

/** The full stylesheet with the current overrides merged in, ready to edit. */
export const buildEditableFile = async (): Promise<string> => {
  const base = await loadBaseStylesheet();
  const overrides = parseCss(state.overrides).entries;
  return FILE_HEADER + formatCss(mergeCss(base.entries, overrides), { headers: true });
};

export type ImportResult = {
  /** Declarations/rules that now differ from the defaults. */
  changes: number;
};

/** Takes an edited copy of the full file (or any CSS) and stores what differs from the defaults. */
export const importEditedFile = async (text: string): Promise<ImportResult> => {
  const base = await loadBaseStylesheet();
  const overrides = diffCss(base.entries, parseCss(text).entries);
  persist({ ...state, overrides: overrides.length > 0 ? formatCss(overrides) : '' });
  return { changes: countOverrides(overrides) };
};

export const resetFileEdits = () => persist({ ...state, overrides: '' });

export const saveSnippets = (snippets: string) =>
  persist({ ...state, snippets: snippets.trim() ? snippets : '' });

export const overrideCount = (overrides: string): number =>
  overrides ? countOverrides(parseCss(overrides).entries) : 0;
