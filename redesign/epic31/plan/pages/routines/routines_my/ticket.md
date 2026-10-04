# [31.4.routines-2] My routine — kit header, plain empty states

## Goal
`/routines/my` sits in the narrow PageContainer under a kit PageHeader, keeps its header visible while loading, shows kit EmptyStates for "you are not a teacher" and "nothing published yet", and never shows an id or an English subject name.

## What and why
This is a teacher's own week: today and the next six days, with their periods, the ones that are cancelled and the ones they cover for someone else. Today the page has its own `max-w-2xl` and padding, a small raw heading, grey sentences for the two empty cases (the admin in the audit only ever sees "no teacher record"), labels that fall back to raw ids, and English subject names on a Bangla screen. The redesign uses the kit's PageContainer, PageHeader, EmptyState and Skeleton, and fixes the labels; the agenda's own look (day tabs, day card, badges) is a shared component and is filed as a shared request, drawn in the mockup as the target.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_my/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_my/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_my/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_my/mobile.webp?raw=true" width="260"> |

(The "before" shot is the admin's no-teacher message; the "after" shows a teacher's normal day.)

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page frame | `PageContainer size="narrow"` + `PageHeader title={t('myRoutine.title')}` + **New** subtitle `myRoutine.subtitle`. Remove `max-w-2xl`, `p-4`, the raw `<h1>`. No actions. | D15, D16 |
| 2 | Loading | Header stays; body = skeleton shaped like the tab row + a card with 4 rows (`Skeleton` bars `h-3`, rows `h-14`), `aria-busy="true"`, sr-only `myRoutine.loading`. | D28 |
| 3 | Not a teacher | Grey sentence → `EmptyState` (icon `user-round-x`) **New** title `myRoutine.notATeacherTitle` + reworded explanation; outline action **New** "শ্রেণির রুটিন দেখুন" → `/routines`, only when `useHasPermission(Permission.ROUTINE_MANAGE)`. | D28, D32 ("শিক্ষক রেকর্ড" is system talk) |
| 4 | No published routine | Grey sentence → `EmptyState` (icon `calendar-clock`) **New** title `myRoutine.noRoutineTitle`, explanation existing, no action. | D28 |
| 5 | Error | `ErrorState` stays, now under the header (inside the container). | D28 |
| 6 | Labels | Subject = `subjectName()` from `./-subject-name` (Bangla name when set); section = "ষষ্ঠ শ্রেণি – ক" (en dash, same as the builder crumb); teacher / section / period not found → "—", never the id. | D9, D38 |
| 7 | Dates | `todayIso()` / `isoOf()` → `toIsoDate()` from `@biddaloy/ui/utils`. | B19 |

## Mobile behaviour
- Same single column; the header's subtitle wraps to two lines at most.
- EmptyState actions are full-width-friendly 44 px outline buttons.
- The agenda's phone look (tabs that scroll sideways, 44 px week toggle) comes with the shared request.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Agenda look | copy `RoutineAgenda` into the route and restyle · request the shared change | Shared request | `RoutineAgenda` is also used by `/portal/routine` (portal-5); one look for both, no duplicate |
| Container width | wide · narrow | `narrow` (`max-w-3xl`) | A reading page with one column of periods (D15) |
| Admin with no teacher record | plain message · message + link to the class routine | Link when the user can manage routines | Gives the admin (the audit's case) somewhere useful to go |

## Files
- `client-admin/src/routes/_staff/routines/my.tsx` — frame, states, labels, `toIsoDate`
- `client-admin/src/routes/_staff/routines/my.test.tsx` — updated
- `ui/src/i18n/locales/en/routines.json`, `ui/src/i18n/locales/bn/routines.json` — keys below (also changed by routines-1a and routines-1b, run earlier)

`client-admin/src/routes/_staff/routines/-subject-name.ts` is created by routines-1a and only imported here.

## Steps
1. **Locale keys** (en / bn). Add `myRoutine.subtitle` "Your periods today and over the next 6 days." / "আজ থেকে পরের ৭ দিনে আপনার পিরিয়ড।"; `myRoutine.notATeacherTitle` "No routine for you" / "আপনার জন্য কোনো রুটিন নেই"; `myRoutine.noRoutineTitle` "No routine published yet" / "এখনো রুটিন প্রকাশিত হয়নি"; `myRoutine.openClassRoutine` "See class routines" / "শ্রেণির রুটিন দেখুন". Change `myRoutine.notATeacherExplanation` → "Your account isn't linked to a teacher, so there are no periods to show." / "আপনার অ্যাকাউন্ট কোনো শিক্ষকের সাথে যুক্ত নয়, তাই এখানে দেখানোর মতো পিরিয়ড নেই।". (The `en` subtitle says "6 days" after today; the `bn` one counts today — both describe the same 7-day window.)
2. **`my.tsx`**: wrap every branch in `PageContainer size="narrow"` with the `PageHeader` first, so the h1 is present in loading / error / empty states too. Replace `MyRoutineSkeleton` with the shape in Change 2 (no `max-w-2xl`). `!ownTeacher` → `EmptyState` with `icon={<UserRoundX />}`, `title={t('myRoutine.notATeacherTitle')}`, `explanation={t('myRoutine.notATeacherExplanation')}`, `action={canManage ? { label: t('myRoutine.openClassRoutine'), onClick: () => navigate({ to: '/routines' }) } : undefined}` (`canManage = useHasPermission(Permission.ROUTINE_MANAGE)`). `!routine` → `EmptyState` with `icon={<CalendarClock />}`, `title={t('myRoutine.noRoutineTitle')}`, `explanation={t('myRoutine.noRoutineExplanation')}`.
3. Labels: `subjectName(subjectsQuery.data?.data.find(...), i18n.language)`; `teacherName` / `sectionLabel` / `periodLabel` fall back to `'—'`; `sectionLabel` = `` `${entry.className} – ${entry.sectionName}` ``.
4. Replace `todayIso` / `isoOf` with `toIsoDate(date)`; `agendaDates()` keeps its logic.
5. `MyRoutinePending` keeps `RoutePending variant="list"`.
6. Do not touch `RoutineAgenda` props or `agenda.*` keys (shared request).

## Tests
- `my.test.tsx`: h1 "My routine" is present while queries are pending (and `aria-busy` region); no teacher → EmptyState title + "See class routines" only when the user has `ROUTINE_MANAGE`; no published routine → its EmptyState title; an unknown subject/section id renders "—", never the id; Bangla subject name used when `name_bn` is set and the language is `bn`.
- `e2e/journeys/routine-agenda.spec.ts`: no change (tablist label, `todayLabel`, `emptyDay`, `cancelledLabel` keys unchanged).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (header, narrow container; agenda look once the shared request lands).
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (this page has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The h1 "আমার রুটিন" is visible in loading, error and empty states.
- [ ] Not-a-teacher and no-routine are kit EmptyStates.

## Out of scope
- Shared request filed: `ui/src/components/routine-agenda.tsx` look (kit line tabs with "আজ" / "সোম ৫", day card with the long date and a period count, week toggle in the card header, time column, StatusBadges for cancelled / covering). Until it lands the agenda keeps today's look inside the new frame.
- Room numbers show as typed (Latin digits — an identifier, D6).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| routine-agenda kit look: line-tab day switcher, day card, time column, StatusBadges | Accepted | 31.2.3b | no prop change; do NOT add agenda period-count / until keys — the agenda uses common.json routine.periodCount / routine.until |

Wave: 9   Lane: routines   Decisions: D5, D6, D9, D15, D16, D28, D32, D38   Depends on: 31.3.8b, 31.4.routines-1b
