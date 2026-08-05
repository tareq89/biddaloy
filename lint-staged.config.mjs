// Runs on staged files only, via husky's pre-commit hook (see
// .husky/pre-commit). scripts/lint-staged-eslint.mjs handles running
// `eslint --fix` with the right per-package cwd, since ESLint 9's flat
// config only looks for eslint.config.* in the current working directory —
// see that script's own comment. server/shared and everything else get
// Prettier only, matching [8.2.2]'s decision that ESLint is scoped to the
// frontend packages.
export default {
  'ui/**/*.{ts,tsx,mjs}': ['node scripts/lint-staged-eslint.mjs', 'prettier --write'],
  'client-admin/**/*.{ts,tsx}': ['node scripts/lint-staged-eslint.mjs', 'prettier --write'],
  'client-student/**/*.{ts,tsx}': ['node scripts/lint-staged-eslint.mjs', 'prettier --write'],
  '**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml,css}': 'prettier --write',
};
