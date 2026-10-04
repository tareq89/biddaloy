# [31.4.payments-1b] Payments — record payment as a full page

## Goal
Done = "পেমেন্ট রেকর্ড করুন" opens a full-page form at `/payments/record` that reads top to bottom — student → bills → money received — with the amount to record on the primary button (b runs after payments-1a).

## What and why
Recording a payment is the cashier's main job. Today the record form is a cramped dialog: the amount field comes before the student, the remarks box has no label, and the failure message can be a backend string. This half turns the dialog into a `FullPageShell` (D22/D23) on the existing `/payments/record` route, laid out as three numbered steps, with the amount to record written on the primary button.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments/mobile.webp?raw=true" width="260"> |
| Before — record payment | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_record/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_record/before-mobile.webp?raw=true" width="260"> |
| After — record payment | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_record/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_record/mobile.webp?raw=true" width="260"> |

This ticket delivers the two "record payment" rows; the "list" rows are payments-1a.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | `/payments/record` | Renders the record form as a page-level `FullPageShell` instead of redirecting. `?record=1` on `/payments` redirects to `/payments/record` (keeps `student_id` / `guardian_id`) so old links still work; the `/payments` header button and empty-state action now go to `/payments/record`. Close / Esc / Cancel go back (`history.back()` when there is history, else `/payments`). | D22 — own route exists, so the URL is the route |
| 2 | `RecordPaymentModal` frame | Same export name and props; renders `<FullPageShell size="wide" dirty={…}>` instead of `Dialog`. `fees/dues.tsx` keeps working with no edit. | D21/D23 — form holds a table |
| 3 | Step 1 "১. শিক্ষার্থী" | Card with **New** one-line help. Selected students are removable chips "নাম · শ্রেণি শাখা · রোল n" (`h-11 md:h-8` chip, 44 px remove button). Search field gets a visible label "আরেকজন শিক্ষার্থী যোগ করুন" (before the first pick: "শিক্ষার্থী খুঁজুন") and a search icon; field wrapper `md:w-1/2` (no `max-w-*`). | D25 labels; chip must never show a UUID (D9) |
| 4 | Step 2 "২. বকেয়া বিল" | Card header: title + help on the left, "প্রাপ্ত পরিমাণ" money field on the right (`md:w-56`). Table columns: ফি (+ "বিলম্ব ফি" neutral pill), মেয়াদ (`formatMonth(period_start)` when `period_type === PeriodType.MONTH`, else `formatDate`), শেষ তারিখ, অবস্থা (`StatusBadge domain="fee"`), বকেয়া, পরিশোধ (MoneyInput, right-aligned), ছাড় (ghost button `lock` + "ছাড় দিন"). The per-line "মোট" column is removed. Summary band (`bg-muted`): উপমোট, wallet checkbox row, প্রদেয় পরিমাণ in `text-h3`. | The amount now sits next to the bills it splits; one less column |
| 5 | No student yet | Step 2 shows "বকেয়া বিল দেখতে আগে একজন শিক্ষার্থী বাছুন।" instead of the word "শিক্ষার্থী". | Today it repeats the label key |
| 6 | Step 3 "৩. টাকা গ্রহণ" | পেমেন্ট পদ্ধতি as a radio grid `grid grid-cols-2 gap-2 md:grid-cols-4`, each option a 44 px row (radio + label), checked row `border-primary bg-secondary font-semibold text-secondary-foreground`. Order: নগদ টাকা, বিকাশ, নগদ (মোবাইল ব্যাংকিং), রকেট, ব্যাংক ট্রান্সফার, চেক, কার্ড. | Readable labels; no 7-column squeeze |
| 7 | Cash fields | "হাতে পেলেন" (tendered) + help "ফেরত হিসাব করতে, না লিখলেও চলবে।", beside it "ফেরত দিতে হবে" shown as a read-only value in `bg-status-due-bg text-status-due-fg text-h3`; "ফেরতের টাকা" radio pair (হাতে ফেরত দিন / ওয়ালেটে জমা রাখুন) appears only when change > 0. | Cashier sees the change at a glance |
| 8 | Reference and remarks | "লেনদেন রেফারেন্স" (non-cash only) and "মন্তব্য" get visible `<label>`s. | D25 |
| 9 | Footer | `FullPageShell` footer: secondary "বাতিল করুন", primary "{{amount}} রেকর্ড করুন" (amount = `formatCurrency(subtotal)`; "পেমেন্ট রেকর্ড করুন" while the subtotal is 0). The approval note and errors move above the footer inside step 3. | D22; state visible on the button |
| 10 | Errors and success | Submit error is always a translated sentence (`record.notifications.failed`), never `ApiError.message`. Success view keeps `CheckoutSuccess`, inside the same shell: title "পেমেন্ট রেকর্ড হয়েছে", footer secondary "চালান দেখুন", primary "আরেকটি রেকর্ড করুন"; print format as the same radio rows as step 3, print and send buttons outline. | D9, D29 |

## Mobile behaviour
- Record form: one column; the bills table becomes a `divide-y` list inside the step-2 card — fee name + badge, "মেয়াদ · শেষ তারিখ …", then a 2-column row (বকেয়া value | পরিশোধ input), then "ছাড় দিন". Method grid is 2 columns. Footer buttons stay `h-11`; the footer is sticky (app) so the primary is always reachable.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Full-page URL | `?record=1` on `/payments` / the existing `/payments/record` route | `/payments/record` | D22 says "its own route where one exists"; the sidebar item and palette action already point there. |
| Keep `RecordPaymentModal` name/props | rename to `RecordPaymentPage` / keep | keep | `fees/dues.tsx` (fees lane) imports it; keeping the API avoids a cross-lane edit. |
| Line total column | keep / drop | drop | pay + discount per line is noise; the summary band carries the totals. |

## Files
- `client-admin/src/routes/_staff/payments/index.tsx` — drop the modal mount; `?record=1` redirect; header/empty-state action → `/payments/record` (also changed by payments-1a, runs earlier)
- `client-admin/src/routes/_staff/payments/record.tsx` — renders the full-page form instead of redirecting
- `client-admin/src/routes/_staff/payments/-record/record-payment-modal.tsx` — `FullPageShell` frame, 3 steps, labels, error text, name seeding
- `client-admin/src/routes/_staff/payments/-record/cart-table.tsx` — new columns, phone list, summary band
- `client-admin/src/routes/_staff/payments/-record/discount-cell.tsx` — ghost button + lucide `lock`
- `client-admin/src/routes/_staff/payments/-record/tender-section.tsx` — new labels, change value, radio rows
- `client-admin/src/routes/_staff/payments/-record/checkout-success.tsx` — body restyle, actions move to the shell footer
- `client-admin/src/routes/_staff/payments/index.test.tsx` — redirect + navigation tests (also changed by payments-1a, runs earlier)
- `client-admin/src/routes/_staff/payments/record.test.tsx` (**New**), `-record/record-payment-modal.test.tsx`, `-record/cart-table.test.tsx`, `-record/tender-section.test.tsx`, `-record/checkout-success.test.tsx`, `-record/record-payment-modal.stories.tsx`, `-record/checkout-success.stories.tsx`
- `ui/src/i18n/locales/{en,bn}/payments.json` — record keys below (also changed by payments-1a, runs earlier)
- `ui/src/i18n/locales/{en,bn}/approval.json` — `scopes` entry for `fees.discount`
- `e2e/journeys/checkout.spec.ts` — dialog → full page selectors

## Steps
1. **Locale (`payments.json`, en + bn).** Add:
   - `record.sections.students` "1. Student" / "১. শিক্ষার্থী"; `record.sections.studentsHelp` "Find the student you are taking money from. Add siblings to take it together (up to 10)." / "যার টাকা নিচ্ছেন তাকে খুঁজে বাছুন। ভাইবোনের টাকা একসাথে নিতে আরও যোগ করুন (সর্বোচ্চ ১০ জন)।"; `record.sections.bills` "2. Bills due" / "২. বকেয়া বিল"; `record.sections.billsHelp` "Type the amount received and it is split from the oldest bill. You can change any line." / "প্রাপ্ত টাকা লিখলে সবচেয়ে পুরনো বিল থেকে ভাগ হয়ে যায়। যেকোনো ঘর নিজে বদলাতে পারেন।"; `record.sections.money` "3. Take the money" / "৩. টাকা গ্রহণ"
   - `record.students.addAnotherLabel` "Add another student" / "আরেকজন শিক্ষার্থী যোগ করুন"; `record.students.chip` "{{name}} · {{className}} {{sectionName}}" (same in bn)
   - `record.cart.pickStudent` "Pick a student first to see the bills due." / "বকেয়া বিল দেখতে আগে একজন শিক্ষার্থী বাছুন।"; `record.discount.give` "Give discount" / "ছাড় দিন"
   - `record.submitWithAmount` "Record {{amount}}" / "{{amount}} রেকর্ড করুন"; `record.changeHandlingLabel` "Change" / "ফেরতের টাকা"; `record.tender.hint` "Only to work out the change; you can leave it empty." / "ফেরত হিসাব করতে, না লিখলেও চলবে।"
   - Change values: bn `record.tender.tenderedLabel` → "হাতে পেলেন" (en "Cash handed over"); bn `record.tender.changeLabel` → "ফেরত দিতে হবে" (en "Change to give back"); bn `record.tender.changeReturn` → "হাতে ফেরত দিন"; bn `record.tender.changeToWallet` → "ওয়ালেটে জমা রাখুন"; bn `record.cancel` → "বাতিল করুন". (`record.method.methods.CASH` → "নগদ টাকা" is already done by payments-1a.)
   - `printFormat.label` "Paper size" / "কাগজের মাপ"; `printFormat.a4` "A4 page" / "A4 পাতা"; `printFormat.pos80` "Receipt printer — 80 mm" / "রসিদ প্রিন্টার — ৮০ মিমি"; `printFormat.pos58` "Receipt printer — 58 mm" / "রসিদ প্রিন্টার — ৫৮ মিমি" (shared with the invoice detail ticket, payments-4).
   - Delete keys that become unused: `record.description`, `record.cart.columnTotal`, `record.discount.unlock`.
2. **Locale (`approval.json`).** Add `scopes` entry for `fees.discount`: en "Approve: discount on a payment", bn "অনুমোদন করুন: পেমেন্টে ছাড়" — same key format as the existing `scopes` entries. (The modal's lookup map is shared — see Out of scope.)
3. **`index.tsx`.** Remove the `RecordPaymentModal` mount, its import and `setModalOpen`. Keep `record`, `student_id`, `guardian_id` in `validateSearch` (the redirect reads them) but stop using them in the component; add `beforeLoad`: if `search.record` is `'1'`, `throw redirect({ to: '/payments/record', search: { student_id, guardian_id } })` (with the same `eslint-disable-next-line @typescript-eslint/only-throw-error` comment `record.tsx` uses today). The header action and the empty-state action become `onClick: () => navigate({ to: '/payments/record' })`. Do this in the same change as step 4 — `record.tsx` today redirects back to `/payments?record=1`, so changing only one of the two files loops.
4. **`record.tsx`.** Replace `beforeLoad` redirect with a component: `validateSearch` = `{ student_id?, guardian_id? }`; loader `loadRouteNamespaces('payments', 'common', 'fees')`; component wraps `<RecordPaymentModal open onOpenChange={(o) => !o && close()} studentId guardianId />` in `RegionConfigProvider`. `close()` = `router.history.canGoBack() ? router.history.back() : navigate({ to: '/payments' })`. Update the header comment.
5. **`record-payment-modal.tsx`.** Replace `Dialog`/`DialogContent`/`DialogHeader`/`DialogFooter` with `FullPageShell` from `@biddaloy/ui`: `title={success ? t('record.success.title') : t('record.title')}`, `size="wide"`, `dirty={selected.length > 0 || amountReceivedMinorUnits !== undefined}` (false on the success view), `onClose={resetAndClose}`, `secondary={{ label: t('record.cancel'), onClick: resetAndClose }}`, `primary={{ label: subtotalMinorUnits > 0 ? t('record.submitWithAmount', { amount: formatCurrency(subtotalMinorUnits, config) }) : t('record.submitAction'), onClick: () => formRef.current?.requestSubmit(), busy: checkout.isPending, disabled: !canSubmit }}`. Render nothing when `open` is false. Body = `<form ref={formRef} id="record-payment-form" className="space-y-6">` with three Card sections (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`; step 2 card is `overflow-hidden` with no padding, header `p-4 md:p-5`). Order: step 1 (chips + search + "+ ভাইবোন যোগ করুন" outline button when guardian entry), step 2 (`MoneyInput` "প্রাপ্ত পরিমাণ" with `<label htmlFor>` in the card header, then the cart states / `CartTable`), step 3 (method `RadioGroup` → Change 6 classes, reference `Input` with label + the existing Enter guard, `TenderSection` when cash, `Textarea` remarks with label, approval note, error). Chip text: `t('record.students.chip', …)` from `cart.data.students` matched by id; while the cart has not loaded a seeded student, render a `Skeleton className="h-8 w-40 rounded-full"` in place of the chip — never `student.id`. `describeSubmitError` always returns `t('record.notifications.failed')` (delete the `ApiError.message` branch). Success: render `CheckoutSuccess` as the body and pass `primary={{ label: t('record.success.recordAnother'), onClick: onRecordAnother }}`, `secondary={{ label: t('record.success.viewInvoice'), onClick: onViewInvoice }}`.
6. **`cart-table.tsx`.** Use `DataTable`-look markup from the kit (`thead` `bg-muted text-label text-text-secondary`, `td` `h-10 px-4 py-1`, numbers `text-right tabular-nums`). Columns per Change 4, status in its own column. Desktop table `hidden md:block`; phone list `md:hidden divide-y divide-border-subtle` per Mobile behaviour. Multi-student: one sub-heading row per student (`text-h3`, `px-4 pt-4 md:px-5`). Summary band = `dl space-y-2 border-t border-border-subtle bg-muted p-4 md:px-5`; wallet row uses the kit `Checkbox` row; last row `border-t pt-2`, value `text-h3`. Empty cart keeps `record.cart.empty`, as `p-4 text-text-secondary`.
7. **`discount-cell.tsx`.** Locked state = ghost button `inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-label font-medium text-text-secondary hover:bg-muted md:h-8` with lucide `Lock` (`size-4`) + `t('record.discount.give')` (or the amount when > 0). Delete the hand-written SVG. "বাকিটা ছাড় দিন" becomes a ghost button (`text-primary`), not an underlined link.
8. **`tender-section.tsx`.** Layout `grid gap-4 md:grid-cols-2`: tendered field (label + help) | change value (`flex h-11 items-center rounded-md bg-status-due-bg px-3 text-h3 text-status-due-fg tabular-nums md:h-8`, label `record.tender.changeLabel`). Change-handling `RadioGroup` as option rows (`grid gap-2 md:grid-cols-2`) under a legend `record.changeHandlingLabel`.
9. **`checkout-success.tsx`.** Summary card: Card + `text-center`, invoice number, amount `text-h1`, change box `bg-status-due-bg text-status-due-fg`. Print format = option rows under the legend `printFormat.label`, labels `printFormat.a4|pos80|pos58` (this namespace), print button outline. Remove the bottom button row (the shell footer now holds both actions); keep the guardian-picker `Dialog` but `size="sm"`.
10. Run `pnpm --filter client-admin test payments`, update snapshots/selectors, then `graphify update .`.

## Tests
- `payments/index.test.tsx` — replace the three `?record=1` modal tests: `?record=1&student_id=s1` redirects to `/payments/record?student_id=s1`; the header button navigates to `/payments/record`.
- `payments/record.test.tsx` (**New**) — `/payments/record?student_id=s1` shows `h1` "পেমেন্ট রেকর্ড করুন" and a "বন্ধ করুন" button; Close with no changes returns to `/payments`.
- `-record/record-payment-modal.test.tsx` — swap `getByRole('dialog')` for the `h1`; add: seeded student never renders its id; primary label contains the subtotal; a 500 from checkout shows `record.notifications.failed`, not the server message; Enter in the reference field still does not submit.
- `-record/cart-table.test.tsx` — no "মোট" column; status column present; wallet row toggles.
- `-record/tender-section.test.tsx`, `-record/checkout-success.test.tsx` — new labels; success view has no inline action row.
- `e2e/journeys/checkout.spec.ts` — replace the three `getByRole('dialog', { name: t('payments.record.title') })` checks with `getByRole('heading', { level: 1, name: t('payments.record.title') })`; submit via the footer button name `t('payments.record.submitWithAmount', …)` (match by regex on "রেকর্ড করুন").

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (record payment).
- [ ] Mobile at 390 px matches the "after" screenshot (record payment); no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] `/payments/record` covers the app chrome, URL stays `/payments/record`, Close asks before discarding typed data.
- [ ] Steps read 1 → 2 → 3; "প্রাপ্ত পরিমাণ" sits in the bills card.
- [ ] The primary button shows the amount being recorded.
- [ ] Remarks and reference fields have visible labels.

## Out of scope
- Step-up approval dialog label for `fees.discount` needs the shared modal's lookup map — filed in shared-requests (this ticket adds the locale key).
- `fees/dues.tsx` (fees lane) — fees-1 already drops its local `RecordPaymentModal` and navigates to `/payments/record?student_id=…`, which works before and after this ticket (today `record.tsx` redirects to `/payments?record=1`). No cross-lane order needed.
- The payment list on `/payments` — payments-1a.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| admin-verification-modal: map fees.discount + payments.reverse scopes | Accepted | 31.2.14c | still add the approval.json scopes entries in payments-1 / payments-2; the modal shows them as soon as the key exists (guarded with i18n.exists) |
| sidebar item /payments | Accepted | 31.3.1 | finance.payments -> /payments, PAYMENT_READ (route-permissions /_staff/payments/ changed to match), icon receipt-text, label nav:items.payments "পেমেন্ট", placed before invoices; dropped from NOT_IN_NAV |
| route-crumbs for /payments and /payments/$id | Accepted | 31.3.5 | /payments crumb = nav:items.payments; /payments/$id = পেমেন্ট (link) › dynamic paymentDetail |
| fees dues.tsx opens /payments/record by URL (fees-lane file) | Accepted | — | already done by page ticket fees-1 (Change 7, Step 2); nothing to add |

Wave: 9   Lane: payments   Decisions: D1, D5, D6, D9, D15, D21, D22, D23, D25, D29   Depends on: 31.3.8b, 31.4.payments-1a
