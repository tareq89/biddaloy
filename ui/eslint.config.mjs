import globals from 'globals';

import { biddaloyReactConfig } from './eslint-config.mjs';

export default [
  ...biddaloyReactConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
