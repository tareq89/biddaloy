# [31.4.portal-4] Portal calendar — month grid on every width, day panel beside it

## Goal
`/portal/calendar` shows the kit `MonthGrid` (with its own month header, "আজ", today selected) and a `DayPanel` for the selected day — beside the grid on desktop, under it on phone — in a wide container, matching the "after" screenshots.

## What and why
This page shows the school's events for the selected child's class, month by month, and what happens on a given day. Today the desktop shows only a grid with hard black lines and no way to see a day's details, the phone shows only a list (no grid), the month stepper floats above the card with a Latin year, and the page sits in a narrow left column. The redesign uses the shared calendar pattern from D26 on both widths.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_calendar/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_calendar/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_calendar/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_calendar/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageHeader` title = `nav:items.portalCalendar`, subtitle "<name> · <class> · রোল <n>" (events follow that child's class). | D16; makes the class filter visible |
| 2 | Layout | `PageContainer` (wide) instead of `max-w-3xl`. | D15: calendar is a wide page |
| 3 | Month controls | Remove the loose stepper; `MonthGrid`'s own header (month label, "আজ", prev / next) drives `?month=` through `onMonthChange` → `navigate`. | D26; month shown once, Back still walks months |
| 4 | Grid on phone | `MonthGrid` renders on every width (chips on desktop, dots on phone). `AgendaList` and the `hidden md:block` / `md:hidden` split are removed. | D26 (no grid/agenda split) |
| 5 | Day panel | **New on this page**: `DayPanel` for the selected day; `selectedDate` starts at today when the shown month is the current month, else the 1st of the shown month; clicking a day sets it. | D26: what is on a day, without leaving the page |
| 6 | Grid look | Grid lines, today ring, selected fill, weekly-off tint come from `MonthGrid` (31.2.3) — nothing page-side. | L18 black lines fixed centrally |

## Mobile behaviour
- One column: header, picker, grid card (header row `h-11` controls, cells ≥ 48 px with up to 3 dots), day panel under the grid.
- The bottom bar marks "আরও" (calendar is not a bottom-bar cell).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Phone view | agenda list (today); grid + day panel | grid + day panel | D26 |
| Selected day | URL param; component state | component state, reset on month / student change | a passing look, not a place; month and student stay in the URL |
| Default day outside the current month | none; 1st of month | 1st of month | the panel is never empty-headed; matches `MonthGrid`'s "defaults to today" in the current month |

## Files
- `client-admin/src/routes/portal/calendar.tsx` — header, layout, MonthGrid + DayPanel, remove stepper / AgendaList
- `client-admin/src/routes/portal/calendar.test.tsx` — updated assertions
- `client-admin/src/routes/portal/-portal-calendar-view.stories.tsx` — show MonthGrid + DayPanel instead of AgendaList
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — remove unused keys

## Steps
1. Wrap the loaded frame in `<PageContainer>`; `<PageHeader title={t('items.portalCalendar', { ns: 'nav' })} subtitle={`${selected.full_name} · ${studentMeta(selected)}`} />` (roll through `formatNumber`). Delete the `<h1>`, the stepper `div` with its two `Link`s, `useMonthNames`, `monthCaption` and every `max-w-3xl` (also in `CalendarSkeleton`). Empty frame: PageHeader + `EmptyState`.
2. Below the picker: `<div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">` with `<div className="min-w-0 flex-1"><MonthGrid month={month} today={toIsoDate(new Date())} selectedDate={selectedDate} onMonthChange={(m) => void navigate({ search: { student: selected.id, month: m } })} onDayClick={setPicked} firstDayOfWeek={settingsQuery.data.firstDayOfWeek} weeklyOffDays={settingsQuery.data.weeklyOffDays} events={monthGridEvents} weekdayLabels={…unchanged…} moreLabel={…unchanged…} /></div>` and `<DayPanel date={selectedDate} events={eventsOn(selectedDate)} />`. Remove the wrapping `Card className="p-3.5"` (MonthGrid and DayPanel are Cards themselves) and the `AgendaList` branch. Use `Route.useNavigate()`.
3. `selectedDate`: `const [picked, setPicked] = React.useState<string | null>(null)`; `selectedDate = picked ?? (month === currentMonthIso() ? toIsoDate(new Date()) : \`${month}-01\`)`; clear `picked` when `month` or `selected.id` changes (`useEffect` on both).
4. `eventsOn(date)`: `monthGridEvents.filter((e) => e.startDate <= date && (e.endDate ?? e.startDate) >= date)` (ISO string compare). `typeLabel` stays `t(\`calendar.types.${event.type}\`)` — it is the panel's second line.
5. If `DayPanel` renders nothing useful for an empty day (check after 31.2.3; see shared request), render after it nothing extra — the panel's own empty line is the contract. Do not add a page key for it.
6. Story: replace `AgendaList` with `MonthGrid` (`today`, `selectedDate="2026-09-08"`) + `DayPanel` in the same flex wrapper; use `formatMonth` instead of `attendanceGrid.months.9`.
7. Locale (en / bn): remove `calendar.previousMonth`, `calendar.nextMonth`, `calendar.today`, `calendar.agendaEmpty` (grep first; keep any key still referenced). Keep `calendar.types.*`, `calendar.weekdays.*`, `calendar.moreEvents_*`.

## Tests
- `calendar.test.tsx`: `heading` level 1 = "Calendar"; MonthGrid renders (one grid) on a narrow viewport too — no agenda list; the DayPanel title is today's `formatDate` in the current month and the 1st in another month; clicking a day with an event lists that event's name and type label in the panel; the prev/next/today controls change `?month=` (router location) and keep `?student=`; switching student refetches with the new `classId` (existing case); still no create/edit controls and no `dialog` (existing case).
- No e2e spec targets this page's selectors today.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] No filled primary button on this page (read-only).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Phone shows the month grid with dots and the selected day's events under it.
- [ ] Desktop shows the day panel to the right of the grid.
- [ ] "আজ" returns to the current month with today selected; Back walks month changes.

## Out of scope
- `MonthGrid` / `DayPanel` internals (lines, today ring, chips, dots, empty-day text) — 31.2.3; shared request filed for the empty-day line.
- `StudentPicker` restyle — shared request filed.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| student-picker chips restyled to kit tokens | Accepted | 31.2.14a | no prop change — place StudentPicker as today |
| DayPanel translated empty-day line | Accepted | 31.2.3a (key 31.1.2a dayPanel.empty) | nothing to pass; events=[] renders 'এই দিনে কোনো ইভেন্ট নেই।' |

Wave: 9   Lane: portal   Decisions: D5, D6, D9, D15, D16, D26, D28   Depends on: 31.3.8b, 31.4.portal-3
