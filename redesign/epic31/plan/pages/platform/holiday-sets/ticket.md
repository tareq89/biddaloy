# [31.4.platform-3] Holiday lists + list detail — no crash, kit table, date pickers

## Goal
`/holiday-sets` and `/holiday-sets/$setId` match the "after" screenshots: the list never crashes on a set without entries, shows country names instead of ISO codes, translated sources, status badges, an edit action and a total; the detail page has a `DetailShell` header (crumbs, name + badge, facts, outline Publish), an entries table with `DatePicker`s instead of browser date inputs, phone cards, and one filled "সংরক্ষণ করুন".

## What and why
The operator fetches each country's public holidays for a year, corrects the names (adds Bangla names), and publishes the list so schools can import it. Today `/holiday-sets` crashes ("Something went wrong loading this page", B7) because the list response has no `entries` and the page reads `set.entries.length`; when it works, the country is a code (`BD`), the source an enum (`NAGER_DATE`), the status a hand-made pill, and the name an underlined link. The detail page uses browser `<input type="date">` (D25), shows the source enum and a `toLocaleString` date, has a "back to list" link instead of crumbs, an `h1` built as "BD 2026", and a 4-field-wide table that does not fit a phone. The redesign makes the client tolerant, translates every value and moves both pages onto kit patterns.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — holiday lists | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/holiday-sets/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/holiday-sets/before-mobile.webp?raw=true" width="260"> |
| After — holiday lists | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/holiday-sets/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/holiday-sets/mobile.webp?raw=true" width="260"> |
| Before — list detail | _not captured_ | _not captured_ |
| After — list detail | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/holiday-sets_setId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/holiday-sets_setId/mobile.webp?raw=true" width="260"> |

The "before" list shots show the B7 crash. The "after" detail shots show a draft with one unsaved change (so Publish is disabled with its hint and Save is the filled button).

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | List data | Holiday count reads `set.entries?.length`; when `entries` is missing the cell shows `—`, never `0` and never a crash. | B7 (server half is 31.3.7) |
| 2 | List header | `PageHeader` title "ছুটির তালিকা", subtitle (`holidaySets.caption`), primary "তালিকা আনুন" (`download`). | D16 |
| 3 | List columns | তালিকা = "{country} {year}" (`font-medium`, country via `Intl.DisplayNames`, year in tenant numerals) · উৎস (translated) · ছুটি (end, "১৮টি") · অবস্থা = StatusBadge (প্রকাশিত success / খসড়া neutral) · কাজ = RowActions `edit` → `/holiday-sets/$setId`. Separate দেশ / বছর columns and the underlined link go. | D9, D19, D27, D6 |
| 4 | List states | `DataTable` `paginated={false}` → "মোট ৩টি"; skeleton while loading (was "ছুটির তালিকা…" text); `ErrorState` with Retry; `EmptyState` with outline "তালিকা আনুন". | D19, D28 |
| 5 | Fetch dialog | `DialogContent size="sm"`; country label "দেশের কোড" + help "দুই অক্ষরে, যেমন বাংলাদেশ = BD" (no "ISO alpha-2"); year field `inputMode="numeric"`; errors are translated sentences, never `ApiError.message`. | D9, D21, D32 |
| 6 | Detail header | `DetailShell` (no tabs): crumbs "ছুটির তালিকা › {name}"; `h1` = same "{country} {year}" name; badge; facts উৎস, আনা হয়েছে (`formatDateTime`), ছুটি ("৬টি"). "ছুটির তালিকায় ফিরে যান" link goes. | D16, D9, D5 |
| 7 | Publish | Moves from the editor into the header: outline "প্রকাশ করুন" (`globe`) / outline "অপ্রকাশিত করুন" (`globe-lock`); disabled while there are unsaved changes, with the hint shown as visible text under it (not a `title` tooltip). Publish confirm = `Dialog size="sm"`; unpublish confirm = `ConfirmDialog tone="danger"`. | D29; the hint was hover-only |
| 8 | Entries card | Card holding the table: title "ছুটির দিন" + help (**New**). Columns শুরুর তারিখ · শেষ তারিখ (both `DatePicker`) · নাম (ইংরেজি) · নাম (বাংলা) (placeholder "ঐচ্ছিক") · কাজ = `trash-2` remove icon with tooltip "{name} সরান". | D25, D19 |
| 9 | Entries footer | outline "ছুটি যোগ করুন" + "মোট ৬টি" on the left; on the right, when dirty, a warning line "সংরক্ষণ হয়নি এমন পরিবর্তন আছে" (**New**) + filled "সংরক্ষণ করুন" (`save`, disabled when clean, busy while saving). | D29, one filled per view |
| 10 | Messages | Save success → `toast.success` (key exists, never rendered today); save / publish / unpublish errors → translated sentence (no `ApiError.message`). | D9 |
| 11 | Leave guard | "Leave without saving?" uses `ConfirmDialog tone="danger"` (stay = cancel, leave = confirm). | D29 |

## Mobile behaviour
- List: title, subtitle, full-width "তালিকা আনুন"; compact two-line rows in one Card ("বাংলাদেশ ২০২৬" + badge, then "উৎস · n টি ছুটি"), edit icon 44 px.
- Detail: crumbs, name + badge, facts in 2 columns, Publish full width with its hint under it.
- Entries become a list inside the card: each entry shows its name as an `h3` with a labelled "সরান" button (`trash-2` + text), then শুরুর তারিখ, শেষ তারিখ, নাম (ইংরেজি), নাম (বাংলা) stacked full width, each with a visible label.
- The entries footer stacks: "ছুটি যোগ করুন" + total, then the warning line, then a full-width "সংরক্ষণ করুন". In the app the footer is `sticky bottom-16 md:static` inside the card so Save stays reachable above the bottom bar on long lists (`bottom-16` = the bar's `h-16`; the mockup cannot show sticky).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Country name | show the code · hard-coded map · `Intl.DisplayNames` | `new Intl.DisplayNames([i18n.language], { type: 'region' }).of(code) ?? code` | Stdlib, covers every code in both languages, no list to maintain. |
| Missing `entries` | `?? 0` · `—` | `—` | `0` would be a wrong number on a list that has holidays; `—` is honest until 31.3.7 ships. |
| Where Publish lives | inside the editor (today) · header | header (`DetailShell` actions) | It acts on the whole list, like any detail-page action; the route already knows `isDirty`. |
| Filled button | Publish · Save | Save | Saving happens many times, publishing once; Publish is blocked while dirty anyway. |
| Phone layout | horizontal scroll table · stacked entry cards | stacked entry cards | Four inputs per row do not fit 390 px (D1 says designed, not shrunk). |
| Country input | free text code · country select | keep the 2-letter field, explain it in help | A select needs a supported-countries list from the sources — new feature (D1). |

## Files
- `client-admin/src/routes/_platform/holiday-sets/index.tsx` — B7 tolerance, header, DataTable columns, badge, RowActions, states, fetch dialog
- `client-admin/src/routes/_platform/holiday-sets/index.test.tsx` — update + B7 case
- `client-admin/src/routes/_platform/holiday-sets/$setId.tsx` — DetailShell, facts, Publish/Unpublish + dialogs, toasts, leave ConfirmDialog; drop back link
- `client-admin/src/routes/_platform/holiday-sets/$setId.test.tsx` — update; publish cases move here
- `client-admin/src/routes/_platform/holiday-sets/-holiday-set-editor.tsx` — Card + table / phone list, `DatePicker`, footer, translated errors; publish props and dialogs removed
- `client-admin/src/routes/_platform/holiday-sets/-holiday-set-editor.test.tsx` — update; publish cases removed
- `client-admin/src/routes/_platform/holiday-sets/-holiday-set-editor.stories.tsx` — clean / dirty / empty stories
- `client-admin/src/routes/_platform/holiday-sets/-holiday-set-name.ts` — **New** helper `holidaySetName(set, language, t)` used by both routes
- `ui/src/i18n/locales/bn/platform.json`, `ui/src/i18n/locales/en/platform.json` — keys below (also changed by platform-1 and platform-2, run earlier)

## Steps
1. **Read first:** BUGS.md B7; `patterns.md` §3 PageHeader, §4 DataTable (unpaginated) / RowActions / StatusBadge / DetailShell, §6 DatePicker, §7 Dialog / ConfirmDialog; the mockups `PLAN/pages/platform/holiday-sets/mockup.html` and `…/holiday-sets_setId/mockup.html`.
2. **Name helper** (`-holiday-set-name.ts`):
   ```ts
   export function countryName(code: string, language: string): string {
     try { return new Intl.DisplayNames([language], { type: 'region' }).of(code) ?? code; } catch { return code; }
   }
   export function holidaySetName(set: Pick<PublicHolidaySet, 'country' | 'year'>, language: string, t: TFunction): string {
     return t('holidaySets.setName', { country: countryName(set.country, language), year: set.year });
   }
   ```
   `year` is passed as a number so the i18next numeral formatter (31.2.1b) renders it in tenant digits. Also export `SOURCE_LABEL_KEY: Record<PublicHolidaySource, string>` = `{ NAGER_DATE: 'holidaySets.source.NAGER_DATE', GOOGLE_ICS: 'holidaySets.source.GOOGLE_ICS', MANUAL: 'holidaySets.source.MANUAL' }`.
3. **List** (`index.tsx`).
   - Wrap in `ListShell` (or `PageContainer` + `PageHeader` + `DataTable` if ListShell needs pagination props): `title={t('holidaySets.title')}`, `subtitle={t('holidaySets.caption')}`, `actions={[{ id: 'fetch', label: t('holidaySets.fetchAction'), icon: <DownloadIcon />, priority: 'primary', onClick: () => setFetchDialogOpen(true) }]}`.
   - Replace the raw `Table` with `DataTable` `tableId="platform-holiday-sets"`, `caption={t('holidaySets.title')}`, `paginated={false}`, `loading={setsQuery.isLoading}`, `error` → `ErrorState` (`holidaySets.errorMessage`, Retry → `setsQuery.refetch()`), `emptyState={{ title: t('holidaySets.emptyTitle'), explanation: t('holidaySets.emptyMessage'), action: { label: t('holidaySets.fetchAction'), onClick: open } }}`.
   - Columns: `name` = `holidaySetName(row, i18n.language, t)` (`card: 'title'`, `font-medium`); `source` = `t(SOURCE_LABEL_KEY[row.source])` (`card: 'subtitle'`); `entries` = `row.entries ? t('holidaySets.entryCount', { count: row.entries.length }) : '—'` with `align: 'end'` (`card: 'subtitle'`) — **B7:** keep the optional chain even though the type says required, with a comment `// B7: GET /platform/holiday-sets omits entries until 31.3.7 — never crash`; `status` = `<StatusBadge tone={row.published_at ? 'success' : 'neutral'} label={t(row.published_at ? 'holidaySets.published' : 'holidaySets.draft')} />` (`card: 'badge'`). `rowActions={(row) => [{ intent: 'edit', label: t('holidaySets.editAction', { name }), to: `/holiday-sets/${row.id}` }]}`. Delete `PublishedPill`.
   - Fetch dialog: `DialogContent size="sm" closeLabel={…}`; country field label `fetchDialog.countryLabel` + `FormDescription`-style help `fetchDialog.countryHelp`, `autoCapitalize="characters"`, `maxLength={2}`; year `Input` with `inputMode="numeric"` (keep `type="number"` out — a text input with numeric validation `2000–2100`, error `fetchDialog.yearError`); server error → always `t('holidaySets.fetchDialog.errorMessage')`. Footer Cancel / primary as today. Errors use the kit error text (`flex items-center gap-1 text-caption text-destructive` + `CircleAlertIcon`).
4. **Detail route** (`$setId.tsx`).
   - Delete the back `Link` and the hand-made `h1`. Loading → `Skeleton` (header bar `h-8 w-64` + card `h-64 w-full`); error → `ErrorState` (`detail.loadError`, Retry → `setQuery.refetch()`).
   - `DetailShell`: `name={holidaySetName(set, i18n.language, t)}`, `statusBadge` as in the list, `facts={[{ label: t('holidaySets.detail.sourceLabel'), value: t(SOURCE_LABEL_KEY[set.source]) }, { label: t('holidaySets.detail.fetchedAtLabel'), value: formatDateTime(set.fetched_at, config) }, { label: t('holidaySets.columnEntries'), value: t('holidaySets.entryCount', { count: set.entries.length }) }]}`, no tabs.
   - `actions`: one action, `priority: 'secondary'`: published → `{ id: 'unpublish', label: t('detail.unpublishAction'), icon: <GlobeLockIcon />, onClick: () => setUnpublishOpen(true), disabled: isDirty || unpublishSet.isPending }`; draft → `{ id: 'publish', label: t('detail.publishAction'), icon: <GlobeIcon />, onClick: () => setPublishOpen(true), disabled: isDirty || publishSet.isPending }`. Under the actions, when `isDirty`, render `<p id="publish-hint" className="text-caption text-text-secondary">{t('detail.publishDisabledHint')}</p>` and point the button's `aria-describedby` at it. If `DetailShellAction` has no `disabled` / hint slot, render the button yourself in the shell's actions area via the same `Button variant="outline"` (do not edit `ui/src/shells`).
   - Publish confirm: the editor's existing publish `Dialog` moves here, `size="sm"`, primary = `detail.publishDialog.confirm`. Unpublish confirm: `ConfirmDialog tone="danger"` with `detail.unpublishDialog.*`. Errors → `toast.error(t('detail.publishError' | 'detail.unpublishError'))`; success → `toast.success(t('detail.publishSuccess' | 'detail.unpublishSuccess'))` (**New**).
   - Save: `updateEntries.mutate(entries, { onSuccess: () => toast.success(t('detail.saveSuccess')) })`.
   - Leave guard: replace its `Dialog` with `ConfirmDialog tone="danger" open={blocker.status === 'blocked'} title={t('detail.unsavedChangesDialog.title')} description={…} cancelLabel={t('detail.unsavedChangesDialog.stayAction')} confirmLabel={t('detail.unsavedChangesDialog.leaveAction')} onConfirm={() => blocker.proceed?.()} onOpenChange={(o) => !o && blocker.reset?.()}`.
5. **Editor** (`-holiday-set-editor.tsx`).
   - Remove props `onPublish`, `onUnpublish`, `isPublishing`, `isUnpublishing`, `publishError`, `unpublishError`, the source / fetched-at line, and both dialogs. Keep row state, dirty tracking, `toInput` / `serialize`, `saveSucceeded` sync exactly.
   - Root: Card `overflow-hidden` without padding (`aria-labelledby`). Header `div p-4 md:px-5`: `h2 text-h2` `detail.entriesTitle`, `p mt-1 text-text-secondary` `detail.entriesHelp`.
   - Desktop: `<table className="hidden w-full text-left md:table">` with the kit `thead` (`border-y border-border-subtle bg-muted text-label text-text-secondary`, `th h-10 px-2 font-medium`, first `px-5`), rows `divide-y divide-border-subtle`, cells `h-12 px-2 py-2`. Dates: `DatePicker value={row.date ? parseDate(row.date) : undefined} onValueChange={(d) => updateRow(row.rowKey, { date: d ? toIsoDate(d) : '' })} config={config} placeholder={t('date.pick', { ns: 'common' })}` with an accessible name = column label (pass `aria-label` or wrap in a visually hidden label). Use `parseDate` / `toIsoDate` from `@biddaloy/ui/utils` (31.2.1, B19) for the value sent back; never `formatDate` output. End date gets `min` = start date. Names: `Input` with `aria-label`; Bangla name placeholder `detail.optional`. Remove: RowActions `delete` with label `t('detail.removeRowNamed', { name: row.name || t('detail.unnamed') })`.
   - Phone: `<ul className="divide-y divide-border-subtle border-t border-border-subtle md:hidden">`, each `li className="space-y-3 p-4"`: header row `flex items-center justify-between gap-2` with `h3 min-w-0 truncate text-h3` (`row.name_bn || row.name || t('detail.unnamed')`) and a ghost destructive button `inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-label font-medium text-destructive hover:bg-muted` (`Trash2Icon` + `detail.removeRow`); then four kit Fields stacked (`grid gap-3`), each with a visible `Label` (`htmlFor` ids `entry-{rowKey}-start|end|name|nameBn`). Only one of the two layouts is in the DOM at a time if the foundation's `useMediaQuery` exists; otherwise both render with `hidden` / `md:hidden` (the tests then query within `getByRole('table')`).
   - Empty: `EmptyState` inside the card (title `detail.emptyTitle`, sentence `detail.emptyMessage`, outline action `detail.addRow`).
   - Footer: `div className="flex flex-col gap-3 border-t border-border-subtle bg-surface p-4 md:flex-row md:items-center md:justify-between md:px-5 sticky bottom-16 md:static"`; left `flex items-center gap-3` = outline `detail.addRow` (`PlusIcon`, `flex-1 md:flex-none`) + `TableCount total={rows.length}`; right `flex flex-col gap-2 md:flex-row md:items-center md:gap-3` = when dirty `<p className="flex items-center gap-1 text-caption text-status-due-fg"><CircleAlertIcon className="size-4" />{t('detail.unsavedNotice')}</p>` + primary `Button` `detail.saveAction` (`SaveIcon`, `disabled={!isDirty}`, `loading={isSaving}`). Save error → kit error text with `detail.saveError` (no `ApiError.message`).
6. **i18n** (`platform.json`, bn / en):
   - add `holidaySets.setName`: "{{country}} {{year}}" / "{{country}} {{year}}"
   - add `holidaySets.source.NAGER_DATE`: "Nager.Date (অনলাইন তালিকা)" / "Nager.Date (online list)"; `source.GOOGLE_ICS`: "গুগল ক্যালেন্ডার" / "Google Calendar"; `source.MANUAL`: "নিজে লেখা" / "Entered by hand"
   - add `holidaySets.columnName`: "তালিকা" / "List"; change `columnEntries`: "ছুটি" / "Holidays"; `columnPublished`: "অবস্থা" / "Status"
   - add `holidaySets.entryCount_one` / `_other`: "{{count}}টি" / "{{count}} holiday" · "{{count}} holidays"
   - add `holidaySets.editAction`: "{{name}} সম্পাদনা করুন" / "Edit {{name}}"; `holidaySets.emptyTitle`: "এখনো কোনো ছুটির তালিকা নেই" / "No holiday lists yet"; change `emptyMessage`: "কোনো দেশের এক বছরের সরকারি ছুটি আনলে তালিকা এখানে দেখা যাবে।" / "Fetch a country's public holidays for a year and the list shows here."
   - change `fetchDialog.countryLabel`: "দেশের কোড" / "Country code"; add `fetchDialog.countryHelp`: "দুই অক্ষরে, যেমন বাংলাদেশ = BD" / "Two letters, e.g. Bangladesh = BD"; add `fetchDialog.yearError`: "২০০০ থেকে ২১০০-এর মধ্যে একটি বছর দিন।" / "Enter a year between 2000 and 2100."
   - change `detail.columnName`: "নাম (ইংরেজি)" / "Name (English)"; `detail.columnActions`: "কাজ" / "Actions"; add `detail.optional`: "ঐচ্ছিক" / "Optional"
   - add `detail.entriesTitle`: "ছুটির দিন" / "Holidays"; `detail.entriesHelp`: "একদিনের ছুটিতে শুরু আর শেষ একই তারিখ। বাংলা নাম না দিলে স্কুলে ইংরেজি নাম দেখাবে।" / "For a one-day holiday the start and end are the same date. Without a Bangla name, schools see the English one."
   - add `detail.removeRowNamed`: "{{name}} সরান" / "Remove {{name}}"; `detail.unnamed`: "নাম নেই" / "Unnamed"; `detail.emptyTitle`: "এই তালিকায় কোনো ছুটি নেই" / "This list has no holidays"; change `detail.emptyMessage`: "প্রথম ছুটি যোগ করে সংরক্ষণ করুন।" / "Add the first holiday and save."
   - add `detail.unsavedNotice`: "সংরক্ষণ হয়নি এমন পরিবর্তন আছে" / "You have unsaved changes"; `detail.publishSuccess`: "তালিকা প্রকাশিত হয়েছে।" / "The list is published."; `detail.unpublishSuccess`: "তালিকা অপ্রকাশিত হয়েছে।" / "The list is unpublished."
   - leave `detail.back` for the unused-key report (not rendered).
7. **Stories**: editor — clean draft, dirty draft, empty; keep the existing ones' names where possible.

## Tests
- `index.test.tsx`:
  - **B7:** a set returned **without** `entries` renders its row with "—" in the holiday column and no error boundary.
  - the seeded BD set shows "বাংলাদেশ ২০২৬" (not "BD"), the source "Nager.Date (অনলাইন তালিকা)" (not `NAGER_DATE`), a "প্রকাশিত"/"খসড়া" badge, a link named "বাংলাদেশ ২০২৬ সম্পাদনা করুন" to `/holiday-sets/<id>`, and "মোট ১টি".
  - fetch dialog: invalid code shows the translated error and sends nothing; a both-sources failure shows `fetchDialog.errorMessage` (not the server text).
- `$setId.test.tsx`: `h1` "বাংলাদেশ ২০২৬"; facts show the translated source and a long-form fetched date; no link "ছুটির তালিকায় ফিরে যান"; editing a row disables "প্রকাশ করুন" and shows the hint text; publish asks in a dialog and calls the API; unpublish asks in an `alertdialog`; the unsaved-changes guard is an `alertdialog` whose confirm navigates away; save sends the full entries array (existing case) and shows the success toast.
- `-holiday-set-editor.test.tsx`: add / remove rows (existing cases); picking a date through `DatePicker` stores an ISO string (`2026-03-26`) in the saved payload; Save is disabled when clean and enabled after an edit; the unsaved notice appears only when dirty; save error shows the translated sentence. Delete the publish-dialog cases (moved).
- No platform e2e touches holiday lists; nothing to update.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] `/holiday-sets` renders even when the API omits `entries` (B7).
- [ ] No ISO country code, source enum or browser date input anywhere on the two pages.
- [ ] Publish sits in the header as an outline button; its "save first" hint is visible text.
- [ ] On phone every entry is a stacked card with labelled fields and a labelled "সরান".

## Out of scope
- Server fix for B7 (`listSets()` relations) — 31.3.7.
- A country picker instead of the 2-letter code — needs a supported-country list (D1).
- Last crumb on the detail page: 31.3.5's resolver builds `${country} ${year}` from the raw code ("BD 2026") — filed in `shared-requests.md` to use the same country name + numerals as the `h1`.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| holiday set crumb label = h1 | Accepted | 31.3.5 | holidaySetDetail label = Intl.DisplayNames region name + year in tenant numerals ("বাংলাদেশ ২০২৬"); build the h1 the same way |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: platform   Decisions: D5, D6, D9, D16, D19, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.platform-2
