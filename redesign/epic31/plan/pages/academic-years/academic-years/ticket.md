# [31.4.academic-years-1] Academic years list — names, periods, icon actions

## Goal
`/academic-years` shows a kit page header, a short unpaginated table of years with the year's own name, one period column in long dates, a status badge, counts in tenant digits and view / edit / delete icons; the year form and delete confirm use kit dialogs.

## What and why
The page is where an admin creates the school's academic years and sees which one is current; every class, fee structure and admission hangs off a year. Today the year column shows a number derived from the start date (not the name the admin typed, and not what the breadcrumb shows), dates are `২০২৬-০১-০১`, counts are Latin digits, actions are three underlined text links of different widths, and a 10-row pager sits under two rows. The redesign shows the name, one readable period, icons, and a total.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/academic-years/academic-years/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/academic-years/academic-years/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/academic-years/academic-years/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/academic-years/academic-years/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` "শিক্ষাবর্ষ" + **New** subtitle "একবারে একটি বর্ষ চলমান থাকে।"; primary "শিক্ষাবর্ষ যোগ করুন" (changed from "বর্ষ যোগ করুন") with `plus`. | D16, D32 |
| 2 | Year column | Header "শিক্ষাবর্ষ"; cell = `row.name` (link, `font-medium`, no underline) instead of `formatAcademicYear(start_date)`. | D16/D32 — list, crumb and detail title now show the same text |
| 3 | Period | Start and end columns merge into **New** "সময়কাল" = `formatDateRange(start, end)` → "১লা জানুয়ারি – ৩১শে ডিসেম্বর, ২০২৬". | D5; two long dates side by side wasted width |
| 4 | Status | Header "অবস্থা"; `StatusBadge domain="academicYear"` as today. | D27 |
| 5 | Counts | শ্রেণি / শিক্ষার্থী through `formatNumber`, `align: 'end'`; skeleton bar while each row's stats load (not "—"). | D6, D28 |
| 6 | Row actions | `rowActions`: view → detail, edit → year form, delete → confirm (manage only). "চলমান হিসেবে নির্ধারণ করুন" leaves the row (it stays on the detail header and as the form's checkbox). | D19 — three underlined links of varying width; set-current is rare |
| 7 | Table | `paginated={false}`, fetch `limit: 100`; footer "মোট ৩টি". | D19 — a school has a handful of years |
| 8 | Year form | `DialogContent size="md"`, FormField labels, both dates required-marked, `DatePicker` placeholder; dates sent with `toIsoDate` (local helper removed). | D21, D25, B19 |
| 9 | Delete confirm | `-delete-year-dialog.tsx` → `ConfirmDialog tone="danger"` naming the year. | D29 |
| 10 | Empty | `EmptyState` (`calendar-range`), title changed, **New** sentence, outline "শিক্ষাবর্ষ যোগ করুন"; the "move a whole school" sentence stays under it as text with an inline link. | D28 |

## Mobile behaviour
- Primary full width under the title.
- Rows become kit cards: name `text-h3` + status badge, period as subtitle, শ্রেণি / শিক্ষার্থী as two fields, action row "দেখুন · সম্পাদনা · মুছুন" with labels.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| What the year column shows | derived `formatAcademicYear(start)` / stored `name` | `name` | The breadcrumb resolver already shows `name`; D16 wants title = crumb; the admin chose that name. |
| Set current from the list | icon in row / detail only | detail only | Keeps every row's icons identical (view, edit, delete) and needs no More menu; the edit form's checkbox still sets it from here. |
| Paging | server pager 25 / unpaginated with limit 100 | unpaginated | One row per year; server max is 100 (`query-academic-year.dto.ts:15`). `ponytail:` comment in code. |
| Period | two columns / one range | one range | Same information, half the width, reads as a span. |

## Files
- `client-admin/src/routes/_staff/academic-years/index.tsx` — header, columns, rowActions, unpaginated fetch, empty state
- `client-admin/src/routes/_staff/academic-years/-year-form-dialog.tsx` — size, labels, `toIsoDate`
- `client-admin/src/routes/_staff/academic-years/-delete-year-dialog.tsx` — ConfirmDialog
- `ui/src/i18n/locales/bn/academicYears.json`, `ui/src/i18n/locales/en/academicYears.json` — keys below
- `client-admin/src/routes/_staff/academic-years/index.test.tsx` — update

## Steps
1. **Fetch.** `useAcademicYears({ limit: 100 })` with `// ponytail: one page of 100 years, add paging if a tenant ever has more`. Drop `useListShellState({ limit: 10 })` paging (keep `sorting` state only) and the `page`/`pageSize`/`totalCount`/`onPageChange`/`onPageSizeChange`/`pageSizeLabel`/`announceResults` props; pass `paginated={false}`.
2. **Header.** `ListShell` `subtitle={t('list.subtitle')}`; primary `Button` with `<PlusIcon />` + `t('list.addYear')`.
3. **Columns.**
   - `name`: header `t('list.columnYear')`; `<Link to="/academic-years/$academicYearId" params={{ academicYearId: row.id }} className="font-medium text-text-primary hover:text-primary">{row.name}</Link>`; `card: 'title'`.
   - `period` (**New**, replaces `start_date` + `end_date`): header `t('list.columnPeriod')`; `formatDateRange(row.start_date, row.end_date, regionConfig)`; `card: 'subtitle'`.
   - `is_current`: header `t('list.columnCurrent')`; badge unchanged; `card: 'badge'`.
   - `classes_count` / `students_count`: `align: 'end'`, `card: 'field'`; the two cell components return `stats.isPending ? <Skeleton className="ms-auto h-3 w-6" /> : formatNumber(stats.data?.classes_count ?? 0, regionConfig)` (same for students). Use `useRegionConfig()` inside the cells (the page already wraps in `RegionConfigProvider`).
   - Delete the hand-made `actions` column.
4. **Row actions.** `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/academic-years/${row.id}` }, { intent: 'edit', label: t('list.edit'), allowed: canManage, onClick: () => setEditing(row) }, { intent: 'delete', label: t('list.delete'), allowed: canManage, onClick: () => setDeleting(row) }]}`. Remove `settingCurrent` state, the `SetCurrentDialog` import and its render from this file (the detail page still uses it).
5. **Empty state.** `emptyState={{ icon: <CalendarRangeIcon />, title: t('list.emptyMessage'), explanation: t('list.emptyExplanation'), action: canManage ? { label: t('list.addYear'), onClick: () => setCreateOpen(true) } : undefined }}`. Keep the `isEmpty && canManageBackup` sentence; restyle to `text-text-secondary` and the link to `font-medium text-primary underline underline-offset-2` (link inside a sentence, D29); remove `mt-2 text-sm text-muted-foreground`.
6. **`-year-form-dialog.tsx`.** `DialogContent size="md"`; name / start / end in `FormField` with `required`; dates in `grid gap-4 md:grid-cols-2`; `DatePicker` keeps its default placeholder ("তারিখ বাছুন"); replace the local date-to-string helper (the one documented at line ~60) with `toIsoDate` from `@biddaloy/ui/utils`; checkbox in the kit Checkbox row. The inline "set as current" confirmation stays but is a kit `Card`-style notice (`rounded-md border border-border-subtle bg-muted p-3`) with outline Cancel + primary confirm — no `size="sm"` buttons.
7. **`-delete-year-dialog.tsx`.** Render `ConfirmDialog tone="danger"` with `title={t('deleteDialog.title')}`, `description={t('deleteDialog.description', { name })}`, `confirmLabel={t('deleteDialog.confirm')}`, `busy`, and on error show `t('deleteDialog.errorMessage')` (never the server message). Props unchanged (the detail page uses it too).
8. **i18n** (`academicYears.json`, en + bn):

   | Key | bn | en |
   |---|---|---|
   | `list.subtitle` (**New**) | একবারে একটি বর্ষ চলমান থাকে। | One year is current at a time. |
   | `list.addYear` (changed) | শিক্ষাবর্ষ যোগ করুন | Add academic year |
   | `list.columnYear` (changed) | শিক্ষাবর্ষ | Academic year |
   | `list.columnPeriod` (**New**) | সময়কাল | Period |
   | `list.columnCurrent` (changed) | অবস্থা | Status |
   | `list.view` (**New**) | দেখুন | View |
   | `list.emptyMessage` (changed) | এখনও কোনো শিক্ষাবর্ষ নেই | No academic years yet |
   | `list.emptyExplanation` (**New**) | শ্রেণি, ফি কাঠামো ও ভর্তি একটি শিক্ষাবর্ষের অধীনে থাকে — আগে একটি যোগ করুন। | Classes, fee structures and admissions belong to a year — add one first. |

   Remove unused: `list.columnStartDate`, `list.columnEndDate`, `list.columnActions`, `list.announceResults_one/_other`.

## Tests
- `academic-years/index.test.tsx`: name column shows `row.name` (not the derived number); period shows one long-form range; counts in Bangla digits; no pager and "মোট n টি" shown; edit/delete icons hidden without `ACADEMIC_YEAR_MANAGE`; delete opens a ConfirmDialog naming the year; empty list shows the EmptyState and, with `BACKUP_MANAGE`, the migrate sentence.
- `e2e/journeys/permissions.spec.ts`, `e2e/keyboard/organisation-structure.spec.ts`: re-run (they create years through the API, no list selectors). No edit expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Year column text equals the breadcrumb on the detail page.
- [ ] One "সময়কাল" column in long-form dates; no `২০২৬-০১-০১`.
- [ ] Every row has the same three icons; no underlined text actions.
- [ ] No pager; "মোট n টি" under the table.

## Out of scope
- Set-current confirm dialog and the detail page — academic-years-2.
- `formatAcademicYear` itself (shared util) — still used elsewhere; untouched.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: academic-years   Decisions: D5, D6, D16, D19, D21, D25, D27, D28, D29, D32   Depends on: 31.3.8b
