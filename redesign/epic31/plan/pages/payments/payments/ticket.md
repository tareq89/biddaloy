# [31.4.payments-1a] Payments — real payment list over GET /payments

## Goal
Done = `/payments` lists every payment the school received, with search, labelled filters, a total and one primary "পেমেন্ট রেকর্ড করুন" (the record form itself becomes a full page in payments-1b, which runs after this).

## What and why
`/payments` is where a cashier checks what came in today and records the next payment. Today it is an empty placeholder: one empty-state card and two copies of the same button, and "নগদ" means both cash and the Nagad app. This half turns the page into a list over the existing `GET /payments` endpoint (no API change) and names cash "নগদ টাকা".

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments/mobile.webp?raw=true" width="260"> |
| Before — record payment | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_record/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_record/before-mobile.webp?raw=true" width="260"> |
| After — record payment | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_record/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_record/mobile.webp?raw=true" width="260"> |

This ticket delivers the two "list" rows; the "record payment" rows are payments-1b.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | `/payments` header | `PageHeader` title "পেমেন্ট", **New** subtitle "স্কুলে গৃহীত সব পেমেন্ট, নতুনগুলো আগে।", one primary "পেমেন্ট রেকর্ড করুন" (`banknote` icon) that opens record payment (still `?record=1` here; payments-1b points it at `/payments/record`). The duplicate button inside the empty state goes. | D16, D29 — one primary |
| 2 | `/payments` body | **New** payment list: `ListShell` + `DataTable` over `GET /payments`. Columns: তারিখ (`formatDate(payment_date)`), শিক্ষার্থী (name in `font-medium` + `· REG-…` in `text-text-secondary`), পদ্ধতি (translated label), লেনদেন রেফারেন্স (`—` when empty), পরিমাণ (`align: 'end'`), কাজ. | The page had no content; the endpoint already exists |
| 3 | List filters | **New** `FilterBar`: search (primary, name/registration/reference), পেমেন্ট পদ্ধতি (select, "সব পদ্ধতি"), পেমেন্টের তারিখ (date range), "বাতিল হওয়াগুলোও দেখান" (checkbox → `include_reversed=true`). | D24 |
| 4 | List row action | `rowActions` → one `view` action "দেখুন" linking to `/payments/$id`. When "বাতিল হওয়াগুলোও দেখান" is on, a **New** অবস্থা column shows `StatusBadge tone="neutral" label="বাতিল হয়েছে"` for a reversed payment and `tone="info" label="বাতিলের এন্ট্রি"` for a reversal row; the column is hidden otherwise. | D19, D27; no badge noise in the default view |
| 5 | List total / pager | Default page size 25 (from the kit `DataTable`), `TableCount` footer. Empty result: `EmptyState` (`receipt` icon, "এখনো কোনো পেমেন্ট নেই", outline action "পেমেন্ট রেকর্ড করুন"). | D19, D28 |
| 6 | Deleted student | A row whose `student` is `null` shows "মুছে ফেলা শিক্ষার্থী" in the name cell. | Server comment `payments-query.service.ts:66-70` — never crash, never show an id (D9) |

## Mobile behaviour
- List: search + "ফিল্টার (n)" sheet; rows become cards — title = student name, amount on the right in `text-h3`, subtitle "তারিখ · পদ্ধতি", fields রেজিস্ট্রেশন নম্বর and লেনদেন রেফারেন্স, action row "দেখুন" with label.
- Header primary is full width (`flex-1`) under the title.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Build the payment list | keep placeholder (strict D1) / list over existing `GET /payments` | list | The endpoint, permission and filters already exist; the placeholder fails "can I see the current state". No API, entity or route is added. |
| Where the list query lives | add `usePaymentsList` to `ui/src/hooks/payments.ts` (shared) / route-local hook | route-local `-list/use-payments-list.ts` keyed under `paymentKeys.all` | Stays in territory (D3); `useCheckout`/`useReversePayment` already invalidate `paymentKeys.all`, so the list refreshes after a payment. `ponytail:` move it to `ui/src/hooks` when a second screen needs it. |
| "নগদ" clash | rename NAGAD / rename CASH | CASH → "নগদ টাকা" | "নগদ" is the brand name of the Nagad app; cash is the one to qualify. |
| Status column in the list | always / only with reversed rows shown | only with "বাতিল হওয়াগুলোও দেখান" | By default every row is a successful payment; a column of identical badges is noise. |
| Record form while this ticket is live | move it now / keep the `?record=1` modal mount | keep | `record.tsx` still redirects to `/payments?record=1` until payments-1b; moving only one side would loop. |

## Files
- `client-admin/src/routes/_staff/payments/index.tsx` — list page (keeps the `?record=1` modal mount; later also changed by payments-1b)
- `client-admin/src/routes/_staff/payments/-list/use-payments-list.ts` — **New** route-local query hook
- `client-admin/src/routes/_staff/payments/index.test.tsx` — list assertions (later also changed by payments-1b)
- `ui/src/i18n/locales/{en,bn}/payments.json` — list keys below (later also changed by payments-1b)

## Steps
1. **Locale (`payments.json`, en + bn).** Add:
   - `subtitle`: "Every payment the school received, newest first." / "স্কুলে গৃহীত সব পেমেন্ট, নতুনগুলো আগে।"
   - `list.caption` "Payments" / "পেমেন্টের তালিকা"; `list.searchLabel` "Search" / "খুঁজুন"; `list.searchPlaceholder` "Name, registration number or reference" / "নাম, রেজিস্ট্রেশন নম্বর বা রেফারেন্স"; `list.methodLabel` "Payment method" / "পেমেন্ট পদ্ধতি"; `list.allMethods` "All methods" / "সব পদ্ধতি"; `list.dateLabel` "Payment date" / "পেমেন্টের তারিখ"; `list.includeReversed` "Show reversed too" / "বাতিল হওয়াগুলোও দেখান"; `list.columnDate` "Date" / "তারিখ"; `list.columnStudent` "Student" / "শিক্ষার্থী"; `list.columnMethod` "Method" / "পদ্ধতি"; `list.columnReference` "Transaction reference" / "লেনদেন রেফারেন্স"; `list.columnAmount` "Amount" / "পরিমাণ"; `list.columnStatus` "Status" / "অবস্থা"; `list.reversed` "Reversed" / "বাতিল হয়েছে"; `list.reversal` "Reversal entry" / "বাতিলের এন্ট্রি"; `list.deletedStudent` "Deleted student" / "মুছে ফেলা শিক্ষার্থী"; `list.view` "View" / "দেখুন"; `list.emptyTitle` "No payments yet" / "এখনো কোনো পেমেন্ট নেই"; `list.emptyText` "Payments you record appear here." / "যে পেমেন্ট রেকর্ড করবেন তা এখানে দেখা যাবে।"; `list.error` "Payments could not be loaded." / "পেমেন্টের তালিকা লোড করা যায়নি।"
   - Change value: bn `record.method.methods.CASH` → "নগদ টাকা" (the list's পদ্ধতি column and method filter read these labels).
   - Delete the key that becomes unused: `explanation`.
2. **`-list/use-payments-list.ts` (New).** `usePaymentsList(params: { page; limit; search?; payment_method?; date_from?; date_to?; include_reversed? })` = `useQuery({ queryKey: [...paymentKeys.all, 'school-list', params], queryFn: GET /payments with params via `apiClient`, placeholderData: keepPreviousData, retry: shouldRetryQuery })`. Response type `{ data: Payment[]; total: number; page: number; limit: number }`. Dates are sent as ISO `YYYY-MM-DD` (use `toIsoDate`, never `formatDate`).
3. **`index.tsx`.** Copy the structure of `invoices/index.tsx`: `useListShellState()` (no `limit` override), `ListShell` with `title={t('title')}`, `subtitle={t('subtitle')}`, `actions=[{ id: 'record', label: t('recordAction'), priority: 'primary', icon: <Banknote/>, allowed: canRecord, onClick: () => setModalOpen(true) }]`, filter descriptors from Change 3 (`search` = `kind: 'text', primary: true`; method = `kind: 'select'` with the 7 `PaymentMethod` values labelled by `record.method.methods.*`; date = `kind: 'date-range'`; reversed = `kind: 'checkbox'`), columns from Change 2/4, `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/payments/${row.id}` }]}`, `emptyState` from Change 5 (its outline action also calls `setModalOpen(true)`), `error={t('list.error')}` on failure. Keep `RegionConfigProvider value={useTenantRegionConfig()}` around the page. Add the list filter keys to `validateSearch` next to the existing `record` / `student_id` / `guardian_id` keys (keep those three, their `z.coerce.string()` comment, `setModalOpen` and the `RecordPaymentModal` mount exactly as today — payments-1b removes them). Delete the old `h1`, the header `Button`, the placeholder `EmptyState` and the file's "placeholder" header comment.
4. Run `pnpm --filter client-admin test payments`, update snapshots/selectors, then `graphify update .`.

## Tests
- `payments/index.test.tsx` — renders the list from an MSW `GET /payments` mock (2 rows); asserts `TableCount` text, method label "নগদ টাকা" (not `CASH`), date in long form, a `null`-student row shows "মুছে ফেলা শিক্ষার্থী"; the checkbox sends `include_reversed=true` and reveals the status column; the header has exactly one primary button "পেমেন্ট রেকর্ড করুন". Keep the three existing `?record=1` modal tests passing unchanged (payments-1b replaces them).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (list).
- [ ] Mobile at 390 px matches the "after" screenshot (list); no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] `/payments` shows payments with a total; filters have visible labels; page size is 25.
- [ ] Cash is "নগদ টাকা"; the Nagad app is "নগদ (মোবাইল ব্যাংকিং)".

## Out of scope
- No sidebar item points at `/payments`, and its crumb reads "পেমেন্ট রেকর্ড করুন" — filed in shared-requests (nav item + crumb).
- Red "no permission" toast in the before shots is B8, owned by 31.3.6.
- Record payment as a full page at `/payments/record` — payments-1b.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| admin-verification-modal: map fees.discount + payments.reverse scopes | Accepted | 31.2.14c | still add the approval.json scopes entries in payments-1 / payments-2; the modal shows them as soon as the key exists (guarded with i18n.exists) |
| sidebar item /payments | Accepted | 31.3.1 | finance.payments -> /payments, PAYMENT_READ (route-permissions /_staff/payments/ changed to match), icon receipt-text, label nav:items.payments "পেমেন্ট", placed before invoices; dropped from NOT_IN_NAV |
| route-crumbs for /payments and /payments/$id | Accepted | 31.3.5 | /payments crumb = nav:items.payments; /payments/$id = পেমেন্ট (link) › dynamic paymentDetail |
| fees dues.tsx opens /payments/record by URL (fees-lane file) | Accepted | — | already done by page ticket fees-1 (Change 7, Step 2); nothing to add |

Wave: 9   Lane: payments   Decisions: D1, D5, D6, D9, D15, D16, D19, D24, D27, D28, D29   Depends on: 31.3.8b
