import {
  biddaloyReactConfig,
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
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  typeCheckedTestOverrides,
  {
    files: ['*.ts', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
