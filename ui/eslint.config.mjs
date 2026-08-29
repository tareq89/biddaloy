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
  typeCheckedTestOverrides,
  {
    files: ['scripts/**/*.mjs', 'eslint-rules/**/*.mjs', '*.mjs', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  ...storybook.configs['flat/recommended'],
);
