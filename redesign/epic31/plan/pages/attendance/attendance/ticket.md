# [31.4.attendance-1] Attendance + mark attendance — clear today list, calm roster

## Goal
`/attendance` shows today's sections as cards with a real status badge (unfinished first), and `/attendance/$sectionId` shows one header, a labelled date picker, a count strip, a roster card and one submit bar that never covers the sidebar or the phone bottom bar.

## What and why
`/attendance` is where a teacher picks the section to mark today; `/attendance/$sectionId` is where they mark every student and submit. Today the list is a full-width stack of plain rows with home-made pills in Latin digits and no hint of what is left, and the marking page has a sticky header that hides under the app top bar, an ISO date in the picker, a counts line without Leave, and a `fixed` submit bar that paints over the desktop sidebar and collides with the phone bottom bar. The redesign uses the kit's header, StatusBadge and Card patterns, sorts unfinished sections first, puts the counts in badges, and moves the submit bar into the content column.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — `/attendance` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance/before-mobile.webp?raw=true" width="260"> |
| After — `/attendance` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance/mobile.webp?raw=true" width="260"> |
| Before — mark attendance | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_sectionId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_sectionId/before-mobile.webp?raw=true" width="260"> |
| After — mark attendance | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_sectionId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_sectionId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | List — container + header | Wrap in `PageContainer`; `PageHeader` title "উপস্থিতি" + **New** subtitle "আজ ৪ঠা অক্টোবর, ২০২৬ · ৩টি শাখা বাকি" (or "…সব শাখার উপস্থিতি জমা হয়েছে"). No primary button — each card is the action. | D15, D16; "can I see the current state" |
| 2 | List — rows | Plain rows become link Cards in `grid gap-3 md:grid-cols-2 xl:grid-cols-3`: title `text-h3` "সপ্তম শ্রেণি – ক", subtitle "৩৮ জন শিক্ষার্থী", StatusBadge, `chevron-right`. | D17; 30 full-width rows on a 1440 screen |
| 3 | List — today state | Home-made `TodayPill` → `StatusBadge tone`: not marked = warning, draft = info, submitted = success "চিহ্নিত ৩৯/৪২". | D27, D6 |
| 4 | List — order | **New**: sections not yet submitted come first (not marked → draft → submitted), stable within each group. | One obvious next action |
| 5 | List — loading / empty / error | Skeleton shaped like 3 cards; EmptyState (icon `calendar-check-2`, outline action); ErrorState. `RoutePending` label translated. | D28, D9 |
| 6 | Mark — header | No sticky header. Title "সপ্তম শ্রেণি – ক" (same text as the last crumb) + **New** StatusBadge of the register state (চিহ্নিত হয়নি / খসড়া / জমা হয়েছে) + subtitle "১০ জন শিক্ষার্থী". Date picker sits right on desktop, full width under the title on phone, with a visible label "তারিখ" (today its aria-label wrongly read "উপস্থিতি"). | D16, D25, D32 |
| 7 | Mark — date | Picker shows `formatDate` ("৪ঠা অক্টোবর, ২০২৬"); the search param is written with `toIsoDate` (B19). | D5, B19 |
| 8 | Mark — counts | The "উপস্থিত 0 · …" text line becomes five StatusBadges in one `<p>`: উপস্থিত (success), অনুপস্থিত (danger), বিলম্বে (warning), **New** ছুটি (info), অচিহ্নিত (neutral). | D27; Leave was missing |
| 9 | Mark — toolbar | "সবাই উপস্থিত" outline with `check-check`, "রিসেট" ghost with `rotate-ccw`, in the roster card's top bar. Shortcut hint moves to the card's foot, `text-caption`, desktop only. | D29; less noise above the list |
| 10 | Mark — roster | Separate bordered boxes per student become one Card with `divide-y` rows; roll in `text-text-secondary`, name `font-medium`, the compact `AttendanceStatusControl` pill on the end. | D17 |
| 11 | Mark — submit bar | `fixed inset-x-0 bottom-0` (covers sidebar, collides with bottom bar) → a bar inside the content column, `sticky bottom-16 md:bottom-0`; "৩ জন অচিহ্নিত" + the one primary "উপস্থিতি জমা দিন" (renamed from "রেজিস্টার জমা দিন"). | D14, D29, D32 |
| 12 | Mark — read-only / future date | Banners become callouts with an icon (`info` / `calendar-clock`) above the roster card. | D28 look |
| 13 | Mark — load / error | `isPending` renders a roster-shaped Skeleton (today: blank); `isError` renders ErrorState with Retry (today: red text). | D28 |
| 14 | Mark — server errors | Toasts never show `error.message`; always the translated sentence (page + correction dialog). | D9 |
| 15 | Dialogs | Unmarked-confirm `size="sm"` with outline Cancel; history `size="md"` with `closeLabel`; conflict `size="lg"`; correction `size="md"`. History panel no longer prints a user id ("ব্যবহারকারী 7f3a… সংশোধন করেছেন"). | D21, D9 |

## Mobile behaviour
- List: one column of cards, each ≥ 64 px tall; whole card is the tap target.
- Mark: crumb row shows the last two crumbs; date field full width under the title; count badges wrap onto two lines; "সবাই উপস্থিত" is `flex-1`, "রিসেট" beside it.
- Mark: status pills stay 44 px; the submit bar sits just above the bottom bar (`sticky bottom-16`) with the primary filling the remaining width.
- Shortcut hint hidden.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Mark page as full-page modal | page / FullPageShell | page | D23 lists no such modal; it is reached from a list row, and the user may switch date or section mid-task. |
| Status control on desktop | `variant="expanded"` (4 inline buttons) / compact pill | compact pill at every width | The expanded variant fills the selected option with the primary colour, giving up to 40 filled buttons per page (D29); compact already supports row-click P⇄A and keys p/a/l/v. |
| Where the submit lives | page header / sticky bar | sticky bar in the content column | A 40-row roster scrolls the header away; the primary must stay reachable (D16). |
| Draft tone on the list | neutral (kit "draft") / info | info | Here "খসড়া" means "started, not submitted" — in progress, which the kit maps to info. |
| Unfinished-first sort | server order / client sort | client sort | No API change (D1); the list is ≤ ~40 items. |
| List as table | DataTable / cards | cards | 2 data points per row; cards are the whole tap target and read well at both sizes. |
| Counts in one `<p>` | separate tiles / badges in one paragraph | one `<p>` of badges | `e2e/pages/attendance-page.ts` (not ours) reads the counts from one `<p>`. |

## Files
- `client-admin/src/routes/_staff/attendance/index.tsx` — container, header, cards grid, StatusBadge, sort, states
- `client-admin/src/routes/_staff/attendance/index.test.tsx` — update
- `client-admin/src/routes/_staff/attendance/$sectionId.tsx` — header, date field, counts, toolbar, roster card, submit bar, states, dialog sizes, `toIsoDate`
- `client-admin/src/routes/_staff/attendance/$sectionId.test.tsx` — update
- `client-admin/src/routes/_staff/attendance/-roster-marker.tsx` — row markup inside one card
- `client-admin/src/routes/_staff/attendance/-correction-dialog.tsx` — `size="md"`, translated error toast
- `client-admin/src/routes/_staff/attendance/-correction-dialog.test.tsx` — error toast assertion
- `client-admin/src/routes/_staff/attendance/-conflict-dialog.tsx` — `size="lg"`
- `client-admin/src/routes/_staff/attendance/-record-history-panel.tsx` — no user id in the actor line
- `client-admin/src/routes/_staff/attendance/-record-history-panel.test.tsx` — update
- `ui/src/i18n/locales/bn/attendance.json` — keys below
- `ui/src/i18n/locales/en/attendance.json` — keys below
- `e2e/keyboard/attendance.spec.ts` — heading name (see Tests)

## Steps
1. **List page (`index.tsx`).**
   - Wrap every branch (pending, error, empty, list) in `<PageContainer>` from `@biddaloy/ui`; delete the `p-4` / `gap-3 p-4` wrappers.
   - Header: `<PageHeader title={t('list.title')} subtitle={subtitle} />`. `subtitle` = `pending > 0 ? t('list.subtitle', { date: formatDate(todayIso(), regionConfig), count: pending }) : t('list.subtitleDone', { date })`, where `pending = sections.filter(s => s.today?.state !== 'FINALIZED').length` and `regionConfig = useTenantRegionConfig()`.
   - Sort a copy: rank `!s.today` → 0, `DRAFT` → 1, `FINALIZED` → 2; `[...sections].sort((a, b) => rank(a) - rank(b))` (Array sort is stable).
   - Render `<section aria-labelledby="att-sections">` with `<h2 id="att-sections" className="sr-only">{t('list.caption')}</h2>` and `<ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">`. Each `<li>` holds the existing `Link` (same `to`, `params`, `search`) with classes `flex min-h-16 items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 no-underline hover:bg-muted md:p-5`. Inside: `<span className="min-w-0 flex-1">` with `<span className="block truncate text-h3">{t('mark.title', { className, sectionName })}</span>` and `<span className="mt-0.5 block text-text-secondary">{t('list.studentCount', { count: section.student_count })}</span>`; then the badge; then `<ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />`.
   - Replace `TodayPill`, `todayTone`, `TONE_CLASSES` with `<StatusBadge tone=… label=… />`: no `today` → `warning` + `t('list.notMarked')`; `DRAFT` → `info` + `t('list.draft')`; `FINALIZED` → `success` + `t('list.marked', { present, total })` (same sums as today). Remove the file comment paragraph about not using StatusBadge.
   - Pending branch: `<div aria-busy="true" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">` with three `Skeleton className="h-20 rounded-lg"`. `AttendanceListPending` → `<RoutePending variant="list" label={t('list.loadingLabel')} />` (use `useTranslation('attendance')`).
   - Empty: `EmptyState` gets `icon={<CalendarCheck2 />}` (action stays; it renders outline). Error: unchanged props.
2. **Mark page header (`$sectionId.tsx`).** Delete the sticky `div` (`sticky top-0 z-10 …`). Render inside `<PageContainer>`:
   - `<header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">`; left `<div className="min-w-0">`: `<div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h1 className="text-h1">{t('mark.title', …)}</h1>{stateBadge}</div>` and `<p className="mt-0.5 text-text-secondary">{t('list.studentCount', { count: students.length })}</p>`. Breadcrumbs come from the layout (31.3.5 resolves the section name).
   - `stateBadge`: `register.session.state === 'FINALIZED'` → `<StatusBadge tone="success" label={t('mark.stateFinalized')} />`; `register.session.id` (a saved draft) → `tone="info"` `t('list.draft')`; else `tone="warning"` `t('list.notMarked')`.
   - Right: `<FormField label={t('mark.dateLabel')} className="md:w-64">` around `DatePicker` (remove its `aria-label`). `onValueChange`: `search: (prev) => ({ ...prev, date: next ? toIsoDate(next) : date })` — `toIsoDate` from `@biddaloy/ui/utils` (B19; the picker trigger itself shows `formatDate` after 31.2.2).
3. **Callouts.** Read-only and future-date messages: `<p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-muted p-4 text-text-secondary">` with `<Info />` / `<CalendarClock />` (`size-4 mt-0.5 shrink-0`, `aria-hidden`) + the existing text. Place them between the header and the roster card.
4. **Roster card.** `<section aria-labelledby="m-roster" className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">` + `<h2 id="m-roster" className="sr-only">{t('mark.rosterHeading')}</h2>`:
   - Top bar `flex flex-col gap-3 border-b border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:px-5`. Left: `<p className="flex flex-wrap gap-2">` with five `StatusBadge`s — `success` `mark.presentCount`, `danger` `mark.absentCount`, `warning` `mark.lateCount`, `info` **New** `mark.leaveCount`, `neutral` `mark.unmarkedCount` (each `{ n }`). Right (only when `editable`): `<Button variant="outline" className="flex-1 md:flex-none"><CheckCheck />{t('mark.allPresent')}</Button>` (same `onClick`/`disabled`) and `<Button variant="ghost"><RotateCcw />{t('mark.reset')}</Button>`. Drop `size="sm"`.
   - Then `<RosterMarker … />` (no `px-4` wrapper).
   - Foot, only when `editable`: `<p className="hidden border-t border-border-subtle px-5 py-3 text-caption text-text-secondary md:block">{t('mark.shortcutHint')}</p>`.
5. **RosterMarker (`-roster-marker.tsx`).** `<ul className="divide-y divide-border-subtle">`; each `<li className="flex min-h-14 items-center gap-3 px-4 py-1.5 md:px-5">` directly holds the row button, the `AttendanceStatusControl` and `renderRowActions` (delete the inner bordered `div`). Row button: `flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`; roll `<span className="w-14 shrink-0 text-text-secondary">`; name `<span className="truncate font-medium">` (keep the `font-medium` span and the `li` — `e2e/pages/attendance-page.ts` finds rows by them). Keyboard model unchanged. The "Edited" pill in `renderRowActions` becomes `<StatusBadge tone="neutral" label={t('mark.editedBadge')} />` inside the tooltip trigger.
6. **Submit bar.** Replace the `fixed inset-x-0 bottom-0 …` div with `<div className="sticky bottom-16 z-20 flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-e2 md:bottom-0 md:px-5">` placed after the roster card (still only when `editable`): `<span className="shrink-0 text-text-secondary">{t('mark.unmarkedRemaining', { n })}</span>` and the primary `Button` with `<Send />`, `className="flex-1 md:ms-auto md:flex-none"` (drop `min-h-12`). Remove `pb-24` from the page root. Label logic (submitting / online / offline) unchanged.
7. **Loading and error.** `if (registerQuery.isPending)` → inside `PageContainer`: `Skeleton` bars `h-8 w-48`, then a Card with 6 `Skeleton className="h-14"` rows, region `aria-busy="true"`. `isError` → `<ErrorState message={t('mark.loadError')} retryLabel={t('list.retry')} onRetry={() => void registerQuery.refetch()} />`.
8. **Translated errors only.** In `doSubmit` and `handleKeepMine` `onError`: `toast.error(t('mark.errorToast'))` (drop the `error.message` branch). Same in `-correction-dialog.tsx:130` with `t('correction.errorToast')`.
9. **Dialogs.** Unmarked confirm: `<DialogContent size="sm">`, Cancel `variant="outline"` (order Cancel, "বাকিদের উপস্থিত চিহ্নিত করুন" outline, "যেভাবে আছে জমা দিন" primary). History: `<DialogContent size="md" closeLabel={t('history.close')}>`. `-conflict-dialog.tsx`: `size="lg"`. `-correction-dialog.tsx`: `size="md"`.
10. **History panel (`-record-history-panel.tsx:59`).** `t('history.entryActorUnknownName')` without `actorId`.
11. **i18n (`attendance.json`, bn + en).**

    | Key | bn | en |
    |---|---|---|
    | `list.subtitle` (**New**, `_one`/`_other` in en) | আজ {{date}} · {{count}}টি শাখা বাকি | Today, {{date}} · {{count}} section left / Today, {{date}} · {{count}} sections left |
    | `list.subtitleDone` (**New**) | আজ {{date}} · সব শাখার উপস্থিতি জমা হয়েছে | Today, {{date}} · every section is submitted |
    | `list.studentCount` (**New**, `_one`/`_other`) | {{count}} জন শিক্ষার্থী | {{count}} student / {{count}} students |
    | `mark.title` (changed) | {{className}} – {{sectionName}} | {{className}} – {{sectionName}} |
    | `mark.dateLabel` (**New**) | তারিখ | Date |
    | `mark.leaveCount` (**New**) | ছুটি {{n}} | Leave {{n}} |
    | `mark.stateFinalized` (**New**) | জমা হয়েছে | Submitted |
    | `mark.rosterHeading` (**New**) | শিক্ষার্থীর তালিকা | Students |
    | `mark.loadError` (**New**) | এই শাখার উপস্থিতি আনা যায়নি। | Could not load this section's attendance. |
    | `mark.submitOnline` (changed) | উপস্থিতি জমা দিন | Submit attendance |
    | `history.entryActorUnknownName` (changed) | একজন ব্যবহারকারী সংশোধন করেছেন | Corrected by a user |

    Remove keys no longer read: `list.columnSection`, `list.columnStudents`, `list.columnToday`.

## Tests
- `index.test.tsx`: three sections (finalized, none, draft) render in the order none → draft → finalized; badges read "Not marked" / "Draft" / "Marked 39/42"; the subtitle shows today's long date and "2 sections left"; each card is a link to `/attendance/<id>?date=<today ISO>`; all-finalized shows `subtitleDone`.
- `$sectionId.test.tsx`: h1 is "Class 6 – A"; the date field has the accessible name "Date"; picking a date navigates with an ISO `date` param (not the formatted text); counts include "Leave 1"; a FINALIZED register shows the "Submitted" badge; submit button reads "Submit attendance"; a 500 on submit toasts "Could not save attendance" and never the server message; a failed register load shows ErrorState with Retry; the submit bar does not carry `fixed`.
- `-correction-dialog.test.tsx`: server error shows `correction.errorToast`, not `error.message`.
- `-record-history-panel.test.tsx`: an entry with `performed_by_user_id` and no name renders "Corrected by a user" and no id.
- `e2e/keyboard/attendance.spec.ts` lines 99 and 114: the heading is now `${chain.className} – A` — match `getByRole('heading', { name: \`${chain.className} – A\` })`. Re-run; tab budget may shift by the two toolbar buttons only if they precede the roster (they do today too).
- `e2e/journeys/attendance.spec.ts` — run unchanged (page object keys `mark.allPresent`, `mark.submitOnline`, `mark.rollNumber` still resolve through `t()`).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] At most one filled primary per view (list: none; mark: the submit button only).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Unfinished sections are listed before submitted ones.
- [ ] Today's state on each card is a StatusBadge with an icon.
- [ ] The marking header scrolls with the page; nothing hides under the top bar.
- [ ] The date field shows "৪ঠা অক্টোবর, ২০২৬" and has a visible label.
- [ ] Counts show five badges including Leave.
- [ ] The submit bar stays inside the content column on desktop and above the bottom bar on phone.
- [ ] The history dialog never shows a user id.

## Out of scope
- UUID as last crumb on the mark page (B16) — 31.3.5 adds the `section` resolver ("Class 6 – A", same text as the new h1).
- `AttendanceStatusControl` look (`ui/src/components`) — unchanged; compact pill used everywhere.
- `e2e/pages/attendance-page.ts` `counters()` regex uses `\d` (Latin only) — unused by any spec; not ours.
- Sidebar label "প্রিন্টযোগ্য রেজিস্টার" in the mockup shell — renamed by 31.3.4a.
- No shared requests filed for this ticket.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: attendance   Decisions: D5, D6, D9, D14, D15, D16, D17, D21, D25, D27, D28, D29, D32   Depends on: 31.3.8b
