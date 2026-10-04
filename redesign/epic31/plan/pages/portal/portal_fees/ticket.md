# [31.4.portal-2] Portal fees — titled "ফি ও চালান", tables on desktop, quiet empties

## Goal
`/portal/fees` has the title "ফি ও চালান", a summary card, month-by-month and invoice tables (compact rows on phone), and wallet / recurring fees in a side column that only appear when they have something to say, matching the "after" screenshots.

## What and why
This page shows, for one child, what is owed now, how each month was charged and paid, and the invoices to print. Today the title says "ফি" while the sidebar says "ফি ও চালান", six equal cards stack in a narrow left column (three of them only say "nothing yet"), each month is a small three-figure grid that is hard to compare, and small text uses arbitrary sizes. The redesign uses the kit header, two tables that line months and invoices up in columns, and moves the secondary wallet / recurring cards to the side, hidden when empty.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_fees/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_fees/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_fees/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_fees/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageHeader` title = `nav:items.portalFees` ("ফি ও চালান"), subtitle "<name> · <class> · রোল <n>". | D16, D32 (title ≠ nav label today) |
| 2 | Layout | `PageContainer` (wide); header, `StudentPicker`, then `grid gap-6 md:grid-cols-3 md:items-start`: main `md:col-span-2` (summary, month table, fines, invoices), side (wallet, recurring). Remove `max-w-2xl`. | D15 |
| 3 | Summary card | Label `text-label text-text-secondary` ("বকেয়া"), amount `text-display`, meta line; the three figures as `dl grid grid-cols-3 gap-4 border-t pt-4`, labels `text-caption text-text-secondary`, values `font-semibold tabular-nums`. | Kit card; drop `text-[11px]` |
| 4 | Month by month | `DataTable` (`paginated={false}`) inside a Card titled "মাসভিত্তিক হিসাব": columns মাস (month label + due date under it, late-fee tag), ধার্য, ছাড়, পরিশোধিত, বকেয়া (status tone), অবস্থা (`StatusBadge`). Footer "মোট n টি". Phone: compact two-line rows (month + due date + "ধার্য · ছাড় · পরিশোধিত" line, outstanding + badge on the right). **New** column-header keys. | Months compare at a glance; D19 total |
| 5 | Month label | `formatMonth(\`${year}-${mm}\`)` replaces the 12 literal `fees.months.*` calls + `renderDigits`. | D5/D6, one formatter |
| 6 | Fines | Card "জরিমানা" (still hidden when the child has none); rows `py-3 divide-y`: name, "কারণ: … · <incident date>" caption, amount + `StatusBadge` on the right. | Kit card |
| 7 | Invoices | `DataTable` (`paginated={false}`) in a Card titled "চালান" with subtitle "নতুন থেকে পুরনো": columns চালান নম্বর, ইস্যুর তারিখ, পরিমাণ, অবস্থা, কাজ (`RowActions` with one `print` action). Truncation note stays above the table. Phone: compact rows (number, date · amount, badge) with the print icon button on the right. | D19 row actions; the print button had no tooltip |
| 8 | Wallet | Side column Card; rendered only when `balance !== 0` or there is at least one transaction. Balance `text-h2`, rows `py-3 divide-y`. | Empty card was noise |
| 9 | Recurring fees | Side column Card; rendered only when `schedules.length > 0`. | Empty card was noise |
| 10 | Push opt-in | Stays where it is (after invoices, same conditions). | unchanged behaviour |

## Mobile behaviour
- One column: header, picker, summary, months, fines, invoices, wallet, recurring.
- Tables become the kit's compact two-line rows (DataTable unpaginated phone mode); the print icon button is `size-11`.
- The picker wraps to two rows with three or more children (existing `StudentPicker`).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Month breakdown | per-month mini grid (today); DataTable | DataTable unpaginated | on desktop columns line up; on phone DataTable already falls back to compact rows, which answers the original "unreadable at 320 px" worry |
| Invoice pagination | client-side pages of 25; unpaginated | unpaginated (≤ 100 rows, truncation note kept) | pagination on this table is caller-owned (`data-table.tsx:8`); a family's list is small and already capped server-side |
| Empty wallet / recurring | empty-state cards; hide | hide | nothing to act on; the money that matters is in the main column |
| Primary button | none; "print latest invoice" | none | read-only page; D1 |

## Files
- `client-admin/src/routes/portal/fees.tsx` — header, layout, tables, hiding rules, formatters
- `client-admin/src/routes/portal/fees.test.tsx` — updated assertions
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — new column keys, remove `fees.months.*` and `fees.title`

## Steps
1. Wrap the loaded frame in `<PageContainer>` and render `<PageHeader title={t('items.portalFees', { ns: 'nav' })} subtitle={`${selected.full_name} · ${studentMeta(selected)}`} />`; delete `FeesHeader`. In `useStudentMeta` pass `roll: formatNumber(student.roll_number, config)`. Empty frame: PageHeader (title only) + `EmptyState`. Loading/error frames unchanged in content; drop `max-w-2xl` from `FeesSkeleton`.
2. After the header: `StudentPicker` (unchanged props), then `<div className="grid gap-6 md:grid-cols-3 md:items-start"><div className="min-w-0 space-y-6 md:col-span-2">{FeesSummary}{BreakdownCard}{fines && FinesCard}{InvoicesCard}{PushOptInCard…}</div><aside className="space-y-6">{WalletCard?}{RecurringFeesCard?}</aside></div>`.
3. `FeesSummary`: Card `p-4 md:p-5`; `<h2 className="text-label text-text-secondary">{t('fees.outstanding')}</h2>`; amount `<p className="mt-1 text-display tabular-nums {tone}">`; meta `<p className="mt-0.5 text-text-secondary">`; `dl.mt-4.grid.grid-cols-3.gap-4.border-t.border-border-subtle.pt-4`. Rewrite `Figure` without the `small` variant: `dt.text-caption.text-text-secondary`, `dd.font-semibold.tabular-nums`, `—` for a null value.
4. `BreakdownCard`: `<Card className="overflow-hidden p-0">` + `<h2 className="px-4 py-3 text-h2 md:px-5">`; then `<DataTable tableId="portal-fee-months" caption={t('fees.breakdownTitle')} paginated={false} data={rows} getRowId={(f) => f.id} columns={…} emptyState={{ title: t('fees.breakdownTitle'), explanation: t('fees.breakdownEmpty') }} />`. Columns: `month` (cell: `formatMonth(\`${fee.year}-${String(fee.month).padStart(2,'0')}\`, config)` in `font-medium`, late-fee tag `text-caption text-status-overdue-fg` when `is_late_fee`, due date `text-caption text-text-secondary` via `hero.dueOn` + `formatDate`), `charged`, `discount` (`—` when 0), `paid`, `outstanding` (`font-semibold` + `toneFor(status)`), all four `align: 'end'`; `status` (`StatusBadge domain="fee" status={deriveMonthStatus(fee, now)}`). Keep the newest-first sort. Delete `useMonthNames`.
5. `FinesCard`: Card `p-4 md:p-5`, `h2.text-h2`, `ul.mt-2.divide-y.divide-border-subtle`, `li.flex.items-start.justify-between.gap-3.py-3`: left `p.font-medium` + `p.text-caption.text-text-secondary` = `[reason line, formatDate(incident)].filter(Boolean).join(' · ')`; right `flex flex-col items-end gap-1` with amount and `StatusBadge`.
6. `InvoicesCard`: Card `overflow-hidden p-0`; header `div.px-4.py-3.md:px-5` with `h2.text-h2` + `p.text-text-secondary` `fees.newestFirst`; truncation note `p.border-t.border-border-subtle.px-4.py-2.text-caption.text-text-secondary`, counts via `formatNumber`; then `DataTable tableId="portal-invoices" paginated={false}` with columns `invoice_number` (`font-medium`, Latin digits — identifier, D6), `issued_date` (`formatDate`), `total_amount` (`align: 'end'`), `status` (`StatusBadge domain="invoice"`), and `rowActions={(inv) => [{ intent: 'print', label: t('fees.print'), onClick: () => void openPrintableInvoice(inv.id, () => toast.error(t('fees.printError'))) }]}`. Empty: `emptyState={{ title: t('fees.invoicesTitle'), explanation: t('fees.invoicesEmpty') }}`. Delete the hand-built print `<button>`.
7. `WalletCard`: render only when `Number(wallet.balance) !== 0 || wallet.transactions.length > 0`. Card `p-4 md:p-5`, `h2.text-h2`, `p.mt-2.text-caption.text-text-secondary` balance label, `p.text-h2.tabular-nums` amount, `ul.mt-3.divide-y.divide-border-subtle.border-t.border-border-subtle` rows `py-3`. Keep the `walletTransactionKind` lookup; `formatDate(tx.created_at, config)` (string input, no `new Date`).
8. `RecurringFeesCard`: render only when `schedules.length > 0`. Card `p-4 md:p-5`, `h2.text-h2`, rows `py-3 divide-y`, name `font-medium` + amount `font-semibold tabular-nums`, rule and next-date lines `text-caption text-text-secondary`.
9. Replace all remaining `text-[11px]`, `text-[10.5px]`, `text-xs`, `text-sm`, `text-muted-foreground`, `px-3.5` on this page with the tokens above.
10. Locale (en / bn): add `fees.month` "Month" / "মাস", `fees.status` "Status" / "অবস্থা", `fees.invoiceNumber` "Invoice no." / "চালান নম্বর", `fees.issuedOn` "Issued on" / "ইস্যুর তারিখ", `fees.amount` "Amount" / "পরিমাণ", `fees.print` "Print" / "প্রিন্ট করুন". Remove `fees.months.*`, `fees.title`, `fees.printLabel` (grep first; keep any key still referenced).

## Tests
- `fees.test.tsx`: `heading` level 1 = "Fees and invoices"; month table has a row per fee, newest first, with the month label from `formatMonth` and the outstanding cell; invoice row has a "Print" button that calls `openPrintableInvoice` with the invoice id; wallet card absent when balance is 0 and there are no transactions, present otherwise; recurring card absent with `[]`; fines card still absent with no fines; zero discount still renders "—"; the existing "never trusts `fee.status` for overdue" case still passes.
- e2e: `e2e/keyboard/fines.spec.ts` (lane fines — do not edit) asserts `getByText(fineName)` and `getByText(reason)` exactly on this page. Keep both as their own text nodes: in step 5 render the reason as `{t('fees.reason')}: <span>{fine.note}</span>` so the exact match still finds it.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] No filled primary button on this page (read-only); none appears by accident.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The `<h1>` reads "ফি ও চালান" and equals the sidebar label.
- [ ] Months and invoices are tables on desktop with "মোট n টি" under each.
- [ ] Print is an icon button with a tooltip on desktop.
- [ ] A child with an empty wallet and no recurring fees shows neither card.

## Out of scope
- `StudentPicker` restyle (shared component) — shared request filed.
- Amounts rendering Latin digits (`৳0.00`) under the portal's value-less `RegionConfigProvider` — formatter/region issue, shared request filed (31.2.1).
- Self-service payment (#291).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| student-picker chips restyled to kit tokens | Accepted | 31.2.14a | no prop change — place StudentPicker as today |
| amounts in tenant digits under the value-less RegionConfigProvider | Accepted | 31.2.1b | keep the value-less provider; 31.2.1b adds the guard test (provider + formatServerAmount give ৳০.০০ in bn) and fixes the cause if it fails |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: portal   Decisions: D5, D6, D9, D15, D16, D17, D19, D27, D28, D32   Depends on: 31.3.8b, 31.4.portal-1
