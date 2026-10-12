import { defineConfig } from 'vitest/config';
import { securityMetaPlugin } from './config/csp';
import { fontPreloadPlugin } from './config/fontPreload';

const base = '/population-peaks/';

export default defineConfig({
  base,
  plugins: [securityMetaPlugin(), fontPreloadPlugin(base)],
  build: {
    target: 'es2022',
    // Inlined data: URIs would bypass the font/script 'self' policy; keep every asset a file.
    assetsInlineLimit: 0,
    sourcemap: true,
    reportCompressedSize: true,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'config/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
