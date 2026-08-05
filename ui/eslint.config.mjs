import globals from 'globals';
import tseslint from 'typescript-eslint';

import { biddaloyReactConfig, typeCheckedRules, typeCheckedTestOverrides } from './eslint-config.mjs';

export default tseslint.config(
  ...biddaloyReactConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...typeCheckedRules],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  typeCheckedTestOverrides,
  {
    files: ['scripts/**/*.mjs', '*.mjs', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
