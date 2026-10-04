# [31.4.payments-3] Invoices — icon row actions, credit-note tag, 25 per page

## Goal
`/invoices` matches the kit list: subtitle, labelled filters, 25 rows per page with a total, icon row actions (view, print), and credit notes visibly tagged.

## What and why
The accountant uses this page to find a receipt and reprint it. Today the filters have no labels and show `YYYY-MM-DD` placeholders, the page shows 10 rows, the only action is an underlined "প্রিন্ট" text link (opening the invoice means clicking the underlined number), credit notes look identical to receipts, and the actions column is called "কার্যক্রম". The redesign keeps the same data and filters and moves them onto the kit patterns.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/invoices/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/invoices/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/invoices/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/invoices/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `ListShell` gets **New** subtitle "প্রতিটি পেমেন্টের রসিদ ও ক্রেডিট নোট, নতুনগুলো আগে।". No primary action (invoices are created by recording a payment). | D16 |
| 2 | Filters | Same 4 filters, now with visible labels from the kit `FilterBar`: খুঁজুন (3 cols), অবস্থা (2), ইস্যুর তারিখ range with `DatePicker` triggers (4), পরিমাণ (৳) min–max (3). Phone: search + "ফিল্টার (n)" sheet. | D24, D25 |
| 3 | Page size | Remove the hard-coded `limit: 10` (route and loader); the kit default 25 applies. | D19, B23 |
| 4 | Number column | Plain `font-medium` text (no underline link). A credit note gets a **New** neutral pill "ক্রেডিট নোট" after the number. | Underlined links only inside sentences (D29); credit notes were indistinguishable |
| 5 | Row actions | Replace the text link column with `rowActions`: `view` "দেখুন" → `/invoices/$id`, `print` "প্রিন্ট" → `openPrintableInvoice` (allowed only with `INVOICE_PRINT`). Column header comes from the kit ("কাজ"). | D19 |
| 6 | Dates / amounts | Issue and due dates via `formatDate` (long form, D5); amounts via `formatServerAmount` in tenant numerals (D6). Already called — only check no ISO fallback remains. | D5, D6 |
| 7 | Empty / error | `emptyState`: `receipt` icon, "কোনো চালান পাওয়া যায়নি", "পেমেন্ট রেকর্ড করলে এখানে তার চালান দেখা যাবে।"; error stays the translated `errorMessage` + retry. | D28 |

## Mobile behaviour
- Cards: title = invoice number, status badge right; subtitle = student name (+ " · ক্রেডিট নোট"); fields পরিমাণ and ইস্যুর তারিখ (due date hidden on cards); action row "দেখুন" and "প্রিন্ট" with labels.
- Pager row: total on its own line, rows-per-page + pager below.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where new keys go | `fees.json` (where the page's keys live) / `payments.json` | `payments.json` under `invoices.*`, page loads both namespaces | `fees` belongs to the fees lane; this lane owns `payments` (LANES namespace table). Existing `fees:invoices.*` keys are read, not edited. |
| Due date on phone cards | show / hide | hide | For receipts it equals the issue date; the detail page has it. |
| Primary action | "পেমেন্ট রেকর্ড করুন" / none | none | Recording a payment is the Payments page's primary and a sidebar quick action; a second home for it is noise. |

## Files
- `client-admin/src/routes/_staff/invoices/index.tsx` — subtitle, limit, columns, row actions, empty state
- `client-admin/src/routes/_staff/invoices/index.test.tsx`
- `ui/src/i18n/locales/{en,bn}/payments.json` — `invoices.*` keys below
- `e2e/journeys/invoices.spec.ts` — open the detail via the row's "দেখুন" action instead of the number link

## Steps
1. **Locale (`payments.json`, en + bn).** Add `invoices.subtitle` "Every payment's receipt and credit note, newest first." / "প্রতিটি পেমেন্টের রসিদ ও ক্রেডিট নোট, নতুনগুলো আগে।"; `invoices.view` "View" / "দেখুন"; `invoices.creditNote` "Credit note" / "ক্রেডিট নোট"; `invoices.emptyText` "When you record a payment its invoice appears here." / "পেমেন্ট রেকর্ড করলে এখানে তার চালান দেখা যাবে।"; `invoices.amountRangeLabel` "Amount (৳)" / "পরিমাণ (৳)"; `invoices.minAmount` "Minimum" / "সর্বনিম্ন"; `invoices.maxAmount` "Maximum" / "সর্বোচ্চ".
2. **Loader / state.** `loadRouteNamespaces('fees', 'payments')`. Delete `limit: search.limit ?? 10` fallback (use `search.limit` and let `useListShellState()`'s default apply) and change `useListShellState({ limit: 10 })` to `useListShellState()`. Keep the loader's prefetch deps in sync with the hook's default (read the default from the same constant the hook uses, or pass nothing so both use it).
3. **Filters.** Keep the four descriptors; set the number-range `label: t('invoices.amountRangeLabel', { ns: 'payments' })`, `minLabel`/`maxLabel` to the new `minAmount`/`maxAmount` keys (used as placeholder + `aria-label`). Search keeps `primary: true`.
4. **Columns.** `number`: `accessorFn: (row) => <span className="font-medium">{row.invoice_number}{(row as InvoiceWithSnapshot).kind === 'CREDIT_NOTE' && <span className="ml-1 inline-flex h-6 items-center rounded-full bg-muted px-2 text-label text-text-secondary">{t('invoices.creditNote', { ns: 'payments' })}</span>}</span>`, `card: 'title'`. `student` stays `card: 'subtitle'` (append " · ক্রেডিট নোট" for credit notes on the card). `dueDate`: add `card: 'hidden'`. Delete the `actions` column.
5. **Row actions.** `rowActions={(row) => [{ intent: 'view', label: t('invoices.view', { ns: 'payments' }), to: `/invoices/${row.id}` }, { intent: 'print', label: t('invoices.print'), allowed: canPrint, onClick: () => void openPrintableInvoice(row.id, () => toast.error(t('invoices.printError'))) }]}`.
6. **Header / empty.** `ListShell subtitle={t('invoices.subtitle', { ns: 'payments' })}`; replace `emptyMessage` with `emptyState={{ icon: <Receipt />, title: t('invoices.emptyMessage'), explanation: t('invoices.emptyText', { ns: 'payments' }) }}` (no action).
7. Run `pnpm --filter client-admin test invoices/index`, then `graphify update .`.

## Tests
- `invoices/index.test.tsx` — default request carries `limit=25`; the number cell is not a link; a `CREDIT_NOTE` row shows "ক্রেডিট নোট"; row actions render "দেখুন" (link to `/invoices/<id>`) and, with `INVOICE_PRINT`, "প্রিন্ট" (calls `openPrintableInvoice`); without the permission the print action is absent (not disabled); empty response renders the empty state and no pager.
- `e2e/journeys/invoices.spec.ts` — replace the click on the invoice-number link with `getByRole('link', { name: t('payments.invoices.view') })` in that row.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] 25 rows per page and "১–২৫ দেখানো হচ্ছে, মোট n" under the table.
- [ ] Row actions are icons with tooltips (desktop) and labelled buttons (phone); no underlined text links in the table.
- [ ] Credit notes carry the "ক্রেডিট নোট" tag.

## Out of scope
- Old `fees:invoices.columnActions` "কার্যক্রম" becomes unused here; deleting it is the fees lane's call (it still has other `columnActions` keys).
- Status labels ("ইস্যু করা হয়েছে") come from the shared `StatusBadge` invoice domain — not changed here.

Wave: 9   Lane: payments   Decisions: D5, D6, D16, D19, D24, D25, D28, D29   Depends on: 31.3.8b, 31.4.payments-2
