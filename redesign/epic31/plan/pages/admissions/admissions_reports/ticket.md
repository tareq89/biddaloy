# [31.4.admissions-4] Admission reports — kit header, labelled filters, readable counts and table

## Goal
`/admissions/reports` uses the kit header, labelled filters, count tiles in the tenant's numerals, long-form dates, event badges, a 25-row paged table with a total, and a link to each student — matching the "after" screenshots.

## What and why
The page tells office staff who joined, left, graduated or came back in one academic year. Today the filters have no visible labels and the year select says "চলতি বছর" without naming the year. Counts are Latin digits and dates are ISO (`2026-12-20`). The event is plain text, and the table has no total. There is also no way to open a student from a row. The redesign keeps the same data and filters and moves everything onto the kit patterns. The subtitle always says which year and class you are looking at.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_reports/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_reports/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_reports/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_reports/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page frame | `PageContainer` (wide) + `PageHeader` with title "ভর্তি প্রতিবেদন". No crumbs, because this is a one-level page. No actions: the page is read-only and export belongs to Epic 8.15. | D15, D16 |
| 2 | Subtitle **New** | "শিক্ষাবর্ষ ২০২৬ · সব শ্রেণি — কে ভর্তি হলো, কে চলে গেল". It always names the year and class in use, so the phone (where filters sit behind a button) still shows the current state. | Diagnose: current state is hidden |
| 3 | Filters | `FilterBar` labels are visible (foundation). The year "all" option reads "চলতি বছর (২০২৬)" instead of a bare "চলতি বছর". | D24; the trigger did not say which year |
| 4 | Count tiles | Four tiles with Card classes. Values go through `formatNumber`. The "চলে গেছে" tile gets a **New** caption, "নাম কাটা ১ · অন্য স্কুলে ১", which says what it adds up. A skeleton shows while loading. | D6, D28; "Left" was an unexplained sum |
| 5 | Event column | `StatusBadge`: ভর্তি হয়েছে and আবার ভর্তি হয়েছে are success, পাশ করেছে is info, নাম কাটা হয়েছে and অন্য স্কুলে গেছে are neutral. | D27 |
| 6 | Date column | `formatDate(occurred_on)` → "২০শে ডিসেম্বর, ২০২৬". | D5 |
| 7 | Reg. no. | A missing value shows "—" in the table. The phone card subtitle shows "রেজি. নম্বর এখনো হয়নি" instead. | D9; a bare dash as a subtitle reads like a glitch |
| 8 | Row action **New** | `RowActions` view → `/students/$studentId`, label "শিক্ষার্থী দেখুন". It is hidden when the row has no `student_id` (admitted applicants) or the user lacks `STUDENT_READ`. | D19; the obvious next step from a row |
| 9 | Pager | Paging happens on the client over the ≤ 500 rows the server returns: 25 per page, options 25/50/100, and `TableCount` "১–৫ দেখানো হচ্ছে, মোট ৫". | D19, B23 |
| 10 | Empty state | `EmptyState`: the title is the existing `emptyMessage` plus one **New** sentence. No pager. | D28 |
| 11 | Truncated note | Same text, now `text-caption text-text-secondary` with an `info` icon, and the number goes through `formatNumber`. | D6 |

## Mobile behaviour
- Filters sit behind one "ফিল্টার" button (FilterBar phone sheet). The subtitle carries the year and class.
- Tiles show 2 × 2.
- Rows become cards: name plus the event badge, then reg. no., then a 2-column `dl` (শ্রেণি, তারিখ, কারণ, কোথায় গেছে). There is a "শিক্ষার্থী দেখুন" footer action only when the row has a student.
- The pager stacks under the count.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Paging | one 500-row page / server paging / slice on the client | slice on the client, 25 per page | The API returns everything at once with no paging params (D1: no API change). D19 wants 25. |
| Event tones | five tones / three groups | joined = success, finished = info, left = neutral | Leaving is not a failure, so no danger tone. The table reads calmly. |
| Year option wording | make the select required (shared FilterBar change) / name the year in `allLabel` | `allLabel` = "চলতি বছর (<name>)" | Fixes it inside the namespace, with no shared prop. |
| Filters in the URL | lift into search params / keep `useState` | keep | No D-rule asks for it. It would add router coupling to a feature component that tests render bare. |

## Files
- `client-admin/src/features/admission/AdmissionReports.tsx` — header, tiles, columns, row action, paging, empty state
- `client-admin/src/features/admission/AdmissionReports.test.tsx` — cases below
- `client-admin/src/features/admission/AdmissionReports.stories.tsx` — make sure the stories still render (add a `Loading` story if missing)
- `client-admin/src/routes/_staff/admissions/reports/index.test.tsx` — heading assertion unchanged, run it
- `ui/src/i18n/locales/en/admission-reports.json`, `ui/src/i18n/locales/bn/admission-reports.json` — keys below
- `e2e/keyboard/admission-reports.spec.ts` — run it; adjust only the count assertions if numerals change (see Tests)

## Steps
1. **Locale** (`admission-reports.json`, en / bn). Change `filterCurrentYear` → "Current year ({{name}})" / "চলতি বছর ({{name}})". Add:
   - `subtitle`: "Academic year {{year}} · {{class}} — who joined, who left" / "শিক্ষাবর্ষ {{year}} · {{class}} — কে ভর্তি হলো, কে চলে গেল"
   - `countLeftDetail`: "Withdrawn {{withdrawn}} · Transferred {{transferred}}" / "নাম কাটা {{withdrawn}} · অন্য স্কুলে {{transferred}}"
   - `noRegistration`: "No reg. no. yet" / "রেজি. নম্বর এখনো হয়নি"
   - `viewStudent`: "View student" / "শিক্ষার্থী দেখুন"
   - `emptyExplanation`: "Admissions, leavers and graduations recorded in this year show up here." / "এই বছরে কেউ ভর্তি হলে, চলে গেলে বা পাশ করলে এখানে দেখা যাবে।"

   Keep every existing key. `emptyMessage` stays and becomes the EmptyState title, so the e2e step still finds it.
2. **Frame.** In `AdmissionReports.tsx`, replace the outer `div.flex.flex-col.gap-4` and the hand-made `h1` with `<PageContainer>` (default `wide`) holding `<PageHeader title={t('title')} subtitle={…} />`, both from `@biddaloy/ui`. Build the subtitle from the resolved year: `const year = years.find((y) => y.id === academicYearId)`. Then `t('subtitle', { year: year?.name ?? '', class: classId ? className : t('filterAllClasses') })`, where `className` is the name of the selected class in `classesQuery.data`. Render no subtitle while `years` is empty.
3. **FilterBar.** Keep the two descriptors and the onChange logic, which clears the class when the year changes. Year `allLabel: t('filterCurrentYear', { name: (years.find((y) => y.is_current) ?? years[0])?.name ?? '' })`.
4. **Tiles.** Keep `<dl aria-label={t('countsLabel')} data-testid="lifecycle-counts">` with the class `grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4`. Each tile is a `div` with `rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`:
   - `dt` gets `text-label text-text-secondary`.
   - `dd` gets `mt-1 text-h1 tabular-nums` and shows `formatNumber(value, regionConfig)`. `regionConfig = useRegionConfig()` comes from `@biddaloy/ui/i18n`.
   - The "Left" tile adds `<p className="mt-0.5 text-caption text-text-secondary">{t('countLeftDetail', { withdrawn: formatNumber(counts.withdrawn, …), transferred: formatNumber(counts.transferred_out, …) })}</p>` after the `dd`. Keep `dt` → `dd` as direct siblings: the unit test reads `nextSibling`.
   - While `reportQuery.isLoading`, render the 4 tiles with `<span className="mt-2 block h-7 w-12 rounded-sm bg-muted" />` in place of the number, under `aria-busy="true"` on the `dl`.
5. **Columns.**
   - `registrationNumber`: `accessorFn: (r) => r.registration_number ?? dash`. For the card subtitle, use the `cell`/card renderer DataTable offers so that `null` shows `t('noRegistration')`. If the card role reads the accessor only, keep the dash and skip this sub-step.
   - `date`: `accessorFn: (r) => formatDate(r.occurred_on, regionConfig)`.
   - `event`: render `<StatusBadge tone={EVENT_TONE[r.event_type]} label={t(\`event${r.event_type}\`)} />` (keep `card: 'badge'`), with a module const `EVENT_TONE = { ADMITTED: 'success', READMITTED: 'success', GRADUATED: 'info', WITHDRAWN: 'neutral', TRANSFERRED_OUT: 'neutral' } as const`.
   - Name, class, reason and destination stay as they are.
6. **Row action.** `const canReadStudents = useHasPermission(Permission.STUDENT_READ)` (`@biddaloy/ui/hooks`, `@biddaloy/shared`). Pass `rowActions={(r) => [{ intent: 'view', label: t('viewStudent'), to: \`/students/${r.student_id}\`, allowed: Boolean(r.student_id) && canReadStudents }]}` to `DataTable`.
7. **Paging on the client.**
   - State: `const [page, setPage] = useState(1)` and `const [pageSize, setPageSize] = useState(25)`. Reset `page` to 1 inside the FilterBar `onChange`.
   - Pass `data={rows.slice((page - 1) * pageSize, page * pageSize)}`, `page`, `pageSize`, `totalCount={rows.length}`, `onPageChange={setPage}` and `onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}`.
   - Drop `pageSize={ROW_LIMIT}`, but keep `ROW_LIMIT` for the truncated note. Do not pass `pageSizeOptions`: the foundation default is [25, 50, 100].
8. **Empty state.** Replace `emptyMessage` with `emptyState={{ title: t('emptyMessage'), explanation: t('emptyExplanation') }}`.
9. **Truncated note.** `<p role="status" className="flex items-center gap-1.5 text-caption text-text-secondary"><Info className="size-4" aria-hidden />{t('truncated', { count: formatNumber(ROW_LIMIT, regionConfig) })}</p>`. `Info` comes from `lucide-react`. If the plural form needs the raw number, pass `count: ROW_LIMIT` and rely on the 31.2.1b number formatter.
10. Update the file's header comment: filters are still local state, and paging happens on the client.

## Tests
- `AdmissionReports.test.tsx`:
  - The counts test still passes. Add an assertion for the Left caption, e.g. `Withdrawn 2 · Transferred 1`, using the mock's numbers.
  - A row's date shows long form (`20th December, 2026` in en).
  - The event cell renders a badge (the text is still found).
  - "View student" links to `/students/<id>` for a row with `student_id` and is absent for an ADMITTED row with `student_id: null`.
  - With 30 mocked rows, the first page shows 25 rows and "Showing 1–25 of 30".
  - The empty case finds `No records for this year` plus the explanation.
  - The truncated case keeps passing. The axe case stays.
- `routes/_staff/admissions/reports/index.test.tsx`: unchanged, run it.
- `e2e/keyboard/admission-reports.spec.ts`: the selectors stay the same (testid, combobox name, table caption, empty text). If the seeded school renders Bangla digits, change `toContainText('2')` / `('1')` to the tenant-numeral string, e.g. `'২'`. Run the spec either way.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (this page has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Subtitle names the selected year and class and updates when a filter changes.
- [ ] The year trigger reads "চলতি বছর (<year name>)" by default.
- [ ] Count tiles show tenant numerals; the Left tile shows its withdrawn / transferred split.
- [ ] Event cells are badges; dates are long form.
- [ ] The table shows "১–n দেখানো হচ্ছে, মোট N" and pages at 25; the empty table shows the EmptyState and no pager.
- [ ] Rows with a student show a "শিক্ষার্থী দেখুন" action that opens the student; admitted-applicant rows show none.

## Out of scope
- Clicking a tile to filter the table by event: new behaviour (D1).
- Export (CSV / print): Epic 8.15.
- Filters in the URL: not required by any D-rule (see Decisions).
- Admitted rows have no reg. no. or student link, because applicants are not linked to a student (server data caveat in the file header).
- The sidebar label "ভর্তি প্রতিবেদন" comes from `nav.json` (31.3.4a). It is not changed here.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: admissions   Decisions: D5, D6, D9, D15, D16, D19, D24, D27, D28   Depends on: 31.3.8b, 31.4.admissions-3
