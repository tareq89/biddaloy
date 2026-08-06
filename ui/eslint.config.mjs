import globals from 'globals';
import tseslint from 'typescript-eslint';

import {
  biddaloyReactConfig,
  financialMutationGuardConfig,
  typeCheckedRules,
  typeCheckedTestOverrides,
} from './eslint-config.mjs';

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
  typeCheckedTestOverrides,
  {
    files: ['scripts/**/*.mjs', 'eslint-rules/**/*.mjs', '*.mjs', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
