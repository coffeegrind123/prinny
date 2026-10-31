import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wasm } from '@rollup/plugin-wasm';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import inject from '@rollup/plugin-inject';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import buildConfig from './build.config';
import { readableCssIdentifiers } from './scripts/vite-readable-css.mjs';
import { hasBuild, readQueue } from './scripts/element-call.mjs';

// Short hash of the commit this bundle was built from, shown in About. The
// Docker build context has no .git, so the Dockerfile passes APP_COMMIT in.
const appCommit = (() => {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT;
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
})();

// The call widget. By default it is our patched build of Element Call
// (element-call/UPSTREAM + element-call/patches, built by
// .github/workflows/element-call.yml and fetched into element-call/dist by
// `npm start` / `npm run build`). A missing or stale build is an error, not a
// reason to fall back: shipping unpatched calls must be a decision, made with
// PRINNY_ELEMENT_CALL=npm (offline work only).
const elementCall = (() => {
  const source = process.env.PRINNY_ELEMENT_CALL || 'patched';
  if (source === 'npm') {
    const pkg = JSON.parse(
      fs.readFileSync('node_modules/@element-hq/element-call-embedded/package.json', 'utf8'),
    );
    return {
      dir: 'node_modules/@element-hq/element-call-embedded/dist',
      stripBase: 4,
      version: pkg.version,
    };
  }
  if (source !== 'patched') {
    throw new Error(`PRINNY_ELEMENT_CALL must be "patched" or "npm", got "${source}"`);
  }
  const queue = readQueue();
  if (!hasBuild(queue)) {
    throw new Error(
      `[element-call] element-call/dist does not hold ${queue.tag}. Run ` +
        '`node scripts/element-call.mjs fetch` (npm start and npm run build do), ' +
        'or set PRINNY_ELEMENT_CALL=npm to ship the unpatched npm package.',
    );
  }
  return { dir: 'element-call/dist', stripBase: 2, version: queue.version };
})();

const copyFiles = {
  targets: [
    {
      // The widget ships its own source maps — 18 MB across 9 files, every
      // byte of it served to every visitor and never requested unless
      // devtools is open. Production maps are stripped from our own bundle
      // (`build.sourcemap: false`); excluding them here applies the same rule to
      // vendored code instead of exempting it.
      src: [`${elementCall.dir}/**/*`, `!${elementCall.dir}/**/*.map`],
      dest: 'public/element-call',
      rename: { stripBase: elementCall.stripBase },
    },
    {
      src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
      dest: '',
      rename: { stripBase: true, name: 'pdf.worker.min.js' },
    },
    // pdfjs-dist 6 moved JBIG2, JPEG 2000 and colour-management decoding into
    // WebAssembly modules the worker fetches at runtime from `wasmUrl`. Without
    // them, scanned PDFs (JBIG2 is the standard scanner codec) render blank
    // images. `quickjs-eval.*` is deliberately NOT copied: it is the sandbox for
    // JavaScript embedded in a PDF, which this client never enables, and not
    // shipping it means a future default flip cannot quietly start running
    // sender-authored script.
    {
      src: 'node_modules/pdfjs-dist/wasm/{jbig2,openjpeg,qcms_bg}.wasm',
      dest: 'pdfjs/wasm',
      rename: { stripBase: true },
    },
    {
      src: 'node_modules/pdfjs-dist/wasm/*_nowasm_fallback.js',
      dest: 'pdfjs/wasm',
      rename: { stripBase: true },
    },
    {
      src: 'node_modules/pdfjs-dist/iccs/*.icc',
      dest: 'pdfjs/iccs',
      rename: { stripBase: true },
    },
    {
      src: 'config.json',
      dest: '',
    },
    {
      src: 'public/manifest.json',
      dest: '',
      rename: { stripBase: 1 },
    },
    {
      src: 'public/res/android/**/*',
      dest: 'public/android',
      rename: { stripBase: 3 },
    },
    {
      src: 'public/locales/**/*',
      dest: 'public/locales',
      rename: { stripBase: 2 },
    },
  ],
};

function serverMatrixSdkCryptoWasm(wasmFilePath) {
  return {
    name: 'vite-plugin-serve-matrix-sdk-crypto-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === wasmFilePath) {
          const resolvedPath = path.join(
            path.resolve(),
            '/node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm',
          );

          if (fs.existsSync(resolvedPath)) {
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Cache-Control', 'no-cache');

            const fileStream = fs.createReadStream(resolvedPath);
            fileStream.pipe(res);
          } else {
            res.writeHead(404);
            res.end('File not found');
          }
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const readableCss = readableCssIdentifiers({ isBuild: command === 'build' });

  return {
    appType: 'spa',
    publicDir: false,
    define: {
      __APP_COMMIT__: JSON.stringify(appCommit),
      __ELEMENT_CALL_VERSION__: JSON.stringify(elementCall.version),
    },
    base: buildConfig.base,
    resolve: {
      // Bare `folds` resolves to our shim (src/folds/index.ts), which re-exports
      // the vendored folds source (vendor/folds) but overrides the `Icons` enum
      // with lucide-react icons. The regex matches only the exact specifier.
      alias: [
        {
          find: /^folds$/,
          replacement: fileURLToPath(new URL('./src/folds/index.ts', import.meta.url)),
        },
        // Bare `classnames` resolves to our own implementation. It is the ~20
        // lines of the package this app uses, kept behind the package's name so
        // that all 65 call sites read the same as upstream's and none of them
        // become a merge conflict on the next sync.
        {
          find: /^classnames$/,
          replacement: fileURLToPath(new URL('./src/app/utils/classNames.ts', import.meta.url)),
        },
      ],
    },
    server: {
      port: 8080,
      // Loopback only by default. `host: true` bound every interface, which —
      // combined with a widened `fs.allow` — exposed the developer's checkout to
      // anyone on the local network. Pass `--host` explicitly (`npm start --
      // --host`) for the rare case you need to reach the dev server from another
      // device, and only on a trusted network.
      host: 'localhost',
      fs: {
        // Project root only. Nothing in the app imports from outside it: the
        // furthest-reaching imports are `src/app/features/settings/about/
        // About.tsx` -> `../../../../../public/res/svg/prinny.svg` and
        // `../../../../../package.json`, both of which resolve inside the root.
        // `allow: ['..']` reached into the parent `prinny-client` tree, which
        // holds `.secrets/` (Tauri updater signing key) and CI keystores.
        allow: ['.'],
        // Belt-and-braces: never serve secrets even if some future import
        // widens the allow-list again. Vite's built-in defaults are repeated
        // here because setting `deny` replaces them rather than extending them.
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          '**/.secrets/**',
          '*.{key,keystore,jks,p12}',
        ],
      },
    },
    plugins: [
      serverMatrixSdkCryptoWasm('/node_modules/.vite/deps/pkg/matrix_sdk_crypto_wasm_bg.wasm'),
      topLevelAwait({
        // The export name of top-level await promise for each chunk module
        promiseExportName: '__tla',
        // The function to generate import names of top-level await promise in each chunk module
        promiseImportName: (i) => `__tla_${i}`,
      }),
      viteStaticCopy(copyFiles),
      readableCss.debugIds,
      vanillaExtractPlugin({
        identifiers: readableCss.identifiers,
        unstable_pluginFilter: readableCss.pluginFilter,
      }),
      wasm(),
      react(),
      VitePWA({
        srcDir: 'src',
        filename: 'sw.ts',
        strategies: 'injectManifest',
        injectRegister: false,
        manifest: false,
        injectManifest: {
          injectionPoint: undefined,
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: 'globalThis',
        },
        plugins: [
          // Enable esbuild polyfill plugins
          NodeGlobalsPolyfillPlugin({
            process: false,
            buffer: true,
          }),
        ],
      },
    },
    build: {
      outDir: 'dist',
      // Never publish source maps with a production deployment: they ship the
      // full original source of every module to anyone who fetches the site.
      // Use 'hidden' locally if you need maps for a one-off investigation.
      sourcemap: false,
      copyPublicDir: false,
      target: 'esnext',
      rollupOptions: {
        plugins: [inject({ Buffer: ['buffer', 'Buffer'] })],
      },
    },
  };
});
