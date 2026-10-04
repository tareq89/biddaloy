# [31.4.routines-3a] Routine review — state header, period table, request dialogs

## Goal
`/routines/review` shows the routine's state, year and audience in a kit detail header with state-driven actions, change requests in a table with accept/reject dialogs, and every period in a sortable, filterable, paginated kit table with real times and Bangla names. Split: the substitute-teacher page is `routines-3b` (`ticket-b.md`), which runs after this one.

## What and why
This page is where an admin moves the year's routine from draft to review to published, answers teachers' change requests, and where a teacher sees their own periods and asks for a change. Today the state is a loud purple banner whose text repeats the state, the period list is a flat list of English subject names with raw times (`08:00:00`) and no class or section (useless once a school has hundreds of periods), every change request carries its own textarea and its own filled "Accept" button, the copy action says "copy last year's routine" while it really copies *this* routine into another year, and the copy dialog uses a browser `<select>`. The redesign uses `DetailShell` (badge + facts + one primary per state), a kit `DataTable` for periods with a section filter, a compact request table whose accept/reject open a small dialog for the optional note, and `ConfirmDialog` for publishing.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_review/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_review/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_review/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_review/mobile.webp?raw=true" width="260"> |

The "after" shows an admin on a PUBLISHED routine with two open requests. The other states' header actions are in Change 3.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | `DetailShell` without tabs (it renders `PageContainer` wide): `name` = `review.title` ("রুটিন পর্যালোচনা"), remove the `p-4` wrapper and the raw `<h1>`. | D15, D16 |
| 2 | State | Purple banner → `StatusBadge` next to the title: DRAFT neutral "ড্রাফট" · REVIEW warning "পর্যালোচনায়" · PUBLISHED success "প্রকাশিত" (`review.stateLabel.*`). **New** `facts`: শিক্ষাবর্ষ (current year name), পিরিয়ড ("১৮৪টি"), খোলা অনুরোধ (admins on a published routine only), কে দেখতে পাচ্ছেন (`review.banner.*`, reworded without the repeated state word). | D27, D9; the banner repeated the badge |
| 3 | Actions (admin, `ROUTINE_MANAGE`) | DRAFT: primary "পর্যালোচনার জন্য জমা দিন" (`send`), More → copy. REVIEW: outline "ড্রাফটে ফিরিয়ে নিন" (`undo-2`), primary "প্রকাশ করুন" (`globe`), More → copy. PUBLISHED: outline "অন্য শিক্ষাবর্ষে কপি করুন" (`copy`) only. Teachers: no actions. Raw `<button>`s go. | D16, D29 (one primary per view) |
| 4 | Copy wording | "গত বছরের রুটিন কপি করুন" → "অন্য শিক্ষাবর্ষে কপি করুন": it copies this routine *into* the year you pick. | The old label described the opposite direction |
| 5 | Copy dialog | `DialogContent size="sm"`; raw `<select>` → `FormField` + `Select` "কোন শিক্ষাবর্ষে" (placeholder `common` "বাছুন"), options = academic years **except the current one**; Cancel outline. | D21, D25, D37 |
| 6 | Publish dialog | `PublishDialog` becomes `ConfirmDialog` (`tone="default"`): title "এই রুটিন প্রকাশ করুন", description = the two sentences reworded, confirm "প্রকাশ করুন". | D29; no red button, irreversible step confirmed |
| 7 | Change requests (admin) | Shown only when the routine is PUBLISHED (the server accepts requests only on published periods). `h2` "পরিবর্তনের অনুরোধ" + the explanation sentence reworded, then `DataTable paginated={false}`: পিরিয়ড ("সোম · পিরিয়ড ১" over "সকাল ৮:০০ · গণিত"), শ্রেণি ও শাখা, যিনি চেয়েছেন (name over `formatDate(created_at)`), অনুরোধ (note), row actions `approve` "গ্রহণ করুন" + `reject` "প্রত্যাখ্যান করুন". Total "মোট ২টি". | D19; one filled button per request is gone |
| 8 | Resolve dialog | **New** small dialog inside `-change-request-list.tsx`: `DialogContent size="sm"`, title "অনুরোধটি গ্রহণ করবেন?" / "অনুরোধটি প্রত্যাখ্যান করবেন?", description names the period + teacher, `FormField` Textarea "শিক্ষকের জন্য নোট (ঐচ্ছিক)", Cancel outline + primary. Replaces the always-open textarea per row. | D21, D29 |
| 9 | Period table | Flat `<ul>` → `DataTable` (paginated, 25): শ্রেণি ও শাখা (`font-medium`), দিন, পিরিয়ড ("পিরিয়ড ১"), সময় (`formatTime` start – end), বিষয় (`subjectName()` from routines-1a), শিক্ষক (names joined by ", "). Sorted by section label, weekday, period. Heading `h2` "সব পিরিয়ড" + subtitle. | D19, D7 (B21 `review.tsx:125`), D9 |
| 10 | Section filter (admin) | **New** `FormField` + `Select` "শ্রেণি ও শাখা" (`md:w-72`, first option "সব শাখা") next to the heading; options = sections that have periods in this routine; value in the URL (`?sectionId=`). | Reviewing one section at a time without leaving the page |
| 11 | Teacher view | Table heading "আমার পিরিয়ড", only own periods, row action `send` "পরিবর্তনের অনুরোধ করুন" (hidden unless PUBLISHED; when hidden a `text-text-secondary` line `review.requestChangeDisabledExplanation` sits above the table). Section filter hidden. | Same table, one place to ask |
| 12 | Request dialog (teacher) | `DialogContent size="sm"`, description names the period; Textarea gets a visible label "কী বদলানো দরকার"; Cancel outline. | D25, D29 |
| 13 | States | Loading (`return null` today) → skeleton header + table skeleton, `aria-busy`. Error → `ErrorState` under the title. No routine → **New** `EmptyState` (`calendar-x-2`) "এখনো কোনো রুটিন নেই" + existing sentence, no action. Teacher not linked → **New** `EmptyState` "আপনার কোনো পিরিয়ড নেই". Routine with no periods → table `emptyState` "এখনো কোনো পিরিয়ড নেই" with outline "শ্রেণির রুটিন খুলুন" → `/routines` (admins). Requests empty → table `emptyState` "কোনো খোলা অনুরোধ নেই". | D28 |
| 14 | Labels | Subject/teacher/section/requester not found → "—", never the id. | D9 |

## Mobile behaviour
- Header: badge wraps under the title; facts in a 2-column grid; the primary (DRAFT/REVIEW) is full width + More; on PUBLISHED only the More button shows (copy lives in it).
- Change requests are cards: title "সোম · পিরিয়ড ১", subtitle "সকাল ৮:০০ · গণিত · ষষ্ঠ শ্রেণি – ক", the note, "আনিকা রহমান · ৩রা অক্টোবর, ২০২৬" caption, action row with labelled "গ্রহণ করুন" / "প্রত্যাখ্যান করুন".
- Periods are cards: title "রবি · পিরিয়ড ১", subtitle time range, `dl` শ্রেণি ও শাখা · বিষয় · শিক্ষক (full width). The section filter is a full-width select above the cards.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Header component | PageHeader + banner · DetailShell | `DetailShell` without tabs | Badge + facts + actions in one kit block; same as routines-1a's builder header |
| Audience sentence | keep banner · fact | Fact "কে দেখতে পাচ্ছেন" reusing `review.banner.*` keys (values reworded) | The e2e publish step asserts `review.banner.published`; keeping the key keeps it green |
| Period list shape | grouped by section · one table + filter | One paginated table + section filter in the URL | Data is already in memory; a filter is one Select; groups of 30 sections would be a long scroll |
| Requests section when not published | always show (empty) · hide | Hide unless PUBLISHED | Requests can only exist on published periods (`ChangeRequestsService.open`) |
| Resolution note | textarea per row (today) · dialog on accept/reject | Small dialog | One primary per view; the note is optional and rarely used |
| Copy as primary? | primary · outline/More | Outline on PUBLISHED, More otherwise | Rare action; never competes with the state action |
| Link from a request to the builder | add "open in class routine" · leave | Leave | The builder needs `?classId=`, and `useSectionLookup` has no class id (see Out of scope) |

## Files
- `client-admin/src/routes/_staff/routines/review.tsx` — DetailShell, actions by state, facts, tables, filter, states, copy dialog
- `client-admin/src/routes/_staff/routines/review.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-change-request-list.tsx` — DataTable + resolve dialog
- `client-admin/src/routes/_staff/routines/-change-request-list.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-change-request-dialog.tsx` — size, label, description
- `client-admin/src/routes/_staff/routines/-change-request-dialog.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-publish-dialog.tsx` — ConfirmDialog
- `client-admin/src/routes/_staff/routines/-publish-dialog.test.tsx` — updated
- `ui/src/i18n/locales/en/routines.json`, `ui/src/i18n/locales/bn/routines.json` — keys below (also changed by routines-1a, 1b, 2, run earlier)

`client-admin/src/routes/_staff/routines/-subject-name.ts` is created by routines-1a and only imported here.

## Steps
1. **Locale keys** (en / bn). Change values:
   - `review.banner.draft` → "Only the people who build the routine" / "শুধু যাঁরা রুটিন সাজান"; `review.banner.review` → "Teachers, each their own periods" / "শিক্ষকরা, শুধু নিজের পিরিয়ড"; `review.banner.published` → "Teachers, students and guardians" / "শিক্ষক, শিক্ষার্থী ও অভিভাবক সবাই".
   - `review.copyYearAction` and `review.copyYearDialogTitle` → "Copy to another year" / "অন্য শিক্ষাবর্ষে কপি করুন"; `review.copyYearDialogExplanation` → "Every period of this routine is copied into a new draft for the year you pick. Periods whose section or subject doesn't exist in that year are left out and counted." / "এই রুটিনের সব পিরিয়ড বেছে নেওয়া শিক্ষাবর্ষের একটি নতুন ড্রাফটে কপি হবে। যে পিরিয়ডের শাখা বা বিষয় ওই বছরে নেই, সেগুলো বাদ পড়বে আর গুনে দেখানো হবে।"; `review.copyYearTargetLabel` → "Copy to" / "কোন শিক্ষাবর্ষে"; `review.copyYearCancel` → "Cancel" / "বাতিল করুন"; `review.copyYearSuccessToast` / `_other` → "Copied — {{count}} period left out" / "Copied — {{count}} periods left out", bn both "কপি হয়েছে — {{count}}টি পিরিয়ড বাদ পড়েছে".
   - `review.emptyExplanation` → "No periods have been placed in this routine yet." / "এই রুটিনে এখনো কোনো পিরিয়ড বসানো হয়নি।"; `review.notATeacherExplanation` → "Your account isn't linked to a teacher, so there are no periods of yours to show." / "আপনার অ্যাকাউন্ট কোনো শিক্ষকের সাথে যুক্ত নয়, তাই আপনার কোনো পিরিয়ড দেখানোর নেই।"
   - `changeRequestList.acceptDoesNotEditExplanation` → "Accepting doesn't change the routine by itself — open the class routine and move the period." / "গ্রহণ করলে রুটিন নিজে থেকে বদলায় না — শ্রেণির রুটিনে গিয়ে পিরিয়ডটি বদলে দিন।"; `changeRequestList.empty` → "When a teacher asks to change a period, it shows up here." / "কোনো শিক্ষক পিরিয়ড বদলাতে চাইলে অনুরোধটি এখানে আসবে।"; `changeRequestList.resolutionNoteLabel` → "Note for the teacher (optional)" / "শিক্ষকের জন্য নোট (ঐচ্ছিক)".
   - `changeRequestDialog.noteLabel` → "What needs to change" / "কী বদলানো দরকার"; `changeRequestDialog.cancel` → "Cancel" / "বাতিল করুন".
   - `publishDialog.oneWayExplanation` → "Once published, the routine can't go back to draft." / "প্রকাশের পর রুটিন আর ড্রাফটে ফেরানো যায় না।"; `publishDialog.correctionsExplanation` → "To change something later, edit it in the class routine from a new date." / "পরে কিছু বদলাতে হলে শ্রেণির রুটিনে নতুন তারিখ থেকে বদলান।"; `publishDialog.cancel` → "Cancel" / "বাতিল করুন".
   Add:
   - `review.facts.year` "Academic year" / "শিক্ষাবর্ষ"; `review.facts.periods` "Periods" / "পিরিয়ড"; `review.facts.periodsValue` "{{count}}" / "{{count}}টি"; `review.facts.openRequests` "Open requests" / "খোলা অনুরোধ"; `review.facts.openRequestsValue` "{{count}}" / "{{count}}টি"; `review.facts.visibleTo` "Who can see it" / "কে দেখতে পাচ্ছেন".
   - `review.noRoutineTitle` "No routine yet" / "এখনো কোনো রুটিন নেই"; `review.notATeacherTitle` "No periods for you" / "আপনার কোনো পিরিয়ড নেই"; `review.emptyTitle` "No periods yet" / "এখনো কোনো পিরিয়ড নেই"; `review.openClassRoutine` "Open class routine" / "শ্রেণির রুটিন খুলুন"; `review.loading` "Loading the routine" / "রুটিন লোড হচ্ছে".
   - `review.slots.title` "All periods" / "সব পিরিয়ড"; `review.slots.titleOwn` "My periods" / "আমার পিরিয়ড"; `review.slots.subtitle` "Every section's weekly periods, by day and time." / "প্রতিটি শাখার সাপ্তাহিক পিরিয়ড, দিন আর সময় ধরে সাজানো।"; `review.slots.subtitleOwn` "Your weekly periods." / "আপনার সাপ্তাহিক পিরিয়ড।"; `review.slots.caption` "Periods of the routine" / "রুটিনের সব পিরিয়ড"; `review.slots.sectionFilter` "Class and section" / "শ্রেণি ও শাখা"; `review.slots.allSections` "All sections" / "সব শাখা"; `review.slots.sectionColumn` "Class and section" / "শ্রেণি ও শাখা"; `review.slots.dayColumn` "Day" / "দিন"; `review.slots.periodColumn` "Period" / "পিরিয়ড"; `review.slots.timeColumn` "Time" / "সময়"; `review.slots.subjectColumn` "Subject" / "বিষয়"; `review.slots.teachersColumn` "Teacher" / "শিক্ষক"; `review.slots.timeRange` "{{start}} – {{end}}" (both); `review.slots.sectionName` "{{className}} – {{sectionName}}" (both).
   - `changeRequestList.caption` "Change requests" / "পরিবর্তনের অনুরোধ"; `changeRequestList.periodColumn` "Period" / "পিরিয়ড"; `changeRequestList.sectionColumn` "Class and section" / "শ্রেণি ও শাখা"; `changeRequestList.requesterColumn` "Asked by" / "যিনি চেয়েছেন"; `changeRequestList.noteColumn` "Request" / "অনুরোধ"; `changeRequestList.slotWhen` "{{day}} · {{period}}" (both); `changeRequestList.slotWhat` "{{time}} · {{subject}}" (both); `changeRequestList.emptyTitle` "No open requests" / "কোনো খোলা অনুরোধ নেই"; `changeRequestList.acceptTitle` "Accept this request?" / "অনুরোধটি গ্রহণ করবেন?"; `changeRequestList.rejectTitle` "Reject this request?" / "অনুরোধটি প্রত্যাখ্যান করবেন?"; `changeRequestList.resolveDescription` "{{slot}} — asked by {{name}}" / "{{slot}} — চেয়েছেন {{name}}"; `changeRequestList.cancel` "Cancel" / "বাতিল করুন".
   - `changeRequestDialog.slotDescription` "{{slot}} — tell the routine's builder what needs to change." / "{{slot}} — কী বদলানো দরকার, রুটিন যিনি সাজান তাঁকে জানান।"
   Delete `review.copyYearSelectTarget` and `changeRequestList.requestedBy` (check with `rg` that nothing else uses them).
2. **`review.tsx` — data.** Add `validateSearch: z.object({ sectionId: z.string().uuid().optional().catch(undefined) })`. Add `useSectionLookup()` and `useRegionConfig()`. Build one row model for every slot: `{ id, sectionId, sectionLabel: t('review.slots.sectionName', lookup[sectionId]) ?? '—', weekday, dayLabel: t(\`grid.weekday.${WEEKDAY_KEYS[weekday]}\`), sequence, periodLabel: t('agenda.periodLabel', { sequence: formatNumber(sequence, config) }), time: t('review.slots.timeRange', { start: formatTime(starts_at, config), end: formatTime(ends_at, config) }), subject: subjectName(subject, i18n.language), teachers: names.join(', ') || '—' }` (period missing → period and time "—"). Sort: `sectionLabel.localeCompare`, then `weekday`, then `sequence`. Visible rows = manager: all, filtered by `search.sectionId` when set; teacher: own (`teacher_ids.includes(ownTeacher.id)`). Section options = unique `sectionId`s of all rows with their labels, sorted.
3. **`review.tsx` — frame and states.** Pending (`routinesQuery.isPending || academicYearsQuery.isPending`): `PageContainer` with a `Skeleton` title bar, a facts row and a table skeleton (6 rows `h-10`), `aria-busy="true"`, sr-only `review.loading`. Error: `PageContainer` → `PageHeader title={t('review.title')}` → existing `ErrorState`. No routine: same header → `EmptyState icon={<CalendarX2 />} title={t('review.noRoutineTitle')} explanation={t('review.noRoutineExplanation')}`.
4. **`review.tsx` — header.** `DetailShell name={t('review.title')} statusBadge={<StatusBadge tone={{ DRAFT: 'neutral', REVIEW: 'warning', PUBLISHED: 'success' }[routine.state]} label={t(\`review.stateLabel.${routine.state}\`)} />} facts={…} actions={…}`. Facts: `review.facts.year` = current year `name`; `review.facts.periods` = `t('review.facts.periodsValue', { count: formatNumber(visibleRows.length, config) })`; when `canManage && routine.state === 'PUBLISHED'` `review.facts.openRequests` = open count; `review.facts.visibleTo` = `t(bannerKey)`. Actions (manager only; `[]` otherwise): `copy` (`label: t('review.copyYearAction')`, `icon: <Copy />`, `priority: routine.state === 'PUBLISHED' ? 'secondary' : 'tertiary'`); DRAFT adds `{ id: 'submit', priority: 'primary', icon: <Send />, label: t('review.submitForReviewAction'), onClick: handleSubmitForReview }`; REVIEW adds `{ id: 'withdraw', priority: 'secondary', icon: <Undo2 />, label: t('review.withdrawAction'), onClick: handleWithdraw }` and `{ id: 'publish', priority: 'primary', icon: <Globe />, label: t('review.publishAction'), onClick: () => setPublishOpen(true) }`. Pass `busy`/`loading` if `DetailShellAction` supports it; otherwise disable while the mutation is pending.
5. **`review.tsx` — body** (`space-y-6`):
   - When `canManage && routine.state === 'PUBLISHED'`: `section.space-y-3` with `h2.text-h2` `changeRequestList.title` + `p.mt-1.text-text-secondary` `changeRequestList.acceptDoesNotEditExplanation`, then `ChangeRequestList` (Step 6) or, on query error, `ErrorState` (`changeRequestList.loadError`). Enable `useChangeRequests` only in that case.
   - `section.space-y-3`: header `div.flex.flex-col.gap-3.md:flex-row.md:items-end.md:justify-between.md:gap-6` with `h2.text-h2` (`review.slots.title` or `titleOwn`) + `p.mt-1.text-text-secondary` (`subtitle`/`subtitleOwn`), and for managers a `FormField label={t('review.slots.sectionFilter')}` in `div.md:w-72` holding `Select` (first option `''` = `review.slots.allSections`; `onValueChange={(v) => navigate({ search: { sectionId: v || undefined }, replace: true })}`). Teacher not linked (`!canManage && !ownTeacher`): `EmptyState icon={<UserRoundX />} title={t('review.notATeacherTitle')} explanation={t('review.notATeacherExplanation')}` instead of the table. Teacher and not PUBLISHED: `p.text-text-secondary` `review.requestChangeDisabledExplanation` above the table.
   - `DataTable caption={t('review.slots.caption')} data={visibleRows} loading={slotsQuery.isPending} columns=[section (font-medium), day, period, time (`whitespace-nowrap`), subject, teachers] rowActions={canManage ? undefined : (row) => [{ intent: 'send', label: t('review.requestChangeAction'), onClick: () => setChangeRequestSlotId(row.id), allowed: routine.state === 'PUBLISHED' }]} emptyState={{ title: t('review.emptyTitle'), explanation: t('review.emptyExplanation'), action: canManage ? { label: t('review.openClassRoutine'), onClick: () => navigate({ to: '/routines' }) } : undefined }}`. Page size: DataTable default (25); if DataTable only paginates through controlled props, keep `pageIndex` in component state and slice `visibleRows`. Phone card: title `${dayLabel} · ${periodLabel}`, subtitle `time`, fields section / subject / teachers (teachers full width).
   - Copy dialog: `DialogContent size="sm"`; `FormField label={t('review.copyYearTargetLabel')}` + `Select` with options `academicYears.filter((y) => y.id !== currentYearId)`; footer Cancel `variant="outline"` + primary (unchanged logic).
   - Delete the raw `<select>`, raw buttons, the banner `div`, the `slotLabel`/`subjectName` helpers that read `name_en` and fall back to ids.
6. **`-change-request-list.tsx`**: props become `{ routineId, requests, describeSlot: (slotId) => { when: string; what: string; section: string }, requesterLabel: (userId) => string }` (`review.tsx` builds `describeSlot` from the row model: `when = t('changeRequestList.slotWhen', { day, period })`, `what = t('changeRequestList.slotWhat', { time: formatTime(starts_at), subject })`; unknown slot → all "—"). Render `DataTable paginated={false} caption={t('changeRequestList.caption')} data={open}` with columns পিরিয়ড (`when` `font-medium` + `what` caption), শ্রেণি ও শাখা, যিনি চেয়েছেন (`requesterLabel` + `formatDate(created_at, config)` caption), অনুরোধ (note), `rowActions={(r) => [{ intent: 'approve', label: t('changeRequestList.accept'), onClick: () => setResolving({ request: r, state: 'ACCEPTED' }) }, { intent: 'reject', label: t('changeRequestList.reject'), onClick: () => setResolving({ request: r, state: 'REJECTED' }) }]}`, `emptyState={{ title: t('changeRequestList.emptyTitle'), explanation: t('changeRequestList.empty') }}`. Phone card: title `when`, subtitle `${what} · ${section}`, body the note, caption `${name} · ${date}`. Resolve dialog: `Dialog open={!!resolving}` → `DialogContent size="sm"` title `acceptTitle`/`rejectTitle`, `DialogDescription` `resolveDescription`, `FormField label={t('changeRequestList.resolutionNoteLabel')}` + `Textarea maxLength={500}`, footer Cancel outline + primary (label `accept`/`reject`) calling the existing `handleResolve` (note trimmed, omitted when empty); close + clear note on success. Remove the per-row Textarea state map. The requester fallback in `review.tsx` becomes `'—'`.
7. **`-change-request-dialog.tsx`**: add prop `slotLabel?: string`; `DialogContent size="sm"`; `DialogDescription` = `slotLabel ? t('changeRequestDialog.slotDescription', { slot: slotLabel }) : t('changeRequestDialog.description')`; Textarea inside `FormField label={t('changeRequestDialog.noteLabel')}` (visible label, no `aria-label`); Cancel `variant="outline"`. `review.tsx` passes `` `${row.dayLabel} · ${row.periodLabel} · ${row.subject}` ``.
8. **`-publish-dialog.tsx`**: render `ConfirmDialog open onOpenChange title={t('publishDialog.title')} description={\`${t('publishDialog.oneWayExplanation')} ${t('publishDialog.correctionsExplanation')}\`} confirmLabel={t('publishDialog.confirm')} cancelLabel={t('publishDialog.cancel')} tone="default" busy={publish.isPending} onConfirm={handleConfirm}`. Props unchanged.
9. Logical classes only; no `max-w-*`, `text-sm`, `text-muted-foreground` left in these files.

## Tests
- `review.test.tsx`: DRAFT → one primary "Submit for review"; REVIEW → primary "Publish" + outline "Withdraw to draft"; PUBLISHED → no primary, "Copy to another year" visible; the state shows as a badge and the fact "Who can see it" holds `review.banner.*`; copy dialog has no `<select>` (`container.querySelector('select')` is null) and its options exclude the current year; a slot row shows "Class 6 – A", "Period 1", "8:00 AM – 8:40 AM" (never `08:00:00`) and the Bangla subject when the language is `bn`; picking a section in the filter sets `?sectionId=` and narrows the rows; a teacher sees only own rows, the "Request a change" action only on PUBLISHED, and the disabled explanation otherwise; the change-request section is absent unless PUBLISHED; unknown requester / subject render "—"; pending renders `aria-busy`; no routine renders the EmptyState title.
- `-change-request-list.test.tsx`: Accept opens the dialog; confirming with a note calls resolve with `{ state: 'ACCEPTED', resolution_note }`, with an empty note `{ state: 'ACCEPTED' }`; Reject likewise; no Textarea is visible before a dialog opens; empty list shows "No open requests".
- `-change-request-dialog.test.tsx`: the note has a visible label (`getByLabelText('What needs to change')`); the slot description renders when `slotLabel` is given; Cancel has the outline variant.
- `-publish-dialog.test.tsx`: renders as `alertdialog` with both sentences; confirm calls publish.
- `e2e/journeys/routine-builder.spec.ts` publish step: unchanged — it tabs to the `review.publishAction` button, confirms `publishDialog.confirm`, and waits for `review.banner.published` text, all of which stay.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view in DRAFT and REVIEW; none in PUBLISHED.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6, times D7.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The routine's state is a StatusBadge; the purple banner is gone.
- [ ] Every period row names its class and section, and the section filter survives a reload.
- [ ] Accept / reject open a small dialog; no textarea is always open per request.
- [ ] The copy action reads "Copy to another year" and cannot target the current year.
- [ ] No `<select>` left in `review.tsx`.

## Out of scope
- Shared request filed: sidebar items "রুটিন পর্যালোচনা" and "বদলি শিক্ষক" (neither page is in the sidebar today; the sidebar lights "শ্রেণির রুটিন" on both).
- A link from a change request to the builder: needs the section's class id, which `useSectionLookup` does not return (shared hook, not changed here).
- Creating a routine for a year has no UI anywhere (pre-existing gap, also noted by routines-1a); the no-routine state therefore has no action.
- Substitute-teacher page: `routines-3b`.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| sidebar items review + substitutions | Accepted | 31.3.1 | academics.routineReview -> /routines/review (ROUTINE_READ, icon clipboard-check), academics.routineSubstitutions -> /routines/substitutions (ROUTINE_MANAGE, icon replace — not user-round-check, too close to staff attendance's user-check); labels nav:items.routineReview / routineSubstitutions ("বদলি শিক্ষক") |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: routines   Decisions: D5, D6, D7, D9, D15, D16, D19, D21, D25, D27, D28, D29, D32, D37   Depends on: 31.3.8b, 31.4.routines-2
