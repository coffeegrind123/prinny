/**
 * The app's complete stylesheet, read back from the page.
 *
 * Read at runtime from `document.styleSheets` rather than shipped as a build
 * artifact: it is then exactly what this engine applies (WebView2, WebKitGTK and
 * Android WebView each serialise a little differently), it works unchanged in the
 * dev server, and it is parsed by the same engine the edited file will be, which
 * is what makes the diff in cssModel compare like with like.
 */
import { CssEntry, flattenRules } from './cssModel';

/** Marks the <style> elements custom CSS itself injects, so they are never read back as base. */
export const CUSTOM_CSS_ATTR = 'data-prinny-custom-css';

/**
 * Stylesheets the app only loads when a feature is first used. Without these,
 * "the full stylesheet" would silently depend on whether the user had opened a
 * map or a math message this session.
 */
const loadLazyStyles = () =>
  Promise.all([
    import('katex/dist/katex.min.css'),
    import('maplibre-gl/dist/maplibre-gl.css'),
    import('../../plugins/react-prism/ReactPrism.css'),
  ]);

const sourceLabel = (sheet: CSSStyleSheet): string => {
  const owner = sheet.ownerNode as Element | null;
  const id = sheet.href ?? owner?.getAttribute?.('data-vite-dev-id') ?? '';

  if (/katex/i.test(id)) {
    return 'KaTeX (math)';
  }
  if (/maplibre/i.test(id)) {
    return 'MapLibre (maps)';
  }
  if (/ReactPrism/.test(id)) {
    return 'Code highlighting';
  }
  return 'Prinny';
};

export type BaseStylesheet = {
  entries: CssEntry[];
  /** Sheets the page has but the browser will not let script read (cross-origin). */
  unreadable: string[];
};

export const loadBaseStylesheet = async (): Promise<BaseStylesheet> => {
  await loadLazyStyles();

  const entries: CssEntry[] = [];
  const unreadable: string[] = [];

  Array.from(document.styleSheets).forEach((sheet) => {
    const owner = sheet.ownerNode as Element | null;
    if (owner?.hasAttribute?.(CUSTOM_CSS_ATTR)) {
      return;
    }

    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      unreadable.push(sheet.href ?? '(inline)');
      return;
    }

    const media = sheet.media.mediaText;
    flattenRules(rules, media ? [`@media ${media}`] : [], entries, sourceLabel(sheet));
  });

  return { entries, unreadable };
};
