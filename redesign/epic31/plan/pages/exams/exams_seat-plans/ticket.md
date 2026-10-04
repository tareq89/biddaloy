# [31.4.exams-4a] Seat plans list + Generate seat plan as full page

## Goal
`/exams/seat-plans` is a kit list (status badges, counts in tenant digits, view action, total, page size 25, empty state) and "সিট প্ল্যান তৈরি করুন" opens a `FullPageShell` (`?generate=1`) with three labelled cards — plan details, subject sittings, rooms — that shows dates and times in long form, never an id, and opens the new plan when done. Part **a**; part **b** (`ticket-b.md`, runs after a) redesigns the plan detail page.

## What and why
Before each exam the exam controller makes a seat plan: picks the exam's subject sittings and the rooms, lets the system seat the students, then reviews and publishes it. Today the list shows status as plain text, underlined names, Latin-digit counts and a page size of 20; the generate dialog is a cramped modal with three scrolling boxes, sittings shown as `Mathematics — 2026-10-12 10:00:00–12:00:00`, rooms without a running seat total, server error strings, and a "conflict" notice that prints raw room and plan ids. The redesign makes the list a kit list and the form a full page (D21/D23: it holds two lists) with long dates, 12-hour times, a seat total, translated errors, and a conflict list with names.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before (list) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans/before-mobile.webp?raw=true" width="260"> |
| After (list) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans/mobile.webp?raw=true" width="260"> |
| Before (generate) | _not captured_ | _not captured_ |
| After (generate, full page) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans_generate/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans_generate/mobile.webp?raw=true" width="260"> |
| Before (detail, part b) | _not captured_ | _not captured_ |
| After (detail, part b) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans_planId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans_planId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` "সিট প্ল্যান", **New** subtitle "কোন শিক্ষার্থী কোন কক্ষে কোন আসনে বসবে — পরীক্ষার আগে তৈরি ও প্রকাশ করুন।", primary "সিট প্ল্যান তৈরি করুন" (`plus`), only with `SEAT_PLAN_MANAGE`. | D16 |
| 2 | Columns | নাম (link, no underline) · অবস্থা (**New** `SeatPlanStatusBadge`: DRAFT neutral "খসড়া", PUBLISHED success "প্রকাশিত") · **পরীক্ষার বিষয়** (was "বিষয় পরীক্ষা") · কক্ষ · শিক্ষার্থী — counts align end through `formatNumber`. | D6, D27, D32 |
| 3 | Row actions | `RowActions`: view "দেখুন" → `/exams/seat-plans/$planId`. | D19 |
| 4 | Footer | Default page size 25 (drop `limit: 20`), `TableCount`, kit pager (client-side slicing stays). | D19, B23 |
| 5 | Empty / error | `EmptyState` (`armchair`): "এখনো কোনো সিট প্ল্যান নেই" + "একটি পরীক্ষার বিষয় ও কক্ষ বেছে সিট প্ল্যান তৈরি করুন।" + outline "সিট প্ল্যান তৈরি করুন" (with `SEAT_PLAN_MANAGE`). Error → `ErrorState` + Retry. | D28 |
| 6 | Generate frame | `FullPageShell` (`size="form"`) instead of `Dialog`, still opened by `?generate=1` (palette action unchanged). Close / Esc ask before discarding once anything is filled; footer "বাতিল" (outline) left, "তৈরি করুন" (primary) right, disabled until name, ≥ 1 sitting and ≥ 1 room are chosen. | D21, D22, D23 |
| 7 | Card "প্ল্যানের তথ্য" | প্ল্যানের নাম* · পরীক্ষা* (Select, placeholder "বাছুন", option = "exam name · class name") · আসন ক্রম as a **radio group** with one help line each: "ক্রমানুসারে — শ্রেণি, শাখা ও রোল অনুযায়ী পরপর বসবে।", "এলোমেলো — আসন এলোমেলোভাবে দেওয়া হবে।". | D25 — a two-option select hid what the options mean |
| 8 | Card "পরীক্ষার বিষয়" | Checkbox rows (whole row 44 px): subject in the UI language + caption "১২ই অক্টোবর, ২০২৬ · সকাল ১০:০০ – দুপুর ১২:০০"; count line "২টি বাছাই করা হয়েছে"; ghost "সব বাছুন" / "সব বাদ দিন". Before an exam is chosen: "বিষয় দেখতে আগে পরীক্ষা বাছুন।" | D5, D7, D9, B21 — raw ISO date, seconds, English names |
| 9 | Card "কক্ষ" | Checkbox rows: room label + "৪০টি আসন" on the right; **New** summary "২টি বাছাই করা হয়েছে · মোট ৮০টি আসন"; "সব বাছুন". | Shows capacity before the server says "not enough seats" |
| 10 | Shortfall | Below the rooms card, `role="alert"` box (`rounded-lg border border-destructive bg-surface p-4 md:p-5`): the existing sentence with numbers through `formatNumber`, then each suggested room as a row (label + seats + outline "যোগ করুন", disabled once checked). Never a room id: a suggestion whose room is unknown is skipped. | D9 |
| 11 | Result | No conflicts → success toast and navigate to the new plan (`/exams/seat-plans/$planId`). With conflicts → the body becomes a Card: `StatusBadge tone="warning"` "সময় মিলে যাচ্ছে", the existing count sentence, and one line per conflict "প্রশাসনিক ভবন — ১০১ · একই সময়ে „প্রথম সাময়িক — আসন“ প্ল্যানেও আছে"; footer primary "প্ল্যান খুলুন", secondary "বন্ধ করুন". | D9 — raw ids today; the next step is reviewing the plan |
| 12 | Errors | Any other failure shows `errors.unknown`, never the server message. | D9 |

## Mobile behaviour
- List: header with full-width primary; rows as kit cards (name `text-h3` + badge, `dl` with পরীক্ষার বিষয় · কক্ষ · শিক্ষার্থী, action "দেখুন" with label); pager under the count.
- Generate: one column; cards full width; checkbox rows 44 px; footer buttons `h-11` left/right.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Frame | dialog / full page | full page on `?generate=1` | D23 lists "generate seat plan"; two selectable lists (D21). The search param keeps the palette action working. |
| After success | stay on the list / open the plan | open the plan | Reviewing seats, invigilators and publishing is the next step. |
| Seat order control | Select / radio group | radio group with help | Two options; the meaning of "এলোমেলো" was invisible. |
| Exam column on the list | add / leave out | leave out | `GET /seat-plans` has no exam field — shared request filed. |
| Seats needed vs selected | compute client-side / show seats selected only | seats selected only | The roster is computed by the server; the shortfall alert covers the rest. |
| Width | `form` / `wide` | `form` (`max-w-3xl`) | Checkbox lists read better narrow; nothing tabular. |

## Files
- `client-admin/src/routes/_staff/exams/seat-plans/index.tsx` — header, columns, badge, row action, page size, empty/error, renders the full page
- `client-admin/src/routes/_staff/exams/seat-plans/index.test.tsx`
- `client-admin/src/routes/_staff/exams/seat-plans/-generate-seat-plan-modal.tsx` — `FullPageShell`, cards, radio, formatting, shortfall, result, navigation
- `client-admin/src/routes/_staff/exams/seat-plans/-generate-seat-plan-modal.test.tsx`
- `client-admin/src/routes/_staff/exams/seat-plans/-seat-plan-status-badge.tsx` — **New** (also used by exams-4b)
- `ui/src/i18n/locales/{en,bn}/seatPlans.json` — keys below
- `e2e/journeys/seat-plans.spec.ts` — full page instead of dialog (also changed by exams-4b, runs later)

Used, not changed: `-detail/subject-label.ts` (exams-2a, `../-detail/subject-label`).

## Steps
1. **Locale `seatPlans.json` (en + bn).** Change: `list.columnScheduleCount` → "Exam subjects" / "পরীক্ষার বিষয়"; `generate.description` → "Choose which subjects of one exam and which rooms to seat. Seats can be changed afterwards." / "একটি পরীক্ষার কোন কোন বিষয়ের জন্য আর কোন কোন কক্ষে আসন সাজানো হবে, তা বেছে নিন। তৈরির পরে আসন বদলানো যাবে।"; `generate.examPlaceholder` → "Select" / "বাছুন"; `generate.schedulesLabel` → "Exam subjects" / "পরীক্ষার বিষয়"; `generate.schedulesPickExamFirst` → "Pick an exam to see its subjects." / "বিষয় দেখতে আগে পরীক্ষা বাছুন।"; `generate.schedulesEmpty` → "This exam has no schedule yet." / "এই পরীক্ষার এখনো কোনো সময়সূচি নেই।"; `generate.roomCapacity` → "{{capacity}} seats" / "{{capacity}}টি আসন"; `generate.seatOrderSequential` → "In order" / "ক্রমানুসারে"; `generate.conflictLine` → "{{room}} · also in “{{plan}}” at the same time" / "{{room}} · একই সময়ে „{{plan}}“ প্ল্যানেও আছে"; `generate.acknowledge` → "Open the plan" / "প্ল্যান খুলুন"; `generate.cancel` "Cancel" / "বাতিল" (same). Add: `list.subtitle` "Which student sits in which room and seat — make and publish it before the exam." / "কোন শিক্ষার্থী কোন কক্ষে কোন আসনে বসবে — পরীক্ষার আগে তৈরি ও প্রকাশ করুন।"; `list.view` "View" / "দেখুন"; `list.emptyTitle` "No seat plans yet" / "এখনো কোনো সিট প্ল্যান নেই"; `list.emptyText` "Pick an exam's subjects and rooms to make a seat plan." / "একটি পরীক্ষার বিষয় ও কক্ষ বেছে সিট প্ল্যান তৈরি করুন।"; `generate.detailsCard` "Plan details" / "প্ল্যানের তথ্য"; `generate.seatOrderSequentialHelp` "Seated one after another by class, section and roll." / "শ্রেণি, শাখা ও রোল অনুযায়ী পরপর বসবে।"; `generate.seatOrderRandomHelp` "Seats are given in random order." / "আসন এলোমেলোভাবে দেওয়া হবে।"; `generate.selectedCount` "{{count}} selected" / "{{count}}টি বাছাই করা হয়েছে"; `generate.roomsSummary` "{{count}} selected · {{seats}} seats in total" / "{{count}}টি বাছাই করা হয়েছে · মোট {{seats}}টি আসন"; `generate.selectAll` "Select all" / "সব বাছুন"; `generate.clearAll` "Clear all" / "সব বাদ দিন"; `generate.scheduleCaption` "{{date}} · {{from}} – {{to}}" (same in bn); `generate.conflictBadge` "Time clash" / "সময় মিলে যাচ্ছে"; `generate.otherPlan` "another plan" / "অন্য একটি প্ল্যান"; `generate.close` "Close" / "বন্ধ করুন". Delete `list.emptyMessage`, `generate.loading` (skeleton rows instead).
2. **`-seat-plan-status-badge.tsx`.** `export function SeatPlanStatusBadge({ status, ns = 'seatPlans' }: { status: 'DRAFT' | 'PUBLISHED'; ns?: string })` → `<StatusBadge tone={status === 'PUBLISHED' ? 'success' : 'neutral'} label={t(\`status.${status}\`, { ns })} />`.
3. **`index.tsx` — list.** `useListShellState()` without `{ limit: 20 }`; drop `pageSizeLabel` if the kit `DataTable` supplies it. `ListShell` `subtitle={t('list.subtitle')}`, primary as a `PageAction` (`plus`, `allowed: canManage`). Columns: `name` (`Link` `font-medium hover:text-primary`, `card: 'title'`), `status` (`<SeatPlanStatusBadge status={row.status} />`), `scheduleCount` / `roomCount` / `studentCount` (align end, `formatNumber(…, config)`). `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: \`/exams/seat-plans/${row.id}\` }]}`. `emptyState` per Change 5 (action only with `canManage`, opens `?generate=1`); error with `onRetry={() => void seatPlansQuery.refetch()}`. Render `{canManage && search.generate === '1' && <GenerateSeatPlanModal onClose={() => setGenerateOpen(false)} />}` (the component now mounts only while open, so its state resets by itself — delete the `reset()` plumbing).
4. **`-generate-seat-plan-modal.tsx` — frame.** Props `{ onClose: () => void }`. Wrap in `FullPageShell` `title={t('generate.title')}` `size="form"` `dirty={name.trim() !== '' || examId !== '' || selectedSchedules.size > 0 || selectedRooms.size > 0}` `onClose={onClose}` `secondary={{ label: t('generate.cancel'), onClick: onClose }}` `primary={{ label: t('generate.submit'), onClick: submit, busy: generate.isPending, disabled: !canSubmit }}`. In the result state: `primary={{ label: t('generate.acknowledge'), onClick: openPlan }}`, `secondary={{ label: t('generate.close'), onClick: onClose }}`, `dirty={false}`.
5. **Card "প্ল্যানের তথ্য".** Card classes, `h2 text-h2`, `mt-4 grid gap-4 md:grid-cols-2`: `FormField` নাম (required mark, `Input`), `FormField` পরীক্ষা (required mark, `Select`, items `` `${exam.name} · ${exam.class?.name ?? ''}` `` — trim the separator when no class), `fieldset md:col-span-2` with `legend` "আসন ক্রম" and `RadioGroup` (`grid gap-x-6 md:grid-cols-2`), each item a row `flex min-h-11 items-start gap-3 py-2 md:min-h-8` with label + help (`text-caption text-text-secondary`).
6. **Card "পরীক্ষার বিষয়".** Head `flex items-start justify-between gap-3`: `h2` + required mark, `p mt-1 text-text-secondary` `selectedCount`, ghost button (`inline-flex h-11 items-center rounded-md px-2 text-label font-medium text-primary hover:bg-muted md:h-8`) toggling all/none. Keep `data-testid="schedule-picker"` on the `ul mt-3 divide-y divide-border-subtle`. Row: `Checkbox` inside a `label` `flex min-h-11 w-full items-center gap-3 py-2 md:min-h-8`; text = `schedule.subject ? subjectLabel(schedule.subject, i18n.language) : '—'` (never `schedule.id`), caption `scheduleCaption` with `formatDate(schedule.date, config)`, `formatTime(schedule.starts_at, config)`, `formatTime(schedule.ends_at, config)`. Checkbox `aria-label` = the subject text. Pending → three skeleton rows; empty / pick-first → `p text-text-secondary`.
7. **Card "কক্ষ".** Same head with `roomsSummary` (`seats` = sum of `capacity ?? 0` of checked rooms, `formatNumber`). Keep `data-testid="room-picker"`. Row: checkbox + `roomLabel(room)` + `span ms-auto shrink-0 text-text-secondary` `roomCapacity` (`formatNumber`). Empty → `generate.roomsEmpty`.
8. **Shortfall and errors.** Shortfall box per Change 10 below the rooms card; `shortfallMessage` values through `formatNumber`; suggestions mapped through `rooms.find`, skip unknown; button outline `h-11 md:h-8` "যোগ করুন" → `toggleRoom(id, true)`. Any other error: `p role="alert"` kit error text with `t('errors.unknown')`.
9. **Result.** `onSuccess`: no conflicts → `notifyOutcome(success)` then `navigate({ to: '/exams/seat-plans/$planId', params: { planId: data.plan.id } })` (this also drops `?generate`). Conflicts → keep the data in state and render one Card: `StatusBadge tone="warning" label={t('generate.conflictBadge')}`, `p mt-2` `conflictsNotice` (count through i18n plural), `ul mt-3 divide-y divide-border-subtle`, each `li py-3` = `conflictLine` with `room` = `roomLabel(rooms.find(...))` (fallback `—`) and `plan` = name from `useSeatPlans().data` by `conflicting_seat_plan_id` (fallback `generate.otherPlan`). `openPlan` navigates as above.
10. **`e2e/journeys/seat-plans.spec.ts`.** After clicking `list.generateButton`, expect the full page: `getByRole('heading', { level: 1, name: t('seatPlans.generate.title') })` instead of `getByRole('dialog')`. Sitting checkboxes: name = the subject's label in the e2e locale (`name_bn` when the fixture sets one, else `name_en`). After submit, expect the plan detail heading `planName` (the page now navigates there) instead of `dialog` hidden + the name in the list.
11. Run `pnpm --filter client-admin test seat-plans/index seat-plans/-generate`, then `graphify update .`.

## Tests
- `index.test.tsx` — status renders as a badge with the translated label; counts in tenant digits; view action links to the plan; default page size 25 (26 plans → "১–২৫ দেখানো হচ্ছে, মোট ২৬"); empty state shows `list.emptyTitle`; `?generate=1` renders the full page heading.
- `-generate-seat-plan-modal.test.tsx` — sitting row shows the long date and 12-hour time (no `:00:00`, no ISO date); primary disabled until name + sitting + room; rooms summary sums capacity; shortfall lists suggested rooms by label and "যোগ করুন" checks the room; a generic failure shows `errors.unknown`; conflicts render room labels and plan names (no ids); success without conflicts navigates to `/exams/seat-plans/<id>`; Close after typing a name asks before discarding.
- `e2e/journeys/seat-plans.spec.ts` — as in Step 10.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Status is a coloured badge; counts use tenant digits; page size 25.
- [ ] Generate is a full page with a visible Close and a footer; the palette's "Generate seat plan" still opens it.
- [ ] Sittings read "১২ই অক্টোবর, ২০২৬ · সকাল ১০:০০ – দুপুর ১২:০০".
- [ ] A conflict line names the room and the other plan.

## Out of scope
- Exam name column on the list — needs `exam_name` in `GET /seat-plans` (shared request).
- Deleting a seat plan (no API).
- Plan detail → `ticket-b.md` (exams-4b).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server exam_name on GET /seat-plans rows | Deferred | — | use the fallback in the ticket (no exam column) |
| server sittings with bn name, date, time on GET /seat-plans/:id | Accepted | 31.3.7b | no schedules[] array: each allocation row gains subject_name_bn, exam_date ('YYYY-MM-DD'), starts_at, ends_at ('HH:mm:ss'); build the sitting label from the first row per exam_schedule_id (bn name when the UI is bn, else subject_name; caption formatDate + formatTime range) |

Wave: 9   Lane: exams   Decisions: D5, D6, D7, D9, D16, D19, D21, D22, D23, D25, D27, D28   Depends on: 31.3.8b, 31.4.exams-3b
