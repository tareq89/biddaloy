// Shared ESLint 9 flat config for every biddaloy SPA (`ui`, `client-admin`,
// `client-student`, ...). One rule set so the four apps can't drift apart —
// consumers spread this array and append a `languageOptions.parserOptions
// .project` pointing at their own tsconfig.
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Type-checked rules need `parserOptions.project` (or `projectService`) to
// resolve type info, which only the `src/**/*.{ts,tsx}` files each consumer
// actually type-checks have. Exported separately so a consumer can scope it
// with `files` + its own `project` path — spreading it unscoped into the
// base config would break every plain `.mjs`/`.ts` config file (vite.config,
// this file itself) with "don't have parserOptions set to generate type
// information" at rule-execution time.
export const typeCheckedRules = tseslint.configs.recommendedTypeChecked;

// Mocked HTTP responses are genuinely untyped (axios-mock-adapter, `res.data`
// without a generic) — the type-checked preset's no-unsafe-* rules would
// otherwise demand type assertions that assert nothing real, since there's
// no server contract backing a test mock. Only meaningful where a consumer
// also applies `typeCheckedRules`; a harmless no-op otherwise.
export const typeCheckedTestOverrides = {
  files: ['src/**/*.spec.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  rules: {
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
  },
};

export const biddaloyReactConfig = tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  jsxA11y.flatConfigs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
);

export default biddaloyReactConfig;
