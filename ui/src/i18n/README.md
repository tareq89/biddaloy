# i18n

i18next setup, locale registry, and per-tenant region configuration. See
`ui/README.md`'s layout table for how this fits alongside `src/utils`
(formatters) and `ui/CONTRIBUTING.md`'s "i18n rules" for the lint
enforcement on consuming SPAs.

## Where the files live

```
src/i18n/
├── i18n.ts                     # the configured i18next instance
├── locale-provider.tsx         # I18nProvider + Suspense boundary
├── use-locale.ts                # useLocale() — read/switch the active locale
├── region-config.ts            # RegionConfig interface + REGION_BD_BN/EN
├── region-config-provider.tsx  # RegionConfigProvider + useRegionConfig()
└── locales/
    ├── bn/
    │   ├── common.json         # always-loaded: actions, statuses
    │   └── <namespace>.json    # one file per feature-module namespace
    └── en/
        ├── common.json
        └── <namespace>.json    # same key structure as the bn file
```

A **namespace** is a JSON file, one per locale, sharing the same relative
path (`locales/bn/students.json` / `locales/en/students.json`). `common`
loads eagerly with every app (see `i18n.ts`'s `ns: [COMMON_NAMESPACE]`);
every other namespace loads lazily the first time a component calls
`useTranslation('that-namespace')` — see `i18n.ts`'s own comment for how
that lazy-loading actually code-splits, not just in theory.

Keys nest freely (`{ "actions": { "save": "Save" } }` →
`t('actions.save')`) — `check:i18n` (below) flattens nested objects into
dot-paths when comparing locales, so nesting for readability doesn't cost
anything.

## Adding a key to an existing namespace

1. Add the English string to `locales/en/<namespace>.json`.
2. Add the Bangla string to `locales/bn/<namespace>.json`, same key path.
3. Call it: `const { t } = useTranslation('<namespace>'); t('the.key')`.

Both locale files need the key — `yarn workspace @biddaloy/ui check:i18n`
(wired into CI) fails the build otherwise. It's fine to land the English
key first and follow up with the Bangla translation in the same PR; it is
**not** fine to merge with only one locale filled in.

## Adding a new namespace

Create `locales/bn/<name>.json` and `locales/en/<name>.json` (both, from
the start — an empty `{}` is fine as a placeholder, a missing file is
not: `check:i18n` treats "no locale files for this namespace" as an error
the first time something calls `t()` against it). No registration step
beyond that — `i18n.ts`'s backend resolves `locales/${language}/${namespace}.json`
dynamically; a new namespace file just needs to exist at that path.

## Adding a new locale

1. Add the locale code to `SUPPORTED_LOCALES` in `locale-storage.ts`.
2. Create `locales/<code>/` with the same namespace files every other
   locale has (start from copying `en/`'s file list — the keys, not the
   English text).
3. If the new locale is RTL, see [8.7.6]'s `dir` plumbing — locale
   switching itself doesn't need anything else here.

`REGION_BD_BN`/`REGION_BD_EN` in `region-config.ts` are Bangladesh-specific
regional data (currency, phone pattern, address shape, ...), not
translated strings — a new **locale** for the existing region reuses
those; a new **region** (a different country) is a new `RegionConfig`
object, covered by that file's own header comment and
`region-config.spec.ts`'s "a second region" suite.

## The translator handoff

1. An engineer adds English keys to the relevant namespace file(s) as
   part of building the feature — this is the source of truth for what
   needs translating, not a separate spec document that can drift.
2. Before merging (or as an immediate follow-up PR), hand the translator
   the **list of new/changed keys** — `git diff` on the touched
   `locales/en/*.json` files is exactly that list; no separate export
   step exists today.
3. The translator fills in the matching `locales/bn/*.json` keys.
   `check:i18n` is what catches a key that got missed — it's the
   safety net, not the review step itself.
4. `yarn workspace @biddaloy/ui check:i18n` locally (or the CI job) is
   the go/no-go: clean output means every key has both locales and every
   `t()` call resolves.

## `check:i18n`

```bash
yarn workspace @biddaloy/ui check:i18n
```

Three things, two of them blocking:

- **Locale parity** (blocking) — a key in `bn` with no matching key in
  `en`, or vice versa, per namespace.
- **Dead `t()` calls** (blocking) — a `t('key')` call site with no
  matching key in either locale for its namespace.
- **Unused keys** (reported, not blocking) — a key in a locale file that
  no `t()` call in `ui`, `client-admin`, or `client-student` references.
  Cleanup, not breakage; left for a reviewer to act on deliberately.

Namespace resolution for a `t()` call: an explicit `{ ns: '...' }` option
on the call wins; otherwise the nearest `useTranslation('...')` call in
the same file; otherwise `common`. The check is regex-based, not a real
parser — see `scripts/check-i18n-keys.mjs`'s header comment for the exact
blind spots (a computed key like `t(someVariable)` can't be checked, and
`useTranslation(ns)` resolution is per-file, not per-component — a file
mixing namespaces needs an explicit `{ ns }` on the calls that don't match
the file's first `useTranslation()`).
