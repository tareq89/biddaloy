# [31.4.exams-2a] Exam detail — facts header, result actions on top, progress tab

## Goal
`/exams/$examId` opens with a detail header (name, status badge, class, year, type) that holds the exam's one next step as the primary action, and its Progress and Results tabs follow the kit. Too big for one ticket: this is part **a**; part **b** (`ticket-b.md`, runs after a) does the Marks-breakdown and Schedule tabs.

## What and why
The exam controller opens an exam every day to see which marks lists are still missing, chase them, and finally process and publish the results. Today the page starts with an underlined back link, shows "টার্ম · খসড়া" as plain text with no class or year, lists missing marks lists by section only (two subjects of section A look identical), offers a state filter that can never show anything but drafts, and hides process / publish / SMS inside the Results tab next to a red filled "reopen" button. The redesign puts name + status + facts in the kit's detail header, makes the action that moves the exam forward (process → publish → SMS) the single primary there, and turns the Progress and Results tabs into kit cards and tables with names and badges.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After (Progress tab, draft exam) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_examId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_examId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Top | Delete the "পরীক্ষার তালিকায় ফিরে যান" link; the layout's crumbs (`পরীক্ষা › <exam name>`) take over. | D16 |
| 2 | Header | `DetailShell` header: name `h1` + `ExamStatusBadge` (from exams-1). `facts`: শ্রেণি (`useClass(class_id)` name), শিক্ষাবর্ষ (`useAcademicYear(academic_year_id)` name), ধরন, and **New** "ফলাফল প্রকাশ" = `formatDate(published_at)` only when set. Drop the `identifiers` string. | D16, D27, D9 — which class and year the exam is for was missing |
| 3 | Header actions | Moved here from the Results tab, chosen by status (table below). They come from **New** `useResultActions(examId, status)` (`-detail/use-result-actions.tsx`), which `/results` also uses through `ResultsPanel`. Process needs `RESULT_PROCESS`; publish, SMS, reopen need `RESULT_PUBLISH`; edit needs `EXAM_MANAGE` — today these buttons show to everyone and fail on the server. | D16, D29 — one primary that always means "the next step"; reopen no longer red filled |
| 4 | Tabs | Kit line tabs; labels অগ্রগতি · **নম্বর বিভাজন** (was "সেটআপ") · সময়সূচি · ফলাফল; Progress stays the default; `?tab=` stays. | D20, D32 — "Setup" said nothing about what is set up |
| 5 | Progress — summary | Card "নম্বর জমার অগ্রগতি": "৩৬০টির মধ্যে ৮৭টি নম্বর তালিকা জমা হয়েছে" (`text-h3`), progress bar with `role="progressbar"`, help "সব তালিকা জমা হলে ফলাফল প্রক্রিয়া করুন।". | Links the number to the next step |
| 6 | Progress — list | Card "যে তালিকা এখনো জমা হয়নি" + help; table বিষয় (**New**: subject name from `useClassSubjects`) · শাখা · কাজ (`RowActions` edit "নম্বর দিন" → `/marks/$examId/$sectionId/$subjectId`); client-side pages of 25 with `TableCount`. Remove the state filter. | The server returns only not-submitted rows (`mark-grid.service.ts:418`), so the filter was dead; rows without a subject were ambiguous |
| 7 | Progress — empty | All submitted: `EmptyState` `circle-check` "সব নম্বর তালিকা জমা হয়েছে" + "এখন ফলাফল প্রক্রিয়া করা যায়।" (no action — the header has it). No lists at all: "এখনো কোনো নম্বর তালিকা নেই" + "নম্বর বিভাজন ট্যাবে বিষয়ের অংশ যোগ করলে তালিকা তৈরি হবে।" + outline "নম্বর বিভাজনে যান" (switches tab). | D28 |
| 8 | Results tab | On the exam detail the tab has no action buttons, only the "শুধু অকৃতকার্য" checkbox row (the header holds the actions). `ResultsPanel` keeps `examStatus` as an **optional** prop: when it is passed (`/results`, marks lane) the checkbox row also holds the status toolbar from the same `useResultActions`, as in `PLAN/pages/marks/results/mockup.html`; when it is omitted (exam detail) there is no toolbar. `DataTable` `paginated={false}` with the existing local sort: অবস্থান · রোল · নাম (link, no underline) · মোট · জিপিএ · গ্রেড · অবস্থা (`StatusBadge` success "কৃতকার্য" / danger "অকৃতকার্য"); numbers right-aligned through `formatNumber` (GPA 2 decimals). Footer "মোট n টি". Empty: `EmptyState` "এখনো কোনো ফলাফল নেই" + "নম্বর তালিকা জমা হলে উপরের \"ফলাফল প্রক্রিয়া করুন\" চাপুন।". | D6, D19, D27, D28 |
| 9 | Loading / error | Header skeleton (title bar + 3 fact bars) instead of one bar; `ErrorState` kept. | D28 |

Result actions by status — one table, built once by `useResultActions`, used by the exam header and by the `/results` panel toolbar (order on screen: outline, primary, More). "সম্পাদনা" (edit exam) is added by `$examId.tsx` only; `/results` never shows it.

| Status | Outline (secondary) | Primary | More menu |
|---|---|---|---|
| DRAFT | — | ফলাফল প্রক্রিয়া করুন (`calculator`) | (সম্পাদনা) |
| PROCESSED | ফলাফল বিশ্লেষণ (`trending-up`) · আবার প্রক্রিয়া করুন (`refresh-cw`) | প্রকাশ করুন (`globe`) | (সম্পাদনা) |
| PUBLISHED | ফলাফল বিশ্লেষণ (`trending-up`) | ফলাফল এসএমএস পাঠান (`message-square`) | (সম্পাদনা ·) separator · পুনরায় খুলুন (`rotate-ccw`, `text-destructive`, last) |

A user without the permission for the primary sees the next allowed result-changing action (আবার প্রক্রিয়া করুন) as primary, or none; "ফলাফল বিশ্লেষণ" is never promoted. "পুনরায় খুলুন" is never a red filled button (D29); its confirm is `ReopenPreviewDialog`.

## Mobile behaviour
- Crumbs show the last two; facts are a 2-column grid.
- Primary full width (`flex-1`) + More icon button; the outline action moves into More.
- Tab row scrolls sideways if it does not fit.
- Progress list: compact two-line rows (subject, then "শাখা ক" as caption) with the pencil icon; pager under the count.
- Results: compact rows "রোল · নাম" + badge on the first line, "মোট ৫৪২ · জিপিএ ৪.৫০ · গ্রেড A" as caption; position as a leading number.
- Panel toolbar (only when `examStatus` is passed, i.e. `/results`): actions row above the checkbox (`flex-col-reverse`); primary full width (`flex-1`) + More; the outline actions move into More.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where process / publish / SMS live | Results tab / header | header (exam detail); panel toolbar only on `/results` | They change the exam's status shown in the header (control next to what it changes) and must be reachable from the default tab. `/results` has no exam header, so there the panel draws them. |
| Sharing the actions with `/results` | delete `examStatus` and let a later ticket rebuild `/results` actions / one hook + optional `examStatus` | `useResultActions` + optional `examStatus` | marks-2 (marks lane, runs in parallel, order unknown) renders `<ResultsPanel examId examStatus />`. Keeping the prop and drawing the toolbar when it is passed makes `/results` work whichever ticket merges first, with no cross-lane step and one status table instead of two copies. |
| Primary per status | fixed / by status | by status | One filled button that always means "the next step" (D16, D29). |
| Reopen | red filled / outline / More | last More item | D29: red filled only inside a confirm dialog; reopening is rare and needs extra approval. The existing `ReopenPreviewDialog` is the confirm. |
| Progress filter | keep / remove | remove | The endpoint never returns submitted rows, so "submitted" always showed nothing. |
| Progress paging | one long table / client pages of 25 | client pages of 25 | A school can have hundreds of missing lists; `useExamProgress` returns them all in one call. |
| Class and year names | ask the server to embed them / client lookup | `useClass` + `useAcademicYear` | Both hooks exist; no API change (D1, D3). |
| Subject names | `name_en` everywhere / by language | `name_bn` when the UI is Bangla and it is set, else `name_en` | Today an English subject name shows on Bangla screens. Lane helper `subjectLabel`, also used by part b. |

## Files
- `client-admin/src/routes/_staff/exams/$examId.tsx` — header, facts, actions, dialogs, edit dialog, tab labels (also changed by exams-2b, runs later)
- `client-admin/src/routes/_staff/exams/$examId.test.tsx`
- `client-admin/src/routes/_staff/exams/-detail/progress-panel.tsx` — summary card, outstanding table, empty states
- `client-admin/src/routes/_staff/exams/-detail/progress-panel.test.tsx`
- `client-admin/src/routes/_staff/exams/-detail/use-result-actions.tsx` — **New** `useResultActions(examId, examStatus)`: status-driven action list + the four dialogs
- `client-admin/src/routes/_staff/exams/-detail/results-panel.tsx` — table, badges, numbers; old buttons and dialog states removed; optional `examStatus` → toolbar from `useResultActions`
- `client-admin/src/routes/_staff/exams/-detail/results-panel.test.tsx`
- `client-admin/src/routes/_staff/exams/-detail/subject-label.ts` — **New** helper (also used by exams-2b)
- `ui/src/i18n/locales/{en,bn}/exams.json` — keys below (also changed by exams-1, runs earlier)
- `e2e/journeys/result-publish.spec.ts` — process / publish / reopen are header actions now

Used, not changed: `-exam-status-badge.tsx` and `-exam-form-dialog.tsx` (exams-1); `routes/_staff/results/-process-dialog.tsx`, `-publish-dialog.tsx`, `-send-result-sms-dialog.tsx` (marks lane — only their import site moves, into `use-result-actions.tsx`; marks-2 keeps their exports and props). `routes/_staff/results/index.tsx` (marks lane) keeps rendering `<ResultsPanel examId examStatus />` — do not edit it.

## Steps
1. **Locale (`exams.json`, en + bn).** `detail`: add `tabsLabel` "Exam details" / "পরীক্ষার তথ্য"; `facts.class` "Class" / "শ্রেণি"; `facts.academicYear` "Academic year" / "শিক্ষাবর্ষ"; `facts.kind` "Type" / "ধরন"; `facts.publishedAt` "Results published" / "ফলাফল প্রকাশ"; `edit` "Edit" / "সম্পাদনা"; `moreActions` "More actions" / "আরও অ্যাকশন"; change `tabs.setup` → "Marks breakdown" / "নম্বর বিভাজন"; delete `back`, `identifiers`, `resultsPlaceholder`. `progressPanel`: add `title` "Marks submission progress" / "নম্বর জমার অগ্রগতি"; `hint` "Process the results once every list is submitted." / "সব তালিকা জমা হলে ফলাফল প্রক্রিয়া করুন।"; `outstandingTitle` "Lists not submitted yet" / "যে তালিকা এখনো জমা হয়নি"; `outstandingHelp` "The pencil opens marks entry for that section and subject." / "কলম চাপলে ওই শাখা ও বিষয়ের নম্বর দেওয়ার পাতা খুলবে।"; `columnSubject` "Subject" / "বিষয়"; `sectionValue` "Section {{name}}" / "শাখা {{name}}"; `enterMarks` "Enter marks" / "নম্বর দিন"; `allSubmittedTitle` "Every marks list is submitted" / "সব নম্বর তালিকা জমা হয়েছে"; `allSubmittedText` "You can process the results now." / "এখন ফলাফল প্রক্রিয়া করা যায়।"; `noListsTitle` "No marks lists yet" / "এখনো কোনো নম্বর তালিকা নেই"; `noListsText` "Lists appear once subjects have parts in the Marks breakdown tab." / "নম্বর বিভাজন ট্যাবে বিষয়ের অংশ যোগ করলে তালিকা তৈরি হবে।"; `goToSetup` "Go to Marks breakdown" / "নম্বর বিভাজনে যান"; change `columnSection` → "Section" / "শাখা"; delete `stateFilterLabel`, `stateAll`, `stateDraft`, `stateSubmitted`, `stateDRAFT`, `stateSUBMITTED`, `columnState`, `empty` (check with `rg -n "progressPanel\." client-admin ui` first). `resultsPanel`: add `emptyTitle` "No results yet" / "এখনো কোনো ফলাফল নেই"; change `empty` → "Once the marks lists are submitted, press \"Process results\" at the top." / "নম্বর তালিকা জমা হলে উপরের \"ফলাফল প্রক্রিয়া করুন\" চাপুন।"; add `analysis` "Result analysis" / "ফলাফল বিশ্লেষণ"; `reprocess` "Process again" / "আবার প্রক্রিয়া করুন"; `rollName` "{{roll}} · {{name}}". Keep `process`, `publish`, `reopen`, `sendSms` (the hook uses them).
2. **`-detail/subject-label.ts`.** `export function subjectLabel(subject: { name_en: string; name_bn?: string | null }, language: string): string` → `language.startsWith('bn') && subject.name_bn ? subject.name_bn : subject.name_en`. One small test inside `progress-panel.test.tsx` is enough.
3. **`-detail/use-result-actions.tsx` (new).** `export function useResultActions(examId: string, examStatus: string | undefined): { actions: PageAction[]; dialogs: React.ReactNode }` (`PageAction` from `@biddaloy/ui/shells`). Inside: `useResults(examId)` (same cached query the Results tab uses; `resultCount = data?.length ?? 0`), `useHasPermission` for `RESULT_PROCESS` and `RESULT_PUBLISH`, `useNavigate`, and the four `open` states that live in `results-panel.tsx` today. `actions` follows the status table, in on-screen order (secondaries first, then the primary, then reopen), each `{ id, label: t('resultsPanel.<key>'), icon, priority, allowed, onClick }`: DRAFT → `process` primary; PROCESSED → `analysis` secondary, `reprocess` secondary (opens the process dialog), `publish` primary; PUBLISHED → `analysis` secondary, `sendSms` primary, `reopen` `priority: 'destructive'`. If the status's primary is not `allowed`, promote `reprocess` when it is allowed, otherwise there is no primary (`analysis` is never promoted). `analysis` → `navigate({ to: '/analysis', search: { examId, tab: 'merit' } })`. `dialogs` = `ProcessDialog`, `PublishDialog`, `ReopenPreviewDialog`, `SendResultSmsDialog` (imports from `../../results/…`) with exactly today's props (`resultCount`, SMS gets `examStatus`). When `examStatus` is `undefined` return `{ actions: [], dialogs: null }` (hooks still run — call order never changes).
4. **`$examId.tsx` — header.** Remove the `Link`. Hooks: `useExam`, `useClass(exam?.class_id)`, `useAcademicYear(exam?.academic_year_id)`, `useHasPermission(EXAM_MANAGE)`, `const resultActions = useResultActions(examId, exam?.status)` (call before any early return). `DetailShell` props: `name`, `statusBadge={<ExamStatusBadge status={exam.status} />}`, `facts` per Change 2 (a fact whose lookup is loading renders `<Skeleton className="h-3 w-16" />`, never the id), `actions={[...resultActions.actions, { id: 'edit', label: t('detail.edit'), icon: <Pencil />, priority: 'tertiary', allowed: canManage, onClick: () => setEditOpen(true) }]}`. `PageHeaderActions` (31.2.5a) does the tiering: tertiary and destructive go into More, destructive last after a separator in `text-destructive`; outline buttons and the primary move to More / full width on phone.
5. **`$examId.tsx` — dialogs.** Render `{resultActions.dialogs}` once. Add `ExamFormDialog mode="edit"` with `examId`, `initialValues={{ name, kind }}`. Pending: header skeleton (`aria-busy="true"`, bars `h-3 rounded-sm bg-muted`: one `h-7 w-64`, three `w-24`).
6. **`$examId.tsx` — tabs.** Pass `classId` and `academicYearId` to `ProgressPanel` plus `onGoToSetup={() => setActiveTab('setup')}`; `ResultsPanel` gets only `examId` (no `examStatus`, so no second set of actions inside the tab). Tab ids unchanged.
7. **`progress-panel.tsx`.** Summary: Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`) with `h2 text-h2` title, `p mt-1 text-h3` `submittedOf`, bar `mt-3 h-2 w-full overflow-hidden rounded-full bg-muted` + inner `h-full rounded-full bg-primary` (width via `style`, the only computed value), `role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={submitted} aria-label={t('progressPanel.title')}`, hint `mt-2 text-text-secondary`. List: Card `overflow-hidden` with header (`p-4 md:p-5`, title + help) and `DataTable` (columns `subject` = `subjectLabel(…)` falling back to `—`, `section` = `t('progressPanel.sectionValue', { name: row.section_name })`; `rowActions` = `[{ intent: 'edit', label: t('progressPanel.enterMarks'), to: '/marks/$examId/$sectionId/$subjectId' with params }]`), rows sorted by section name then subject label, client-side `page` state with page size 25 (`data={sorted.slice((page-1)*25, page*25)}`, `totalCount={sorted.length}`). Empty states per Change 7 (`total === 0` → no lists; `outstanding.length === 0` → all submitted). Delete the state `Select`. Loading: `Skeleton` card + table skeleton.
8. **`results-panel.tsx`.** Delete today's action buttons, the four dialog states and the dialog imports (they live in the hook now). `examStatus` becomes optional: `export interface ResultsPanelProps { examId: string; examStatus?: string }` — existing callers keep compiling, including marks-2's `/results`. `const { actions, dialogs } = useResultActions(examId, examStatus)` at the top (before the loading/error returns). Toolbar row `flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between` (mockup `PLAN/pages/marks/results/mockup.html`, the `ResultsPanel` section): left the `Checkbox` label `flex min-h-11 items-center gap-3 md:min-h-8` "শুধু অকৃতকার্য"; right, only when `actions` has an allowed item, `div.flex.items-center.gap-2` with — for `allowed !== false` actions — each secondary as `Button variant="outline" className="hidden md:inline-flex"` (icon + label), the primary as `Button className="flex-1 md:flex-none"`, then a More `Menu` (ghost icon `Button size="icon"`, `Ellipsis`, `aria-label={t('actions.moreActions', { ns: 'common' })}`, `MenuContent align="end"`) holding the secondaries as `MenuItem className="md:hidden"` and, after a `MenuSeparator`, the destructive one (`reopen`) as the last `MenuItem` with `text-destructive`. The More trigger gets `md:hidden` when there is no destructive action (PROCESSED in the mockup). Never a `variant="destructive"` button. When `examStatus` is omitted the row is the checkbox alone. Render `{dialogs}` after the table. Table: `DataTable` `paginated={false}`, `sorting`/`onSortingChange` mapped onto the existing `sortColumn`/`sortDesc` state and comparator (keep "no position sorts last"); columns `position` (align end, `formatNumber` or `—`), `full_name` (`Link` `font-medium hover:text-primary` with `rollName`, roll through `formatNumber`), `total_marks` (end, `formatNumber`), `gpa` (end, `formatNumber(gpa, config, { decimals: 2 })`), `grade`, `status` (`StatusBadge tone={is_fail ? 'danger' : 'success'} label={…}`). `emptyState` per Change 8.
9. **`e2e/journeys/result-publish.spec.ts`.** After `page.goto('/exams/<id>')`, click the header button `t('exams.resultsPanel.process')` without opening the Results tab; then expect the header button `t('exams.resultsPanel.publish')`; after publishing, open More (`getByRole('button', { name: t('exams.detail.moreActions') })`) and expect `getByRole('menuitem', { name: t('exams.resultsPanel.reopen') })`. Keep the Results-tab review step (open the tab, see the row).
10. Run `pnpm --filter client-admin test exams/\$examId exams/-detail/progress exams/-detail/results results/`, then `graphify update .`. (`results/` = marks-2's `/results` tests: they must stay green whether or not marks-2 is already merged.)

## Tests
- `$examId.test.tsx` — no back link; facts show the class and year names; a DRAFT exam has exactly one filled button "ফলাফল প্রক্রিয়া করুন"; PROCESSED shows primary "প্রকাশ করুন" and outline "আবার প্রক্রিয়া করুন"; PUBLISHED shows primary SMS and "পুনরায় খুলুন" only inside More; without `RESULT_PROCESS` the DRAFT exam has no primary; tab label "নম্বর বিভাজন"; the Results tab shows no action buttons (only the header has them).
- `progress-panel.test.tsx` — summary text and `progressbar` values; rows show the subject name (bn name when the language is bn) and "শাখা ক"; the pencil links to the marks route; 30 rows paginate to 25 + "মোট ৩০"; no state filter exists; all-submitted and no-lists empty states (the latter's button calls `onGoToSetup`).
- `results-panel.test.tsx` — keep the sort and fail-filter tests; pass/fail render as badges; GPA renders with the tenant numerals. Rewrite the Publish/Reopen button tests for the optional prop: without `examStatus` there is no button besides the sort headers and the checkbox; `examStatus="DRAFT"` → one filled "ফলাফল প্রক্রিয়া করুন" that opens the process dialog; `"PROCESSED"` → outline "ফলাফল বিশ্লেষণ" + "আবার প্রক্রিয়া করুন" and one filled "প্রকাশ করুন" that opens the publish dialog; `"PUBLISHED"` → filled "ফলাফল এসএমএস পাঠান", "পুনরায় খুলুন" only as a `menuitem` after opening "আরও অ্যাকশন", and no button with the destructive variant; without `RESULT_PUBLISH` a PROCESSED exam's primary is "আবার প্রক্রিয়া করুন".
- `e2e/journeys/result-publish.spec.ts` — as in Step 9.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No back link; header shows status badge, class, year and type.
- [ ] The primary action follows the status table; no red filled button on the page.
- [ ] `/results` (marks lane page, not edited here) still processes, publishes, sends SMS and reopens: its panel shows the status toolbar with one filled primary, matching the toolbar in `PLAN/pages/marks/results/mockup.html`; the exam detail's Results tab shows no actions.
- [ ] `ResultsPanel` still accepts `examStatus` (optional); `results/index.tsx` is untouched and `results/` tests pass.
- [ ] Every missing marks list names its subject and section; no state filter.
- [ ] Results show pass/fail as badges and numbers in the tenant numerals.

## Out of scope
- Marks-breakdown and Schedule tabs → `ticket-b.md` (exams-2b).
- The process / publish / reopen / SMS dialogs themselves (`routes/_staff/results/**`, marks lane).
- Crumb label for the exam (B15/B16) → 31.3.4 / 31.3.5.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server overlap warnings as data | Deferred | — | use the fallback in the ticket (compute clashes client-side, ignore warnings) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: exams   Decisions: D6, D9, D16, D19, D20, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.exams-1
