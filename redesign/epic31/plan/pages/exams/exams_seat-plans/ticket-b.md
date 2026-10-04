# [31.4.exams-4b] Seat plan detail — facts header, one sitting, room cards

## Goal
`/exams/seat-plans/$planId` opens with a kit detail header (name, status badge, four facts, "সিট প্ল্যান প্রকাশ করুন" as the only primary while it is a draft), a picker for which subject sitting to look at, and one Card per room with a labelled invigilator field, "আসন আবার সাজান" behind a confirm, and a kit table of seats sorted by seat number. Part **b**; runs after `ticket.md` (exams-4a).

## What and why
After generating a plan the exam controller checks each room, moves a few students, assigns an invigilator per room and publishes the plan. Today the page starts with an underlined back link, shows the status as plain text, keeps a filled Publish button even after publishing (disabled), mixes every subject sitting of the plan in one room list (a student appears once per subject), sorts seats as text ("10" before "2"), shows the invigilator picker without a visible label, reshuffles a room with one click and no warning, and shows server error strings in the dialogs. The redesign adds the detail header and facts, one sitting at a time, kit room cards and tables, confirms before reshuffling, and translates every message.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After (draft) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans_planId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_seat-plans_planId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Top | Delete the "সিট প্ল্যানে ফিরে যান" link; crumbs `সিট প্ল্যান › <plan name>` take over. | D16 |
| 2 | Header | `DetailShell` (no tabs): name `h1` + `SeatPlanStatusBadge` (exams-4a); `facts`: পরীক্ষার বিষয় ("৬টি"), কক্ষ ("৪টি"), শিক্ষার্থী ("১৬০ জন"), আসন ক্রম ("এলোমেলো"/"ক্রমানুসারে") — all already in the detail response. | D16, D27 |
| 3 | Header action | DRAFT + `SEAT_PLAN_MANAGE`: primary "সিট প্ল্যান প্রকাশ করুন" (`megaphone`) → `ConfirmDialog`. PUBLISHED: no button at all. | D29 — no disabled filled button |
| 4 | Notice | DRAFT: one line "প্রকাশের আগে আসন, কক্ষ ও পরিদর্শক বদলানো যায়; প্রকাশের পর আর বদলানো যাবে না।". PUBLISHED: `p role="status"` with `lock` icon "এই সিট প্ল্যান প্রকাশিত — আসন, কক্ষ ও পরিদর্শক আর বদলানো যাবে না।" (replaces the bordered banner). | Says what publish means before pressing it |
| 5 | Sitting picker | **New** `FormField` "কোন বিষয়ের আসন দেখবেন" + Select of the plan's subject sittings (distinct `exam_schedule_id` of all allocations, label `subject_name`), selected one in `?sitting=` (default: first by label). Hidden when the plan has one sitting. Room tables show only that sitting. | A room lists each student once per subject today; the controller checks one paper at a time |
| 6 | Room card | Card `overflow-hidden`: room label `h2 text-h2`, caption "৪০ জন বসেছে · ধারণক্ষমতা ৪০" (seated = rows of the selected sitting; capacity `—` when null); right side: `FormField` "পরিদর্শক" (visible label) with the invigilator Select (`md:w-56`, "নির্ধারিত নয়" when empty) and outline "আসন আবার সাজান" (`shuffle`). PUBLISHED: the invigilator shows as text (`invigilator_name` or "নির্ধারিত নয়"), no Select, no reshuffle. | D25, D19 — hidden, not disabled, when not allowed |
| 7 | Reshuffle | **New** `ConfirmDialog` (default tone): "এই কক্ষের আসন আবার সাজাবেন?" + "প্রশাসনিক ভবন — ১০১-এর সব আসন নতুন করে দেওয়া হবে। আগের আসন বদল হারিয়ে যাবে।"; confirm "আবার সাজান". | One click silently threw away manual moves |
| 8 | Seat table | Columns আসন (numbers via `formatNumber`, numeric sort) · শিক্ষার্থী · শাখা · রোল (`formatNumber`, align end) · কাজ (`RowActions` edit "আসন বদলান", DRAFT only). Footer "মোট ৪০ জন". Empty for this sitting: "এই বিষয়ে এই কক্ষে কেউ বসেনি।". | D6, D19; seats sorted as text today |
| 9 | Reseat dialog | `DialogContent size="sm"`; `FormField` কক্ষ (Select) and আসন নম্বর (`inputMode="numeric"`); Cancel outline; errors translated: 409 `SEAT_ALREADY_TAKEN` → "এই আসনে আর একজন বসে আছে।", 400 `SEAT_CAPACITY_SHORTFALL` → "এই কক্ষে আর খালি আসন নেই।", else `errors.unknown`. | D9, D21 |
| 10 | Publish dialog | `ConfirmDialog` (default tone) with today's title/description; failure → **New** "সিট প্ল্যান প্রকাশ করা যায়নি।". | D9, D29 |
| 11 | States | Loading → header + room-card skeleton; load error → `ErrorState` (kept); no rooms → `EmptyState` (`door-open`) "এই সিট প্ল্যানে কোনো কক্ষ নেই". | D28 |

## Mobile behaviour
- Crumbs (last two), name + badge, facts 2 × 2, primary full width.
- Sitting picker full width.
- Room card: label + caption, invigilator Select full width, "আসন আবার সাজান" full width (outline), then compact two-line rows: seat number as a leading column, name, caption "শাখা ক · রোল ১২", pencil icon (44 px) on the right.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Several sittings in one room | all mixed / subject column / one sitting at a time | one sitting at a time (`?sitting=`) | Allocations are per sitting (`allocation.ts`); 6 sittings × 40 seats would be 240 mixed rows per room. |
| Sitting label | subject + date / subject only | subject only | The detail response has no schedule date; date requires an API field (shared request). |
| Reshuffle | one click / confirm | confirm | It overwrites every manual move in the room. |
| Published controls | disabled / hidden | hidden | Kit rule: `allowed: false` hides; a disabled filled button reads as broken. |
| Seat order | server order / client numeric sort | client `localeCompare(…, { numeric: true })` | Server orders `seat_number` as text. |

## Files
- `client-admin/src/routes/_staff/exams/seat-plans/$planId.tsx` — header, facts, notice, sitting picker, room cards, table, confirm, states, `validateSearch`
- `client-admin/src/routes/_staff/exams/seat-plans/$planId.test.tsx`
- `client-admin/src/routes/_staff/exams/seat-plans/-invigilator-picker.tsx` — width, `id` for the label, placeholder
- `client-admin/src/routes/_staff/exams/seat-plans/-reseat-dialog.tsx` — size, labels, translated errors
- `client-admin/src/routes/_staff/exams/seat-plans/-publish-dialog.tsx` — `ConfirmDialog`, translated error
- `ui/src/i18n/locales/{en,bn}/seatPlansDetail.json` — keys below
- `e2e/journeys/seat-plans.spec.ts` — reseat icon, reshuffle confirm, published notice (also changed by exams-4a, runs earlier)

Used, not changed: `-seat-plan-status-badge.tsx` (exams-4a).

## Steps
1. **Locale `seatPlansDetail.json` (en + bn).** Change: `detail.publishedBanner` → "This seat plan is published — seats, rooms and invigilators can no longer be changed." / "এই সিট প্ল্যান প্রকাশিত — আসন, কক্ষ ও পরিদর্শক আর বদলানো যাবে না।"; `detail.noRooms` → "This seat plan has no rooms" / "এই সিট প্ল্যানে কোনো কক্ষ নেই"; `room.reshuffleButton` → "Reseat this room" / "আসন আবার সাজান"; `room.reseatButton` → "Change seat — {{name}}" / "আসন বদলান — {{name}}"; `room.empty` → "Nobody sits in this room for this subject." / "এই বিষয়ে এই কক্ষে কেউ বসেনি।"; `room.capacity` → "capacity {{capacity}}" / "ধারণক্ষমতা {{capacity}}"; `reseat.title` → "Change seat" / "আসন বদলান"; `reseat.description` → "Move {{name}} to another room or seat." / "{{name}}-কে অন্য কক্ষ বা আসনে সরান।". Add: `detail.draftHint` "Seats, rooms and invigilators can be changed until you publish; not after." / "প্রকাশের আগে আসন, কক্ষ ও পরিদর্শক বদলানো যায়; প্রকাশের পর আর বদলানো যাবে না।"; `detail.facts.subjects` "Exam subjects" / "পরীক্ষার বিষয়"; `detail.facts.rooms` "Rooms" / "কক্ষ"; `detail.facts.students` "Students" / "শিক্ষার্থী"; `detail.facts.seatOrder` "Seat order" / "আসন ক্রম"; `detail.countItems` "{{count}}" / "{{count}}টি"; `detail.countPeople` "{{count}}" / "{{count}} জন"; `detail.seatOrder.SEQUENTIAL` "In order" / "ক্রমানুসারে"; `detail.seatOrder.RANDOM` "Random" / "এলোমেলো"; `detail.sittingLabel` "Show seats for" / "কোন বিষয়ের আসন দেখবেন"; `room.seated` "{{count}} seated · {{capacity}}" / "{{count}} জন বসেছে · {{capacity}}"; `room.total` "Total {{count}}" / "মোট {{count}} জন"; `room.columnActions` "Actions" / "কাজ"; `reshuffle.title` "Reseat this room?" / "এই কক্ষের আসন আবার সাজাবেন?"; `reshuffle.description` "Every seat in {{room}} will be given again. Manual changes will be lost." / "{{room}}-এর সব আসন নতুন করে দেওয়া হবে। আগের আসন বদল হারিয়ে যাবে।"; `reshuffle.confirm` "Reseat" / "আবার সাজান"; `reseat.errorTaken` "Someone already sits in this seat." / "এই আসনে আর একজন বসে আছে।"; `reseat.errorFull` "This room has no free seat." / "এই কক্ষে আর খালি আসন নেই।"; `publish.errorMessage` "Couldn't publish the seat plan." / "সিট প্ল্যান প্রকাশ করা যায়নি।"; `errors.unknown` "Something went wrong. Please try again." / "কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।". Delete `detail.back`, `room.seatLabel`.
2. **`$planId.tsx` — route.** `validateSearch: z.object({ sitting: z.string().optional().catch(undefined) })`. Remove the `Link` import and back link.
3. **Header.** `DetailShell` with `name={plan.name}`, `statusBadge={<SeatPlanStatusBadge status={plan.status} ns="seatPlansDetail" />}`, `facts` = `[subjects: countItems(schedule_count), rooms: countItems(room_count), students: countPeople(student_count), seatOrder: t(\`detail.seatOrder.${plan.seat_order_mode}\`)]` (counts through `formatNumber`), `actions={[{ id: 'publish', label: t('detail.publishButton'), icon: <Megaphone />, priority: 'primary', allowed: canManage && isDraft, onClick: () => setPublishOpen(true) }]}`. Under it: draft → `p text-text-secondary` `draftHint`; published → `p role="status" className="flex items-center gap-2 text-text-secondary"` + `<Lock className="size-4" />` + `publishedBanner`.
4. **Sitting picker.** `const sittings = useMemo(() => unique by exam_schedule_id over plan.rooms.flatMap(r => r.allocations)` → `{ id, label: a.subject_name ?? '—' }` sorted by label with `localeCompare`). `const sittingId = sittings.some(s => s.id === search.sitting) ? search.sitting : sittings[0]?.id`. When `sittings.length > 1`, render `FormField` (`md:w-80`) + `Select` (`value={sittingId}`, `onValueChange={(v) => navigate({ search: { sitting: v }, replace: true })}`) in a row `flex flex-col gap-4 md:flex-row md:items-end md:justify-between` with the notice from Step 3 on the right (`md:text-end`).
5. **Room card** (local component `RoomCard` in the same file). Card `overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1`; head `flex flex-col gap-4 p-4 md:flex-row md:items-end md:justify-between md:p-5`: `h2 text-h2` room label (`building — room_no`, or `room_no`, or `—`), `p mt-1 text-text-secondary` `room.seated` (`count` = rows.length via `formatNumber`, `capacity` = `t('room.capacity', { capacity: formatNumber(capacity) })` or `—`); right `flex flex-col gap-3 md:flex-row md:items-end`: editable → `FormField` (`htmlFor` = `invigilator-${room_id}`) + `InvigilatorPicker` and outline `Button` `Shuffle` "আসন আবার সাজান" (`loading` while that room reshuffles) opening the reshuffle `ConfirmDialog`; not editable → `dl` with `dt` "পরিদর্শক" (`text-caption text-text-secondary`) and `dd font-medium` `invigilator_name ?? t('room.invigilatorNone')`.
6. **Seat table.** Rows = `room.allocations.filter(a => a.exam_schedule_id === sittingId).sort((a, b) => a.seat_number.localeCompare(b.seat_number, undefined, { numeric: true }))`. Kit table inside the card (`border-t border-border-subtle`; `thead` `hidden … md:table-header-group`; `tbody divide-y divide-border-subtle`): seat cell `w-16 px-4 text-right tabular-nums font-medium` (`/^\d+$/.test(s) ? formatNumber(Number(s), config) : s`); student cell `font-medium` with phone caption `শাখা {{section}} · রোল {{roll}}` (`md:hidden`); শাখা (`section_name ?? '—'`), রোল (align end, `formatNumber` or `—`) as `hidden md:table-cell`; actions `RowActions` `[{ intent: 'edit', label: t('room.reseatButton', { name: a.student_name }), allowed: editable, onClick: () => setReseatTarget(a) }]`; hide the কাজ column entirely when not editable. Footer `p border-t border-border-subtle px-4 py-3 text-text-secondary` `room.total`. No rows → `p px-4 py-6 text-text-secondary` `room.empty` instead of the table. Delete the separate `ul sm:hidden` card list (the table's compact rows cover phone).
7. **Reshuffle confirm.** `const [reshuffleRoomId, setReshuffleRoomId] = useState<string | null>(null)`; `ConfirmDialog` `title={t('reshuffle.title')}` `description={t('reshuffle.description', { room: label })}` `confirmLabel={t('reshuffle.confirm')}` `busy={reshuffleRoom.isPending}` `onConfirm={() => reshuffleRoom.mutate(id, { onSuccess: () => setReshuffleRoomId(null) })}`.
8. **States.** Pending: skeleton (`aria-busy="true"`; header bars `h-7 w-72` + four `h-3 w-20`, two Card blocks `h-64`). No rooms: `EmptyState icon={<DoorOpen />} title={t('detail.noRooms')}` without action.
9. **`-invigilator-picker.tsx`.** Accept `id?: string` and pass it to `SelectTrigger`; `className="w-full md:w-56"`; keep `aria-label` only when no `id` is given. Placeholder `room.invigilatorPlaceholder`.
10. **`-reseat-dialog.tsx`.** `DialogContent size="sm"`; `FormField` labels for কক্ষ and আসন নম্বর (`Input inputMode="numeric"`); room items via the same room label; Cancel `variant="outline"`; error = `err instanceof ApiError && err.details?.code === 'SEAT_ALREADY_TAKEN' ? t('reseat.errorTaken') : err?.details?.code === 'SEAT_CAPACITY_SHORTFALL' ? t('reseat.errorFull') : t('errors.unknown')`, rendered with the kit error text classes.
11. **`-publish-dialog.tsx`.** Replace the `Dialog` with `ConfirmDialog` (`title={t('publish.title')}`, `description={t('publish.description')}`, `confirmLabel={t('publish.confirm')}`, default tone, `busy={publish.isPending}`); failure shows `t('publish.errorMessage')` under the description (`role="alert"`).
12. **`e2e/journeys/seat-plans.spec.ts`.** Reseat: `getByRole('button', { name: t('seatPlansDetail.room.reseatButton', { name: <student> }) })` (icon button). Reshuffle: click `room.reshuffleButton`, then the `alertdialog` button `reshuffle.confirm`. Publish: header button `detail.publishButton`, then `alertdialog` `publish.confirm`; then expect `detail.publishedBanner` and that `detail.publishButton`, `room.reshuffleButton` and the reseat buttons are **absent** (`toHaveCount(0)`), not disabled. If the fixture has two sittings, pick the sitting with `detail.sittingLabel` first.
13. Run `pnpm --filter client-admin test seat-plans/\$planId`, then `graphify update .`.

## Tests
- `$planId.test.tsx` — no back link; facts show the counts in tenant digits and the seat order label; DRAFT shows exactly one filled button "সিট প্ল্যান প্রকাশ করুন"; PUBLISHED shows no publish, reshuffle or reseat control and shows the invigilator as text plus the `role="status"` notice; with two sittings only the selected sitting's rows render and switching updates `?sitting=`; seats "2" sort before "10"; reshuffle asks in an `alertdialog` and calls the mutation only after confirm; reseat 409 shows `reseat.errorTaken`; publish failure shows `publish.errorMessage`.
- `e2e/journeys/seat-plans.spec.ts` — as in Step 12.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No back link; header has the status badge and four facts.
- [ ] One subject sitting at a time; seats in numeric order.
- [ ] Invigilator field has a visible label; reshuffle asks first.
- [ ] After publishing, no edit control is left on the page.

## Out of scope
- Sitting date/time in the picker and Bangla subject names — need `schedules[]` (`id, subject_name_bn, date, starts_at, ends_at`) in `GET /seat-plans/:id` (shared request).
- Printing the seat plan / room sheets (Epic 32 print module).
- The `useUsers({ role: 'TEACHER' })` permission behaviour of the invigilator list (unchanged).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server exam_name on GET /seat-plans rows | Deferred | — | use the fallback in the ticket (no exam column) |
| server sittings with bn name, date, time on GET /seat-plans/:id | Accepted | 31.3.7b | no schedules[] array: each allocation row gains subject_name_bn, exam_date ('YYYY-MM-DD'), starts_at, ends_at ('HH:mm:ss'); build the sitting label from the first row per exam_schedule_id (bn name when the UI is bn, else subject_name; caption formatDate + formatTime range) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: exams   Decisions: D6, D9, D16, D19, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.exams-4a
