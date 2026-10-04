# [31.4.attendance-2] Attendance register + reports — kit pickers, tabs, row actions

## Goal
`/attendance/register` picks class, section and month with kit controls and shows a readable, Bangla-lettered month matrix with a legend and one Print primary; `/attendance/reports` switches its two views with tabs, filters with labelled controls and month names, and lists students in a kit table with icon row actions and a total.

## What and why
The register replaces the paper attendance book for one section's month; the reports page shows a section's month summary or the school-wide list of students below a minimum. Today the register uses browser `<select>` / `<input type="month">`, English letters P/A/L/V on a Bangla screen, Latin day numbers, an ISO month in its caption and a plain-text prompt; the reports page hides its two views inside a "দৃশ্য" select, shows months as "2026-10", has no visible filter labels, shows table headers and a pager over an empty "pick a section" message, and uses text links for actions. The redesign applies the kit's Select / MonthPicker, Tabs, FilterBar, DataTable, RowActions, EmptyState and formatters.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — register | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_register/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_register/before-mobile.webp?raw=true" width="260"> |
| After — register | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_register/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_register/mobile.webp?raw=true" width="260"> |
| Before — reports | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_reports/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_reports/before-mobile.webp?raw=true" width="260"> |
| After — reports | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_reports/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_reports/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Register — header | `PageContainer` + `PageHeader` title "উপস্থিতির খাতা" (glossary), **New** subtitle, one primary "প্রিন্ট করুন" (`printer`), disabled until rows are loaded. | D15, D16, D29 |
| 2 | Register — pickers | Raw `<select>` × 2 + `<input type="month">` → kit `Select` × 2 (placeholder "বাছুন", section disabled until a class is picked) + `MonthPicker`, each in a `FormField` with a visible label, `grid gap-4 md:grid-cols-12`, 3 columns each. The "সব শ্রেণি / সব শাখা" options go (the register needs one section). | D25, D37 |
| 3 | Register — matrix card | Card with a heading "সপ্তম শ্রেণি – ক · সেপ্টেম্বর ২০২৬" (`formatMonth`) and a **New** legend (উ = উপস্থিত, অ = অনুপস্থিত, বি = বিলম্বে, ছু = ছুটি, — = স্কুল বন্ধ, · = চিহ্নিত হয়নি). | D5, D9 |
| 4 | Register — cells | Letters come from i18n (bn উ/অ/বি/ছু, en P/A/L/V); absent `font-semibold text-status-overdue-fg`, late `text-status-due-fg`, leave `text-status-partial-fg`; school-closed columns `bg-muted` with "—". Day numbers `formatNumber`; hidden full date `formatDate` (today the ISO string). An unknown status shows "?" / "অজানা" (today the raw enum, e.g. `HALF_DAY`). | D6, D9 |
| 5 | Register — states | No section picked → EmptyState "এখনো শাখা বাছা হয়নি"; no students → EmptyState without the meaningless Retry; footer "মোট ১০টি". | D19, D28 |
| 6 | Register — scroll bug | The scroll region gets `relative`: its `sr-only` header spans are `position: absolute` and escaped the `overflow-x-auto`, making the whole phone page scroll sideways. | D12 / no sideways scroll |
| 7 | Reports — container + header | Compose `PageContainer` + `PageHeader` (title, **New** subtitle) directly; `ListShell` goes (it has no slot for tabs above the filters). No primary. | D15, D16 |
| 8 | Reports — views | The "দৃশ্য" select → `Tabs` (`TabsList variant="line"`): "মাসের হিসাব" · "কম উপস্থিতি". URL keeps `?view=flags` (absent = summary). | D20, D32 |
| 9 | Reports — filters | `FilterBar` with visible labels: মাস (options labelled `formatMonth`, values stay `YYYY-MM`; current month is the default and no longer listed twice), শ্রেণি, শাখা, "সর্বনিম্ন উপস্থিতি (%)". Phone: one "ফিল্টার (n)" button + chips. | D5, D9, D24 |
| 10 | Reports — table | `DataTable` with `rowActions`: view (`eye`, link to the student) and send (`send`, "রিমাইন্ডার পাঠান", only with `COMMUNICATION_BULK_SEND`). Summary view `paginated={false}` ("মোট ১০টি"); flags view paginated, 25 per page (was 20). "দেরি" → "বিলম্বে" (one word with the status label). | D19, D32, B23 |
| 11 | Reports — empty | Summary without a section → EmptyState "শাখা বাছুন" (no table header, no pager); empty result → EmptyState; flags empty → "এই মাসে কেউ সর্বনিম্নের নিচে নেই". | D19, D28 |

## Mobile behaviour
- Register: Print is a full-width primary under the subtitle; the three pickers stack full width (they are required inputs, not optional filters); the legend wraps; a hint "পুরো মাস দেখতে ছকটি পাশে সরান।" sits above the matrix, which scrolls sideways inside its card only.
- Reports: tabs on one row; filters behind "ফিল্টার (n)" (bottom sheet) with chips under it; DataTable card mode — title name, subtitle "রোল ৩", badge = attendance % (with "কম" when low), fields উপস্থিত / অনুপস্থিত / বিলম্বে / ছুটি / কর্মদিবস, action row "দেখুন" + "রিমাইন্ডার পাঠান".

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Register pickers on phone | FilterBar sheet / stacked fields | stacked fields | Nothing shows until all three are set; hiding required inputs behind a sheet adds a step. D24 covers optional list filters. |
| Register letters | keep P/A/L/V / i18n letters | i18n letters + legend | English letters on a Bangla page are jargon to a teacher; the legend makes the paper copy self-explaining. |
| Reports views | select filter / tabs / two routes | tabs on `?view=` | Two different tables, not a filter; no new route (D1). |
| Reports shell | keep `ListShell` / compose parts | compose | `ListShell` renders filters right under the header and has no tabs slot; editing it is foundation territory. |
| Month filter control | MonthPicker (needs a new FilterBar kind) / select with month names | select, `formatMonth` labels | Meets D5/D9 with the existing `select` kind; 13 options. |
| EmptyState without an action | add a fake action / none | none for "no students" and "pick a section" | The only real next step is the picker right above it; a Retry that cannot change the result misleads (D28 action is omitted rather than invented). |
| Print colours | toned letters in print / black | black (print CSS unchanged) | Paper copies are usually b/w; letters carry the meaning. |

## Files
- `client-admin/src/routes/_staff/attendance/register.tsx` — header, pickers, matrix card, letters, formatters, states, `relative` region
- `client-admin/src/routes/_staff/attendance/register.test.tsx` — update
- `client-admin/src/routes/_staff/attendance/-register-print.css` — print area id moves to the card; `overflow: visible`
- `client-admin/src/routes/_staff/attendance/reports.tsx` — composed page, tabs, filters, DataTable rowActions, empty states
- `client-admin/src/routes/_staff/attendance/reports.test.tsx` — update
- `ui/src/i18n/locales/bn/attendance.json` — keys below (also changed by attendance-1, runs earlier)
- `ui/src/i18n/locales/en/attendance.json` — keys below (also changed by attendance-1, runs earlier)

## Steps
1. **Register header (`register.tsx`).** Wrap `RegisterPageContent` output in `<PageContainer>`; delete the `flex flex-col gap-4 p-4` root and the `print:hidden` header row. `<PageHeader title={t('register.title')} subtitle={t('register.subtitle')} actions={[{ id: 'print', label: t('register.print'), icon: <PrinterIcon />, priority: 'primary', disabled: !matrixQuery.data?.rows.length, onClick: () => window.print() }]} />` (if `PageAction` has no `disabled`, use `allowed` = false → hidden; prefer disabled).
2. **Register pickers.** `<section aria-label={t('register.pickersLabel')} className="grid gap-4 md:grid-cols-12">`, three `<div className="md:col-span-3">` each with `FormField` + control:
   - Class: `Select value={search.class_id} onValueChange={(v) => patchSearch({ class_id: v, section_id: undefined })}`, `SelectTrigger` with `SelectValue placeholder={t('register.pickPlaceholder')}`, items from `classesQuery.data.data`.
   - Section: same, `disabled={!search.class_id}`, items from `sectionsQuery.data`.
   - Month: `<MonthPicker value={month} onValueChange={(v) => patchSearch({ month: v })} />`.
   - Remove `reports.allClasses` / `reports.allSections` options here.
3. **Register matrix card.** When rows exist, render `<section id="attendance-register-print-area" aria-labelledby="r-title" className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">`:
   - Head `flex flex-col gap-2 border-b border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:px-5`: `<h2 id="r-title" className="text-h3">{t('register.cardTitle', { className, sectionName, month: formatMonth(month, regionConfig) })}</h2>` and the legend `<p className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-text-secondary">` with four `<span>{abbrev(s)} = {statusLabel(t, s)}</span>` plus `register.legendClosed` and `register.legendUnmarked`.
   - `<p className="px-4 py-3 text-caption text-text-secondary md:hidden print:hidden">{t('register.scrollHint')}</p>`.
   - Region: keep `role="region"`, `tabIndex={0}`, `aria-label`; classes `relative overflow-x-auto` (**the `relative` fixes the sideways page scroll**). Drop the outer border (the card has it).
   - Table `w-full text-caption tabular-nums`; `caption` becomes `sr-only` with `register.caption` (month through `formatMonth`). `thead` `border-b border-border-subtle bg-muted text-text-secondary`, `th` `h-9 px-2 font-medium` (`text-start` for roll/name, `text-end` for totals), day `th` `h-9 min-w-6 text-center font-medium` showing `formatNumber(day, regionConfig)` with `<span className="sr-only">{formatDate(date.date, regionConfig)}</span>`. First total column gets `border-s border-border-subtle`. `tbody` `divide-y divide-border-subtle`; cells `h-9`; name `font-medium whitespace-nowrap`.
   - Cell: not a working day → `className="h-9 bg-muted text-center text-text-secondary"` "—"; status → letter from `abbrev(status)` with the tone class from the Changes table; unmarked "·". Keep the `sr-only` full label.
   - `abbrev(status)`: a `switch` over the four members returning `t('register.abbrev.PRESENT')` … (literal keys for `check-i18n`); default `'?'`. `statusLabel` default → `t('register.unknownStatus')` instead of the raw `status`.
   - Footer `<p className="border-t border-border-subtle px-4 py-3 text-text-secondary">` with `<TableCount total={rows.length} />`.
4. **Register states.** No section: `<EmptyState icon={<FileSpreadsheet />} title={t('register.pickTitle')} explanation={t('register.selectPrompt')} />`. Loading: keep the skeleton, inside a Card shape (`h-64 rounded-lg`). Error: unchanged. No rows: `<EmptyState title={t('register.emptyMessage')} explanation={t('register.emptyExplanation')} />` (delete the Retry action).
5. **Print CSS (`-register-print.css`).** The id is now on the card, so the heading and legend print too. Add inside `@media print`: `#attendance-register-print-area, #attendance-register-print-area * { overflow: visible; }` and keep everything else. Manual print-preview check (file comment already asks for it).
6. **Reports page composition (`reports.tsx`).** Replace `<ListShell …>` with `<PageContainer>`: `<PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />`, then tabs, `FilterBar`, `DataTable`, and the existing `SendReminderDialog` (imported from `../students/-send-reminder-dialog` — placed, not edited). `useListShellState()` without `{ limit: 20 }`.
7. **Tabs.** `<Tabs value={view} onValueChange={(v) => actions.setFilters({ view: v === 'flags' ? 'flags' : null })}><TabsList variant="line" aria-label={t('reports.viewLabel')}><TabsTrigger value="summary">{t('reports.viewSummary')}</TabsTrigger><TabsTrigger value="flags">{t('reports.viewFlags')}</TabsTrigger></TabsList></Tabs>` (from `@biddaloy/ui/components`; no `TabsContent` — the table below switches on `view`). Remove the `view` field from `filterFields`.
8. **Filters.** `<FilterBar fields={filterFields} values={state.filters} onChange={handleFilterChange} resultCount={totalCount} />`. Month field: `allLabel: formatMonth(currentMonthIso(), regionConfig)`, `options: trailingMonthOptions(new Date()).slice(1).map(o => ({ value: o.value, label: formatMonth(o.value, regionConfig) }))`. Threshold field label `t('reports.thresholdLabel')`. Class / section unchanged.
9. **Table.** `<DataTable tableId="attendance-reports" caption={t('reports.caption')} columns data getRowId sorting={null} onSortingChange={() => undefined} loading isFetching rowActions={(row) => [{ intent: 'view', label: t('reports.viewStudent'), to: \`/students/${row.student_id}\` }, { intent: 'send', label: t('reports.sendReminder'), onClick: () => setReminderStudentId(row.student_id), allowed: canSendReminder }]} />` — summary view: `paginated={false}`; flags view: `page`, `pageSize`, `totalCount`, `onPageChange`, `onPageSizeChange`. Delete both `actions` columns and `renderActions`. Keep the `as DataTableColumn<never>[]` casts and their comment.
   - Columns: `roll_number` keeps `card: 'subtitle'` but renders `t('mark.rollNumber', { roll: row.roll_number })`; `late_days` header `reports.columnLate`; percentage column unchanged (`card: 'badge'`). Flags view keeps class / section columns.
   - `emptyState`: summary with no section → `{ icon: <ChartLine />, title: t('reports.selectSectionTitle'), explanation: t('reports.selectSectionPrompt') }`; flags with no rows → `{ title: t('reports.flagsEmptyTitle'), explanation: t('reports.emptyMessage') }`; otherwise `{ title: t('reports.emptyTitle'), explanation: t('reports.emptyMessage') }`. `error={isError ? t('reports.errorMessage') : undefined}`. Keep `announceResults`.
10. **i18n (`attendance.json`, bn + en).**

    | Key | bn | en |
    |---|---|---|
    | `register.subtitle` (**New**) | এক শাখার পুরো মাসের উপস্থিতি, কাগজের খাতার মতো করে। | One section's whole month, laid out like the paper register. |
    | `register.print` (changed) | প্রিন্ট করুন | Print |
    | `register.pickersLabel` (**New**) | কোন খাতা দেখবেন | Which register |
    | `register.pickPlaceholder` (**New**) | বাছুন | Select |
    | `register.pickTitle` (**New**) | এখনো শাখা বাছা হয়নি | No section picked yet |
    | `register.cardTitle` (**New**) | {{className}} – {{sectionName}} · {{month}} | {{className}} – {{sectionName}} · {{month}} |
    | `register.caption` (changed) | উপস্থিতির খাতা — {{className}} – {{sectionName}}, {{month}} | Attendance register — {{className}} – {{sectionName}}, {{month}} |
    | `register.abbrev.PRESENT` / `ABSENT` / `LATE` / `LEAVE` (**New**) | উ / অ / বি / ছু | P / A / L / V |
    | `register.legendClosed` (**New**) | — = স্কুল বন্ধ | — = school closed |
    | `register.legendUnmarked` (**New**) | · = চিহ্নিত হয়নি | · = not marked |
    | `register.scrollHint` (**New**) | পুরো মাস দেখতে ছকটি পাশে সরান। | Swipe the table sideways to see the whole month. |
    | `register.emptyExplanation` (**New**) | শিক্ষার্থী ভর্তি হলে খাতা এখানে দেখা যাবে। | The register appears once students are enrolled. |
    | `register.unknownStatus` (**New**) | অজানা | Unknown |
    | `register.totalLate` (changed) | বিলম্বে | Late |
    | `reports.subtitle` (**New**) | শাখার মাসিক হিসাব, আর কার উপস্থিতি কম। | A section's month at a glance, and who is falling behind. |
    | `reports.viewLabel` (changed) | প্রতিবেদনের ধরন | Report type |
    | `reports.viewSummary` (changed) | মাসের হিসাব | Month summary |
    | `reports.viewFlags` (changed) | কম উপস্থিতি | Low attendance |
    | `reports.thresholdLabel` (changed) | সর্বনিম্ন উপস্থিতি (%) | Minimum attendance (%) |
    | `reports.columnLate` (changed) | বিলম্বে | Late |
    | `reports.selectSectionTitle` (**New**) | শাখা বাছুন | Pick a section |
    | `reports.emptyTitle` (**New**) | কোনো হিসাব নেই | Nothing to show |
    | `reports.flagsEmptyTitle` (**New**) | এই মাসে কেউ সর্বনিম্নের নিচে নেই | Nobody is below the minimum this month |

    Remove keys no longer read: `reports.columnActions`. Keep `register.classLabel` / `sectionLabel` / `monthLabel` (the FormField labels) and `reports.allClasses` / `allSections` (still the FilterBar `allLabel`s).

## Tests
- `register.test.tsx`: pickers are labelled (`getByLabelText('Class')`, `'Section'`, `'Month'`) and no `select` / `input[type=month]` exists; no section → "No section picked yet" + the prompt sentence; Print is disabled until rows load; with data: caption "Attendance register — Class 5 – A, January 2026" (update line 154); cells show "P"/"A" letters and the legend; unknown status renders "?" and "Unknown", not `HALF_DAY` (update lines 121–122); no students → EmptyState without a Retry button (line 174); error keeps Retry.
- `reports.test.tsx`: a tab "Low attendance" replaces the select option (line 164: `user.click(getByRole('tab', { name: 'Low attendance' }))`); month options read "January 2026"-style labels; summary with no section shows "Pick a section" and no pager; the reminder action is a button named "Send reminder" (line 239 still passes) and the view action is a link to `/students/<id>`; flags request sends `limit=25`; non-numeric threshold still not sent (line 171 test unchanged).
- `e2e/journeys/attendance.spec.ts` step 4 (`?view=flags&month=…&section_id=…`, `ListShellPage` h1 + `table > tbody > tr`): run unchanged — the URL contract and the h1 stay.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px (register included).
- [ ] At most one filled primary per view (register: Print; reports: none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No browser-native select or month input on either page.
- [ ] Register letters, day numbers and totals follow the language and numerals; a legend explains the letters.
- [ ] The register prints with heading, legend and the full table on a landscape page.
- [ ] Reports views switch with underline tabs and the choice survives a reload (`?view=flags`).
- [ ] Every reports filter shows its label; months read "সেপ্টেম্বর ২০২৬".
- [ ] Row actions are icons with tooltips on desktop, labelled on phone cards; no text links.
- [ ] An empty or "pick a section" table shows an EmptyState and no pager.

## Out of scope
- Threshold chip shows Latin "75" — FilterBar formats only date/number kinds; shared request filed.
- `SendReminderDialog` look (`students/-send-reminder-dialog.tsx`, students lane) — placed unchanged.
- Sidebar label "উপস্থিতির খাতা" — renamed by 31.3.4a; the mockup shell still shows the old label.
- A MonthPicker inside FilterBar — not needed; month names via select labels.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| FilterBar: format text-filter chip values (tenant digits) | Accepted | 31.2.7a | on the text field descriptor: formatChip: (v) => formatNumber(Number(v), rc) |

Wave: 9   Lane: attendance   Decisions: D5, D6, D9, D15, D16, D19, D20, D24, D25, D28, D29, D32, D37   Depends on: 31.3.8b, 31.4.attendance-1
