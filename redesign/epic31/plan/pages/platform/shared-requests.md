# Shared requests — lane platform

- schools_schoolId | `client-admin/src/use-breadcrumbs.ts` `ENTITY_RESOLVERS` | `schoolDetail` resolver: last crumb = `name` of the row with this id from the `useSchools()` list query (there is no `GET /schools/:id`) | last crumb shows the generic "স্কুল" while the h1 shows the school name
- holiday-sets_setId | `client-admin/src/use-breadcrumbs.ts` `holidaySetDetail` resolver (31.3.5) | build the label as `countryName(country, language)` via `Intl.DisplayNames([language], { type: 'region' })` + the year in tenant numerals (`renderDigits`), not the raw `${country} ${year}` ("BD 2026"), so crumb = h1 (D9, D16) | crumb shows "BD 2026" while the h1 shows "বাংলাদেশ ২০২৬"
