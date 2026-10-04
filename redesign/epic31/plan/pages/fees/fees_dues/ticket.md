# [31.4.fees-1] Student dues — one primary, icon actions, readable fee lines

## Goal
`/fees/dues` matches the "after" screenshots (header with one filled "পেমেন্ট রেকর্ড করুন", labelled filters with a phone sheet, icon row actions, a readable per-fee breakdown, a visible total, 25 rows per page), record payment always opens through the URL, and `/fees` redirects here (D40).

## What and why
This is where the accountant sees who owes money and either collects it or sends a reminder. Today the page has no clear next action (the only filled button appears after selecting rows), months show as `01`–`12`, the "collect" action is an underlined text link, the wallet column is a chip that reads "ওয়ালেট: ৳০.00", the expanded fee lines are an eight-column table with a button per line that opens the whole-student payment modal from local state (not in the URL), and the pager never says how many students owe. The redesign keeps every capability but builds it from the kit: PageHeader with one primary, FilterBar with labels, DataTable with RowActions and TableCount, and the fee lines as a compact list that works in both table and card mode.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_dues/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_dues/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_dues/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_dues/mobile.webp?raw=true" width="260"> |

The "after" shots show the class filter "সপ্তম" applied, two rows selected (so the selection bar is visible) and the first row expanded. `/fees` (today a placeholder card, audit shot `accountant__fees.png`) has no "after": it becomes a redirect to this page.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title "শিক্ষার্থীর বকেয়া", subtitle "বাকি ফি আদায় করুন বা রিমাইন্ডার পাঠান।" (**New**), one primary "পেমেন্ট রেকর্ড করুন" (`banknote`) → `/payments/record` (**New** on this page; needs `FEE_COLLECT`). | D16/D29: one obvious next action — the walk-in parent at the counter. |
| 2 | Filters | Every field labelled: খুঁজুন (search), শ্রেণি, শাখা, মাস, বছর, অবস্থা, ফির ধরন, checkbox "শুধু মেয়াদোত্তীর্ণ". Month options are month names (`অক্টোবর`), years in tenant numerals (`২০২৬`). | D24, D5, D6 — today `01`…`12`, Latin years. |
| 3 | Flagged mode | When "শুধু মেয়াদোত্তীর্ণ" is on, the month, year, status and fee-type fields are **not rendered** (and their values are cleared) instead of rendering empty selects. | Shows only controls that do something; no dead selects. |
| 4 | Columns | শিক্ষার্থী (name `font-medium` + caption "REG-2026-0001 · রোল ১"), শ্রেণি (`সপ্তম · ক`, section column merged in), বকেয়া (right, `font-medium`), অবস্থা (StatusBadge), জমা টাকা (right; plain amount, muted when zero — no chip), শেষ রিমাইন্ডার (long date or muted "কখনো না"). মোট and পরিশোধিত stay available but start hidden (column menu "কলাম"). | D5/D19; the page fits 1440 px without a sideways scroll; the balance is what the accountant acts on. |
| 5 | Row actions | `RowActions`: দেখুন (`view` → `/students/$studentId?tab=fees`, **New**), ফি আদায় (`pay` → `/payments/record?student_id=…`, needs `FEE_COLLECT`), রিমাইন্ডার (`send`, opens the existing `SendReminderDialog` for that one student, needs `COMMUNICATION_BULK_SEND`, **New** per row). | D19; today one underlined text link. |
| 6 | Expanded row | The per-fee breakdown becomes a list: fee name (+ "বিলম্ব ফি" StatusBadge on late fees) and balance on one line; "অক্টোবর ২০২৬ · শেষ তারিখ ১০ই অক্টোবর, ২০২৬" and "মোট ৳… · ছাড় ৳… · পরিশোধিত ৳…" as captions. The per-line "পেমেন্ট রেকর্ড করুন" buttons are removed. | The line buttons opened the same whole-student payment as the row action (the modal cannot pre-select lines); a list reads on a phone where an 8-column table cannot. |
| 7 | Record payment | Every entry point navigates to `/payments/record?student_id=…`; the page no longer mounts `RecordPaymentModal` from local state. | D22: the full-page modal is in the URL; requested by the payments lane. |
| 8 | Selection bar | "২ জন নির্বাচিত" + outline "রিমাইন্ডার পাঠান", outline "সিএসভি এক্সপোর্ট", ghost "নির্বাচন বাতিল" (was "মুছুন", which reads as delete). No filled button. | D29, D32; same as the students list. |
| 9 | Footer | `TableCount` "১–২৫ দেখানো হচ্ছে, মোট ৬৪" + rows per page; default 25. | D19, B23. |
| 10 | Empty / error | `EmptyState` title "কোনো বকেয়া হিসাব পাওয়া যায়নি" + sentence (**New**); `ErrorState` with Retry. | D28. |
| 11 | CSV | The "last reminder" CSV cell uses `toIsoDate`, not the display date. | D5, B19 (`dues.tsx:381`). |
| 12 | `/fees` | Becomes a redirect to `/fees/dues` (`replace`); the placeholder EmptyState and "সেটিংসে যান" disappear. | D40. |

## Mobile behaviour
- Header: title, subtitle, then the primary full width.
- Filters: search + outline "ফিল্টার (n)" opening the `FilterSheet`; chips stay under the search; "কলাম" is desktop only (DataTable already hides it in card mode).
- Above the cards: "এই পাতার সব" checkbox + sort menu "সাজান: বকেয়া".
- Card: checkbox, name with "REG · রোল" caption, status badge; subtitle `সপ্তম · ক`; fields বকেয়া, জমা টাকা, শেষ রিমাইন্ডার; footer = DataTable's existing expand chevron + the three labelled actions; the fee-line list opens under the footer.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Header primary | none · "রিমাইন্ডার পাঠান" · "পেমেন্ট রেকর্ড করুন" | পেমেন্ট রেকর্ড করুন | Works with no selection; the most frequent task; reminder needs a selection and lives in the selection bar. |
| Per-fee-line pay button | keep · drop | drop | `RecordPaymentModal` cannot pre-select lines (its own comment, `dues.tsx:191-198`), so each line button did exactly what the row's "ফি আদায়" does. |
| Fee-line layout | inner table · list | list | `renderExpandedRow` cannot know table vs card mode (C9 container query); a list reads in both. |
| Name + registration | two columns · one two-line cell | one cell | Saves a column at 1440 px; the card title gets the registration number for free. |
| মোট / পরিশোধিত | always on · hidden by default | hidden by default via `defaultColumnVisibility` | Balance is the actionable number; both stay one click away in "কলাম". |
| Flagged-only filters | empty selects (today) · hide | hide | A control that cannot change anything is noise. |
| Wallet chip | chip · plain amount | plain amount, muted at zero | Matches every other money cell; glossary word "জমা টাকা". |

## Files
- `client-admin/src/routes/_staff/fees/dues.tsx` — header, filters, columns, row actions, expanded list, selection bar, page size, empty state, CSV date, record-payment navigation
- `client-admin/src/routes/_staff/fees/dues.test.tsx` — update / add assertions
- `client-admin/src/routes/_staff/fees/index.tsx` — becomes a redirect
- `client-admin/src/routes/_staff/fees/index.test.tsx` — **New**, one redirect test
- `ui/src/i18n/locales/bn/fees.json` — `dues.*` keys below; delete top-level `title`/`explanation`/`action`
- `ui/src/i18n/locales/en/fees.json` — same keys

## Steps
1. **Page size (B23).** Delete `{ limit: 10 }` from `useListShellState(...)` (`:300`) and change `limit: search.limit ?? 10` in `loaderDeps` (`:104`) to the shared default from 31.2.4 (`DEFAULT_PAGE_SIZE` from `@biddaloy/ui/shells`; if not exported, `25`).
2. **Record payment by URL.** Delete `useRecordPaymentSeam` (`:191-208`), the `RecordPaymentModal` import (`:35`) and its mount (`:671-677`). Add `const navigate = useNavigate()` (from `@tanstack/react-router`). Header action and row `pay` action use `to`/`navigate({ to: '/payments/record', search: { student_id } })`. (The payments lane's `record.tsx` accepts `student_id`.)
3. **Header.** Pass `subtitle={t('dues.subtitle')}` and `actions={[{ id: 'record', label: t('dues.recordPayment'), icon: <BanknoteIcon />, priority: 'primary', allowed: canCollectFees, onClick: () => navigate({ to: '/payments/record' }) }]}` to `ListShell` (PageHeader API, patterns.md "PageHeader").
4. **Filters.**
   - Month options: `Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: formatMonthName(i + 1, regionConfig) }))`; delete `monthOptions` and its comment (`:348-359`).
   - Year options: `label: renderDigits(String(year), regionConfig.numerals)` (value stays Latin).
   - Build `filterFields` so that when `flagged` is true the `month`, `year`, `status`, `fee_type` descriptors are omitted (`.filter`), and in `handleFilterChange` when `patch.flagged === 'true'` also set `month`, `year`, `status`, `fee_type` to `null`. Delete the `:505-514` comment.
   - Keep the order search, class, section, month, year, status, fee type, flagged.
5. **Columns** (replace `:413-503`):
   - `student`: `accessorFn: (row) => <span className="flex flex-col"><span className="font-medium">{row.full_name}</span><span className="text-caption text-text-secondary">{t('dues.studentCaption', { registration: row.registration_number, roll: formatNumber(row.roll_number, regionConfig) })}</span></span>`, `sortable: !flagged`, `card: 'title'`.
   - `class`: `` `${row.class_name ?? '—'} · ${row.section_name ?? '—'}` ``, `sortable: !flagged`, `card: 'subtitle'`. Delete the `section` column.
   - `total`, `paid`: unchanged values, `align: 'end'`; pass `defaultColumnVisibility={{ total: false, paid: false }}` to the table.
   - `due`: unchanged value wrapped in `<span className="font-medium">`, `align: 'end'`, `sortable: !flagged`.
   - `status`: unchanged (`card: 'badge'`).
   - `wallet`: header `dues.columnWallet` ("জমা টাকা" after 31.3.4b), `align: 'end'`. `WalletChip` renders: loading → `<span aria-hidden="true" className="inline-block h-3 w-16 rounded-sm bg-muted" />`; error/undefined → `—`; else `formatServerAmount(balance)` with `className="text-text-secondary"` when `Number(balance) === 0`. No chip, no `walletChip`/`walletLoading` strings.
   - `lastReminder`: `toReminderLabel` (display, `formatDate`); "কখনো না" in `text-text-secondary`.
   - Remove the `actions` column; pass `rowActions={(row) => [{ intent: 'view', label: t('dues.view'), to: `/students/${row.student_id}?tab=fees` }, { intent: 'pay', label: t('dues.collect'), to: `/payments/record?student_id=${row.student_id}`, allowed: canCollectFees }, { intent: 'send', label: t('dues.remindShort'), allowed: canSendReminder, onClick: () => setReminderTarget({ ids: [row.student_id], bulk: false }) }]}`.
6. **Reminder dialog.** Replace `reminderDialogOpen` with `const [reminderTarget, setReminderTarget] = React.useState<{ ids: string[]; bulk: boolean } | null>(null)`. Bulk button: `setReminderTarget({ ids: Array.from(state.selectedIds), bulk: true })`; row action: `setReminderTarget({ ids: [row.student_id], bulk: false })`. `SendReminderDialog open={reminderTarget !== null} onOpenChange={(o) => !o && setReminderTarget(null)} studentIds={reminderTarget?.ids ?? []} onSent={() => { if (reminderTarget?.bulk) actions.setSelectedIds(new Set()); }}`.
7. **Expanded row.** Rewrite `DuesFeeLines` (`:210-295`) with no `onRecordPayment` prop and no `Table*` imports: `<ul aria-label={t('dues.expandLabel', { name, count })} className="divide-y divide-border-subtle">`, each `<li className="py-2">` = `<div className="flex items-start justify-between gap-4"><p className="flex min-w-0 flex-wrap items-center gap-2 font-medium">{due.fee_name}{occurrence suffix}{due.is_late_fee && <StatusBadge tone="warning" label={t('dues.expanded.lateFeeBadge')} />}</p><p className="shrink-0 font-medium tabular-nums">{formatServerAmount(due.balance)}</p></div>` + `<p className="text-caption text-text-secondary">{t('dues.expanded.periodAndDue', { period, date })}</p>` + `<p className="text-caption text-text-secondary">{t('dues.expanded.breakdown', { total, discount, paid })}</p>`. `period` = `due.period_type === PeriodType.MONTH ? formatMonth(due.period_start, regionConfig) : formatDate(due.period_start, regionConfig)`; with `occurrence > 1` append ` (${formatNumber(occurrence)})` to the fee name; `date` = `formatDate(due.due_date)` or `—`. Wrap the list in `<div className="px-4 pb-2">` (it sits under the card footer and inside the expanded `<td>`). `renderExpandedRow={(row) => <DuesFeeLines name={row.full_name} dues={row.dues} />}`.
8. **Selection bar.** `bulkActions`: "রিমাইন্ডার পাঠান" `variant="outline"` + `SendIcon`; "সিএসভি এক্সপোর্ট" `variant="outline"` + `DownloadIcon`; "নির্বাচন বাতিল" `variant="ghost"` + `XIcon`. Drop `size="sm"`.
9. **CSV (B19).** In `exportSelectedToCsv`, the last-reminder cell = `reminder ? toIsoDate(new Date(reminder.sent_at)) : ''` (read `lastReminders` directly; do not call `toReminderLabel`). Keep the section column in the CSV.
10. **Empty / error.** Replace `emptyMessage` with `emptyState={{ title: t('dues.emptyMessage'), explanation: t('dues.emptyExplanation') }}` (no action). Error stays `error={t('dues.errorMessage')}` (ErrorState with Retry comes from DataTable).
11. **`/fees` redirect.** Replace `fees/index.tsx` body with `export const Route = createFileRoute('/_staff/fees/')({ beforeLoad: () => { throw redirect({ to: '/fees/dues', replace: true }); } });` — delete the component, pending component, loader and the header comment (replace with one line: "`/fees` → `/fees/dues` (D40)").
12. **i18n** (`fees.json`, bn / en). Do not touch the glossary renames 31.3.4b already made (`dues.title`, `caption`, `errorMessage`, `columnWallet`).
   - add `dues.subtitle`: "বাকি ফি আদায় করুন বা রিমাইন্ডার পাঠান।" / "Collect what is owed or send a reminder."
   - add `dues.recordPayment`: "পেমেন্ট রেকর্ড করুন" / "Record payment"
   - add `dues.view`: "দেখুন" / "View"
   - add `dues.remindShort`: "রিমাইন্ডার" / "Remind"
   - add `dues.studentCaption`: "{{registration}} · রোল {{roll}}" / "{{registration}} · Roll {{roll}}"
   - add `dues.emptyExplanation`: "অন্য ফিল্টার দিয়ে দেখুন — অথবা সবার ফি পরিশোধ হয়ে গেছে।" / "Try other filters — or everyone is paid up."
   - add `dues.expanded.periodAndDue`: "{{period}} · শেষ তারিখ {{date}}" / "{{period}} · due {{date}}"
   - add `dues.expanded.breakdown`: "মোট {{total}} · ছাড় {{discount}} · পরিশোধিত {{paid}}" / "Total {{total}} · discount {{discount}} · paid {{paid}}"
   - change `dues.searchLabel`: "খুঁজুন" / "Search"; `dues.searchPlaceholder`: "শিক্ষার্থীর নাম বা রেজিস্ট্রেশন নম্বর" / "Student name or registration number"
   - change `dues.feeTypeLabel`: "ফির ধরন" / "Fee type"; `dues.allFeeTypes`: "সকল ধরন" / "All types"
   - change `dues.flaggedToggleLabel`: "শুধু মেয়াদোত্তীর্ণ" / "Overdue only"
   - change `dues.columnLastReminder`: "শেষ রিমাইন্ডার" / "Last reminder"
   - change `dues.collect`: "ফি আদায়" / "Collect fee"
   - change `dues.sendReminder`: "রিমাইন্ডার পাঠান" / "Send reminder"
   - change `dues.exportCsv`: "সিএসভি এক্সপোর্ট" / "Export CSV"
   - change `dues.clearSelection`: "নির্বাচন বাতিল" / "Clear selection"
   - delete `dues.columnActions`, `dues.walletChip`, `dues.walletLoading`, `dues.recordPaymentSeamToast`, `dues.expanded.column*` (8 keys), `dues.expanded.recordPayment`; delete top-level `title`, `explanation`, `action` (only `fees/index.tsx` used them).
13. Remove every raw `text-xs` / `text-sm` / `underline` / `text-muted-foreground` className left in the file.

## Tests
- `client-admin/src/routes/_staff/fees/dues.test.tsx`:
  - "Collect reaches Record Payment in one interaction": the row's "ফি আদায়" link has `href` `/payments/record?student_id=…`; add: the header "পেমেন্ট রেকর্ড করুন" is the only filled button and links to `/payments/record`.
  - "renders one row per student with two fees, and expanding shows both per-fee lines": expanding shows two `listitem`s with the balances and a period like "অক্টোবর ২০২৬"; there is no "পেমেন্ট রেকর্ড করুন" button inside the expanded region.
  - "the Flagged toggle…": with flagged on, the month / year / status / fee-type fields are gone (`queryByLabelText` null).
  - Month filter options read month names (no `01`); default request `limit=25` (update `limit: 10` mocks / the `limit: 20` page-size case per 31.2.13c's note — use 50).
  - "shows a wallet balance chip on the row" → renamed "shows the credit balance as an amount", asserts the formatted amount under header "জমা টাকা".
  - CSV export: last-reminder cell is `YYYY-MM-DD` (ISO) when a reminder exists, empty when never.
  - Row "রিমাইন্ডার" opens the send-reminder dialog without selecting rows.
- `client-admin/src/routes/_staff/fees/index.test.tsx` (**New**): navigating to `/fees` lands on `/fees/dues` (`router.state.location.pathname`).
- E2E: `e2e/journeys/dues-and-reminder.spec.ts`, `reversal.spec.ts` and `e2e/a11y/overlay-openers.ts` find controls by `fees.dues.searchLabel` / `fees.dues.sendReminder` keys through `t()` — the bulk button keeps the key, so no edit expected. `overlay-openers.ts` is foundation-owned; do not edit it.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Month filter shows month names; year shows `২০২৬` in Bangla.
- [ ] With "শুধু মেয়াদোত্তীর্ণ" on, only search, class and section remain.
- [ ] Row actions are three coloured icons with tooltips on desktop, labelled on phone cards.
- [ ] Expanded row is a list with no buttons; reads on a 390 px phone without wrapping one word per line.
- [ ] Clicking any "record / collect" control changes the URL to `/payments/record…`.
- [ ] Footer shows "১–২৫ দেখানো হচ্ছে, মোট N"; default 25 rows.
- [ ] Visiting `/fees` lands on `/fees/dues`.

## Out of scope
- Sidebar item "ফি" (`finance.fees` → `/fees`) now only redirects here and duplicates "শিক্ষার্থীর বকেয়া" — filed in shared-requests.md (nav-tree).
- `e2e/route-manifest.json` / smoke specs that expect `/fees` to render its own page — foundation files; filed.
- Money cells in the CSV export are formatted for display (`৳১,২০০.০০`), not as plain numbers — left as today.
- A batched credit-balance endpoint (one `useStudentWallet` call per visible row) — server work, not this ticket.
- Pre-selecting the clicked fee line in the record-payment page — the payments page cannot do it (D1).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| drop sidebar item "ফি" -> /fees | Accepted | 31.3.1 | finance.fees removed from nav-tree.ts; /_staff/fees/ added to NOT_IN_NAV; nav:items.fees key stays (crumb) |
| /fees as redirect in route-manifest / smoke / a11y | Accepted | 31.5.0 | manifest /fees archetype becomes "redirect"; smoke does not list /fees and a11y/reflow accept any h1, so fees-1 breaks nothing in between |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: fees   Decisions: D5, D6, D9, D16, D19, D22, D24, D27, D28, D29, D32, D40   Depends on: 31.3.8b
