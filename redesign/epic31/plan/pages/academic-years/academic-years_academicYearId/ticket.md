# [31.4.academic-years-2] Academic year detail — facts header, three kit tabs

## Goal
`/academic-years/$academicYearId` opens with a kit detail header (crumbs, the year's name + status badge, period and counts as facts, Edit as the one primary, Set current outline, Delete in More), the Statistics tab folded into those facts, and the Classes, Fee structures and Terms tabs using kit tables with icon actions.

## What and why
The page shows one academic year: its dates, whether it is current, and the classes, fee structures and terms that belong to it. Today it has a "শিক্ষাবর্ষ" back link under the breadcrumb, a title ("২০২৬", derived from the start date) that differs from the last crumb (the year's name), ISO dates, a red Delete button in the header, pill tabs, a whole tab for three numbers, bare tables with 20-row pagers and text-button actions, and a Terms tab with a second filled button. The redesign puts the numbers in the header, keeps three tabs, and gives every tab the kit table.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/academic-years/academic-years_academicYearId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/academic-years/academic-years_academicYearId/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/academic-years/academic-years_academicYearId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/academic-years/academic-years_academicYearId/mobile.webp?raw=true" width="260"> |

(The mockup shows the current year with `?tab=terms`.)

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Top | Remove the underlined "শিক্ষাবর্ষ" back link; the crumb "শিক্ষাবর্ষ › ২০২৬" is the way back. | D16 |
| 2 | Title | `name={year.name}` instead of `formatAcademicYear(start_date)`. | D16 — title = last crumb |
| 3 | Facts | **New** `facts`: সময়কাল (`formatDateRange`), শ্রেণি "১২টি", শিক্ষার্থী "৪৮০ জন", ফি কাঠামো "৯টি" from `useAcademicYearStats`. Replaces `identifiers`. | D5, D6 |
| 4 | Statistics tab | Removed; its three numbers are the facts above. `?tab=statistics` falls back to the first tab (`useDetailShellTab` already does). `statistics-tab.tsx` deleted. | "Is anything shown that I don't need?" — a tab for three numbers |
| 5 | Header actions | Primary "সম্পাদনা" (`pencil`); outline "চলমান হিসেবে নির্ধারণ করুন" (`circle-check`, only when not current); More → "মুছুন" (destructive, last). | D16, D29 — the red header button goes |
| 6 | Set-current confirm | `-set-current-dialog.tsx` → `ConfirmDialog tone="default"` with the existing description. | D29 |
| 7 | Tabs | Line tabs, one row (DetailShell after 31.2.5b): শ্রেণি · ফি কাঠামো · টার্ম. | D20, B1 |
| 8 | Classes tab | `DataTable`, page size 25: নাম (link to the class, `font-medium`), গ্রেড (`formatNumber`, end); `rowActions` view → `/classes/$classId`; `EmptyState`. | D19, D6, D28 |
| 9 | Fee structures tab | `DataTable`, page size 25: নাম, ধরন, শ্রেণি ("পুরো বিদ্যালয়" when none), পরিমাণ (end); `EmptyState`. | D19, D28 |
| 10 | Terms tab | Panel header: h2 (term label from calendar settings) + **New** subtitle + **outline** "টার্ম যোগ করুন". Card table: ক্রম (tenant digits), নাম, **New** সময়কাল (one range), দৈর্ঘ্য (end), কাজ = `arrow-up` / `arrow-down` icon buttons + `RowActions` edit / delete. Footer "মোট ৩টি". | D19, D29 — the add button was a second filled one |
| 11 | Term dialogs | Term form `size="sm"`, FormField labels, dates via `toIsoDate`; the "outside the year" error formats `yearStart`/`yearEnd` with `formatDate`; delete term → `ConfirmDialog tone="danger"`. | D5, D9, D21, D25, D29 |
| 12 | Loading | Facts show a skeleton bar while stats load; tabs keep `TabQueryState`. | D28 |

## Mobile behaviour
- Crumbs "শিক্ষাবর্ষ › name"; facts in a 2-column grid with সময়কাল spanning both columns.
- Header: Edit `flex-1` + More; Set current moves into More.
- Tabs scroll sideways if needed.
- Terms panel: add button full width under the title; each term row = name + "period · length" on top, the four icon buttons on a second line, end-aligned.
- Classes and fee structures: DataTable cards (name title, other columns as fields).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Statistics tab | keep / fold into facts | fold | Three numbers belong in the header; one tab fewer to understand. |
| The one primary | Edit / Set current / Add term | Edit | Always available; Set current exists only for non-current years and Add term only on one tab. |
| Title source | derived year / stored name | stored `name` | Matches the breadcrumb resolver and the list (academic-years-1). |
| Terms table | DataTable / custom table | custom kit table | DataTable has no reorder controls; the kit table classes are copied instead (still one Card, header band, 40 px rows, "মোট n টি"). |
| Terms tab label | follow `termLabel` setting / keep "টার্ম" | keep "টার্ম" | Reading calendar settings in the route would fire for users without `CALENDAR_READ` (403 toast); the panel heading already follows the setting. |

## Files
- `client-admin/src/routes/_staff/academic-years/$academicYearId.tsx` — back link removed, name, facts, actions, tab list
- `client-admin/src/routes/_staff/academic-years/-set-current-dialog.tsx` — ConfirmDialog
- `client-admin/src/routes/_staff/academic-years/-detail/statistics-tab.tsx` — delete
- `client-admin/src/routes/_staff/academic-years/-detail/classes-tab.tsx` — DataTable, link, view action, empty state
- `client-admin/src/routes/_staff/academic-years/-detail/fee-structures-tab.tsx` — DataTable, align, empty state
- `client-admin/src/routes/_staff/academic-years/-detail/terms-tab.tsx` — panel header, kit table, icon actions, dialogs
- `ui/src/i18n/locales/bn/academicYears.json`, `ui/src/i18n/locales/en/academicYears.json` — keys below (also changed by academic-years-1, runs earlier)
- `client-admin/src/routes/_staff/academic-years/$academicYearId.test.tsx`, `-detail/terms-tab.test.tsx`, `-detail/-terms-tab-view.stories.tsx` — update

## Steps
1. **`$academicYearId.tsx`.**
   - Delete the `<Link to="/academic-years">` and the wrapping `flex flex-col gap-4` div (fragment inside `RegionConfigProvider`).
   - `const stats = useAcademicYearStats(academicYearId);` (before the early returns).
   - `name={year.name}`; keep `statusBadge`.
   - `facts={[{ label: t('detail.factPeriod'), value: formatDateRange(year.start_date, year.end_date, regionConfig) }, { label: t('detail.statistics.classes'), value: count(stats.data?.classes_count, 'detail.classCount') }, { label: t('detail.statistics.students'), value: count(stats.data?.students_count, 'detail.studentCount') }, { label: t('detail.statistics.feeStructures'), value: count(stats.data?.fee_structures_count, 'detail.feeStructureCount') }]}` where `count(n, key) = n === undefined ? <Skeleton className="h-4 w-10" /> : t(key, { count: n })`.
   - `actions`: `{ id: 'edit', label: t('list.edit'), icon: <PencilIcon />, priority: 'primary', allowed: canManage, onClick }`, set-current `{ …, icon: <CircleCheckIcon />, priority: 'secondary' }` only when `!year.is_current`, `{ id: 'delete', label: t('list.delete'), icon: <Trash2Icon />, priority: 'destructive', allowed: canManage, onClick }`.
   - `TAB_IDS = ['classes', 'feeStructures', 'terms']`; remove the `statistics` tab and the `StatisticsTab` import; delete `-detail/statistics-tab.tsx`.
2. **`-set-current-dialog.tsx`.** `ConfirmDialog` (`tone="default"`) with `title={t('setCurrentDialog.title')}`, `description={t('setCurrentDialog.description', { name })}`, `confirmLabel={t('setCurrentDialog.confirm')}`, `busy`; error line `t('setCurrentDialog.errorMessage')`. Props unchanged.
3. **`classes-tab.tsx`.** `PAGE_SIZE = 25`. Replace `Table`+`Pagination` with `DataTable` (`tableId="academic-year-classes"`, `caption={t('detail.tabClasses')}`, `sorting={null}`, `onSortingChange={() => {}}`, `page`, `pageSize`, `totalCount={classes.total}`, `onPageChange={setPage}`). Columns: name `<Link to="/classes/$classId" params={{ classId: k.id }} className="font-medium text-text-primary hover:text-primary">`; grade `k.numeric_grade == null ? '—' : formatNumber(k.numeric_grade, regionConfig)`, `align: 'end'`. `rowActions={(k) => [{ intent: 'view', label: t('detail.classes.view'), to: `/classes/${k.id}` }]}`. `emptyState={{ icon: <SchoolIcon />, title: t('detail.classes.emptyMessage') }}` replaces the `<p>`.
4. **`fee-structures-tab.tsx`.** Same DataTable swap, `PAGE_SIZE = 25`, `tableId="academic-year-fee-structures"`; amount column `align: 'end'` (keep `formatServerAmount`); `emptyState={{ icon: <LayersIcon />, title: t('detail.feeStructures.emptyMessage') }}`.
5. **`terms-tab.tsx` panel.** Header `flex flex-col gap-3 md:flex-row md:items-end md:justify-between`: `<div><h2 className="text-h2">{heading}</h2><p className="mt-0.5 text-text-secondary">{t('detail.terms.subtitle')}</p></div>` + `Button variant="outline"` with `PlusIcon` + `t('detail.terms.addTerm')` (`w-full md:w-auto`). Empty: `EmptyState` (`calendar-range`, title `detail.terms.emptyMessage`, outline add action when `canManage`).
6. **Terms table.** Card `overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1`; `thead` `hidden border-b border-border-subtle bg-muted text-label text-text-secondary md:table-header-group`, `th h-10 px-4 font-medium`. Row `<tr className="flex flex-col hover:bg-muted md:table-row">`:
   - seq `hidden h-10 px-4 py-1 tabular-nums md:table-cell` = `formatNumber(term.seq, regionConfig)`;
   - name `block px-4 pt-3 md:table-cell md:h-10 md:py-1` with `font-medium` name and, `md:hidden`, `text-caption text-text-secondary` = `period · length`;
   - period `hidden … md:table-cell` = `formatDateRange(term.start_date, term.end_date, regionConfig)`;
   - length `hidden … text-end tabular-nums md:table-cell` = `t('detail.terms.weekCount', { count })`;
   - actions (only `canManage`) `block px-2 pb-1 md:table-cell md:h-10 md:py-1` → `flex justify-end`: ghost icon buttons `ArrowUpIcon` / `ArrowDownIcon` (icon-button classes `size-11 md:size-8 text-text-secondary`, existing aria-labels, disabled at the ends or while reordering) then `<RowActions actions={[{ intent: 'edit', label: t('detail.terms.edit'), onClick }, { intent: 'delete', label: t('detail.terms.delete'), onClick }]} />`.
   - Footer `<TableCount total={terms.length} />` in `border-t border-border-subtle px-4 py-3`.
7. **Term dialogs.** `TermFormDialog`: `DialogContent size="sm"`, `FormField` for name / start / end (required), dates side by side `grid gap-4 md:grid-cols-2`; replace `toLocalDateString` with `toIsoDate`; in `termServerErrorDetail` pass `yearStart: formatDate(details.yearStart, regionConfig)` and `yearEnd: formatDate(details.yearEnd, regionConfig)` (needs `regionConfig` argument). Delete-term `Dialog` → `ConfirmDialog tone="danger"` with the existing title / description / confirm keys and `deleteDialog.errorMessage` on failure.
8. **i18n** (`academicYears.json`, en + bn):

   | Key | bn | en |
   |---|---|---|
   | `detail.factPeriod` (**New**) | সময়কাল | Period |
   | `detail.classCount_one/_other` (**New**) | {{count}}টি | {{count}} class / {{count}} classes |
   | `detail.studentCount_one/_other` (**New**) | {{count}} জন | {{count}} student / {{count}} students |
   | `detail.feeStructureCount_one/_other` (**New**) | {{count}}টি | {{count}} fee structure / {{count}} fee structures |
   | `detail.classes.view` (**New**) | দেখুন | View |
   | `detail.terms.subtitle` (**New**) | পরীক্ষা ও ফলাফল এই পর্বগুলো ধরে ভাগ হয়। | Exams and results are grouped by these periods. |
   | `detail.terms.columnSeq` (changed) | ক্রম | No. |
   | `detail.terms.columnPeriod` (**New**) | সময়কাল | Period |

   Remove unused: `detail.tabStatistics`, `detail.statistics.errorMessage`, `detail.terms.columnStartDate`, `detail.terms.columnEndDate`, `detail.terms.columnActions`.

## Tests
- `$academicYearId.test.tsx`: no back link; h1 = `year.name`; facts show the long-form period and counts in Bangla digits; no "পরিসংখ্যান" tab; Edit is the only filled button; Set current shows only for a non-current year and opens a ConfirmDialog; Delete sits in the More menu.
- `-detail/terms-tab.test.tsx`: add button is outline; rows show one period range; up is disabled on the first row, down on the last; delete opens a ConfirmDialog; a 422 `TERM_OUTSIDE_ACADEMIC_YEAR` shows long-form dates, never `2026-01-01`.
- `-detail/-terms-tab-view.stories.tsx`: update the story to the new layout (data unchanged).
- e2e: no spec drives this page's selectors (`permissions.spec.ts` / `organisation-structure.spec.ts` only create years via API); re-run them.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No back link; h1 text equals the last crumb.
- [ ] Three tabs only; counts appear in the header facts.
- [ ] No red button in the header; Delete is in More.
- [ ] Terms, classes and fee-structure tables show a total and icon actions; no text-button actions.

## Out of scope
- Year form and delete dialog — restyled by academic-years-1 (runs earlier); used here unchanged.
- Terms tab label following the semester/trimester setting — would need a permission-safe settings read in the route; left as "টার্ম".

Wave: 9   Lane: academic-years   Decisions: D5, D6, D9, D16, D19, D20, D21, D25, D28, D29   Depends on: 31.3.8b, 31.4.academic-years-1
