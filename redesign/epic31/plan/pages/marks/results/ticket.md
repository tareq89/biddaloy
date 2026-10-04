# [31.4.marks-2] Results — status and next step, report card header

## Goal
`/results` shows a labelled exam picker with the exam's result status and a one-line next step above the results panel, its dialogs follow the kit, and `/results/$examId/$studentId` opens with the student's name, pass/fail badge, key facts and "প্রিন্ট করুন" as the one primary — no back link.

## What and why
An admin uses `/results` to pick an exam, work out (process) its results, check them, publish them to guardians and send them by SMS; from a row they open one student's report card to print it. Today the exam picker has no visible label, nothing says where the exam is in DRAFT → PROCESSED → PUBLISHED, so the right next button is a guess among five, and "reopen" is a red filled button on the page. The report card page has no `h1`, starts with an underlined "back to exam" link that goes to the exam page (not where the user came from), and its last crumb is the student id. The redesign adds the status badge + next-step sentence under a labelled picker, tidies the four dialogs, and gives the report card page a kit detail header. The results table and its toolbar live in the exams lane's `results-panel.tsx`; this mockup shows what that file should look like, and exams-2a builds it.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — `/results` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/results/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/results/before-mobile.webp?raw=true" width="260"> |
| After — `/results` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/results/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/results/mobile.webp?raw=true" width="260"> |
| Before — report card | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/results_examId_studentId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/results_examId_studentId/before-mobile.webp?raw=true" width="260"> |
| After — report card | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/results_examId_studentId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/results_examId_studentId/mobile.webp?raw=true" width="260"> |

The "before" report card shot shows an error card — an audit artefact (placeholder ids); the design is built from the code.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | `/results` header | `PageHeader` title "ফলাফল" (`exams:resultsRoute.title`, = nav label), **New** subtitle "পরীক্ষা বাছুন, ফলাফল তৈরি করুন, তারপর প্রকাশ করুন।". No header actions (they belong to the panel). | D16 |
| 2 | Exam picker | Visible `Label` "পরীক্ষা", trigger `md:w-96`; option text **New** "{exam} · {class}" (`exam.class?.name`, already returned by the list). | D24/D25; same-named exams of two classes |
| 3 | Status + next step | **New** beside the picker (under it on phone): `StatusBadge` for `exam.status` — DRAFT neutral "খসড়া", PROCESSED info "প্রক্রিয়াকৃত", PUBLISHED success "প্রকাশিত" (existing `exams:status.*`) — and one sentence: DRAFT "সব নম্বর তালিকা জমা হলে ফলাফল প্রক্রিয়া করুন।", PROCESSED "ফলাফল দেখে নিন, তারপর প্রকাশ করুন। প্রকাশের পর অভিভাবকেরা দেখতে পাবেন।", PUBLISHED "অভিভাবকেরা এই ফলাফল দেখতে পাচ্ছেন।". | D27; one obvious next action |
| 4 | Panel | `<ResultsPanel examId={selectedExam.id} examStatus={selectedExam.status} />` exactly as today — this ticket does not change the panel or its call. `examStatus` stays a supported (optional) prop. The panel's redesign (toolbar with one primary chosen by status, reopen in More, sortable DataTable, StatusBadge, numerals — as in the mockup) arrives with exams-2a (exams lane): it draws that toolbar whenever `examStatus` is passed. `/results` works before exams-2a (today's panel buttons) and after it (the new toolbar). | Territory (D3) |
| 5 | `/results` states | Exams loading: skeleton bar the size of the picker. Error: `ErrorState` (existing key). No exams: `EmptyState` "এখনো কোনো পরীক্ষা নেই" (key from marks-1) instead of an empty select. | D28 |
| 6 | Process dialog | `DialogContent size="md"`; outstanding grids as a bordered list (`ul divide-y divide-border-subtle rounded-md border border-border-subtle`, rows `px-3 py-2`, label "শাখা ক" + " · গণিত" once `subject_name` exists) instead of a bullet list; the force warning as a warning callout (`flex gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg`, `triangle-alert`), keeping `role="alert"`; error line uses the kit Error text. "তবুও প্রক্রিয়া করুন" stays red filled (it is the confirm of an audited override inside a dialog, D29). | D21, D29 |
| 7 | Publish / reopen dialogs | `DialogContent size="sm"`; error line as kit Error text (`circle-alert`). Reopen confirm stays red filled (confirm inside a dialog). | D21 |
| 8 | SMS dialog | `DialogContent size="sm"`; after queueing, the "{{count}} টি বার্তা সারিবদ্ধ হয়েছে।" line gets `circle-check` in `text-status-paid-fg`; error line as kit Error text. | D27-style feedback |
| 9 | Report card header | `DetailShell` without tabs (`name` = student full name, `statusBadge` = `StatusBadge` success "কৃতকার্য" / danger "অকৃতকার্য" from `result.is_fail` (existing `exams:resultsPanel.pass/fail`), `facts` = পরীক্ষা (exam name), রোল, জিপিএ ("৫.০০ · A+"), অবস্থান (or "—"), `actions` = one primary "প্রিন্ট করুন" (`printer`) → `window.print()`). Header is `print:hidden`. | D16, D27 |
| 10 | Back link | Delete the "পরীক্ষায় ফিরে যান" link; the layout's crumbs "ফলাফল › {student}" take over. | D16 |
| 11 | Report card body | The existing `ReportCard` inside a Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`, `print:border-0 print:p-0 print:shadow-none`), so it reads as the paper it prints to. | Kit card; print unaffected |
| 12 | Report card states | Loading: header-shaped skeleton (title bar `h-7 w-48`, four `w-24` fact bars, then an `h-96` block), `aria-busy`. Error: unchanged `ErrorState`. | D28 |

## Mobile behaviour
- `/results`: picker full width; the status badge and sentence wrap under it. The panel toolbar (from exams-2a) puts the primary full width with a More button holding the outline actions; result rows become cards (name + badge, "রোল · অবস্থান", মোট নম্বর / জিপিএ / গ্রেড, "ফলাফলপত্র দেখুন").
- Report card: crumbs show the last two; facts are a 2-column grid (exam spans both); "প্রিন্ট করুন" is full width; the report card table keeps its four columns.
- The bottom bar marks "আরও".

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Panel redesign | copy the table into `/results` / edit `results-panel.tsx` / ask the owner | exams-2a builds it (mockup as the spec); this ticket keeps passing `examStatus` | The exam detail's Results tab and `/results` render one component; a copy would drift, and the file belongs to another lane running at the same time. exams-2a keeps `examStatus` as an optional prop, so the call here is right before and after it — no order between the lanes. |
| Where the result actions sit | page header / panel toolbar | panel toolbar (drawn when `examStatus` is passed) | The same panel sits inside the exam detail tab, whose header already holds the exam's own actions — there exams-2a omits `examStatus`, so no toolbar. One primary per view still holds. |
| Report card `h1` | "ফলাফলপত্র" / student name | student name | It is what the user is looking for; the crumb resolver to match it is filed. |
| Report card facts | none / everything / four facts | পরীক্ষা, রোল, জিপিএ, অবস্থান + pass/fail badge | Enough to confirm "right student, right exam" before printing; the full sheet is right below. |
| Reopen as red filled | keep on page / More item + dialog | exams-2a's panel toolbar puts it in More; the dialog's confirm stays red | D29: red filled only as a confirm inside a dialog. |

## Files
- `client-admin/src/routes/_staff/results/index.tsx` — header, picker, status + next step, states
- `client-admin/src/routes/_staff/results/index.test.tsx` — **new**
- `client-admin/src/routes/_staff/results/$examId.$studentId.tsx` — detail header, card, skeleton, no back link
- `client-admin/src/routes/_staff/results/$examId.$studentId.test.tsx` — updated
- `client-admin/src/routes/_staff/results/-process-dialog.tsx` — size, list, warning callout
- `client-admin/src/routes/_staff/results/-process-dialog.test.tsx`
- `client-admin/src/routes/_staff/results/-publish-dialog.tsx` — sizes, error line
- `client-admin/src/routes/_staff/results/-publish-dialog.test.tsx`
- `client-admin/src/routes/_staff/results/-send-result-sms-dialog.tsx` — size, success/error lines
- `client-admin/src/routes/_staff/results/-send-result-sms-dialog.test.tsx`
- `ui/src/i18n/locales/en/grading.json` — new `resultsPage` object (also changed by marks-1, runs earlier)
- `ui/src/i18n/locales/bn/grading.json` — same (also changed by marks-1, runs earlier)

## Steps
1. **Locale (`grading.json`, en / bn).** Add `resultsPage.subtitle` "Pick an exam, work out its results, then publish them." / "পরীক্ষা বাছুন, ফলাফল তৈরি করুন, তারপর প্রকাশ করুন।"; `resultsPage.nextStep.DRAFT` "Work out the results once every marks list is submitted." / "সব নম্বর তালিকা জমা হলে ফলাফল প্রক্রিয়া করুন।"; `resultsPage.nextStep.PROCESSED` "Check the results, then publish. Guardians see them after publishing." / "ফলাফল দেখে নিন, তারপর প্রকাশ করুন। প্রকাশের পর অভিভাবকেরা দেখতে পাবেন।"; `resultsPage.nextStep.PUBLISHED` "Guardians can see these results." / "অভিভাবকেরা এই ফলাফল দেখতে পাচ্ছেন।"; `resultsPage.gpaValue` "{{gpa}} · {{grade}}" (same in bn). Reuse `marksEntry.examOption`, `marksEntry.noExamsTitle/Text`, `marksEntry.sectionValue` from marks-1.
2. **Loaders.** Both routes: `loadRouteNamespaces('exams', 'grading', 'common')`.
3. **`results/index.tsx`.** Drop the outer `div p-4` and `h1`. `PageHeader title={t('resultsRoute.title')} subtitle={t('grading:resultsPage.subtitle')}`. Row `flex flex-col gap-3 md:flex-row md:items-end md:gap-4`: Field (`flex flex-col gap-1.5 md:w-96 md:shrink-0`) with `Label htmlFor` + the existing `Select` (option text per Change 2); when `selectedExam`, a block `flex min-w-0 items-start gap-2 md:min-h-8 md:items-center` with `<StatusBadge tone={TONE[selectedExam.status]} label={t(\`status.${selectedExam.status}\`)} />` (`TONE = { DRAFT: 'neutral', PROCESSED: 'info', PUBLISHED: 'success' }`) and `<p className="text-text-secondary">{t(\`grading:resultsPage.nextStep.${selectedExam.status}\`)}</p>`. Then `<ResultsPanel examId={selectedExam.id} examStatus={selectedExam.status} />` exactly as today (keep `examStatus` — it is what turns on the panel's action toolbar). States per Change 5 (`exams.length === 0` → `EmptyState` with `icon` `file-pen-line`, no action).
4. **`-process-dialog.tsx`.** Per Change 6. Row label: `t('grading:marksEntry.sectionValue', { name: row.section_name })` + (`row.subject_name` ? ` · ${row.subject_name}` : ''). Export name and props unchanged (the exams lane imports it — `results-panel.tsx` today, `use-result-actions.tsx` after exams-2a).
5. **`-publish-dialog.tsx`, `-send-result-sms-dialog.tsx`.** Per Changes 7–8: `size="sm"`, `closeLabel={t('actions.close', { ns: 'common' })}`, error `<p role="alert" className="flex items-center gap-1 text-caption text-destructive"><CircleAlert className="size-3.5" />…</p>`; SMS success `<p className="flex items-center gap-1.5 text-text-secondary"><CircleCheck className="size-4 text-status-paid-fg" />…</p>`. Exports and props unchanged.
6. **`$examId.$studentId.tsx`.** Remove the top `div` with the `Link` and `Button`. Render `<DetailShell name={detail.student.full_name} statusBadge={…} facts={[{ label: t('reportCard.examLabel'), value: examQuery.data.name }, { label: t('reportCard.rollLabel'), value: formatNumber(detail.student.roll_number, config) }, { label: t('reportCard.gpa'), value: t('grading:resultsPage.gpaValue', { gpa: formatNumber(detail.result.gpa, config, { decimals: 2 }), grade: detail.result.grade }) }, { label: t('reportCard.position'), value: detail.result.position === null ? '—' : formatNumber(detail.result.position, config) }]} actions={[{ id: 'print', label: t('reportCard.print'), priority: 'primary', icon: <Printer />, onClick: () => window.print() }]} className="print:hidden">` (if `DetailShell` has no `className`, wrap the header in `<div className="print:hidden">`), then the Card around `<ReportCard …/>` per Change 11. Skeleton per Change 12. `useRegionConfig()` for `formatNumber`.
7. Run `pnpm --filter client-admin test results/`, `pnpm --filter @biddaloy/ui check:i18n`, then `graphify update .`.

## Tests
- `results/index.test.tsx` (new) — the picker has the visible label "Exam"; with a PROCESSED exam selected the "Processed" badge and the "Check the results, then publish…" sentence show; switching to a PUBLISHED exam shows "Published" and its sentence; an empty exam list shows "No exams yet" and no picker; an exam with a class shows "{name} · {class}" as the option text. Do not assert the panel's action buttons here — they change when exams-2a lands (covered by `exams/-detail/results-panel.test.tsx`).
- `$examId.$studentId.test.tsx` — no "Back to exam" link (replace that assertion); the `h1` is "Rafi Ahmed"; facts show the exam name, roll and GPA "5.00 · A+"; a failing student shows the "Fail" badge; exactly one filled button ("Print") and it calls `window.print`; because the name and exam now appear in the header and the card, switch `getByText('Rafi Ahmed')` / `findByText('Half-Yearly 2026')` to `getAllByText(...)[0]` or scope them to the card region.
- `-process-dialog.test.tsx`, `-publish-dialog.test.tsx`, `-send-result-sms-dialog.test.tsx` — existing button-name assertions stay; add: the force warning still has `role="alert"`; the SMS success line renders after a queued response.
- `e2e/journeys/result-publish.spec.ts` drives the exam detail tab and dialog titles/buttons by key — no change expected; run it.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (the panel part once exams-2a is merged; before that the panel looks as today and its actions still work).
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] `/results` shows the exam's status badge and a next-step sentence for each of the three statuses.
- [ ] The report card page has one `h1` (the student's name), no back link, and prints without the header.

## Out of scope
- `results-panel.tsx` (toolbar, table, row actions, numerals, red "reopen" button on the page) — exams-2a builds it with this mockup as the spec. The panel is unchanged by this ticket; `examStatus` stays a supported prop and keeps being passed.
- `/results` is not in the sidebar — filed with marks-1's nav request.
- The report card's last crumb is the student id — filed (`reportCard` crumb resolver).
- `ReportCard` prints GPA with `toFixed(2)` (Latin digits) and uses old tokens — filed (`ui/src/components/print/report-card.tsx`).
- `exams:reportCard.back` becomes unused — left for the exams lane to delete.
- The outstanding list in the process dialog names only the section until `subject_name` lands (filed in marks-1).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| report-card numbers via formatNumber (GPA decimals 2), text-text-secondary | Accepted | 31.2.14b | no prop change |
| crumb resolver: report card student name | Accepted | 31.3.5 | resolver key reportCard reads the resultDetailKey(examId, studentId) cache (what useResultDetail fills, not studentQueryOptions) -> student.full_name |
| results-panel redesign + actions (exams-lane file) | Accepted | 31.4.exams-2a | no change here: keep rendering <ResultsPanel examId examStatus />. exams-2a keeps examStatus as an optional prop and, when it is passed, draws the status toolbar from useResultActions (as in this mockup); the exam detail omits it. /results works before and after exams-2a lands — no order between the lanes |

Wave: 9   Lane: marks   Decisions: D5, D6, D9, D15, D16, D19, D21, D24, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.marks-1
