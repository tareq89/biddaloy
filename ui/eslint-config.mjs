// Shared ESLint 9 flat config for every biddaloy SPA (`ui`, `client-admin`,
// `client-student`, ...). One rule set so the four apps can't drift apart —
// consumers spread this array and append a `languageOptions.parserOptions
// .projectService` for their own tsconfig(s).
//
// Supported exports (treat this as the package's public API — anything else
// reached via a deep import is an implementation detail and can change
// without notice):
//   - `biddaloyReactConfig` (default): the base rule set, safe to spread
//     unscoped into any consumer's config.
//   - `typeCheckedRules`: type-aware rules, must be scoped to a `files`
//     block with `parserOptions.projectService` set — see the comment below.
//   - `typeCheckedTestOverrides`: relaxes a subset of `typeCheckedRules` for
//     spec/test files — see the comment below for exactly what it turns off.
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Type-checked rules need `parserOptions.projectService` (typescript-eslint's
// current recommendation over the older `project: './tsconfig.json'` — it's
// faster, shares one Program across files instead of rebuilding it, and
// scales better across this monorepo's several tsconfigs) to resolve type
// info, which only the `src/**/*.{ts,tsx}` files each consumer actually
// type-checks have. Exported separately so a consumer can scope it with a
// `files` block — spreading it unscoped into the base config would break
// every plain `.mjs`/`.ts` config file (vite.config, this file itself) with
// "don't have parserOptions set to generate type information" at
// rule-execution time.
export const typeCheckedRules = tseslint.configs.recommendedTypeChecked;

// Turns off every `no-unsafe-*` rule the type-checked preset enables
// (assignment, member-access, call, return, argument) for spec/test files —
// not narrowly scoped to HTTP-mock call sites, despite the motivating case
// below; it relaxes unsafe-`any` propagation checks across a whole test
// file. Broad on purpose: mocked HTTP responses are genuinely untyped
// (axios-mock-adapter, `res.data` without a generic), and the type-checked
// preset would otherwise demand assertions that assert nothing real, since
// there's no server contract backing a test mock — but once a test file
// carries any `any`-typed value, requiring type-safety proofs everywhere
// else in that same file bought nothing beyond the mock itself already
// bought. Only meaningful where a consumer also applies `typeCheckedRules`;
// a harmless no-op otherwise.
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
