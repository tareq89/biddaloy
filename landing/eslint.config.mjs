import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Landing is static Astro + plain TS: no React, no app boundary rules.
export default tseslint.config(
  { ignores: ['dist/**', '.astro/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ['**/*.{ts,mjs,astro}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Inline <script is:inline> blocks are deliberate ES5 (no bundling) with
    // best-effort try/catch around storage access.
    files: ['**/*.astro', '**/*.astro/*.{js,ts}'],
    rules: {
      'no-var': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
);
