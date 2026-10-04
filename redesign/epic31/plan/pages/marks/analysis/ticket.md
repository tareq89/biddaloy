# [31.4.marks-3] Result analysis — labelled pickers, one toolbar, readable tables

## Goal
`/analysis` has the kit header with Print and CSV once (not once per tab), labelled exam and section pickers, line tabs, and tables that show tenant numerals, a pass/fail `StatusBadge`, a distinct overall row and a "মোট nটি" total.

## What and why
An admin, teacher or exam controller opens `/analysis` to pick an exam (and maybe one section) and read its merit list, the students who failed or were absent, and the pass rate of each subject — then print it or download a CSV. Today the two pickers have no visible label, the exam option is only "Half Yearly Exam" (two classes look the same), Print and CSV are repeated inside each tab, pass/fail is plain text, numbers come out in Latin digits (`4.50`, `83.3%`), the overall row of the pass/fail table looks like one more subject and prints the server's English word "Overall", and an unprocessed exam shows a filled button that only jumps to another page. The redesign uses the kit's PageHeader (Print + CSV, acting on the selected tab), two labelled pickers, line Tabs, unpaginated DataTables with StatusBadge and TableCount, and a plain empty state.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/analysis/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/analysis/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/analysis/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/analysis/mobile.webp?raw=true" width="260"> |

The "before" shot shows the DRAFT state of the audit data; the "after" shot shows the merit tab of a processed exam.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title `t('items.analysis', { ns: 'nav' })` ("ফলাফল বিশ্লেষণ", already renamed by the glossary), **New** subtitle "পরীক্ষা বেছে মেধা তালিকা, অকৃতকার্য শিক্ষার্থী আর বিষয়ভিত্তিক পাস-ফেল দেখুন।". Actions: outline "প্রিন্ট করুন" (`printer`) and outline "CSV ডাউনলোড করুন" (`download`, busy while downloading) — both `allowed` only when an exam is selected and not DRAFT. No primary (read-only page). | D16; one toolbar instead of three copies |
| 2 | Pickers | Two Fields with visible `Label`s: "পরীক্ষা" (`md:w-96`), "শাখা" (`md:w-56`). Exam option text **New** "{exam} · {class}" (reuse `grading:marksEntry.examOption` from marks-1). Section "সব শাখা" + the exam's sections. Both always visible on phone (they are the page's subject, not filters). | D24, D25 |
| 3 | Tabs | Kit line Tabs (default `TabsList` variant after 31.2.5b), labels **New** "মেধা তালিকা" · "অকৃতকার্য ও অনুপস্থিত" · "বিষয়ভিত্তিক পাস-ফেল". `?tab=` stays. | D20; "অকৃতকার্য/অনুপস্থিত" and "পাস / ফেল" read like codes |
| 4 | Merit table | Columns অবস্থান (or "শাখায় অবস্থান" with a section picked) · রোল · নাম · শাখা (only for "সব শাখা") · মোট নম্বর · জিপিএ · গ্রেড · ফলাফল. Roll and name split (were "1 · Rahim"); numbers end-aligned through `formatNumber` (GPA `decimals: 2`); missing position "—"; ফলাফল = `StatusBadge` success "কৃতকার্য" / danger "অকৃতকার্য". `paginated={false}`, footer "মোট nটি". | D6, D19, D27 |
| 5 | Defaulters table | Columns রোল · নাম · শাখা (all sections only) · কারণ · মোট নম্বর · জিপিএ · গ্রেড. কারণ shows **two lines**: "অকৃতকার্য: গণিত, ইংরেজি" and "অনুপস্থিত: বিজ্ঞান" (only the lines that apply). Empty → `EmptyState` `circle-check` "সবাই কৃতকার্য হয়েছে" + "এই পরীক্ষায় কেউ অকৃতকার্য বা অনুপস্থিত হয়নি।". | D6, D28; "ফেল:" was jargon |
| 6 | Pass/fail table | Numbers via `formatNumber` (pass % `decimals: 1` + "%", average `decimals: 1`); grade chips "A: ১০" via `formatNumber`; the overall row renders `exams:analysis.passFail.overallRow` ("সামগ্রিক") instead of the server's `subject_name` ("Overall") and is styled as a total row (`font-semibold bg-muted`). Toggle = kit checkbox row "অংশ অনুযায়ী" (`min-h-11 md:min-h-8`), part column header "অংশ". | D6, D9 (English "Overall" on a Bangla page) |
| 7 | Not processed | DRAFT exam → `EmptyState` `file-clock` **New** "এই পরীক্ষার ফলাফল এখনো তৈরি হয়নি" + "ফলাফল প্রক্রিয়া করা হলে এখানে মেধা তালিকা, অকৃতকার্য শিক্ষার্থী আর পাসের হার দেখা যাবে।" + outline "পরীক্ষার পাতা খুলুন" (→ `/exams/$examId`), shown only with `EXAM_MANAGE` (that route needs it; a teacher would land on a no-permission page). | D28, D29; the old filled button said "process" but only navigated |
| 8 | Other states | No exams → `EmptyState` "এখনো কোনো পরীক্ষা নেই" (marks-1 keys) instead of the select hint. Exams loading → two picker-sized skeleton bars. Tab loading → `DataTable loading` (table-shaped skeleton) instead of one `h-32` block. Empty merit / pass-fail → `EmptyState` "এই বাছাইয়ে কোনো ফলাফল নেই". | D28 |
| 9 | Loader | `examsQueryOptions({ limit: 50 })` — the same key `useExams({ limit: 50 })` reads (today the loader warms `{}` and the page fetches again). | bug |

## Mobile behaviour
- Header: title + subtitle; Print and CSV move into the PageHeader "আরও অ্যাকশন" menu (no primary on this page).
- Pickers full width, one under the other. The tab row scrolls sideways with the kit fade.
- Merit and defaulter rows become DataTable cards: name (`card: 'title'`) + result badge, subtitle "অবস্থান ১ · রোল ২ · শাখা ক", then মোট নম্বর / জিপিএ / গ্রেড. Pass/fail rows: subject as title, the counts as the `dl` fields.
- The bottom bar marks "আরও" for admin (EXAM_CONTROLLER has a বিশ্লেষণ cell already).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where Print / CSV live | per tab (today) / page header | page header, acting on `tab` | One copy instead of three; CSV kind is simply the tab id. The print sheet still prints only `#analysis-print-area` of the mounted tab. |
| Primary button | Print as primary / none | none | A read-only report; printing is not "the" next step for most visits. Contract allows at most one. |
| Merit list paging | paginate 25 / unpaginated | unpaginated + total | Print must contain every row; class sizes are ≤ ~150. Same as today. |
| Changed wording | edit `exams.json` / own keys in `grading.json` | new `grading:analysisPage.*` keys, the route reads those | `exams.json` belongs to the exams lane (it renames "উপাদান" → "অংশ" there too); the unchanged column headers keep reading `exams:analysis.*`. |
| Report-card link from merit rows | add RowActions view / none | none | New navigation; `/results/*` needs `RESULT_PROCESS`, which most analysis readers lack. |

## Files
- `client-admin/src/routes/_staff/analysis/index.tsx` — header + actions, CSV handler, labelled pickers, tabs, states, loader key
- `client-admin/src/routes/_staff/analysis/index.test.tsx` — updated
- `client-admin/src/routes/_staff/analysis/-merit-tab.tsx` — drop toolbar, columns, badge, numerals, unpaginated
- `client-admin/src/routes/_staff/analysis/-defaulted-tab.tsx` — drop toolbar, columns, reasons lines, empty state
- `client-admin/src/routes/_staff/analysis/-pass-fail-tab.tsx` — drop Print/CSV, numerals, overall row, toggle row
- `ui/src/i18n/locales/en/grading.json` — new `analysisPage` object (also changed by marks-1/marks-2, run earlier)
- `ui/src/i18n/locales/bn/grading.json` — same (also changed by marks-1/marks-2, run earlier)

## Steps
1. **Locale (`grading.json`, en / bn)** — add `analysisPage`:
   - `subtitle` "Pick an exam to see the merit list, failed students and pass rates by subject." / "পরীক্ষা বেছে মেধা তালিকা, অকৃতকার্য শিক্ষার্থী আর বিষয়ভিত্তিক পাস-ফেল দেখুন।"
   - `allSections` "All sections" / "সব শাখা"
   - `tabs.merit` "Merit list" / "মেধা তালিকা"; `tabs.defaulted` "Failed or absent" / "অকৃতকার্য ও অনুপস্থিত"; `tabs.passFail` "Pass/fail by subject" / "বিষয়ভিত্তিক পাস-ফেল"
   - `print` "Print" / "প্রিন্ট করুন"; `downloadCsv` "Download CSV" / "CSV ডাউনলোড করুন"
   - `byPart` "By part" / "অংশ অনুযায়ী"; `columnPart` "Part" / "অংশ"
   - `columnRoll` "Roll" / "রোল"; `columnName` "Name" / "নাম"; `columnTotal` "Total marks" / "মোট নম্বর"; `columnResult` "Result" / "ফলাফল"
   - `reasonFailed` "Failed: {{subjects}}" / "অকৃতকার্য: {{subjects}}"; `reasonAbsent` "Absent: {{subjects}}" / "অনুপস্থিত: {{subjects}}"
   - `gradeCount` "{{grade}}: {{count}}" (same in bn)
   - `notProcessedTitle` "Results are not ready yet" / "এই পরীক্ষার ফলাফল এখনো তৈরি হয়নি"; `notProcessedText` "Once the results are processed, the merit list, failed students and pass rates show here." / "ফলাফল প্রক্রিয়া করা হলে এখানে মেধা তালিকা, অকৃতকার্য শিক্ষার্থী আর পাসের হার দেখা যাবে।"; `openExam` "Open the exam" / "পরীক্ষার পাতা খুলুন"
   - `noRowsTitle` "No results for this choice" / "এই বাছাইয়ে কোনো ফলাফল নেই"; `noRowsText` "Try another section." / "অন্য শাখা বেছে দেখুন।"
   - `noDefaultersTitle` "Everyone passed" / "সবাই কৃতকার্য হয়েছে"; `noDefaultersText` "No student failed or missed a subject in this exam." / "এই পরীক্ষায় কেউ অকৃতকার্য বা অনুপস্থিত হয়নি।"
2. **Loader**: `examsQueryOptions({ limit: 50 })`; `loadRouteNamespaces('exams', 'grading', 'common')`.
3. **`index.tsx`.** Drop the root `div p-4` and the `h1`. Render `PageHeader title={tNav('items.analysis')} subtitle={t('grading:analysisPage.subtitle')} actions={[{ id: 'print', label: print, icon: <Printer />, onClick: () => window.print(), allowed: ready }, { id: 'csv', label: downloadCsv, icon: <Download />, onClick: () => void handleDownloadCsv(), allowed: ready, busy: csvBusy }]}` where `ready = selectedExam !== undefined && selectedExam.status !== 'DRAFT'` (if `PageAction` has no `busy`, set `disabled` while `csvBusy` and keep the label). Move the CSV handler here once: `downloadAnalysisCsv(selectedExam.id, tab, sectionId, selectedExam.name)`, error → `toast.error(t('analysis.downloadCsvError'))` (existing key).
   - Picker row `<div className="flex flex-col gap-4 md:flex-row md:items-end">` with two Fields (`flex flex-col gap-1.5`, `md:w-96 md:shrink-0` and `md:w-56 md:shrink-0`): `Label htmlFor="analysis-exam"` (`exams:resultsRoute.examLabel`) + `SelectTrigger id="analysis-exam"` (drop `w-64`, `aria-label`); options `t('grading:marksEntry.examOption', { exam: exam.name, class: exam.class?.name })`, falling back to `exam.name`. `Label htmlFor="analysis-section"` (`exams:analysis.sectionFilter`) + trigger; first option `grading:analysisPage.allSections`. Loading: two `Skeleton className="h-11 md:h-8"` bars in the same Fields.
   - Tabs: drop nothing structural; triggers read `grading:analysisPage.tabs.*`; `document.title` uses the same keys. `TabsList` keeps `print:hidden`.
   - DRAFT: `<EmptyState icon={<FileClock />} title={notProcessedTitle} explanation={notProcessedText} action={canManageExam ? { label: openExam, onClick: … } : undefined} />` with `canManageExam = useHasPermission(Permission.EXAM_MANAGE)`.
   - `exams.length === 0` → `EmptyState` (`grading:marksEntry.noExamsTitle/Text`, no action) instead of the pickers.
   - Pass `sectionLabel` down unchanged (`selectedSection?.section_name`).
4. **`-merit-tab.tsx`.** Delete the Print/CSV row and the CSV state (the print-only header `div` stays). Columns per Change 4: position (`align: 'end'`, `formatNumber`, "—" when null), roll (`align: 'end'`, `formatNumber`), name (`card: 'title'`, `font-medium`), section (only `!sectionId`; `t('grading:marksEntry.sectionValue', { name })` or "—"), total (`align: 'end'`, `formatNumber`), gpa (`formatNumber(row.gpa, config, { decimals: 2 })`), grade, result (`<StatusBadge tone={row.is_fail ? 'danger' : 'success'} label={t(row.is_fail ? 'resultsPanel.fail' : 'resultsPanel.pass')} />`, `card: 'badge'` if DataTable card mode has a badge slot). `DataTable paginated={false}` (drop `page`/`pageSize`/`totalCount`/`onPageChange` if the prop makes them optional), `loading={meritQuery.isLoading}` instead of the early `Skeleton` return, `emptyState={{ icon: <ListX />, title: noRowsTitle, explanation: noRowsText }}`. `useRegionConfig()` for `formatNumber`.
5. **`-defaulted-tab.tsx`.** Same toolbar removal and table props. Columns per Change 5; reasons cell = `<div className="flex flex-col">` with one `<span>` per non-empty list (`grading:analysisPage.reasonFailed/reasonAbsent`, subjects joined with ", "). `emptyState={{ icon: <CircleCheck />, title: noDefaultersTitle, explanation: noDefaultersText }}`.
6. **`-pass-fail-tab.tsx`.** Remove the Print/CSV buttons and CSV state; keep the toggle as the kit checkbox row: `<label className="flex min-h-11 items-center gap-3 md:min-h-8 print:hidden"><Checkbox …/>{t('grading:analysisPage.byPart')}</label>`. Numbers: appeared/passed/failed/absent/highest via `formatNumber` ("—" for null), pass % `${formatNumber(row.pass_pct, config, { decimals: 1 })}%`, average `decimals: 1`. Subject cell: `row.subject_id === null ? t('analysis.passFail.overallRow') : row.subject_name`. Overall row styling: if `DataTable` takes `getRowClassName`, return `'bg-muted font-semibold'` for `subject_id === null`; otherwise wrap the cell contents in `<span className="font-semibold">`. `GradeChips`: chip classes `inline-flex h-6 items-center rounded-full bg-muted px-2 text-label`, text `t('grading:analysisPage.gradeCount', { grade, count: formatNumber(count, config) })`. Component table: header of the part column `grading:analysisPage.columnPart`. Both tables `paginated={false}`, `loading`, `emptyState` (noRows keys).
7. Run `pnpm --filter client-admin test analysis/`, `pnpm --filter @biddaloy/ui check:i18n`, then `graphify update .`.

## Tests
- `analysis/index.test.tsx` — tab names become "Merit list" / "Failed or absent" / "Pass/fail by subject" (update the `Defaulters` lookup; URL `tab=defaulted` assertion stays); the exam and section pickers are found with `getByLabelText('Exam')` / `getByLabelText('Section')`; "Print" and "Download CSV" render once each in the header (not inside the tab panel) and are absent for a DRAFT exam; the merit row shows a "Pass" badge and GPA "4.50"; the defaulted reasons still match `/Failed: Math/` and `/Absent: Physics/`; the toggle checkbox name becomes "By part" and still swaps in the part table ("Written"); the pass/fail overall row shows "Overall" from the locale (assert the mocked `subject_name` is replaced by changing the mock's overall `subject_name` to `"OVERALL_FROM_SERVER"` and asserting it is not on screen); the DRAFT state shows "Results are not ready yet" and the "Open the exam" button only when the mocked user has `EXAM_MANAGE`.
- No e2e spec drives `/analysis` today (`rg -n "/analysis" e2e/journeys` — check; if one exists, update tab names there).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (this page has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Print and CSV appear once, in the header; printing still outputs only the selected tab's table.
- [ ] Both pickers have visible labels; exam options name the class.
- [ ] Every result is a StatusBadge; every table shows "মোট nটি"; the overall row is visibly a total row and reads "সামগ্রিক".

## Out of scope
- `exams:analysis.*` keys that this page stops reading (tabs, print, downloadCsv, empty, reasons, byComponent) — left for the exams lane to delete.
- Summary tiles (pass rate, GPA 5 count) above the tabs — new feature, not done.
- The sidebar label still reads the old word until 31.3.4a lands (shared, already planned).

Wave: 9   Lane: marks   Decisions: D6, D9, D15, D16, D19, D20, D24, D25, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.marks-2
