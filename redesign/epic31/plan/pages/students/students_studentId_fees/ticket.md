# [31.4.students-5a] Student detail Fees tab — one summary, clean bill tables

## Goal
The student's "ফি" and "স্বয়ংক্রিয় বিল" tabs match the "after" screenshots: one summary card, a segmented switch, kit tables with long dates and right-aligned amounts, no second filled button, and discount rules edited with icon actions and a date picker.
Sized for one afternoon; the Payments, Invoices and Fines tabs are students-5b (b runs after a).

## What and why
The Fees tab tells staff what a student owes and lets them manage the student's discounts and automatic billing. Today it opens with three loose bordered boxes, every open bill carries its own outline "পেমেন্ট রেকর্ড করুন" button that opens the same unseeded modal as the header's filled "ফি আদায়", periods are full dates for monthly fees, discounts use red filled Delete buttons and typed `YYYY-MM-DD` dates, and automatic billing is three stacks of bordered boxes with an inline reason box that pushes the row sideways. The redesign keeps every capability but puts it into kit cards, `DataTable` (unpaginated), `RowActions`, `ConfirmDialog` and `DatePicker`.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_fees/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_fees/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Summary | One Card with a 3-column `dl` (মোট বিল · মোট পরিশোধিত · বকেয়া), separated by `divide-x`; values `text-h3 md:text-h2`; বকেয়া in `text-status-overdue-fg` when > 0. Three columns on phone too. | Kit Card; one glance. |
| 2 | Section switch | The existing `Tabs` keeps the pill (segmented) variant: `grid w-full grid-cols-4 md:inline-grid md:w-auto`, triggers `h-11 md:h-8`. Labels খোলা বিল · জমা টাকা · ইতিহাস · ডিসকাউন্ট. | conflicts.md "Tabs primitive"; 44 px on phone. |
| 3 | Open bills | `DataTable paginated={false}`: ফি (+ danger StatusBadge "বিলম্ব ফি" for late-fee lines), মেয়াদ (`formatMonth(period_start)`, occurrence > 1 adds " (২)"), শেষ তারিখ (`formatDate`), পরিমাণ / ছাড় / পরিশোধিত / বকেয়া (`align: 'end'`), অবস্থা (StatusBadge). Footer "মোট ৪টি". Phone: two-line rows — name + badge, then "শেষ তারিখ … · বকেয়া …". | D5, D19, D27. |
| 4 | Per-bill pay button | Removed with its column and the local `RecordPaymentModal`. The header's filled "ফি আদায়" is the one way in (it opens `/payments/record?student_id=`, the full-page record flow from payments-1b). | D29; the button never pre-selected the line (`useRecordPaymentSeam` ignored `feeIds`). |
| 5 | Credit balance (জমা টাকা) | Balance in a Card (`text-h2`); last 10 transactions in `DataTable paginated={false}`: তারিখ (`formatDate`), ধরন (translated), পরিমাণ (end), মন্তব্য. | D19. |
| 6 | History | Same unpaginated table for paid lines, page size 25 (was 10), footer `TableCount` + the kit's icon pager (`chevron-left` / `chevron-right` around "পাতা ১ / ৩"). | D19, B23. |
| 7 | Empty / error | `EmptyState` (icon `receipt`) for "no open bills", "no credit transactions", "no paid bills"; errors keep `TabQueryState`'s `ErrorState`. | D28. |
| 8 | Discounts | Outline "ডিসকাউন্ট নিয়ম যোগ করুন" (`plus`) at the top right; rules in `DataTable paginated={false}` with RowActions সম্পাদনা (`edit`) and মুছুন (`delete`); value `formatNumber` + "%" or `formatServerAmount`; কার্যকর সময় `formatDateRange` (open end = "{start} থেকে"); loading = Skeleton, error = ErrorState with Retry. | D19, D5, D28. |
| 9 | Discount dialog | `DialogContent size="md"`; শুরুর / শেষের তারিখ become `DatePicker` (placeholder "তারিখ বাছুন"); radio and checkbox rows are full-row targets (`min-h-11 md:min-h-8`); error shown under the field it belongs to. | D21, D25. |
| 10 | Discount delete | `ConfirmDialog tone="danger"` naming the rule ("শতাংশ ১০% — মেধাবৃত্তি"). Red filled Delete buttons in rows are gone. | D29. |
| 11 | Automatic billing tab | Three Cards (h2 each): included, excluded, other active rules. Rows `ul divide-y`, `flex min-h-11 items-center justify-between gap-3 py-2`. "বাদ দিন" opens a `Dialog size="sm"` with a required reason Textarea (was an inline input that widened the row); "আবার অন্তর্ভুক্ত করুন" and "একবারের জন্য বিল করুন" stay outline. | D21, D29. |

## Mobile behaviour
- Summary stays three columns (amounts `text-h3`).
- Segmented switch is full width, four equal cells, 44 px.
- Bill, credit, history and discount tables become two-line rows inside one Card (kit "DataTable (unpaginated)"); discount actions show icon + label.
- Automatic-billing rows wrap the button under the name when the name is long (`flex-wrap`).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Per-bill "Record payment" | Keep outline per row · RowAction `pay` per row · remove | Remove | It opened the same unseeded flow as the header primary; one entry point, no fake precision. Add back as a `pay` RowAction when the record flow can pre-select fee lines. |
| Inner section switch in the URL | `?section=` · local state | Local state (as today) | It is a view toggle inside one tab, not navigation; keeps the route search schema untouched. |
| Period label | full date · month | `formatMonth(period_start)` | Bills are monthly; "অক্টোবর ২০২৬" is what a parent asks about. |
| Discount value input | number input · text | `Input type="number" inputMode="decimal"` (unchanged type) | D25 bans only date/time/month/select natives. |

## Files
- `client-admin/src/routes/_staff/students/-detail/fees-tab.tsx` — summary card, switch, DataTables, remove pay seam + modal
- `client-admin/src/routes/_staff/students/-detail/fees-tab.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/discounts-section.tsx` — table, RowActions, dialog size, DatePicker, ConfirmDialog, skeleton/error
- `client-admin/src/routes/_staff/students/-detail/discounts-section.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/recurring-fees-tab.tsx` — cards, exclude dialog
- `client-admin/src/routes/_staff/students/-detail/recurring-fees-tab.test.tsx`
- `ui/src/i18n/locales/bn/students.json` — keys below (also changed by students-1/2/3/4, run earlier)
- `ui/src/i18n/locales/en/students.json` — same keys

## Steps
1. **`fees-tab.tsx` summary.** Replace the `grid … sm:grid-cols-3` of three bordered divs with `<Card aria-label={t('detail.fees.summaryLabel')}><dl className="grid grid-cols-3 divide-x divide-border-subtle">` and three `<div className="p-4 md:p-5"><dt className="text-caption text-text-secondary">…</dt><dd className="mt-1 text-h3 tabular-nums md:text-h2">…</dd></div>`. Add `text-status-overdue-fg` to the balance `dd` when `Number(summary.balance) > 0`. Wrap the tab in `space-y-6`.
2. **Switch.** `<Tabs defaultValue="open-bills" className="space-y-4">`; `TabsList className="grid w-full grid-cols-4 md:inline-grid md:w-auto"`; each `TabsTrigger className="h-11 md:h-8"`. Same values and labels.
3. **`FeeLinesTable` → `DataTable`.** `tableId="student-fee-lines"`, `caption`, `paginated={false}`, `getRowId={(f) => f.id}`, columns: `fee` (cell: name + `{fee.late_fee_for_student_fee_id !== null && <StatusBadge tone="danger" label={t('detail.fees.lateFeeBadge')} />}`), `period` (`formatMonth(fee.period_start, regionConfig)` + `fee.occurrence > 1 ? \` (${formatNumber(fee.occurrence, regionConfig)})\` : ''`), `dueDate`, `amount`, `discount`, `paid`, `balance` (`align: 'end'`, `formatServerAmount`), `status` (`StatusBadge domain="fee" status={deriveFeeStatus(fee, now)}`). Card subtitle: `t('detail.fees.cardSubtitle', { due, balance })`. `emptyState={{ title, explanation, icon: <ReceiptIcon /> }}` per section. Delete the `onRecordPayment` prop, the actions column, `useRecordPaymentSeam`, the `RecordPaymentModal` import/mount and `canCollectFees`.
4. **Wallet.** Balance → `<Card padded><p className="text-caption text-text-secondary">…</p><p className="mt-1 text-h2 tabular-nums">…</p></Card>`; transactions → `DataTable paginated={false}` (date `formatDate(tx.created_at, regionConfig)`, kind `t('walletTransactionKind.X', { ns: 'common', defaultValue: tx.kind })`, amount end, note or `—`).
5. **History.** `HISTORY_PAGE_SIZE = 25`. Pass the current slice to `DataTable paginated={false}` and render under it the paginated footer of patterns.md "TableCount": `<TableCount total={paid.length} from={…} to={…} />` + outline icon buttons (`aria-label` = `detail.fees.previousPage` / `nextPage`) around `t('detail.fees.pageOf', { page, totalPages })` (both via `formatNumber`). Only when `paid.length > 25`.
6. **`discounts-section.tsx`.** Header row `flex items-center justify-end` with `<Button variant="outline"><PlusIcon />{t('discounts.addRule')}</Button>` (when `canManage`). Pending → `<SkeletonTable rows={3} columns={5} />`; error → `<ErrorState message={t('discounts.errorMessage')} onRetry={() => void rulesQuery.refetch()} />`; empty → `EmptyState` (icon `percent`, title `discounts.emptyMessage`, explanation `discounts.emptyExplanation`). Table → `DataTable paginated={false}` with columns kind, value (`rule.kind === 'PERCENT' ? \`${formatNumber(rule.value, regionConfig)}%\` : formatServerAmount(rule.value, regionConfig)`, end), fee types, range (`rule.starts_on && rule.ends_on ? formatDateRange(rule.starts_on, rule.ends_on, regionConfig) : rule.starts_on ? t('discounts.fromDate', { date: formatDate(rule.starts_on, regionConfig) }) : '—'`), reason; `rowActions={(rule) => [{ intent: 'edit', label: t('discounts.edit'), onClick: () => openEditDialog(rule), allowed: canManage }, { intent: 'delete', label: t('discounts.delete'), onClick: () => handleDelete(rule), allowed: canManage }]}`.
7. **Discount dialog.** `<DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>`. Replace both `Input type="date"` with `<DatePicker value={form.startsOn ? new Date(form.startsOn) : undefined} onValueChange={(d) => setForm((p) => ({ ...p, startsOn: d ? toIsoDate(d) : '' }))} />` (same for `endsOn`, `min` = start date). Labels use the Field/Label classes; radio and checkbox `label`s get `flex min-h-11 items-center gap-3 md:min-h-8`. Show the validation error under the field it is about (value / fee types / dates / reason) instead of one line at the bottom; keep the save error line at the bottom.
8. **Discount delete.** Replace the inline confirm `Dialog` with `<ConfirmDialog tone="danger" title={t('discounts.deleteConfirmTitle')} description={t('discounts.deleteConfirmDescriptionNamed', { rule: ruleSummary(confirmingRule) })} confirmLabel={t('discounts.delete')} onConfirm={confirmDelete} />`, `ruleSummary` = kind label + formatted value + " — " + reason. Keep `DeleteRuleAction`'s error row, but its button becomes `variant="ghost"`.
9. **`recurring-fees-tab.tsx`.** Each of the three `section`s → `<Card padded>` with `<h2 className="text-h2">` (same `fees` keys) and `<ul className="mt-2 divide-y divide-border-subtle">`; row `li` = `flex min-h-11 flex-wrap items-center justify-between gap-3 py-2`. `ExcludeAction`: the outline button opens `<Dialog><DialogContent size="sm">` titled `recurringFeesTab.excludeAction`, body = labelled `Textarea` (`recurringFeesTab.excludeReasonLabel`, required), footer Cancel (outline) + primary `recurringFeesTab.excludeAction` (disabled while empty or pending); close on success. `AddToScheduleRow`'s notice becomes `text-caption text-text-secondary` under the name. Empty messages stay plain `text-text-secondary` lines inside each card.
10. **i18n** (`students.json`, bn / en):
    - add `detail.fees.summaryLabel` "ফির সারসংক্ষেপ" / "Fee summary"
    - add `detail.fees.cardSubtitle` "শেষ তারিখ {{due}} · বকেয়া {{balance}}" / "Due {{due}} · Balance {{balance}}"
    - add `detail.fees.emptyExplanation` "এই শিক্ষার্থীর সব বিল পরিশোধ হয়ে গেছে।" / "Every bill for this student is paid."
    - add `detail.fees.historyEmptyExplanation` "কোনো বিল পরিশোধ হলে এখানে দেখা যাবে।" / "Paid bills will show up here."
    - add `detail.fees.walletEmptyExplanation` "বেশি টাকা দিলে তা জমা টাকা হিসেবে এখানে থাকবে।" / "Overpayments are kept here as credit."
    - delete `detail.fees.recordPayment`, `detail.fees.recordPaymentSeamToast`, `detail.fees.columnActions`
    - add `discounts.emptyExplanation` "নিয়ম যোগ করলে প্রতিটি মিলে যাওয়া বিলে ছাড় নিজে থেকে বসবে।" / "Add a rule and matching bills get the discount automatically."
    - add `discounts.fromDate` "{{date}} থেকে" / "From {{date}}"
    - add `discounts.deleteConfirmDescriptionNamed` "{{rule}} নিয়মটি মুছে যাবে। এটি ফিরিয়ে আনা যাবে না; ভবিষ্যতের বিলে আর ছাড় বসবে না।" / "The rule {{rule}} will be deleted. This can't be undone; future bills won't get the discount."
    - change `discounts.columnActions` "কাজ" / "Actions"

## Tests
- `fees-tab.test.tsx`: no button named "পেমেন্ট রেকর্ড করুন"; summary shows the three amounts and the balance has the overdue class when > 0; switch has four tabs; open-bill period reads "অক্টোবর ২০২৬"; late-fee line shows "বিলম্ব ফি"; empty open bills renders the EmptyState title + explanation; history pages at 25.
- `discounts-section.test.tsx`: rows expose buttons named "সম্পাদনা" / "মুছুন"; delete opens `alertdialog` naming the rule; the form has no `input[type=date]`; date range renders long form; error state has Retry.
- `recurring-fees-tab.test.tsx`: "বাদ দিন" opens a dialog; confirm disabled until a reason is typed; success closes it and calls the mutation with the trimmed reason.
- E2E: no spec targets these controls by the removed name (checked `e2e/journeys`, `e2e/keyboard`).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Summary is one card with three amounts; outstanding is red when above zero.
- [ ] Bill tables right-align every amount and show "মোট n টি".
- [ ] No filled or red button inside the Fees or Automatic billing tabs.
- [ ] Discount dates use the date picker and show long-form ranges.

## Out of scope
- Leftover jargon in `fees.json` `recurringFeesTab.*` ("সময়সূচী", "শ্রোতা", "পুনরাবৃত্ত") — fees lane owns that file (filed).
- Pre-selecting fee lines in the record-payment flow — new feature.
- `GenerateFeesModal` (one-off bill) frame — fees-3b owns it.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| fees.json recurringFeesTab.* glossary | Accepted | 31.3.4b | same keys, new words (স্বয়ংক্রিয় বিল / স্বয়ংক্রিয় বিলের নিয়ম / plain audience sentence) before wave 4 |

Wave: 9   Lane: students   Decisions: D5, D6, D19, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.students-4
