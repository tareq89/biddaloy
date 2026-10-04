# [31.4.students-5b] Student detail Payments, Invoices, Fines tabs — kit tables

## Goal
The student's "পেমেন্ট", "চালান" and "জরিমানা" tabs use the same table look as the Fees tab of students-5a: long dates, translated payment methods, icon row actions, outline buttons only, and a real error message on Fines.
b runs after a (students-5a); no shared files except `students.json`.

## What and why
These tabs answer "what has this student paid, which invoices exist, which fines are open". Today Payments shows `2026-09-12` and `CASH`, and has its own filled "পেমেন্ট রেকর্ড করুন" next to the header's filled "ফি আদায়"; Invoices shows ISO due dates and a text link "প্রিন্ট" with no way to open the invoice; Fines has a filled "জরিমানা যোগ করুন", a hand-built phone card list, and shows the empty-state title as its *error* message. The redesign applies `DataTable` (unpaginated), `RowActions`, `StatusBadge`, `EmptyState` and outline buttons; the look follows the Fees tab mockup of students-5a.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_fees/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_fees/mobile.webp?raw=true" width="260"> |

The "after" shot is the Fees tab (students-5a); these three tabs use the same table card, row style and footer.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Payments action | Filled "পেমেন্ট রেকর্ড করুন" → outline (`plus`), navigates to `/payments/record?student_id=` (payments-1b's full-page route) instead of mounting `RecordPaymentModal` locally. Still gated by `PAYMENT_RECORD`. | D29, D22 (URL-reflected). |
| 2 | Payments table | `DataTable paginated={false}`: তারিখ (`formatDate`), পরিমাণ (end), পদ্ধতি (`common:enums.paymentMethod.*`, e.g. "নগদ টাকা"), রেফারেন্স (as typed, Latin), গ্রহণকারী; RowAction `view` → `/payments/$id`. **New** link. | D5, D9, D19. |
| 3 | Invoices table | চালান নম্বর (Latin), পরিমাণ (end), অবস্থা (StatusBadge), শেষ তারিখ (`formatDate`, was ISO); RowActions `view` → `/invoices/$invoiceId` (**New** link) and `print` (`openPrintableInvoice`, was a text link). | D5, D19. |
| 4 | Fines action | Filled "জরিমানা যোগ করুন" → outline (`plus`), same label and permission. | D29. |
| 5 | Fines totals | The grey "বকেয়া: … · মওকুফ: …" sentence → a Card with a 2-column `dl` (বকেয়া জরিমানা, মওকুফ), like the Fees summary. | Kit Card. |
| 6 | Fines table | One `DataTable paginated={false}` for both sizes (the hand-built `FineCard` list goes): জরিমানা, কারণ, ঘটনার তারিখ, পরিমাণ / পরিশোধিত (end), অবস্থা, উৎস; RowAction `remove` "মওকুফ করুন" when the fine is neither WAIVED nor PAID and the user can waive. | D19 — "remove: take out of what is owed; the record stays". |
| 7 | Fines error | Error message is a real sentence ("জরিমানার তথ্য লোড করা যায়নি।"), not the empty-state title. | D28 — bug. |
| 8 | Empty states | `EmptyState` for no payments (icon `wallet`), no invoices (`file-text`), no fines (`badge-check`), each with one sentence; no action button (the outline buttons above already exist). | D28. |

## Mobile behaviour
- All three tables become two-line rows in one Card: Payments "date · method" under the amount; Invoices "due date · status"; Fines "date · amount" with the status badge on the right.
- Row actions show icon + label on phone.
- Outline buttons sit full width above the table.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Keep a record button in Payments | Remove (header has "ফি আদায়") · keep outline | Keep outline | The header button needs `FEE_COLLECT`; this one needs `PAYMENT_RECORD` — a role may hold only one. |
| Waive intent | `reject` · `archive` · `remove` | `remove` | Red minus = "take off what is owed, record stays"; matches the RowActions table. |
| Fines on phone | Keep custom cards · DataTable card rows | DataTable rows | One component, same look as the other tabs. |

## Files
- `client-admin/src/routes/_staff/students/-detail/payments-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/payments-tab.test.tsx` — **New**
- `client-admin/src/routes/_staff/students/-detail/invoices-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/invoices-tab.test.tsx` — **New**
- `client-admin/src/routes/_staff/students/-detail/fines-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/fines-tab.test.tsx`
- `ui/src/i18n/locales/bn/students.json` — keys below (also changed by students-1…5a, run earlier)
- `ui/src/i18n/locales/en/students.json` — same keys

## Steps
1. **`payments-tab.tsx`.** Delete `recordOpen` state and the `RecordPaymentModal` import/mount. When `canRecord`: `<Button variant="outline" onClick={() => void navigate({ to: '/payments/record', search: { student_id: studentId } })}><PlusIcon />{tPayments('recordAction')}</Button>` in a `flex justify-end` row (`w-full md:w-auto` on the button). Table → `DataTable tableId="student-payments" paginated={false}`: `date` (`formatDate(payment.payment_date, regionConfig)`), `amount` (existing `formatCurrency(parseCurrency(…))`, `align: 'end'`), `method` (`t(\`enums.paymentMethod.${payment.payment_method}\`, { ns: 'common', defaultValue: payment.payment_method })` — keys from 31.3.4a), `reference`, `receivedBy`; `rowActions={(p) => [{ intent: 'view', label: t('detail.payments.view'), to: \`/payments/${p.id}\` }]}`; card subtitle `t('detail.payments.cardSubtitle', { date, method })`; `emptyState={{ title: t('detail.payments.emptyMessage'), explanation: t('detail.payments.emptyExplanation'), icon: <WalletIcon /> }}`.
2. **`invoices-tab.tsx`.** `DataTable tableId="student-invoices" paginated={false}`: `number`, `amount` (end), `status` (`StatusBadge domain="invoice"`), `dueDate` (`invoice.due_date ? formatDate(invoice.due_date, regionConfig) : '—'`); `rowActions={(inv) => [{ intent: 'view', label: t('detail.invoices.view'), to: \`/invoices/${inv.id}\` }, { intent: 'print', label: t('detail.invoices.print'), onClick: () => void openPrintableInvoice(inv.id, () => toast.error(t('detail.invoices.printError'))) }]}`; EmptyState with `detail.invoices.emptyExplanation`, icon `FileTextIcon`.
3. **`fines-tab.tsx`.** Button → `variant="outline"` + `PlusIcon`, label unchanged (`fines.logForm.title`; `e2e/keyboard/fines.spec.ts` tabs to it by name). `errorMessage={t('detail.fines.errorMessage', { ns: 'students' })}`. Empty → `EmptyState` (title `fines:empty.title`, explanation `fines:empty.description`, icon `BadgeCheckIcon`). Totals → `<Card><dl className="grid grid-cols-2 divide-x divide-border-subtle">` two cells as in students-5a step 1 (labels `fines:totals.outstanding` / `fines:totals.waived`). Delete `FineCard` and the `sm:hidden` list; one `DataTable tableId="student-fines" paginated={false}` with the existing seven columns (amount and paid `align: 'end'`), card subtitle `t('detail.fines.cardSubtitle', { date, amount })`, `rowActions={(fine) => [{ intent: 'remove', label: t('waiveDialog.title'), onClick: () => setWaiveFineId(fine.id), allowed: canWaive && fine.status !== 'WAIVED' && fine.status !== 'PAID' }]}`. `LogFineModal` and `WaiveFineDialog` mounts unchanged (fines lane owns them).
4. **i18n** (`students.json`, bn / en):
   - add `detail.payments.view` "পেমেন্ট দেখুন" / "View payment"; `detail.payments.cardSubtitle` "{{date}} · {{method}}" / "{{date}} · {{method}}"; `detail.payments.emptyExplanation` "টাকা জমা নিলে তা এখানে দেখা যাবে।" / "Payments you record will show up here."
   - add `detail.invoices.view` "চালান দেখুন" / "View invoice"; `detail.invoices.emptyExplanation` "বিল তৈরি হলে চালান এখানে দেখা যাবে।" / "Invoices appear here once bills are created."
   - add `detail.fines.errorMessage` "জরিমানার তথ্য লোড করা যায়নি।" / "Couldn't load fines."; `detail.fines.cardSubtitle` "{{date}} · {{amount}}" / "{{date}} · {{amount}}"

## Tests
- `payments-tab.test.tsx` (**New**): date is long form, method reads "নগদ টাকা" not `CASH`, the record button is outline and navigates to `/payments/record?student_id=…`, view link points to `/payments/:id`, empty state shows.
- `invoices-tab.test.tsx` (**New**): due date long form; row has links/buttons named "চালান দেখুন" and "প্রিন্ট"; print calls `openPrintableInvoice`.
- `fines-tab.test.tsx`: log button is outline; a failed query shows "জরিমানার তথ্য লোড করা যায়নি।"; waive action only on open fines and only with `FEE_APPROVE`; totals card renders both amounts.
- E2E: `e2e/keyboard/fines.spec.ts` (student-tab part, `:247-280`) finds the log button by `fines.logForm.title` and the dialog by role — unchanged. `e2e/journeys/fines.spec.ts`, `invoices.spec.ts` — run; no selector change expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot's table style.
- [ ] Mobile at 390 px matches the "after" screenshot's row style; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (the header's).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Payments show translated methods and open the payment detail.
- [ ] Invoices have view + print icon actions and long due dates.
- [ ] Fines error shows the error sentence, not the empty title.

## Out of scope
- `LogFineModal` / `WaiveFineDialog` frames and `fines.json` wording — fines lane.
- `RecordPaymentModal` / `/payments/record` — payments lane (payments-1b).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| fees.json recurringFeesTab.* glossary | Accepted | 31.3.4b | same keys, new words (স্বয়ংক্রিয় বিল / স্বয়ংক্রিয় বিলের নিয়ম / plain audience sentence) before wave 4 |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: students   Decisions: D5, D6, D9, D19, D22, D27, D28, D29   Depends on: 31.3.8b, 31.4.students-5a
