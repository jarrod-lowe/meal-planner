import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

const engineRule = 'The planning engine is pure TypeScript (DESIGN §3).';

// Browser-only globals (window, document, localStorage, …), excluding the
// ECMAScript built-ins. `no-undef` can't catch these: typescript-eslint adds
// the TS `dom` lib's values as globals, so `no-restricted-globals` is used.
const browserOnlyGlobals = Object.keys(globals.browser)
  .filter((name) => !(name in globals.builtin))
  .map((name) => ({ name, message: `${engineRule} No browser globals.` }));

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    languageOptions: {
      parserOptions: { projectService: true },
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      // typescript-eslint recommends against no-undef in TypeScript projects:
      // https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off'
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser
      }
    }
  },
  {
    files: ['src/lib/engine/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // Patterns use gitignore syntax, where a leading `#` starts a
          // comment, so `#lib` must be written `\\#lib`.
          patterns: [
            {
              group: ['svelte', 'svelte/*', '$app/*', '@sveltejs/*'],
              message: `${engineRule} No Svelte or SvelteKit imports.`
            },
            {
              group: ['\\#lib/api', '\\#lib/api/*', '**/api', '**/api/*'],
              message: `${engineRule} No API client imports.`
            },
            {
              group: ['\\#lib/stores', '\\#lib/stores/*', '**/stores', '**/stores/*'],
              message: `${engineRule} No store imports.`
            },
            {
              group: [
                'date-fns',
                'date-fns*',
                'dayjs',
                'dayjs/*',
                'luxon',
                'moment*',
                '@js-temporal/*'
              ],
              message: `${engineRule} No date libraries.`
            }
          ]
        }
      ],
      'no-restricted-globals': ['error', ...browserOnlyGlobals]
    }
  }
);
