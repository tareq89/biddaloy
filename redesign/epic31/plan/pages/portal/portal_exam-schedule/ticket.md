# [31.4.portal-5] Portal exam schedule and routine — readable dates, one day at a time

## Goal
`/portal/exam-schedule` shows one table per exam with long dates, 12-hour times, the subject in the reader's language and a "next exam" card; `/portal/routine` shows one day at a time behind a day tab row with no 403 toast and no raw ids, matching the four "after" screenshots.

## What and why
The exam page tells a guardian when and where each exam sits; the routine page tells them what the child has on a given day. Today the exam page prints `2026-02-05 · 09:00:00–11:00:00`, English subject names in Bangla and the subject id when a name is missing, and the routine page opens with a red "no permission" toast (B11), a cramped day-button row whose "দৈনিক দৃশ্য" toggle wraps, and subject names that would be ids for every family. The redesign uses the kit header, formatters, tables and tabs, puts the next sitting first, and lists one day's periods with their times.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — exam schedule | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_exam-schedule/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_exam-schedule/before-mobile.webp?raw=true" width="260"> |
| After — exam schedule | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_exam-schedule/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_exam-schedule/mobile.webp?raw=true" width="260"> |
| Before — routine | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_routine/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_routine/before-mobile.webp?raw=true" width="260"> |
| After — routine | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_routine/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_routine/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Both pages, top | `PageContainer` + `PageHeader` (title = the existing `examSchedule.title` / `routine.title`, which equal the nav labels; subtitle "<name> · <class> · রোল <n>", roll through `formatNumber`). Routine gains the subtitle. Remove every `max-w-2xl` and the hand-made `<h1>`. | D15, D16, D6 |
| 2 | Exam: layout | Wide container; `flex flex-col gap-6 md:grid md:grid-cols-3 md:items-start`; exam tables `md:col-span-2 md:order-1`, next-exam card `md:order-2` (phone: card first). | Next sitting is the first thing a guardian looks for |
| 3 | Exam: **New** next-exam card | Card: label "পরবর্তী পরীক্ষা", subject `text-h2` + "আজ" `StatusBadge` (info) when it is today, exam name, then a `dl` with icon rows (`calendar-days` date with weekday, `clock` time range, `map-pin` venue; venue row hidden when null). Hidden when no sitting is today or later. | One glance answers "what's next" |
| 4 | Exam: tables | One Card per exam (title `text-h2` = exam name, subtitle `formatDateRange(first, last)`), unpaginated `DataTable` with তারিখ (`formatWeekday` + `formatDate`), সময় (`formatTime` – `formatTime`), বিষয় (+ badge), স্থান (`—` when null); `TableCount` footer. Exams ordered by first sitting date; rows by date then start time. | D5, D7, D19; B21 (seconds) |
| 5 | Exam: row state | Past sitting (date < today): row `text-text-secondary` + neutral badge "শেষ হয়েছে" (**New** key). Today: row `bg-secondary` + info badge "আজ". | Can see the current state |
| 6 | Exam: subject name | Pick `name_bn` in Bangla, `name_en` in English (each falls back to the other); a row with no subject shows **New** `examSchedule.unknownSubject`, never `subject_id`. | D9, D32 |
| 7 | Exam: empty | `EmptyState` (icon `file-clock`, **New** title + sentence, no action) instead of a bare paragraph. | D28 |
| 8 | Routine: B11 | Remove `useSubjects({})` and `useTeachers({})` — both always 403 for families and fire the global toast. | B11 |
| 9 | Routine: day switcher | Replace the shared `RoutineAgenda` on this page with kit `Tabs` (line) inside one Card: 7 tabs from today, labels "আজ", then "<short weekday> <day number>" (`সোম ৫`); tab list `aria-label` stays `routines:agenda.daySwitcherLabel`. The week-view toggle is removed. | D20 look; toggle wrapped and duplicated what tabs do |
| 10 | Routine: day panel | Selected `TabsContent`: `h2` = `formatWeekday` + `formatDate`, count line "৬টি পিরিয়ড" (**New** key), then `ul.divide-y` rows: time block (`formatTime(start)` + "<end> পর্যন্ত", **New** key), subject `font-medium`, meta "পিরিয়ড n · <room>"; cancelled = subject `line-through` + danger badge "বাতিল"; substituted = warning badge "বদলি শিক্ষক" (**New** key). Off day = the existing holiday / weekly-off reason in a muted line; empty working day = `routines:agenda.emptyDay`. | D7, D27; one day at a time on a phone |
| 11 | Routine: subject name | Never render `subject_id`. Use the server's subject name when `ResolvedSlot` carries it (shared request); until then the row title is the period label. | D9 |
| 12 | Routine: not published | `PageHeader` + picker + `EmptyState` (icon `calendar-clock`, **New** title, explanation = existing `routine.noRoutineExplanation`). | D28 |
| 13 | Routine: width | Narrow `PageContainer` (`size="narrow"`, `max-w-3xl`). | D15: one day's list is a reading page |

## Mobile behaviour
- Exam: next-exam card on top; each table row becomes a two-line row — subject + badge on line 1, date on line 2, "time · venue" on line 3 (DataTable phone layout for an unpaginated list).
- Routine: the tab row scrolls sideways with the kit's right-edge fade; every tab is `h-11`; the time column is `w-24` (`md:w-32`).
- No sticky or floating controls; both pages have no primary button.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Next sitting | none; highlight row only; side card | side card + row highlight | answers the page's main question without scrolling |
| Routine look | wait for a shared `RoutineAgenda` restyle; route-local list with kit `Tabs` | route-local, kit `Tabs` + Card list | `RoutineAgenda` is shared (teacher `my.tsx` also uses it) and outside this lane; the portal list is ~60 lines of markup |
| Week view toggle | keep; remove | remove | every day is one tap away in the tab row; the toggle wrapped at 390 px |
| Selected day | URL param; component state | component state, defaults to today | a day is a passing look (same call as portal-3); `?student=` stays in the URL |
| Substitute badge | "covering for <teacher>" (needs `/teachers`, 403); plain "বদলি শিক্ষক" | plain badge | a guardian needs to know a substitute teaches, not who was absent |
| Container | wide; narrow | exam wide (table + side card), routine narrow | D15 by page type |

## Files
- `client-admin/src/routes/portal/exam-schedule.tsx` — header, layout, next-exam card, per-exam tables, formatters, subject name, empty state
- `client-admin/src/routes/portal/exam-schedule.test.tsx` — updated assertions
- `client-admin/src/routes/portal/routine.tsx` — header, remove subjects/teachers queries, Tabs + day panel, empty state
- `client-admin/src/routes/portal/routine.test.tsx` — updated assertions
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — new keys, remove `examSchedule.empty` (also changed by portal-1…4, run earlier)

## Steps
1. **Both pages.** Wrap the loaded frames in `<PageContainer>` (exam: default wide; routine: `size="narrow"`) and render `<PageHeader title={t('examSchedule.title')} subtitle={`${selected.full_name} · ${studentMeta(selected)}`} />` (routine: `routine.title`). In `useStudentMeta` pass `roll: formatNumber(student.roll_number, config)` with `const config = useRegionConfig()` (`@biddaloy/ui/i18n`). Loading / error frames keep their content; drop `max-w-2xl` from both skeletons. The no-children frame: PageHeader (title only) + the existing `EmptyState`.
2. **Exam — data.** `todayIso = toIsoDate(new Date())`. Group `scheduleQuery.data` by `row.exam.id` into `{ exam, rows }`, rows sorted by `date` then `starts_at` (keep today's comparator), groups sorted by their first row's date. `next` = first row over all groups with `row.date >= todayIso` (same sort), or `undefined`. Subject label helper: `const bn = i18n.language.startsWith('bn'); const subjectLabel = (r) => r.subject ? ((bn ? r.subject.name_bn || r.subject.name_en : r.subject.name_en || r.subject.name_bn) || t('examSchedule.unknownSubject')) : t('examSchedule.unknownSubject')`.
3. **Exam — layout.** `div.flex.flex-col.gap-6.md:grid.md:grid-cols-3.md:items-start`; first child (when `next`) `<Card asChild><aside className="p-4 md:order-2 md:p-5" aria-labelledby="exam-next-title">`: `h2#exam-next-title.text-label.text-text-secondary` `examSchedule.next.title`; `p.mt-1.flex.flex-wrap.items-center.gap-2` with `span.text-h2` subject + (`next.date === todayIso`) `<StatusBadge tone="info" label={t('today', { ns: 'common' })} />`; `p.text-text-secondary` exam name; `dl.mt-4.space-y-3.border-t.border-border-subtle.pt-4` with rows `div.flex.items-start.gap-3` → `dt.mt-0.5.text-text-secondary` (lucide `CalendarDaysIcon` / `ClockIcon` / `MapPinIcon`, `aria-hidden`, plus `span.sr-only` with `examSchedule.columns.date|time|venue`) and `dd` (`${formatWeekday(d, config)}, ${formatDate(d, config)}`; `${formatTime(start, config)} – ${formatTime(end, config)}`; venue — row omitted when `venue` is null). Second child `div.min-w-0.space-y-6.md:order-1.md:col-span-2` with one table card per group.
4. **Exam — table card.** `<Card className="overflow-hidden p-0" aria-labelledby={id}>`; header `div.px-4.py-3.md:px-5` with `h2.text-h2` = `group.exam.name` and `p.text-text-secondary` = `formatDateRange(first.date, last.date, config)`; then `<DataTable tableId={`portal-exam-${group.exam.id}`} caption={group.exam.name} paginated={false} data={group.rows} getRowId={(r) => r.id} columns={…} />`. Columns: `date` (`whitespace-nowrap`, weekday + date as in step 3), `time` (`whitespace-nowrap`, start – end), `subject` (`font-medium`; `span.flex.items-center.gap-2` with the label and the row badge), `venue` (`venue ?? '—'`). Row badge: `date < todayIso` → `<StatusBadge tone="neutral" label={t('examSchedule.done')} />`; `date === todayIso` → info badge `today`. Row class: past `text-text-secondary`, today `bg-secondary` (use DataTable's row class hook if it has one; otherwise apply on the cells). Phone row (DataTable card/compact layout): line 1 subject + badge, line 2 date, line 3 `${time} · ${venue ?? '—'}`.
5. **Exam — empty.** `rows.length === 0` → `<EmptyState icon={<FileClockIcon />} title={t('examSchedule.emptyTitle')} explanation={t('examSchedule.emptyExplanation')} />` under the header and picker (no action). Delete `ScheduleRow`.
6. **Routine — queries.** Delete `useSubjects`, `useTeachers`, `subjectsQuery`, `teachersQuery`, `subjectName`, `teacherName` and their imports and the comment about the 403 (B11). Replace `isoOf` / `todayIso` with `toIsoDate`. Keep `agendaDates`, `hasPublishableRoutine`, the pending/error handling and `holidayFor` / weekly-off logic as they are.
7. **Routine — subject.** `subjectLabel(slot)`: if the slot carries a server subject name (field added by the shared request — pick bn/en like step 2), use it; else `null`. Row title = `subjectLabel ?? periodLabel`; meta = `[subjectLabel ? periodLabel : null, roomLabel].filter(Boolean).join(' · ')`. Never fall back to `subject_id` or `period_slot_id` (make `periodLabel` fall back to `''` instead of the id). Period sequence via `formatNumber`.
8. **Routine — not published.** Replace the `<p>` frame with PageHeader + picker + `<EmptyState icon={<CalendarClockIcon />} title={t('routine.noRoutineTitle')} explanation={t('routine.noRoutineExplanation')} />`.
9. **Routine — day tabs.** Replace `PortalRoutineAgenda` / `RoutineAgenda` with route-local `PortalRoutineDays({ days })` (keep `RoutineAgendaDay` as the data shape or a local equivalent). `const [selected, setSelected] = React.useState(days[0]?.date ?? '')`, reset when the student changes (`key={selected.id}` on the component). Markup: `<Card className="overflow-hidden p-0" aria-labelledby="routine-day-title">` → `<Tabs value={selected} onValueChange={setSelected}>` → `<TabsList aria-label={tRoutines('agenda.daySwitcherLabel')}>` with one `TabsTrigger` per day, label `day.isToday ? t('today', { ns: 'common' }) : `${day.weekdayLabel} ${formatNumber(parseServerDate(day.date).getDate(), config)}``, `className="px-3"` (the list keeps the kit's sideways scroll and fade from 31.2.5b). Render only the selected `TabsContent` (`className="p-4 md:p-5"`).
10. **Routine — panel.** Inside `TabsContent`: `h2#routine-day-title.text-h2` = `${formatWeekday(day.date, config)}, ${formatDate(day.date, config)}`; `p.text-text-secondary` = `t('routine.periodCount', { count: day.items.length })` (hidden on an off day). Off day → `p.mt-3.border-t.border-border-subtle.pt-3.text-text-secondary` = `day.offReason`. No items → same line with `tRoutines('agenda.emptyDay')`. Else `ul.mt-3.divide-y.divide-border-subtle.border-t.border-border-subtle`, each `li.flex.items-start.gap-3.py-3` (+ `text-text-secondary` when cancelled): `div.w-24.shrink-0.tabular-nums.md:w-32` → `p.font-medium` `formatTime(startsAt)` + `p.text-caption.text-text-secondary` `t('routine.until', { time: formatTime(endsAt, config) })`; `div.min-w-0.flex-1` → `p.font-medium` title (+ `line-through` when cancelled) + `p.text-caption.text-text-secondary` meta; then the badge: cancelled `<StatusBadge tone="danger" label={tRoutines('agenda.cancelledLabel')} />`, else substituted `<StatusBadge tone="warning" label={t('routine.substitute')} />`. Drop `coveringForLabel` from the items.
11. **Routine skeleton**: header bars, one `h-11` bar for the tabs, three `h-14` rows, inside the narrow container.
12. **Locale (en / bn)**, all under `portal`:
    - `examSchedule.next.title` "Next exam" / "পরবর্তী পরীক্ষা"
    - `examSchedule.columns.date|time|subject|venue` "Date|Time|Subject|Venue" / "তারিখ|সময়|বিষয়|স্থান"
    - `examSchedule.done` "Finished" / "শেষ হয়েছে"
    - `examSchedule.unknownSubject` "Subject not set" / "বিষয় ঠিক করা হয়নি"
    - `examSchedule.emptyTitle` "No exam schedule yet" / "এখনও কোনো পরীক্ষার সময়সূচি নেই"; `examSchedule.emptyExplanation` "It appears here once the school publishes a complete schedule." / "স্কুল পুরো সময়সূচি প্রকাশ করলে এখানে দেখা যাবে।" — remove `examSchedule.empty`
    - `routine.noRoutineTitle` "No routine yet" / "রুটিন এখনও প্রকাশিত হয়নি"
    - `routine.periodCount_one` "{{count}} period" / "{{count}}টি পিরিয়ড"; `routine.periodCount_other` "{{count}} periods" / "{{count}}টি পিরিয়ড"
    - `routine.until` "until {{time}}" / "{{time}} পর্যন্ত"
    - `routine.substitute` "Substitute teacher" / "বদলি শিক্ষক"

## Tests
- `exam-schedule.test.tsx`: dates render long form with weekday and times without seconds (no `09:00:00`, no `2026-02-05`); two exams render two tables in first-date order; a sitting dated yesterday shows "Finished", today's shows "Today"; the next-exam card names the first sitting dated today or later and is absent when all are past; in `bn` the subject shows `name_bn`; a row with `subject: null` shows "Subject not set" (replace the "falls back to the subject id" case); empty data shows the `EmptyState` title; keep the picker, no-class, no-children and both error cases.
- `routine.test.tsx`: no request to `/subjects` or `/teachers` is made (MSW: fail the test if hit); the tablist named `routines:agenda.daySwitcherLabel` has 7 tabs, first "Today"; selecting another tab shows that day's heading; a cancelled slot shows the "Cancelled" badge and `line-through`; a substituted slot shows "Substitute teacher"; no subject or period-slot UUID appears in the document; the not-published frame shows the new title and `routine.noRoutineExplanation`.
- `e2e/journeys/routine-agenda.spec.ts` (portal block) asserts the tablist by `routines.agenda.daySwitcherLabel` or `portal.routine.noRoutineExplanation` — both are kept; no spec change needed. No e2e spec targets `/portal/exam-schedule`.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px (the tab row scrolls inside itself).
- [ ] No filled primary button on either page (read-only).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring; tabs move with arrow keys.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6, times D7.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route files (D15).
- [ ] Opening `/portal/routine` as a guardian shows no "no permission" toast.
- [ ] Exam: the next sitting is shown in its own card (top on phone, right on desktop); past rows are muted with "শেষ হয়েছে".
- [ ] Routine: one day visible at a time; no week-view toggle.

## Out of scope
- Shared request filed: `server/src/modules/routines` resolve response + `ui/src/hooks/routines.ts` `ResolvedSlot` — add the subject's name (bn + en). Until then the routine row title is the period label.
- `ui/src/components/routine-agenda.tsx` (teacher `my.tsx` still uses it; its time format is 31.2.3's B21 fix) — untouched.
- `StudentPicker` restyle — already requested by portal-2/3.
- Exam venue is free text from the school; shown as entered.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server subject names on resolved routine slots | Accepted | 31.3.7c | fields: ResolvedSlot.subject_name_en + subject_name_bn (ui/src/hooks/routines.ts updated) |

Wave: 9   Lane: portal   Decisions: D5, D6, D7, D9, D15, D16, D19, D20, D27, D28   Depends on: 31.3.8b, 31.4.portal-4
