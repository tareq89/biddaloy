import storybook from 'eslint-plugin-storybook';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import {
  biddaloyReactConfig,
  dataFetchingGuardConfig,
  financialMutationGuardConfig,
  noWindowAlertConfig,
  typeCheckedRules,
  typeCheckedTestOverrides,
  waitForTextContentConfig,
} from './eslint-config.mjs';
import logicalPropertiesPlugin from './eslint-rules/logical-properties.mjs';

// [15.6] Pre-commit (`scripts/lint-staged-eslint.mjs`) sets ESLINT_FAST=1 to
// keep the hook under budget: `@typescript-eslint`'s type-checked rule set
// boots a full TypeScript program per ESLint invocation — a cost that's
// flat in file count (1 file ≈ 3 files) and, measured, the single biggest
// piece of pre-commit's time (see README's "Pre-commit hooks" section for
// the numbers). `yarn workspace @biddaloy/ui lint` — what CI and `ci:local`
// both run — never sets this, so the full type-aware rules still gate
// every merge; only the commit-time hook skips them. Any new rule that
// needs type information must be added to the fast-mode omission below, or
// committing a file it applies to crashes ESLint outright
// (`@typescript-eslint`'s parser throws before the rule's own
// `services?.program` guard ever runs).
const FAST = process.env.ESLINT_FAST === '1';

export default tseslint.config(
  ...biddaloyReactConfig,
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
      ]),
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
  // [8.7.6]: components use margin-inline-*/padding-inline-* (Tailwind's
  // ms-/me-/ps-/pe-), never -left/-right — scoped to where className
  // strings actually get authored (not primitives, which are vendored and
  // regenerated, not hand-edited; not hooks/utils/api/test, which don't
  // render markup at all).
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/shells/**/*.{ts,tsx}'],
    plugins: { 'logical-properties': logicalPropertiesPlugin },
    rules: { 'logical-properties/no-physical-direction-classes': 'error' },
  },
  ...(FAST ? [] : [typeCheckedTestOverrides]),
  {
    files: ['scripts/**/*.mjs', 'eslint-rules/**/*.mjs', '*.mjs', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  ...storybook.configs['flat/recommended'],
);
