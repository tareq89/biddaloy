import {
  biddaloyReactConfig,
  componentBoundaryConfig,
  typeCheckedRules,
  typeCheckedTestOverrides,
} from '@beton-boi/ui/eslint-config';
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
    files: ['*.ts', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
