import { biddaloyReactConfig } from '@beton-boi/ui/eslint-config';
import globals from 'globals';

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
    files: ['*.ts', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
