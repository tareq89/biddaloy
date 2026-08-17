import {
  biddaloyReactConfig,
  componentBoundaryConfig,
  dataFetchingGuardConfig,
  financialMutationGuardConfig,
  typeCheckedRules,
  typeCheckedTestOverrides,
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
    files: ['*.ts', '*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
