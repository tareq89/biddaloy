# [31.4.marks-1] Enter marks — labelled picker, status list, clear marks list

## Goal
`/marks` shows every marks list of the picked exam with its status and one "নম্বর দিন" action per row, and `/marks/$examId/$sectionId/$subjectId` says which subject, section and exam it is, shows the save state with an icon, and has "জমা দিন" as its one filled button.

## What and why
A teacher opens `/marks` to find the marks list (one section × one subject) they still have to fill, types the marks, and submits. Today the exam picker has no visible label, an admin-only search box is a raw `<input>` with only a placeholder, the table shows only drafts with no count, states are plain text, and the row is an underlined link that says only the section — two subjects of one section look identical. The entry page's title is the same for every list ("মার্ক এন্ট্রি গ্রিড"), submit is an outline button under the title, times are printed with `toLocaleString`, the "submitted" banner prints a user id, and the keyboard shortcuts (A, E, Enter, Ctrl+Enter) are invisible. The redesign uses the kit's PageHeader, a labelled exam picker plus FilterBar, an unpaginated DataTable with StatusBadge and RowActions, and on the entry page a header with context, save-state line and one primary.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — `/marks` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/marks/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/marks/before-mobile.webp?raw=true" width="260"> |
| After — `/marks` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/marks/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/marks/mobile.webp?raw=true" width="260"> |
| Before — marks list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/marks_examId_sectionId_subjectId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/marks_examId_sectionId_subjectId/before-mobile.webp?raw=true" width="260"> |
| After — marks list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/marks_examId_sectionId_subjectId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/marks_examId_sectionId_subjectId/mobile.webp?raw=true" width="260"> |

The "before" shot of the marks list shows an error card — that is an audit artefact (placeholder ids); the design is built from the code.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | `/marks` header | `PageHeader` with title `t('items.marksEntry', { ns: 'nav' })` ("নম্বর দেওয়া") and subtitle: with an exam picked and grids loaded → **New** "১২টি নম্বর তালিকার মধ্যে ৮টি জমা হয়েছে" (from `progress.counts`); otherwise **New** hint "পরীক্ষা বাছুন, তারপর শাখা ও বিষয়ের নম্বর তালিকা খুলুন।". No header actions. | D16 title = nav label/crumb; progress at a glance |
| 2 | `/marks` exam picker | `Select` with a visible `Label` "পরীক্ষা", `md:w-96`, always visible on phone. Option text **New** "{exam} · {class}" (`exam.class?.name`, already in the list response). | D24/D25; two classes' "Half Yearly" are told apart |
| 3 | `/marks` filters | `FilterBar` next to the picker: search (primary field, label "খুঁজুন", placeholder "শাখা বা বিষয়") — only for `EXAM_MANAGE`, as today — and **New** status select "অবস্থা": সব / জমা বাকি / জমা হয়েছে (default সব). Phone: search + "ফিল্টার" button opening the sheet. | D24; replaces the raw `<input>` |
| 4 | `/marks` list | `DataTable` `paginated={false}`: columns শাখা ("শাখা ক"), বিষয় (`subject_name`, see Out of scope), অবস্থা (`StatusBadge` warning "জমা বাকি" / success "জমা হয়েছে"), কাজ. Rows: drafts first, then submitted, each group in server order. Footer `TableCount` "মোট ১২টি". Shows all grids, not only drafts (**New**: submitted rows were hidden). | D19, D27; the teacher sees what is left and what is done |
| 5 | `/marks` row action | `RowActions`: draft + `MARK_ENTER` → `edit` "নম্বর দিন" (`to` the grid); submitted, or no `MARK_ENTER` → `view` "নম্বর দেখুন". Replaces the underlined section link. | D19 |
| 6 | `/marks` states | Loading: `DataTable loading`. Error: `ErrorState` (existing `marksList.loadError`). No exams: `EmptyState` "এখনো কোনো পরীক্ষা নেই". No grids: `EmptyState` "এখনো কোনো নম্বর তালিকা নেই". Filters match nothing: `EmptyState` "কিছু মেলেনি" with outline "সব মুছুন". | D28 |
| 7 | Entry page header | Crumbs (layout) → `h1` "নম্বর তালিকা" (unchanged key `exams:marksGrid.caption`) → **New** subtitle "গণিত · শাখা ক · অর্ধবার্ষিক পরীক্ষা ২০২৬ · ৮ জন শিক্ষার্থী" → save-state line with an icon. Right: primary "জমা দিন" (`send`), `aria-keyshortcuts="Control+Enter"`. | Where am I (5-second test); D16 one primary |
| 8 | Save-state line | Icon per state: idle `circle-dashed` secondary; saving `loader-circle animate-spin`; saved `circle-check` `text-status-paid-fg`; error `circle-alert` and the whole line `text-destructive`. Saved time via `formatTime` (was `toLocaleTimeString`). Keep `data-testid="save-state-line"`, `role="status"`, `aria-live="polite"`. | D7, B25; state visible at a glance |
| 9 | Keyboard help | **New** desktop-only help line above the grid: "নম্বর লিখে Enter চাপলে নিচের ঘরে যাবে। অনুপস্থিত হলে A, মওকুফ হলে E চাপুন। শেষে Ctrl+Enter চেপে জমা দিন।" with `<kbd>`. | The shortcuts exist but nobody can see them |
| 10 | Grid frame | Desktop: `MarksGrid` inside a flush Card (`rounded-lg border border-border-subtle bg-surface shadow-e1 overflow-hidden`) with a `TableCount total={students.length}` footer. Phone: `MarksStepper` as today, no card around it. | Kit card look; D19 total |
| 11 | Submitted state | Replaces the grey banner with a Card: `StatusBadge tone="success"` "জমা হয়েছে" + "৯ই সেপ্টেম্বর, ২০২৬, বিকাল ৩:৪৫-এ জমা দেওয়া হয়েছে। শুধু অ্যাডমিন আবার খুলতে পারেন।" (`formatDateTime`); admin gets outline "আবার খুলুন" on the right. The user id is no longer printed. No primary on the page in this state. | D5, D9 (today shows a UUID), D29 |
| 12 | Leave-with-unsaved dialog | `ConfirmDialog tone="danger"`: title "সংরক্ষণ না করে চলে যাবেন?", description "৩টি পরিবর্তন এখনো সংরক্ষিত হয়নি, চলে গেলে হারিয়ে যাবে।", cancel "থাকুন", confirm "তবুও চলে যান". | Today it reuses the "retrying" sentence and has no primary |
| 13 | Submit dialog | `DialogContent size="sm"`; Cancel outline (was ghost) then "জমা দিন"; blank count stays. | D21, D29 |
| 14 | Entry page load/error | Loading: table-shaped skeleton (header band + 8 rows of `h-10`, `aria-busy`). Error: `ErrorState` with `exams:marksList.loadError` (today it shows the page title as the error text). | D28; bug |

## Mobile behaviour
- `/marks`: exam picker full width on its own row; under it the search field + "ফিল্টার" outline button (status lives in the sheet; teachers without search see only the button). List rows are compact two-line rows (`PATTERN: DataTable (unpaginated)`): "শাখা ক · গণিত" then the StatusBadge; the action is a 44 px icon button.
- Entry page: crumbs show the last two; "জমা দিন" is full width under the save-state line; the keyboard help line is hidden; `MarksStepper` below. The stepper's own look (buttons ≥ 44 px, full words "অনুপস্থিত"/"মওকুফ") is a shared request.
- The bottom bar marks "আরও" (the page is in no cell).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Which grids to list | drafts only (today) / all with status | all, drafts first, status filter | The teacher sees what is left and what is done; the status keys already existed for a filter that was never built. |
| Exam picker placement | inside FilterBar / own field | own labelled field beside the FilterBar | It is the page's subject, not a filter: on phone it must stay visible, not hide in the sheet. |
| Entry page `h1` | "গণিত · শাখা ক" / "নম্বর তালিকা" | "নম্বর তালিকা" + context subtitle | h1 must equal the last crumb (D16); the crumb is a static label, and the e2e specs already find the page by this heading. |
| Exam name on the entry page | `useExam(id)` / the cached exam list | `useExams({ limit: 50 })` (same query as `/marks`) and find by id | `GET /exams/:id` needs `EXAM_MANAGE`; a teacher would get a 403 toast. Omit the part when the exam is not in the list. |
| Section name on the entry page | new endpoint / `useExamProgress` | `useExamProgress(examId)` row with this `section_id` | Already allowed for teachers and already cached from `/marks`. |
| Where new strings go | `exams.json` / `grading.json` | `grading.json` (this lane's namespace) | Contract: new keys only in namespaces the lane owns; existing `exams` keys are still read. |
| Sticky header | keep / drop | keep, as `md:sticky md:top-14 md:z-20 md:bg-bg` | Long grids scroll; save state and submit must stay in view. Today's `top-0` slides under the app top bar. Not shown in the one-frame mockup. |

## Files
- `client-admin/src/routes/_staff/marks/index.tsx` — header, picker, FilterBar, DataTable, states
- `client-admin/src/routes/_staff/marks/index.test.tsx` — updated
- `client-admin/src/routes/_staff/marks/$examId.$sectionId.$subjectId.tsx` — header, save line, help, card, submitted card, dialogs, skeleton
- `client-admin/src/routes/_staff/marks/$examId.$sectionId.$subjectId.test.tsx` — updated
- `client-admin/src/routes/_staff/marks/-submit-dialog.tsx` — size, button tiers
- `ui/src/i18n/locales/en/grading.json` — new `marksEntry`, `marksSheet` objects
- `ui/src/i18n/locales/bn/grading.json` — same keys in Bangla

## Steps
1. **Locale (`grading.json`, en / bn).** Add:
   - `marksEntry.subtitleHint` "Pick an exam, then open a section's marks list." / "পরীক্ষা বাছুন, তারপর শাখা ও বিষয়ের নম্বর তালিকা খুলুন।"
   - `marksEntry.subtitleProgress` "{{submitted}} of {{total}} marks lists submitted" / "{{total}}টি নম্বর তালিকার মধ্যে {{submitted}}টি জমা হয়েছে" (pass both through `formatNumber`)
   - `marksEntry.examOption` "{{exam}} · {{class}}" (same in bn)
   - `marksEntry.searchLabel` "Search" / "খুঁজুন"; `marksEntry.searchPlaceholder` "Section or subject" / "শাখা বা বিষয়"
   - `marksEntry.statusLabel` "Status" / "অবস্থা"; `statusAll` "All" / "সব"; `statusDraft` "Not submitted" / "জমা বাকি"; `statusSubmitted` "Submitted" / "জমা হয়েছে"
   - `marksEntry.columnSection` "Section" / "শাখা"; `columnSubject` "Subject" / "বিষয়"; `columnStatus` "Status" / "অবস্থা"
   - `marksEntry.sectionValue` "Section {{name}}" / "শাখা {{name}}"
   - `marksEntry.enterMarks` "Enter marks" / "নম্বর দিন"; `viewMarks` "View marks" / "নম্বর দেখুন"
   - `marksEntry.emptyTitle` "No marks lists yet" / "এখনো কোনো নম্বর তালিকা নেই"; `emptyText` "Marks lists appear once the exam's subjects and mark parts are set." / "পরীক্ষার বিষয় আর নম্বরের ভাগ ঠিক হলে তালিকা এখানে আসবে।"
   - `marksEntry.noMatchTitle` "Nothing matches" / "কিছু মেলেনি"; `noMatchText` "Try another search or status." / "অন্য কিছু লিখে বা অবস্থা বদলে দেখুন।"
   - `marksEntry.noExamsTitle` "No exams yet" / "এখনো কোনো পরীক্ষা নেই"; `noExamsText` "Marks can be entered once an exam is created." / "পরীক্ষা তৈরি হলে এখানে নম্বর দেওয়া যাবে।"
   - `marksSheet.studentCount_one` / `_other` "{{count}} student" / "{{count}} students"; bn both "{{count}} জন শিক্ষার্থী"
   - `marksSheet.keyboardHelp` "Type a mark and press <k>Enter</k> to move down. Press <k>A</k> for absent, <k>E</k> for exempt. Press <k>Ctrl+Enter</k> to submit when done." / "নম্বর লিখে <k>Enter</k> চাপলে নিচের ঘরে যাবে। অনুপস্থিত হলে <k>A</k>, মওকুফ হলে <k>E</k> চাপুন। শেষে <k>Ctrl+Enter</k> চেপে জমা দিন।" (render with `Trans`, `components={{ k: <kbd className="rounded-sm border border-border-subtle bg-muted px-1 font-sans" /> }}`)
   - `marksSheet.submittedAt` "Submitted on {{time}}. Only an admin can reopen it." / "{{time}}-এ জমা দেওয়া হয়েছে। শুধু অ্যাডমিন আবার খুলতে পারেন।"
   - `marksSheet.submittedAtBy` "Submitted by {{name}} on {{time}}. Only an admin can reopen it." / "{{name}} {{time}}-এ জমা দিয়েছেন। শুধু অ্যাডমিন আবার খুলতে পারেন।" (used only once the shared request for `submitted_by_name` lands)
   - `marksSheet.reopen` "Reopen" / "আবার খুলুন"
   - `marksSheet.leaveTitle` "Leave without saving?" / "সংরক্ষণ না করে চলে যাবেন?"; `leaveText_one` / `_other` "{{count}} change is not saved yet and will be lost." / "{{count}} changes are not saved yet and will be lost."; bn both "{{count}}টি পরিবর্তন এখনো সংরক্ষিত হয়নি, চলে গেলে হারিয়ে যাবে।"; `marksSheet.stay` "Stay" / "থাকুন"
2. **Both route loaders**: `loadRouteNamespaces('exams', 'grading', 'common')`.
3. **`marks/index.tsx`.** Remove the outer `div p-4` and `h1` (the layout's `PageContainer` gives width and spacing). Render `PageHeader title={t('items.marksEntry', { ns: 'nav' })} subtitle={…}` per Change 1 (`counts.SUBMITTED` and `counts.DRAFT + counts.SUBMITTED`).
   - Row under it: `<div className="flex flex-col gap-4 md:flex-row md:items-end">`; left a Field (`flex flex-col gap-1.5 md:w-96 md:shrink-0`) with `Label` (`exams:marksList.examLabel`) + the existing `Select` (`SelectTrigger` gets an `id` tied to the label; options `t('grading:marksEntry.examOption', { exam: exam.name, class: exam.class?.name })`, falling back to `exam.name` when there is no class); right `FilterBar` inside `min-w-0 flex-1` with fields: `{ id: 'q', kind: 'search', primary: true, label, placeholder }` only when `canManage`, and `{ id: 'status', kind: 'select', label, options: all/DRAFT/SUBMITTED }`. Keep the values in local state as today (search filters `section_name` and, once present, `subject_name`, case-insensitive).
   - Build rows: `outstanding` filtered by status, then `[...drafts, ...submitted]`.
   - `DataTable` with `paginated={false}`, `caption={t('exams:marksList.tableCaption')}`, `getRowId={(r) => \`${r.section_id}:${r.subject_id}\`}`, columns: section (`t('grading:marksEntry.sectionValue', { name: row.section_name })`, `font-medium`; on phone append " · subject" and the badge on a second line as in the mockup), subject (`row.subject_name ?? '—'`, see Out of scope), status (`<StatusBadge tone={draft ? 'warning' : 'success'} label={…} />`), and `rowActions={(row) => [ { intent: 'edit', label: enterMarks, to: gridPath, allowed: draft && canEnter }, { intent: 'view', label: viewMarks, to: gridPath, allowed: !draft || !canEnter } ]}` where `canEnter = useHasPermission(Permission.MARK_ENTER)`.
   - States per Change 6 (`emptyState` prop for "no grids" / "no match"; `EmptyState` without action when there are no exams, replacing the picker row).
4. **`$examId.$sectionId.$subjectId.tsx`.**
   - Context: `const exam = useExams({ limit: 50 }).data?.data.find((e) => e.id === examId)`; `const row = useExamProgress(examId).data?.outstanding.find((r) => r.section_id === sectionId && r.subject_id === subjectId) ?? …find((r) => r.section_id === sectionId)`. Subtitle = non-empty parts joined with " · ": `row?.subject_name`, `sectionValue(row.section_name)`, `exam?.name`, `studentCount({ count: grid.students.length })`.
   - Header markup: `<header className="flex flex-col gap-3 md:sticky md:top-14 md:z-20 md:flex-row md:items-start md:justify-between md:gap-6 md:bg-bg md:py-2">`; left: `h1 className="text-h1"` (`exams:marksGrid.caption`), subtitle `mt-0.5 text-text-secondary`, save line `mt-2 flex items-center gap-1.5 text-text-secondary` (Change 8; icons `size-4`); right `flex shrink-0 items-center gap-2` with `<Button className="flex-1 md:flex-none" aria-keyshortcuts="Control+Enter" onClick={() => setSubmitOpen(true)}><Send />{t('exams:submitDialog.confirm')}</Button>` rendered only when `canSubmit`.
   - When `submitted`: a Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`, inner `flex flex-col gap-3 md:flex-row md:items-center md:justify-between`) with `StatusBadge tone="success" label={t('grading:marksEntry.statusSubmitted')}` + `marksSheet.submittedAt` (`time: formatDateTime(grid.submitted_at, config)`), and the outline `Button` "আবার খুলুন" (`loading={reopenGrid.isPending}`) when `canReopen`.
   - Desktop body: `<div className="hidden space-y-3 md:block">` with the help line (`text-caption text-text-secondary`) and the Card (`overflow-hidden` flush) holding `<MarksGrid …/>` + `<div className="border-t border-border-subtle px-4 py-3"><TableCount total={grid.students.length} /></div>`. Keep the `isMobile` switch for which component mounts (the two must not both mount — they share autosave); render the help line and card only when `!isMobile`.
   - Blocker: replace the `Dialog` with `ConfirmDialog open={blocker.status === 'blocked'} tone="danger" title={leaveTitle} description={leaveText({ count: autosave.pendingCount })} cancelLabel={stay} confirmLabel={t('exams:saveState.leaveAnyway')} onConfirm={() => blocker.proceed?.()} onOpenChange={(o) => !o && blocker.reset?.()}`.
   - Pending/error per Change 14 (`ErrorState message={t('exams:marksList.loadError')}`).
   - `useRegionConfig()` for `formatTime` / `formatDateTime`; drop both `toLocale*` calls.
5. **`-submit-dialog.tsx`.** `DialogContent size="sm" closeLabel={t('actions.close', { ns: 'common' })}`; cancel `variant="outline"`; blank count `text-text-secondary`. Props unchanged.
6. Run `pnpm --filter client-admin test marks/`, `pnpm --filter @biddaloy/ui check:i18n`, then `graphify update .`.

## Tests
- `marks/index.test.tsx` — the exam picker has the visible label "Exam"; a submitted row shows "Submitted" badge and a "View marks" link; a draft row shows "Enter marks" linking to `/marks/exam-1/sec-1/subj-1` (keep that href assertion); drafts render above submitted rows; status filter "Not submitted" hides submitted rows; footer "Total 2"; the search field renders only with `EXAM_MANAGE`; empty progress renders the "No marks lists yet" empty state and no footer.
- `marks/$examId.$sectionId.$subjectId.test.tsx` — existing save-state and submit tests stay green (button name is now exactly "Submit"); the subtitle contains the section name from the progress mock and the exam name from the exam list mock; the saved line shows a 12-hour time without seconds; a submitted grid shows "Submitted" badge, never the `submitted_by` id text, and no Submit button; an error response renders the load-error sentence, not the page title; the blocker dialog says "Leave without saving?".
- `e2e/journeys/marks-entry.spec.ts` and `e2e/journeys/exam-controller-role.spec.ts` — no change expected (heading text, `save-state-line` test id, cell labels and Ctrl+Enter are kept); run both.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (the `/marks` list has none; the entry page has "জমা দিন" only while it is a draft and the user can enter).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] `/marks` h1 reads "নম্বর দেওয়া"; the exam picker has a visible label; every row has a StatusBadge; the list shows "মোট nটি".
- [ ] The entry page subtitle names the section and the exam; the saved time has no seconds; A/E/Enter/Ctrl+Enter help is visible on desktop.
- [ ] A submitted list shows a date-time sentence and no user id.

## Out of scope
- `/marks` and `/results` are not in the sidebar, so no item lights up — filed (`nav-tree.ts`).
- The subject name is missing from `GET /exams/:id/marks/progress` rows (`section_name` only) — filed; until it lands the বিষয় column and the subtitle part show nothing (column shows "—").
- `submitted_by` is a user id; a display name is filed. Until then the sentence without a name is used.
- The last crumb of the entry page is the raw `$subjectId` — filed (`route-crumbs.ts`: static label).
- The look of `MarksGrid` / `MarksStepper` themselves (tokens, ✓ glyph → icon, numerals in cells, stepper buttons < 44 px, "অনু" → "অনুপস্থিত") — filed (`ui/src/components`).
- Remembering the picked exam in the URL (`?exam=`) when coming back from a list — not done; add if teachers ask.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| marks-grid / marks-stepper kit tokens, tenant digits shown and accepted, icon saved mark, 44px full-word stepper buttons, EmptyState | Accepted | 31.2.14b | no prop change — place MarksGrid / MarksStepper as today |
| sidebar items for /marks and /results | Accepted | 31.3.1 | examsResults.marksEntry -> /marks (permission MARK_VIEW, not MARK_ENTER: nav and route gate must match), icon pen-line, label nav:items.marksEntry "নম্বর দেওয়া"; examsResults.results -> /results (RESULT_PROCESS), icon award, nav:items.results "ফলাফল"; first crumbs become links automatically |
| server subject_name on progress outstanding rows | Accepted | 31.3.7b | fields: outstanding[].subject_name + subject_name_bn (ExamProgress type updated); show bn when the UI is bn |
| server submitted_by_name on getGrid | Deferred | — | use the fallback in the ticket (marksSheet.submittedAt sentence without a name) |
| static last crumb instead of $subjectId | Accepted | 31.3.5 | last crumb = nav:items.marksEntryGrid "নম্বর তালিকা" (dynamic dropped) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: marks   Decisions: D5, D6, D7, D9, D15, D16, D19, D21, D24, D25, D27, D28, D29, D32   Depends on: 31.3.8b
