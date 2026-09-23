/**
 * Stable, human-readable vanilla-extract identifiers.
 *
 * vanilla-extract's production default names every class and CSS variable by
 * hash (`._10dxgc60`, `--oq6d070`). A hash is derived from the file path and
 * the rule's position in the file, so it changes whenever anything above it is
 * edited. The custom-CSS feature (Settings -> Appearance) hands the user the
 * app's full stylesheet to edit, and a user's overrides must keep matching
 * after an update - so names have to be readable AND survive unrelated edits.
 *
 *   src/app/features/room/RoomViewHeader.css.ts  export const HeaderTopic
 *     -> .RoomViewHeader_HeaderTopic
 *   vendor/folds/src/theme/color.css.ts  color.Background.Container
 *     -> --folds-color_Background-Container
 *
 * Two plugins are needed because vanilla-extract only derives debug ids from
 * variable names in its own 'debug' mode; with a custom identifier function it
 * passes `debugId: undefined` for every style that does not name itself. The
 * `pre` plugin below runs vanilla-extract's own babel debug-id pass inside its
 * compiler (let through by `pluginFilter`), which restores the names.
 */
import { transformAsync, types as t } from '@babel/core';
import debugIdsPlugin from '@vanilla-extract/babel-plugin-debug-ids';
import typescriptSyntax from '@babel/plugin-syntax-typescript';
import path from 'node:path';

const CSS_TS = /\.css\.(ts|tsx|js|jsx|mjs)$/;
const DEBUG_IDS_PLUGIN = 'prinny-vanilla-extract-debug-ids';

// Plugins vanilla-extract already allows inside its compiler (its default filter).
const VE_COMPATIBLE_PLUGINS = ['vite-tsconfig-paths'];

// Filenames that say nothing on their own; the parent directory names them instead.
const GENERIC_BASENAMES = new Set(['style', 'styles', 'css', 'index']);

const FOLDS_PREFIX = 'folds-';

const toIdent = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_');

const VE_PACKAGES = new Set(['@vanilla-extract/css', '@vanilla-extract/recipes']);

// Calls whose debug id is simply the argument after the style object.
const APPEND_DEBUG_ID = new Set(['style', 'recipe', 'keyframes', 'fontFace']);

const keyName = (key) => {
  if (t.isIdentifier(key)) {
    return key.name;
  }
  if (t.isStringLiteral(key) || t.isNumericLiteral(key)) {
    return String(key.value);
  }
  return undefined;
};

/**
 * vanilla-extract's debug-id pass only reads identifier keys, so a style under
 * a literal key is named after the enclosing variable alone:
 *
 *   export const RadiiVariant = { '0': style(...), '300': style(...) };
 *     -> both "RadiiVariant"  (collision)
 *     -> here: "RadiiVariant_0", "RadiiVariant_300"
 *
 * This runs first and, only for calls with a literal key somewhere on their
 * object path, appends the full path as the debug id; the upstream pass then
 * sees the argument and leaves the call alone.
 */
function literalKeyDebugIds() {
  return {
    pre() {
      this.imports = new Map();
    },
    visitor: {
      ImportDeclaration(p) {
        if (!VE_PACKAGES.has(p.node.source.value)) {
          return;
        }
        for (const spec of p.node.specifiers) {
          if (t.isImportSpecifier(spec)) {
            const imported = t.isIdentifier(spec.imported)
              ? spec.imported.name
              : spec.imported.value;
            this.imports.set(spec.local.name, imported);
          }
        }
      },
      CallExpression(p) {
        const { node } = p;
        const fn = t.isIdentifier(node.callee) ? this.imports.get(node.callee.name) : undefined;
        if (!fn || !(APPEND_DEBUG_ID.has(fn) || fn === 'styleVariants')) {
          return;
        }
        if (fn !== 'styleVariants' && node.arguments.length !== 1) {
          return;
        }
        const last = node.arguments[node.arguments.length - 1];
        if (fn === 'styleVariants' && (t.isStringLiteral(last) || t.isTemplateLiteral(last))) {
          return;
        }

        const names = [];
        let literalKey = false;
        let ancestor = p.parentPath;
        while (ancestor) {
          const n = ancestor.node;
          if (t.isObjectProperty(n)) {
            const name = keyName(n.key);
            if (name === undefined) {
              return;
            }
            literalKey ||= !t.isIdentifier(n.key);
            names.unshift(name);
          } else if (t.isVariableDeclarator(n) && t.isIdentifier(n.id)) {
            names.unshift(n.id.name);
            break;
          }
          ancestor = ancestor.parentPath;
        }
        if (!literalKey || names.length === 0) {
          return;
        }
        node.arguments.push(t.stringLiteral(names.join('_')));
      },
    },
  };
}

/** `src/app/components/room-topic-viewer/style.css.ts` -> `room-topic-viewer` */
export const scopeName = (filePath) => {
  const posix = filePath.split(path.sep).join('/');
  const segments = posix.split('/');
  const base = segments[segments.length - 1].replace(CSS_TS, '');
  const scope = GENERIC_BASENAMES.has(base) ? segments[segments.length - 2] : base;
  const vendoredFolds = posix.includes('vendor/folds/');

  return toIdent(`${vendoredFolds ? FOLDS_PREFIX : ''}${scope}`);
};

/** @param {{ isBuild: boolean }} opts */
export function readableCssIdentifiers({ isBuild }) {
  // name -> `${filePath}#${hash}` of the first rule that claimed it.
  const claimed = new Map();

  const identifiers = ({ hash, filePath, debugId }) => {
    const scope = scopeName(filePath);
    // No debug id means a style the babel pass could not name (e.g. created
    // inside a helper). The hash suffix keeps it unique; it is stable as long as
    // the rules above it in the same file do not change.
    let name = debugId ? `${scope}_${toIdent(debugId)}` : `${scope}_${hash}`;
    if (/^[0-9-]/.test(name)) {
      name = `_${name}`;
    }

    const owner = `${filePath}#${hash}`;
    const previous = claimed.get(name);
    if (previous === undefined) {
      claimed.set(name, owner);
      return name;
    }

    // In dev the compiler re-evaluates a file on every edit, so the same file
    // claiming a name again is normal there. A different file claiming it - or,
    // in a one-shot build, a different rule in the same file - is a collision
    // that would make one component's styles apply to another.
    const previousFile = previous.slice(0, previous.lastIndexOf('#'));
    const collides = isBuild ? previous !== owner : previousFile !== filePath;
    if (collides) {
      throw new Error(
        `[readable-css] identifier "${name}" is produced by both ${previous} and ${owner}. ` +
          'Rename one of the styles (or its file) so the custom-CSS names stay unique.',
      );
    }
    return name;
  };

  const debugIds = {
    name: DEBUG_IDS_PLUGIN,
    enforce: 'pre',
    async transform(code, id) {
      const [file] = id.split('?');
      if (!CSS_TS.test(file)) {
        return null;
      }
      const result = await transformAsync(code, {
        filename: file,
        plugins: [literalKeyDebugIds, debugIdsPlugin, typescriptSyntax],
        configFile: false,
        babelrc: false,
        sourceMaps: true,
      });
      if (!result || result.code == null) {
        throw new Error(`[readable-css] adding debug ids failed for ${file}`);
      }
      return { code: result.code, map: result.map };
    },
  };

  const pluginFilter = ({ name }) =>
    name === DEBUG_IDS_PLUGIN || VE_COMPATIBLE_PLUGINS.includes(name);

  return { identifiers, debugIds, pluginFilter };
}
