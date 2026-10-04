# [31.4.marks-4a] Grading scales list — names instead of ids, clear create

## Goal
`/grading-scales` shows each scale's academic year and class by name (never a UUID, B13), which ones still have no grades, a "মোট nটি" total and a pencil row action, and "পদ্ধতি যোগ করুন" opens a labelled small dialog that takes you straight to the new scale's editor.

Split: this ticket is the list page; the editor is `ticket-b.md` (`marks-4b`, runs after this one).

## What and why
An admin uses this page to see which grading scale applies to which year and class, add one, and open one to set its grades. Today the year and class columns print UUIDs (B13 — the academic-year list is fetched with the server's default limit of 10), the year filter has no visible label, the name is an underlined link, a technical "সংশোধন" (revision counter) column takes space, a just-created scale has no grades and looks like every other row, "বর্ষের ডিফল্ট" is jargon, and after creating a scale the user is left on the list to find it again. The redesign uses ListShell with a subtitle and one primary, a labelled FilterBar select, an unpaginated DataTable with names, a "গ্রেড বাকি" badge, RowActions and TableCount, and a kit `sm` dialog that navigates to the new scale.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales/mobile.webp?raw=true" width="260"> |
| Before — editor | _not captured_ | _not captured_ |
| After — editor | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales_scaleId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales_scaleId/mobile.webp?raw=true" width="260"> |

The editor rows belong to `marks-4b`; they are here so both tickets show the whole flow.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `ListShell` title `list.title` ("গ্রেডিং পদ্ধতি", already renamed by the glossary), **New** subtitle "কত শতাংশ নম্বরে কোন গ্রেড আর জিপিএ, তা প্রতি শিক্ষাবর্ষে এখানে ঠিক হয়।", one primary "পদ্ধতি যোগ করুন" (`plus`) via `actions` (`allowed: canManage`). | D16; bn label matches the nav word "পদ্ধতি" |
| 2 | Filter | `filters` (typed FilterBar): one select `{ kind: 'select', key: 'academic_year_id', label: "শিক্ষাবর্ষ", allLabel: "সব শিক্ষাবর্ষ", options: years }`. Phone: "ফিল্টার (n)" button + chip "শিক্ষাবর্ষ: ২০২৬". Replaces the label-less `filterBar` Select and the `__all__` sentinel. | D24 |
| 3 | Year / class columns (B13) | `useAcademicYears({ limit: 100 })` (server max). Cell shows the name; while years/classes load, a `Skeleton className="h-3 w-16"`; a name that is still not found after loading shows "—" — never the id. A scale with no class shows **New** "সব শ্রেণি" (was "বর্ষের ডিফল্ট"). Column header "কোন শ্রেণির জন্য". | B13, D9, D32 |
| 4 | Grades column | Header "গ্রেড"; value "৭টি" via `formatNumber`; 0 bands → `StatusBadge tone="warning"` **New** "গ্রেড বাকি". The "সংশোধন" column is removed. | D6, D27; a new empty scale stands out |
| 5 | Row action | Name is plain `font-medium` text; `rowActions` → `edit` "সম্পাদনা করুন" (`to` the editor). | D19 |
| 6 | Table frame | `paginated={false}` (the endpoint returns the whole list, a handful of rows per year), footer "মোট ৪টি"; `emptyState` `ruler` "এখনো কোনো গ্রেডিং পদ্ধতি নেই" + "একটি পদ্ধতি যোগ করুন, তারপর তার গ্রেডগুলো ঠিক করুন।" (no action — the header has it). Error stays `list.errorMessage`. | D19, D28 |
| 7 | Create dialog | `DialogContent size="sm"`; title "গ্রেডিং পদ্ধতি যোগ করুন", description "নাম দিন আর কোন শ্রেণির জন্য তা বাছুন। গ্রেডগুলো পরের পাতায় দেবেন।". Fields with `Label htmlFor` (today two are `span`s): নাম* (placeholder "যেমন: জাতীয় পাঠ্যক্রম ২০২৬"), শিক্ষাবর্ষ* (placeholder "বাছুন"), কোন শ্রেণির জন্য (default "বর্ষের সব শ্রেণি", help "কোনো শ্রেণির নিজের পদ্ধতি থাকলে সেই শ্রেণিতে সেটিই খাটে।"). Error line = kit Error text. On success **New**: navigate to `/grading-scales/$scaleId` of the created scale (and reset the form). | D21, D25; the next step is always "add grades" |

## Mobile behaviour
- Primary "পদ্ধতি যোগ করুন" full width under the title.
- Filter: the outline "ফিল্টার (n)" button opens the FilterBar sheet with the year select; the active year shows as a chip.
- The list uses compact two-line rows (`PATTERN: DataTable (unpaginated)`): name, then "২০২৬ · সব শ্রেণি · ৭টি গ্রেড" (or "· গ্রেড বাকি"), and a 44 px pencil.
- The bottom bar marks "আরও".

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| B13 fix | new server lookup / bigger limit | `useAcademicYears({ limit: 100 })` | The server caps at 100; a school has a handful of years. Classes already default to 100 (`CLASS_FILTER_LIMIT`). |
| Revision column | keep / move to editor / drop | drop | A counter of confirmed saves; nobody acts on it. |
| Pagination | 25-row pager / unpaginated | unpaginated | `GET /grading/scales` is not paginated; a pager that always says "page 1 of 1" is noise. |
| After create | stay on list / open editor | open editor | A new scale has no grades; adding them is the only next step. |
| Wording "scale" in bn | স্কেল / পদ্ধতি | পদ্ধতি | Same word as the nav item after the glossary (31.3.4a `items.gradingScales`). |

## Files
- `client-admin/src/routes/_staff/grading-scales/index.tsx` — header, filter, columns, B13, dialog, navigation
- `client-admin/src/routes/_staff/grading-scales/index.test.tsx` — **new**
- `e2e/keyboard/grading-scales.spec.ts` — last step only (also changed by marks-4b, runs later)
- `ui/src/i18n/locales/en/grading.json` — `list`, `createDialog` changes (also changed by marks-1/2/3, run earlier)
- `ui/src/i18n/locales/bn/grading.json` — same

## Steps
1. **Locale (`grading.json`, en / bn).**
   - `list`: add `subtitle` "How many percent of the marks give which grade and GPA, set per academic year." / "কত শতাংশ নম্বরে কোন গ্রেড আর জিপিএ, তা প্রতি শিক্ষাবর্ষে এখানে ঠিক হয়।"; `addScale` → "Add grading scale" / "পদ্ধতি যোগ করুন"; `caption` bn → "গ্রেডিং পদ্ধতি"; `columnClass` → "Applies to" / "কোন শ্রেণির জন্য"; `columnBands` → "Grades" / "গ্রেড"; add `bandCount` "{{count}}" with `_one`/`_other` en "{{count}} grade(s)" / bn "{{count}}টি"; `bandCountLong` en "{{count}} grades" / bn "{{count}}টি গ্রেড" (phone line); `noBands` "No grades yet" / "গ্রেড বাকি"; `yearDefault` → "All classes" / "সব শ্রেণি"; `edit` "Edit" / "সম্পাদনা করুন"; `emptyTitle` "No grading scales yet" / "এখনো কোনো গ্রেডিং পদ্ধতি নেই"; `emptyText` "Add a scale, then set its grades." / "একটি পদ্ধতি যোগ করুন, তারপর তার গ্রেডগুলো ঠিক করুন।". Delete `columnRevision`, `emptyMessage`.
   - `createDialog`: `title` → "Add grading scale" / "গ্রেডিং পদ্ধতি যোগ করুন"; `description` → "Give it a name and choose where it applies. You add the grades on the next page." / "নাম দিন আর কোন শ্রেণির জন্য তা বাছুন। গ্রেডগুলো পরের পাতায় দেবেন।"; add `namePlaceholder` "e.g. National curriculum 2026" / "যেমন: জাতীয় পাঠ্যক্রম ২০২৬"; `academicYearPlaceholder` → "Choose" / "বাছুন"; `classLabel` → "Applies to" / "কোন শ্রেণির জন্য"; `yearDefault` → "All classes of the year" / "বর্ষের সব শ্রেণি"; add `classHelp` "If a class has its own scale, that one is used for the class." / "কোনো শ্রেণির নিজের পদ্ধতি থাকলে সেই শ্রেণিতে সেটিই খাটে।"; `errorMessage` bn → "গ্রেডিং পদ্ধতি তৈরি করা যায়নি। আবার চেষ্টা করুন।".
2. **`index.tsx` — data.** `const academicYearsQuery = useAcademicYears({ limit: 100 });`. `yearName(row)` / `className(row)` return `undefined` while the matching query `isPending`, the name when found, `'—'` otherwise; `class_id === null` → `t('list.yearDefault')`. Render `undefined` as `<Skeleton className="h-3 w-16" />`.
3. **`index.tsx` — ListShell.** `useListShellState()` (25 is the default now, B23). Replace `primaryAction` with `actions={[{ id: 'add', label: t('list.addScale'), priority: 'primary', icon: <Plus />, onClick: () => setCreateOpen(true), allowed: canManage }]}`; add `subtitle={t('list.subtitle')}`. Replace `filterBar` with `filters={{ fields: [{ kind: 'select', key: 'academic_year_id', label: t('list.academicYearLabel'), allLabel: t('list.allAcademicYears'), options: years.map((y) => ({ value: y.id, label: y.name })) }], values: state.filters, onChange: (patch) => actions.setFilters({ ...state.filters, ...patch }) }}` (follow whatever `setFilters` shape `audit-logs/index.tsx` uses with `filters`). Query: `useGradingScales(filterYearId ? { academic_year_id: filterYearId } : {})`; delete `ALL_VALUE` from the filter path (keep a local sentinel only for the dialog's class select).
   - Columns: name (`font-medium`, `card: 'title'`), academicYear, class, bands (`row.bands.length > 0 ? t('list.bandCount', { count: formatNumber(n, config) }) : <StatusBadge tone="warning" label={t('list.noBands')} />` — pass the formatted string as a separate interpolation if `count` must stay numeric for plurals: `t('list.bandCount', { count: n, n: formatNumber(n, config) })` with `{{n}}` in the value). Remove the revision column.
   - `rowActions={(row) => [{ intent: 'edit', label: t('list.edit'), to: \`/grading-scales/${row.id}\` }]}`, `paginated={false}`, `emptyState={{ icon: <Ruler />, title: t('list.emptyTitle'), explanation: t('list.emptyText') }}`; drop `emptyMessage`, `page`, `pageSize`, `onPageChange`, `onPageSizeChange`, `pageSizeLabel` if `paginated={false}` makes them optional.
   - Phone compact row: if DataTable's card mode renders a `subtitle` column slot, give it `${year} · ${class} · ${bandCountLong | noBands}`; otherwise rely on the default card fields.
4. **`index.tsx` — dialog.** `DialogContent size="sm" closeLabel={t('actions.close', { ns: 'common' })}`; fields as `Field` (`flex flex-col gap-1.5`) with `Label htmlFor` + the control's `id` (`scale-name`, `scale-year`, `scale-class`); required mark on name and year (kit Required mark); name `placeholder={t('createDialog.namePlaceholder')}`; class help text under the select (`text-caption text-text-secondary`); error `<p role="alert" className="flex items-center gap-1 text-caption text-destructive"><CircleAlert className="size-3.5" />…</p>`. `onSuccess: (created) => { setCreateOpen(false); setName(''); setAcademicYearId(''); setClassId(ALL_VALUE); void navigate({ to: '/grading-scales/$scaleId', params: { scaleId: created.id } }); }` (`useNavigate()`).
5. **`e2e/keyboard/grading-scales.spec.ts`** last step: the name is no longer a link → `await expect(page.getByRole('cell', { name: scaleName })).toBeVisible()`.
6. Run `pnpm --filter client-admin test grading-scales/`, `pnpm --filter @biddaloy/ui check:i18n`, then `graphify update .`.

## Tests
- `grading-scales/index.test.tsx` (new, MSW like the sibling tests): with 12 academic years mocked and a scale on the 12th, the year cell shows its name and no UUID text appears anywhere (B13; assert the request had `limit=100`); a scale with `class_id: null` shows "All classes"; a scale with 0 bands shows the "No grades yet" badge, one with 7 shows "7 grades"; no "Revision" header; the edit action links to `/grading-scales/<id>`; footer "Total 2"; the filter is found by `getByLabelText('Academic year')`; the create dialog's fields are found by label; creating navigates to the new scale's route.
- `e2e/keyboard/grading-scales.spec.ts` — run it (last step changed).

## Acceptance
- [ ] Desktop at 1440 px matches the "after — list" screenshot.
- [ ] Mobile at 390 px matches the "after — list" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (header "পদ্ধতি যোগ করুন"; "তৈরি করুন" inside the dialog).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Year and class always show a name, a skeleton or "—" — never a UUID, even with more than 10 academic years.
- [ ] A scale with no grades shows the "গ্রেড বাকি" badge; there is no revision column.
- [ ] Creating a scale lands on its editor.

## Out of scope
- Deleting a scale (`useDeleteGradingScale` exists but no UI today) — not added (D1).
- Sorting rows by year — server order kept.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| crumb resolver: scale name | Accepted | 31.3.5 | resolver key gradingScaleDetail -> name from gradingScaleQueryOptions(id) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: marks   Decisions: D6, D9, D15, D16, D19, D21, D24, D25, D27, D28, D32   Depends on: 31.3.8b, 31.4.marks-3
