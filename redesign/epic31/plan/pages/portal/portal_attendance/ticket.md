# [31.4.portal-3] Portal attendance — month header on the grid, day panel instead of dialog

## Goal
`/portal/attendance` shows one summary card, the month grid with its own header (month, "আজ", prev/next) and a selected-day panel beside it (under it on phone) instead of a dialog, and never shows "0%" for an unmarked month, matching the "after" screenshots.

## What and why
This page shows how one child attended in one month and what happened on a given day. Today the month name is printed twice (a loose stepper above, the grid caption below) with a Latin year, there is no way back to today, "0%" appears when nothing is marked, and a day's detail hides behind a dialog. The redesign puts the month controls on the grid (D26), lists the selected day's status and remarks next to the grid, and shows "—" until there is data.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_attendance/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_attendance/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_attendance/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_attendance/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageHeader` title = `nav:items.portalAttendance`, subtitle "<name> · <class> · রোল <n>". | D16 |
| 2 | Layout | `PageContainer` (wide); header, `StudentPicker`, summary card, then `flex flex-col gap-4 md:flex-row md:items-start md:gap-6` with the grid card (`min-w-0 flex-1`) and the day panel (`md:w-80 md:shrink-0`). Remove `max-w-2xl`. | D15, D26 layout |
| 3 | Summary card | One card: on desktop the rate on the left (`md:w-56`), the four counts in `grid-cols-4` on the right behind a `md:border-l`; on phone the rate on top and counts in `grid-cols-2`. Each count label has a status dot (present `bg-status-paid-fg`, absent `bg-status-overdue-fg`, late `bg-status-due-fg`, leave `bg-status-partial-fg`). Rate label reads "উপস্থিতির হার · <month>" (**New** key). | One glance; the month the numbers belong to is named |
| 4 | "0%" | Rate shows "—" + `attendance.summary.notEnoughData` when `attendance_percentage === null` **or** `present + absent + late + leave === 0`. | L18: "0%" for an unmarked month reads as "never came" |
| 5 | Month header | Remove the loose stepper above the summary. The grid card's first row is the kit month header: month label (`formatMonth`, `text-h3`), "আজ" (outline, links to the current month), prev / next icon links — all `Link`s rewriting `?month=` so Back still walks months. | D26; month was shown twice |
| 6 | Grid | `AttendanceMonthGrid` with today ringed, the selected day filled, weekly off days tinted and the legend under the grid (shared component change, 31.2.3 — see shared request). | D26 |
| 7 | Day detail | The `Dialog` is removed. **New** selected-day panel (Card): `formatDate(day)` `text-h3`, weekday `text-text-secondary`, then a `dl` with অবস্থা (`StatusBadge`), বিলম্বের মিনিট (only for late), মন্তব্য (when present), holiday name (when not a school day). Default selection: today when it is in the shown month, otherwise nothing selected and the panel says "দিনের বিবরণ দেখতে একটি দিন বাছুন" (**New** key). | D26: day info sits next to the grid, no extra click to close |
| 8 | Status words | Day status shown as `StatusBadge`: present success, late warning, absent danger, leave info, not a school day / not marked neutral. | D27 (today plain text in the dialog) |

## Mobile behaviour
- One column: header, picker, summary (rate on top, counts 2×2), grid card, day panel under the grid.
- Month header controls are `h-11` / `size-11`; grid cells are ≥ 48 px tall.
- Tapping a day updates the panel below; the page does not scroll by itself.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Day detail | dialog (today); panel beside / under grid | panel | D26; same shape as the calendar's DayPanel |
| Selected day state | URL param; component state | component state | a day is a passing look, not a place; month and student stay in the URL as today |
| Kit `DayPanel` | reuse it; own small card | own small card in the route (same classes) | `DayPanel` takes calendar events, not attendance fields |
| Month header | wait for the grid to own it; route renders it | route renders it with `Link`s now; drop it when 31.2.3 gives the grid a header (shared request) | keeps Back-button month history working without a shared change |

## Files
- `client-admin/src/routes/portal/attendance.tsx` — header, layout, summary, month header, day panel, remove dialog
- `client-admin/src/routes/portal/attendance.test.tsx` — updated assertions
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — new keys, remove `attendance.dialog.close`

## Steps
1. Wrap the loaded frame in `<PageContainer>`; `<PageHeader title={t('items.portalAttendance', { ns: 'nav' })} subtitle={`${selected.full_name} · ${studentMeta(selected)}`} />`; `roll` through `formatNumber`. Delete the `<h1>` and every `max-w-2xl` (also in `AttendanceSkeleton`). Empty frame: PageHeader + `EmptyState`.
2. Delete `useMonthNames` and `monthCaption`; use `formatMonth(month, config)` for the header label and for the `monthStepper` aria-labels (`attendance.monthStepper.previousLabel` / `nextLabel`, `{ month: formatMonth(previousMonth, config) }`).
3. `SummaryCard`: Card `p-4 md:p-5` → `div.flex.flex-col.gap-4.md:flex-row.md:items-center.md:gap-10`; left `div.md:w-56.md:shrink-0` with `<h2 className="text-label text-text-secondary">{t('attendance.summary.rateFor', { month: formatMonth(month, config) })}</h2>` and `p.mt-1.text-display.tabular-nums` (`formatNumber(pct)` + `%`, or `—`); right `dl.grid.flex-1.grid-cols-2.gap-4.border-t.border-border-subtle.pt-4.md:grid-cols-4.md:border-t-0.md:border-l.md:pt-0.md:pl-10`, each `dt.flex.items-center.gap-1.5.text-caption.text-text-secondary` with `span.size-2.rounded-full.<dot>` and `dd.text-h2.tabular-nums` (`formatNumber`). `noData = summary.attendance_percentage === null || summary.present_days + summary.absent_days + summary.late_days + summary.leave_days === 0` → "—" + `p.mt-0.5.text-text-secondary` `attendance.summary.notEnoughData`.
4. Grid card: `<Card className="min-w-0 flex-1 overflow-hidden p-0">`. If `@biddaloy/ui` `AttendanceMonthGrid` already accepts `today` / `selectedDate` / `onMonthChange` after 31.2.3 (check its props), pass `today={toIsoDate(new Date())}`, `selectedDate={selectedDay?.date}`, `onMonthChange={(m) => navigate({ search: { student: selected.id, month: m } })}` and render no header of your own. Otherwise render the header row yourself above the grid: `div.p-3.md:px-4 > div.flex.items-center.gap-1` with `h2.mr-auto.text-h3` (month label), `Link` "আজ" (`t('today', { ns: 'common' })`, outline button classes `inline-flex h-11 items-center justify-center rounded-md border border-border-functional bg-surface px-4 font-medium hover:bg-muted md:h-8 md:px-3`, `search={{ student, month: currentMonthIso() }}`), and two icon `Link`s (`inline-flex size-11 items-center justify-center rounded-md text-text-secondary hover:bg-muted md:size-8`, `ChevronLeftIcon` / `ChevronRightIcon`, existing aria-labels). Then `<AttendanceMonthGrid month days firstDayOfWeek onSelectDay={setSelectedDay} />` without the old `p-3.5` card padding.
5. Empty month (`days.length === 0`): keep the grid card with its header and put `attendance.noRecordsThisMonth` in `p.border-t.border-border-subtle.p-4.text-text-secondary` instead of the grid (no separate card).
6. Selected day: `const [selectedDate, setSelectedDate] = React.useState<string | null>(null)`; effective day = the clicked day, else today's cell when `search.month === currentMonthIso()`, else `null`. Reset the clicked day when `search.month` or `selected.id` changes (`key` on the panel or an effect).
7. Replace `DayDialog` with `DayPanel` (route-local function, name it `AttendanceDayPanel`): `<Card asChild><aside className="p-4 md:w-80 md:shrink-0 md:p-5" aria-labelledby="attendance-day-title">`; with a day: `h2#attendance-day-title.text-h3` = `formatDate(day.date, config)`, `p.text-text-secondary` = the weekday from the existing `attendanceGrid.weekdays.0`…`6` keys (seven literal `t()` calls in an array, indexed by `parseServerDate(day.date).getDay()`; short form "রবি" — the mockup's "রবিবার" is not worth seven new keys), then `dl.mt-3.divide-y.divide-border-subtle.border-t.border-border-subtle`: row `div.flex.items-center.justify-between.gap-3.py-3` অবস্থা + `StatusBadge tone label`, optional minutes-late row (`formatNumber`), remarks `div.py-3` (`dt.text-text-secondary`, `dd.mt-0.5`), holiday name row. Without a day: the title `h2` = `formatMonth(month)` and `p.text-text-secondary` `attendance.pickDay`. Tone map: `PRESENT→success`, `LATE→warning`, `ABSENT→danger`, `LEAVE→info`, not a school day / not marked → `neutral`; labels from the existing `attendanceGrid.status.*` keys via the same literal-key switch as today's `statusKey`.
8. Remove the `Dialog*` and `Button` imports.
9. Locale (en / bn): add `attendance.summary.rateFor` "Attendance rate · {{month}}" / "উপস্থিতির হার · {{month}}", `attendance.pickDay` "Pick a day on the calendar to see its details" / "দিনের বিবরণ দেখতে ক্যালেন্ডারে একটি দিন বাছুন". Remove `attendance.dialog.close`. Keep every `attendanceGrid.*` key — the shared `AttendanceMonthGrid` reads them.

## Tests
- `attendance.test.tsx`: `heading` level 1 = "Attendance"; "—" (not "0%") when `attendance_percentage` is `0` with all four counts `0`, and when it is `null`; month label rendered once (by `formatMonth`) as a heading in the grid card; "Today" link points at the current month; clicking a marked day shows its status badge, minutes late and remarks in the panel (replace the `findByRole('dialog')` case; assert `queryByRole('dialog')` is null); with the current month the panel shows today's date by default; another month shows the "Pick a day" line.
- No e2e spec targets this page's selectors today.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] No filled primary button on this page (read-only).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The month name appears once, inside the grid card, with Bangla digits in Bangla.
- [ ] "আজ" returns to the current month; Back walks month changes.
- [ ] Selecting a day updates the panel; no dialog opens.
- [ ] An unmarked month shows "—", never "0%".

## Out of scope
- Inside of `AttendanceMonthGrid` (today ring, selected fill, caption, cell look, legend) — 31.2.3; shared request filed.
- `StudentPicker` restyle — shared request filed.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| student-picker chips restyled to kit tokens | Accepted | 31.2.14a | no prop change — place StudentPicker as today |
| attendance-month-grid: MonthHeader, today ring, selected fill, weekly-off muted, sr-only caption, icon pills, legend inside | Accepted | 31.2.3b | <AttendanceMonthGrid month days today selectedDate onMonthChange onSelectDay /> — drop the page's own month-link header row |

Wave: 9   Lane: portal   Decisions: D5, D6, D9, D15, D16, D17, D26, D27, D28   Depends on: 31.3.8b, 31.4.portal-2
