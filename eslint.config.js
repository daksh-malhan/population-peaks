import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const htmlSink = 'Builds HTML from strings (XSS risk). Use textContent or the helpers in src/ui/dom.ts.';

export default defineConfig(
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', 'pipeline/', 'fixtures/', 'public/', 'playwright-report/', 'test-results/', '.lighthouseci/'],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: htmlSink },
        { property: 'outerHTML', message: htmlSink },
        { property: 'insertAdjacentHTML', message: htmlSink },
        { object: 'document', property: 'write', message: htmlSink },
        { object: 'document', property: 'writeln', message: htmlSink },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
    },
  },
);
