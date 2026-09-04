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

// [15.6] See ui/eslint.config.mjs's own comment — same ESLINT_FAST
// commit-time budget trade-off, plus one client-admin-specific wrinkle:
// `boundary/no-raw-intl` is itself type-aware
// (`ESLintUtils.getParserServices(context, true)` throws before its own
// `services?.program` guard can save it — see ui/eslint-config.mjs's
// `componentBoundaryConfig`), so fast mode must explicitly turn it off
// rather than rely on the missing `projectService` to silently no-op it.
const FAST = process.env.ESLINT_FAST === '1';

export default tseslint.config(
  ...biddaloyReactConfig,
  // Fast mode turns off the type-checked rule set above, so an
  // `eslint-disable` comment written for one of those rules (e.g.
  // `@typescript-eslint/only-throw-error` on a `throw redirect(...)` —
  // `redirect()` isn't an `Error`, but the rule needs type info to know
  // that) looks unused to this pass and `--fix` deletes it, silently
  // reintroducing the very error `yarn lint` (CI, full type-checked pass)
  // then catches. Disabling the "unused directive" check only in fast
  // mode keeps pre-commit from destroying comments it can't evaluate,
  // without weakening the real check anywhere it runs with full type info.
  ...(FAST ? [{ linterOptions: { reportUnusedDisableDirectives: false } }] : []),
  ...(FAST
    ? []
    : [
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
          // program (it needs the `WebWorker` lib, which would leak into
          // every app and test file — see `tsconfig.sw.json`), so the
          // project service cannot find it. Point the type-checked rules at
          // its own tsconfig instead of silently dropping type-aware
          // linting for the one file that talks to Cache Storage.
          files: ['src/sw.ts'],
          extends: [...typeCheckedRules],
          languageOptions: {
            parserOptions: {
              // `projectService` only ever finds the nearest
              // `tsconfig.json`, which is exactly the program this file is
              // excluded from — so this one block opts back into the older
              // explicit-`project` mode. The two settings are mutually
              // exclusive; leaving the inherited `projectService: true` on
              // is a parse error.
              projectService: false,
              project: './tsconfig.sw.json',
              tsconfigRootDir: import.meta.dirname,
            },
          },
        },
      ]),
  ...(FAST ? [] : [typeCheckedTestOverrides]),
  {
    files: ['src/**/*.{ts,tsx}'],
    ...componentBoundaryConfig,
    // `boundary/no-raw-intl` needs type info; the other three boundary
    // rules are pure AST and stay on even in fast mode.
    ...(FAST ? { rules: { ...componentBoundaryConfig.rules, 'boundary/no-raw-intl': 'off' } } : {}),
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
