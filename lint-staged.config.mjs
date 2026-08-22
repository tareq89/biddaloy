// Runs on staged files only, via husky's pre-commit hook (see
// .husky/pre-commit). scripts/lint-staged-eslint.mjs handles running
// `eslint --fix` with the right per-package cwd, since ESLint 9's flat
// config only looks for eslint.config.* in the current working directory —
// see that script's own comment. server/shared and everything else get
// Prettier only, matching [8.2.2]'s decision that ESLint is scoped to the
// frontend packages.
//
// The extension split below (json/md/yml/yaml/css vs ts/tsx/js/jsx/mjs/cjs)
// exists only so a frontend TS/TSX/MJS file doesn't get `prettier --write`
// twice — once from its own eslint+prettier entry, once more from a naive
// `**/*` catch-all. json/md/yml/yaml/css are never touched by ESLint, so
// those can stay a single universal pattern with no risk of double-running.
//
// A glob with no `/` in it (e.g. `*.ts`) matches by *basename anywhere in
// the tree*, not "root-level files only" — lint-staged/micromatch behavior,
// not shell globbing. `lint-staged.config.mjs` is the one genuine root-level
// file in the ts/tsx/js/jsx/mjs/cjs set today; listed explicitly rather than
// with a bare `*.{...}` pattern, which re-matched every nested file too and
// reintroduced the exact duplicate-prettier problem this split exists to
// avoid.
export default {
  'ui/**/*.{ts,tsx,mjs}': ['node scripts/lint-staged-eslint.mjs', 'prettier --write'],
  'client-admin/**/*.{ts,tsx}': ['node scripts/lint-staged-eslint.mjs', 'prettier --write'],
  '**/*.{json,md,yml,yaml,css}': 'prettier --write',
  '!(ui|client-admin)/**/*.{ts,tsx,js,jsx,mjs,cjs}': 'prettier --write',
  'lint-staged.config.mjs': 'prettier --write',
};
