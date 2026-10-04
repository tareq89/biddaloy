# [31.4.payments-2] Payment detail — facts header, print first, reverse tucked away

## Goal
`/payments/$id` shows who paid, how much, when, how and into which bills in one header plus one table, with "রসিদ প্রিন্ট করুন" as the single primary and "পেমেন্ট বাতিল করুন" moved into the More menu.

## What and why
A cashier opens a payment to reprint its receipt, check which bills it paid, or (rarely, an admin) reverse it. Today the page starts with an underlined "back" link, scatters the facts in a loose grid, shows a red filled "reverse" button on the page itself (D29 allows red filled only inside a confirm dialog) and shows raw UUIDs ("#5ecc0dab… এর বিপরীত", and a list of ids when a reversal is blocked). The redesign uses the kit's detail header (name + status + facts), makes printing the receipt the one primary, puts the rare and dangerous reverse in More, and replaces every id with a link that has a name.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_id/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/payments_id/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Top | Delete the "পেমেন্টে ফিরে যান" link; the layout's breadcrumbs (`পেমেন্ট › …`) take over. | D16 — no back link |
| 2 | Header | `PATTERN: DetailHeader`: `h1` = student name, `StatusBadge domain="payment"` beside it. | D16, D27 |
| 3 | Facts | `dl` facts: পরিমাণ, তারিখ, পদ্ধতি, লেনদেন রেফারেন্স (only when not null), সংগ্রহকারী, **New** ছাড় অনুমোদনকারী (`approved_by.full_name`, `—` when null; already in the DTO), চালান (link with the invoice number, or "কোনো চালান নেই"). | Everything at a glance; approver was returned but never shown |
| 4 | Actions | Primary "রসিদ প্রিন্ট করুন" (`printer`) → `openPrintableInvoice(invoice.id, …)`; shown when `invoice !== null` and the user has `INVOICE_PRINT`. More menu (`ellipsis`): "চালান দেখুন" (`receipt`), "শিক্ষার্থীর পাতা" (`user-round`), separator, "পেমেন্ট বাতিল করুন" (`undo-2`, `text-destructive`) — last item, only when today's reverse rules allow it. | D16, D29 — one primary, danger only in More + confirm |
| 5 | Allocations | Card "কোন ফিতে কত গেল" + help "এই পেমেন্টের টাকা যে বিলগুলোতে বসেছে।", flush table (ফি, মেয়াদ, পরিশোধ, ছাড়; numbers right-aligned), footer `TableCount` "মোট ৩টি". | Plain title (D32); D19 total |
| 6 | Remarks | When `remarks` is not null, a Card "মন্তব্য" with the text under the allocations. | It is returned but never shown |
| 7 | Reversal row | A reversal payment shows an info Card: "এটি একটি বাতিলের এন্ট্রি।" + link "মূল পেমেন্ট দেখুন" → `/payments/${reversal_of_payment_id}`. A reversed payment shows `StatusBadge tone="neutral" label="বাতিল হয়েছে"` in place of the success badge, and a Card "এই পেমেন্টটি বাতিল করা হয়েছে।" with link "বাতিলের এন্ট্রি দেখুন" → `/payments/${reversed_by_payment_id}`. | D9 — today shows `#<uuid>` |
| 8 | Reverse dialog | `ConfirmDialog`-look `Dialog size="sm"`: title, description, the 3 consequences as a plain list, "কারণ" textarea (required mark), Cancel outline + danger confirm. Blocking later payments render as links "পরবর্তী পেমেন্ট ১", "… ২" (numbered, never the id). | D9, D21, D29 |
| 9 | Loading / error | Header skeleton shaped like the header (title bar + 4 fact bars) + table skeleton; error = `ErrorState` with retry. | D28 |

## Mobile behaviour
- Crumbs show the last two; facts are a 2-column grid.
- Primary "রসিদ প্রিন্ট করুন" is full width (`flex-1`) with the More button beside it.
- The allocations table keeps the ফি and পরিশোধ columns; মেয়াদ and ছাড় move into a second line under the fee name ("সেপ্টেম্বর ২০২৬ · ছাড় ৳০.০০").

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Primary action | none / reverse / print receipt | print receipt | Reprinting is the common reason to open a payment; reverse is rare, admin-only and destructive. |
| Header component | `DetailShell` (needs `tabs`) / inline header markup | inline markup with the kit classes | `DetailShell.tabs` is required and this page has no tabs; a tab row with one tab is noise. Shared request filed to make `tabs` optional; switch to it when it lands. |
| Approver | hide / show | show as a fact | Approved discounts are money-tier; the DTO already returns it. |

## Files
- `client-admin/src/routes/_staff/payments/$id.tsx` — header, actions, cards, reversal states
- `client-admin/src/routes/_staff/payments/-reverse-payment-dialog.tsx` — dialog size, layout, blocking-payment links
- `client-admin/src/routes/_staff/payments/$id.test.tsx`
- `client-admin/src/routes/_staff/payments/-reverse-payment-dialog.test.tsx`
- `ui/src/i18n/locales/{en,bn}/payments.json` — keys below
- `ui/src/i18n/locales/{en,bn}/approval.json` — `scopes` entry for `payments.reverse`
- `e2e/journeys/reversal.spec.ts` — reverse is now a More-menu item

## Steps
1. **Locale (`payments.json`).** Add under `detail`: `reference` "Transaction reference" / "লেনদেন রেফারেন্স"; `approver` "Discount approved by" / "ছাড় অনুমোদনকারী"; `printReceipt` "Print receipt" / "রসিদ প্রিন্ট করুন"; `printError` "The receipt could not be opened for printing." / "রসিদ প্রিন্টের জন্য খোলা যায়নি।"; `moreActions` "More actions" / "আরও অ্যাকশন"; `viewInvoice` "View invoice" / "চালান দেখুন"; `viewStudent` "Student page" / "শিক্ষার্থীর পাতা"; `remarks` "Remarks" / "মন্তব্য"; `reversalEntry` "This is a reversal entry." / "এটি একটি বাতিলের এন্ট্রি।"; `viewOriginal` "View original payment" / "মূল পেমেন্ট দেখুন"; `reversedStatus` "Reversed" / "বাতিল হয়েছে"; `viewReversal` "View reversal entry" / "বাতিলের এন্ট্রি দেখুন"; `allocations.title` → "Where the money went" / "কোন ফিতে কত গেল"; `allocations.help` "The bills this payment was put against." / "এই পেমেন্টের টাকা যে বিলগুলোতে বসেছে।"; `reverseDialog.laterPaymentLink` "Later payment {{n}}" / "পরবর্তী পেমেন্ট {{n}}" (`n` via `formatNumber`). Change bn `reversedBanner` → "এই পেমেন্টটি বাতিল করা হয়েছে।" (drops the English "(reverse)"). Delete `back`, `reversalOf`.
2. **Locale (`approval.json`).** Add `scopes` entry for `payments.reverse`: en "Approve: reverse a payment", bn "অনুমোদন করুন: পেমেন্ট বাতিল" (same key format as the existing entries).
3. **`$id.tsx` header.** Remove the `Link` back. Render, inside the page (the shell supplies `PageContainer` and crumbs):
   - `<header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">`
   - left `<div className="min-w-0">`: `<div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h1 className="text-h1">{student?.full_name ?? t('list.deletedStudent')}</h1>{badge}</div>` where `badge` = `alreadyReversed ? <StatusBadge tone="neutral" label={t('detail.reversedStatus')} /> : <StatusBadge domain="payment" status={…} />`.
   - facts `<dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:flex md:flex-wrap">`, each `<div><dt className="text-caption text-text-secondary">…</dt><dd className="font-medium">…</dd></div>`; amount `formatServerAmount`, date `formatDate(parseServerDate(…))`, method `t('record.method.methods.<M>')`, invoice = `Link` with `font-medium text-primary underline underline-offset-2 inline-flex min-h-11 items-center md:min-h-0`.
   - right `<div className="flex shrink-0 items-center gap-2">`: primary `Button` (`className="flex-1 md:flex-none"`, `Printer` icon) → `openPrintableInvoice(payment.invoice.id, () => toast.error(t('detail.printError')))`; then an icon `Button variant="ghost"` (`aria-label={t('detail.moreActions')}`, `Ellipsis`) opening `DropdownMenu` from `@biddaloy/ui` with the items from Change 4. The reverse item uses the existing visibility rule (`canReverse && !alreadyReversed && !isReversal && status === SUCCESS`) and opens `ReversePaymentDialog`. Hide the whole More button when it would be empty.
   If no print is possible (no invoice or no `INVOICE_PRINT`), there is no primary; More still shows.
4. **`$id.tsx` body.** Allocations Card `overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1`: header `p-4 md:p-5` (`h2 text-h2` + help `mt-1 text-text-secondary`), table per `PATTERN: DataTable (unpaginated)` (phone second line per Mobile behaviour), footer `<TableCount total={allocations.length} />` in `border-t border-border-subtle px-4 py-3`. Remarks Card and reversal Cards per Changes 6–7 (Card classes `rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`; reversal card icon `info` in `text-status-partial-fg`). Sections spaced by the container's `space-y-6`.
5. **Pending/error.** Replace `Skeleton className="h-7 w-48"` with a header-shaped skeleton (`aria-busy="true"`; bars `h-3 rounded-sm bg-muted`: one `w-48 h-7`, four `w-24` fact bars, then a `h-40` table block). `ErrorState` keeps `message`/`onRetry`.
6. **`-reverse-payment-dialog.tsx`.** `DialogContent size="sm"`; consequences `ul className="list-disc space-y-1 pl-5 text-text-secondary"`; reason label with the required mark; confirm button `variant="destructive"` with `Undo2` icon; blocking list renders `blockingPaymentIds.map((id, i) => <Link to="/payments/$id" params={{ id }} className="font-medium text-primary underline underline-offset-2">{t('detail.reverseDialog.laterPaymentLink', { n: formatNumber(i + 1, config) })}</Link>)`. Footer per `Dialog` pattern: Cancel outline, then confirm.
7. Run `pnpm --filter client-admin test payments/\$id payments/-reverse`, then `graphify update .`.

## Tests
- `$id.test.tsx` — no "back" link; `h1` is the student name; facts include ছাড় অনুমোদনকারী; exactly one filled button ("রসিদ প্রিন্ট করুন") and it calls `openPrintableInvoice` with the invoice id; reverse is reachable only through the More menu and hidden for a reversal row; a reversal row shows "মূল পেমেন্ট দেখুন" linking to the original id and never renders the id as text; a `null` invoice hides the primary.
- `-reverse-payment-dialog.test.tsx` — a 409 `REVERSE_LATER_PAYMENTS_FIRST` renders "পরবর্তী পেমেন্ট ১" links and no UUID text.
- `e2e/journeys/reversal.spec.ts` — open the More menu (`getByRole('button', { name: t('payments.detail.moreActions') })`) before clicking `getByRole('menuitem', { name: t('payments.detail.reverseAction') })`.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No red filled button on the page; "পেমেন্ট বাতিল করুন" is the last More item.
- [ ] Allocations card shows "মোট nটি".
- [ ] No "back to list" link.

## Out of scope
- Crumbs read "পেমেন্ট রেকর্ড করুন › …" and the last crumb has no name — filed in shared-requests (crumb label + payment entity resolver).
- Step-up dialog label for `payments.reverse` needs the shared modal's lookup map — filed (this ticket adds the locale key).
- `DetailShell` with optional `tabs` — filed; this ticket writes the header markup itself until then.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| DetailShell tabs optional, body via children | Accepted | 31.2.5b | <DetailShell name statusBadge facts actions>{body}</DetailShell> — omit tabs/activeTab/onTabChange |
| crumb resolver: payment | Accepted | 31.3.5 | resolver key paymentDetail reads paymentKeys.detail(id) (usePayment) -> "<student name> — <formatDate(payment_date)>", date only when student is null |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: payments   Decisions: D5, D6, D9, D15, D16, D19, D21, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.payments-1b
