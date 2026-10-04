# [31.4.students-6b] Student detail Attendance, Results, Homework, Performance tabs — readable figures

## Goal
The student's "উপস্থিতি", "ফলাফল", "বাড়ির কাজ" and "পারফরম্যান্স" tabs show a month label instead of `2026-10`, numbers in the tenant's digits, results as a kit table with status badges and a link to the result, and kit Card/label styles — in the same card look as students-6a's Enrollment tab.
b runs after a (students-6a); no shared files except `students.json`.

## What and why
These tabs show how the student is doing. Today Attendance's month stepper reads `2026-10` between two 36 px buttons with no way back to the current month; summary labels use an arbitrary `text-[11px]`; Results is a hand-built table with GPA as `3.50` in Latin digits, "not published" as a hand-made outline pill and no way to open the result; Homework's empty state is a bare line. The redesign uses the MonthHeader layout (label + "এই মাস" + icon prev/next), `formatMonth`/`formatNumber`, `DataTable` (unpaginated) with `StatusBadge` and a `view` RowAction, and `EmptyState`.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_enrollment/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_enrollment/mobile.webp?raw=true" width="260"> |

The shot is the Enrollment tab (students-6a); these tabs use the same Card, table row and footer styles.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Attendance month row | MonthHeader layout: month label `text-h3` = `formatMonth(month)` ("অক্টোবর ২০২৬") on the left; outline "এই মাস" (**New**, disabled on the current month) + icon buttons `chevron-left` / `chevron-right` (`size-11 md:size-8`) on the right. | D5, D26 header, 44 px. |
| 2 | Attendance summary | Card `p-4 md:p-5`: "উপস্থিতি" label + `formatNumber(pct)` + "%" in `text-h1`; four figures in `dl grid grid-cols-4` with `text-caption` labels (was `text-[11px]`). | Tokens only; D6. |
| 3 | Attendance grid | `AttendanceMonthGrid` in `<Card padded>`; empty month → `EmptyState` (icon `calendar-x`, title `detail.attendanceTab.noRecordsThisMonth`, one sentence). | D28. |
| 4 | Results table | `DataTable paginated={false}`: পরীক্ষা · গ্রেড · জিপিএ (`formatNumber(gpa, { decimals: 2 })`, end) · অবস্থা (StatusBadge success "প্রকাশিত" / warning "প্রকাশিত হয়নি"); a failed result adds a danger StatusBadge "ফেল" next to the exam name; RowAction `view` → `/results/$examId/$studentId` (**New** link). Footer "মোট n টি". | D6, D19, D27. |
| 5 | Results empty / error | `EmptyState` (icon `award`) and `ErrorState` with a Retry label. | D28. |
| 6 | Homework | Card `p-4 md:p-5`; completion % in `text-h1` with `formatNumber`; three figures with `text-caption` labels; empty → `EmptyState` (icon `notebook-pen`). | D6, D28. |
| 7 | Performance | Print button stays outline (`printer`), aligned right in `flex justify-end`; `noYear` → `EmptyState`; numbers keep `renderDigits` (already tenant digits). No layout change to the shared `SummaryCard` / `BarWidget`. | D28; shared widgets are not this lane's. |

## Mobile behaviour
- Month row: label left, three 44 px buttons right; label truncates before the buttons wrap.
- Attendance figures stay four columns; Homework three.
- Results become two-line rows: exam name + status badge, then "গ্রেড A · জিপিএ ৩.৫০"; view shows icon + label.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Month control | MonthPicker trigger · MonthHeader-style stepper | Stepper with "এই মাস" | Students page through recent months one at a time; same header shape as the shared MonthGrid (D26). |
| Fail marker | red text · badge | danger StatusBadge "ফেল" | D27 — status is always a badge. |
| Result link | none · view action | `view` → result detail | The result page exists (`/results/$examId/$studentId`); staff otherwise retype the exam and student. |

## Files
- `client-admin/src/routes/_staff/students/-detail/attendance-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/attendance-tab.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/results-panel.tsx`
- `client-admin/src/routes/_staff/students/-detail/results-panel.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/homework-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/homework-tab.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/performance-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/performance-tab.test.tsx`
- `ui/src/i18n/locales/bn/students.json` — keys below (also changed by students-1…6a, run earlier)
- `ui/src/i18n/locales/en/students.json` — same keys

## Steps
1. **`attendance-tab.tsx` month row.** Replace the three-element stepper with `<div className="flex items-center justify-between gap-2"><h2 className="min-w-0 truncate text-h3">{formatMonth(month, config)}</h2><div className="flex shrink-0 items-center gap-1"><Button variant="outline" disabled={month === currentMonthIso()} onClick={() => setMonth(currentMonthIso())}>{t('detail.attendanceTab.monthStepper.thisMonth')}</Button><Button variant="ghost" size="icon" aria-label={…previousLabel} onClick={…}><ChevronLeftIcon /></Button><Button variant="ghost" size="icon" aria-label={…nextLabel} onClick={…}><ChevronRightIcon /></Button></div></div>` (icon buttons are `size-11 md:size-8` via the shared Icon-button size). Keep the stepper visible during loading (render it above the skeleton) so the user can step back after an error.
2. **Summary.** `Card` with `padded`; percentage `<p className="text-h1 tabular-nums">{pct === null ? '—' : \`${formatNumber(pct, config)}%\`}</p>`; `SummaryFigure` `dt` → `text-caption text-text-secondary`, value via `formatNumber`. Delete `renderDigits` use here.
3. **Grid / empty.** Grid in `<Card padded>`; empty → `<EmptyState icon={<CalendarXIcon />} title={t('detail.attendanceTab.noRecordsThisMonth')} explanation={t('detail.attendanceTab.noRecordsExplanation')} />`.
4. **`results-panel.tsx`.** `DataTable tableId="student-results" caption={t('studentResultsPanel.caption')} paginated={false}` with columns: `exam` (name + `{row.is_fail && <StatusBadge tone="danger" label={t('studentResultsPanel.failTag')} />}`), `grade`, `gpa` (`formatNumber(row.gpa, rc, { decimals: 2 })`, `align: 'end'`), `status` (`row.published ? <StatusBadge tone="success" label={t('studentResultsPanel.published')} /> : <StatusBadge tone="warning" label={t('studentResultsPanel.notPublished')} />`); card subtitle `t('detail.results.cardSubtitle', { ns: 'students', grade, gpa })`; `rowActions={(row) => [{ intent: 'view', label: t('detail.results.view', { ns: 'students' }), to: \`/results/${row.exam_id}/${studentId}\` }]}`. Loading → `SkeletonTable rows={3} columns={4}`; error → `ErrorState` with `retryLabel={t('actions.retry', { ns: 'common' })}`; empty → `EmptyState` (title `studentResultsPanel.empty`, explanation `detail.results.emptyExplanation`, icon `AwardIcon`).
5. **`homework-tab.tsx`.** `Card padded`; heading stays an `h2` with `text-caption text-text-secondary`; figure `text-h1`; `SummaryFigure` labels `text-caption`; values `formatNumber`. Empty → `EmptyState` (icon `NotebookPenIcon`, title `detail.homeworkTab.emptyMessage`, explanation `detail.homeworkTab.emptyExplanation`).
6. **`performance-tab.tsx`.** `noYear` → `<EmptyState title={t('noYear')} />`; print row `flex justify-end print:hidden` (unchanged behaviour). Nothing else.
7. **i18n** (`students.json`, bn / en):
   - add `detail.attendanceTab.monthStepper.thisMonth` "এই মাস" / "This month"
   - add `detail.attendanceTab.noRecordsExplanation` "এই মাসে উপস্থিতি নেওয়া হলে এখানে দেখা যাবে।" / "Attendance taken this month will show up here."
   - add `detail.results.view` "ফলাফল দেখুন" / "View result"; `detail.results.cardSubtitle` "গ্রেড {{grade}} · জিপিএ {{gpa}}" / "Grade {{grade}} · GPA {{gpa}}"; `detail.results.emptyExplanation` "কোনো পরীক্ষার নম্বর দেওয়া হলে ফলাফল এখানে দেখা যাবে।" / "Results appear once marks are entered for an exam."
   - add `detail.homeworkTab.emptyExplanation` "বাড়ির কাজ দেওয়া হলে অগ্রগতি এখানে দেখা যাবে।" / "Progress shows up once homework is set."

## Tests
- `attendance-tab.test.tsx`: label reads "অক্টোবর ২০২৬" (not `2026-10`); "এই মাস" disabled on the current month and resets after stepping back; percentage in Bangla digits; empty month shows the EmptyState.
- `results-panel.test.tsx`: GPA "৩.৫০"; unpublished row has the warning badge; failed row has "ফেল" badge; view link points to `/results/:examId/:studentId`.
- `homework-tab.test.tsx`: figures in tenant digits; empty state title + sentence.
- `performance-tab.test.tsx`: no-year path renders the EmptyState heading.
- E2E: `e2e/keyboard/homework-detail-tabs.spec.ts` (tab by name), `e2e/journeys/evaluations-tail.spec.ts` (`?tab=performance`), `e2e/journeys/attendance.spec.ts` — run; no selector change expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot's card and table style.
- [ ] Mobile at 390 px matches the "after" screenshot's row style; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (the header's).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Attendance shows "অক্টোবর ২০২৬" with "এই মাস" and two icon buttons.
- [ ] Results show badges for status and fail, and open the result page.
- [ ] No `text-[11px]` left in these files.

## Out of scope
- `AttendanceMonthGrid`, `SummaryCard`, `BarWidget` (shared `ui` components) — unchanged.
- `exams.json` / `performance.json` wording — exams and staff lanes.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| promotions.json badge.* without "ওভাররাইড" | Accepted | 31.3.4b | badge.promote/retain/graduate start "বিশেষ বিবেচনায় উত্তীর্ণ / … একই শ্রেণিতে / … পাস সম্পন্ন"; same keys and placeholders |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: students   Decisions: D5, D6, D19, D26, D27, D28   Depends on: 31.3.8b, 31.4.students-6a
