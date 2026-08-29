import {
  biddaloyReactConfig,
  componentBoundaryConfig,
  dataFetchingGuardConfig,
  financialMutationGuardConfig,
  noWindowAlertConfig,
  typeCheckedRules,
  typeCheckedTestOverrides,
  waitForTextContentConfig,
} from '@biddaloy/ui/eslint-config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...biddaloyReactConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...typeCheckedRules],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // [8.12.1]: `src/sw.ts` is deliberately outside `tsconfig.json`'s
    // program (it needs the `WebWorker` lib, which would leak into every
    // app and test file — see `tsconfig.sw.json`), so the project service
    // cannot find it. Point the type-checked rules at its own tsconfig
    // instead of silently dropping type-aware linting for the one file
    // that talks to Cache Storage.
    files: ['src/sw.ts'],
    extends: [...typeCheckedRules],
    languageOptions: {
      parserOptions: {
        // `projectService` only ever finds the nearest `tsconfig.json`,
        // which is exactly the program this file is excluded from — so
        // this one block opts back into the older explicit-`project`
        // mode. The two settings are mutually exclusive; leaving the
        // inherited `projectService: true` on is a parse error.
        projectService: false,
        project: './tsconfig.sw.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  typeCheckedTestOverrides,
  {
    files: ['src/**/*.{ts,tsx}'],
    ...componentBoundaryConfig,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...financialMutationGuardConfig,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...dataFetchingGuardConfig,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...noWindowAlertConfig,
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    ...waitForTextContentConfig,
  },
  {
    files: ['*.ts', '*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
