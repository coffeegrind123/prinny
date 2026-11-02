import { defineConfig } from 'vitest/config';

// Separate from vite.config.js on purpose: that config refuses to load unless
// the patched Element Call bundle has been fetched, and pulls in the PWA, wasm
// and vanilla-extract plugins. Unit tests exercise plain modules and need none
// of it. Tests live next to the code as `*.test.ts`. Run with: npm test
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
