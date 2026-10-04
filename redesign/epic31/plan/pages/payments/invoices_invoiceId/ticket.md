# [31.4.payments-4] Invoice detail — show the bills, group print and send

## Goal
`/invoices/$invoiceId` shows what the invoice is for (its line items and totals, already in the response) and groups the actions into a "প্রিন্ট" card (paper size next to the one primary) and an "অভিভাবককে পাঠান" card (WhatsApp, SMS, share link).

## What and why
The accountant opens an invoice to check what was paid for, reprint it or send it to a guardian. Today the page never shows the fees on the invoice (the `snapshot` with every line is returned but not rendered), starts with an underlined back link, shows the invoice UUID as the last crumb, and stacks print format, print, share and send in one box whose jargon ("পস ৮০মিমি") a cashier has to decode. The redesign puts the facts in the kit detail header, renders the snapshot as a table per student with a totals band, and splits the actions into two clearly named cards.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/invoices_invoiceId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/invoices_invoiceId/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/invoices_invoiceId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/payments/invoices_invoiceId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Top | Delete "চালান তালিকায় ফিরুন"; layout crumbs `চালান › INV-…` take over. | D16 |
| 2 | Header | `PATTERN: DetailHeader`: `h1` = invoice number, invoice `StatusBadge` beside it; a credit note also gets the neutral pill "ক্রেডিট নোট" (replaces the red outlined span). | D16, D27 |
| 3 | Facts | শিক্ষার্থী ("নাম · REG-…", spans 2 columns on phone), ইস্যুর তারিখ, শেষ তারিখ (only when status is not PAID or CANCELLED), মোট, **New** পেমেন্ট (link "পদ্ধতি · তারিখ" → `/payments/$payment_id`, when `payment_id` is set), **New** মূল চালান (credit note only: link with `related_invoice.invoice_number`). The separate কর / ছাড় facts move into the totals band. | One glance; cross-links instead of dead ends |
| 4 | Line items | **New** one Card per `snapshot.students[]`: `h2` = student name, subtitle "শ্রেণি · REG-…"; flush table ফি, মেয়াদ (`period_label`), বিল, ছাড়, এবার পরিশোধ, বাকি (numbers right-aligned). | The data is returned and typed (`InvoiceSnapshotStudent`/`Line`) but never shown |
| 5 | Totals band | Under the last student card's table: মোট বিল (`totals.billed`), ছাড় (`totals.discount`), কর (only when `tax_amount > 0`), ওয়ালেট থেকে (`totals.wallet_used`, only when > 0), পরিশোধিত (`totals.paid`, `text-h3`), ফেরত (`totals.change`, only when > 0). | Mirrors the printed receipt |
| 6 | Notes | `notes` (when not null) as a Card "নোট" under the line items. | Was a loose grey paragraph |
| 7 | "প্রিন্ট" card | Right column (desktop) / first card (phone): "কাগজের মাপ" radio rows (A4 পাতা · রসিদ প্রিন্টার — ৮০ মিমি · রসিদ প্রিন্টার — ৫৮ মিমি, persisted as today) + full-width primary "প্রিন্ট করুন". Shown with `INVOICE_PRINT`. | Control next to what it changes; plain words for POS paper |
| 8 | "অভিভাবককে পাঠান" card | Outline WhatsApp / SMS buttons in a 2-column grid (disabled + help text when no guardian); divider; `h3` "শেয়ার লিংক" + help "লিংক থাকলে যে কেউ লগইন ছাড়া রসিদটি দেখতে পারবে।"; outline "লিংক তৈরি করুন", or (when a live link exists) the URL field + "লিংক কপি করুন" outline + "লিংক বন্ধ করুন" ghost (`text-destructive`). Revoke confirm uses `ConfirmDialog tone="danger"`. | Groups the "send to someone" actions; the share link's consequence is said up front |
| 9 | Loading / error | Header-shaped skeleton + two card blocks; `ErrorState` with retry. | D28 |

## Mobile behaviour
- One column. Order: header + facts, "প্রিন্ট" card (primary visible near the top), "অভিভাবককে পাঠান" card, then the line-item cards.
- Line-item table keeps ফি and এবার পরিশোধ; the second line under the fee name reads "মেয়াদ · বিল ৳…" (`md:hidden`); other columns `hidden md:table-cell`.
- All buttons and radio rows `h-11` / `min-h-11`.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Render line items | keep hidden (the file comment says "out of scope") / render `snapshot` | render | `snapshot` is fully typed in `schema.d.ts` (no unsound cast, unlike `line_items`); an invoice that does not say what it is for fails the page's job. No API change. |
| Where the primary lives | page header / inside the print card | print card | The paper size must sit next to the button it affects; the card is first on phone, so the primary is still near the top. |
| Header component | `DetailShell` (needs `tabs`) / inline header markup | inline markup with the kit classes | No tabs on this page; shared request filed to make `tabs` optional. |
| Credit-note badge colour | danger outline (today) / neutral pill | neutral pill | A credit note is a normal document, not an error (D27 tones). |
| "Revoke" wording | "বাতিল করুন" / "লিংক বন্ধ করুন" | "লিংক বন্ধ করুন" | "বাতিল করুন" is also Cancel and reverse-payment; one word per thing (D32). |

## Files
- `client-admin/src/routes/_staff/invoices/$invoiceId.tsx` — header, facts, line items, totals, action cards
- `client-admin/src/routes/_staff/invoices/$invoiceId.test.tsx`
- `ui/src/i18n/locales/{en,bn}/payments.json` — `invoiceDetail.*` keys below (print-format keys come from payments-1b)
- `e2e/journeys/invoice-sharing.spec.ts` — new radio, print and revoke names

## Steps
1. **Locale (`payments.json`, en + bn), under `invoiceDetail`:** `student` "Student" / "শিক্ষার্থী"; `payment` "Payment" / "পেমেন্ট"; `paymentValue` "{{method}} · {{date}}" (same in bn); `originalInvoice` "Original invoice" / "মূল চালান"; `creditNote` "Credit note" / "ক্রেডিট নোট"; `lines.caption` "Bills for {{name}}" / "{{name}}-এর বিল"; `lines.fee` "Fee" / "ফি"; `lines.period` "Period" / "মেয়াদ"; `lines.billed` "Bill" / "বিল"; `lines.discount` "Discount" / "ছাড়"; `lines.paidNow` "Paid now" / "এবার পরিশোধ"; `lines.balance` "Left to pay" / "বাকি"; `totals.billed` "Total billed" / "মোট বিল"; `totals.discount` "Discount" / "ছাড়"; `totals.tax` "Tax" / "কর"; `totals.wallet` "From wallet" / "ওয়ালেট থেকে"; `totals.paid` "Paid" / "পরিশোধিত"; `totals.change` "Change given" / "ফেরত"; `notes` "Notes" / "নোট"; `printTitle` "Print" / "প্রিন্ট"; `printAction` "Print" / "প্রিন্ট করুন"; `sendTitle` "Send to guardian" / "অভিভাবককে পাঠান"; `sendWhatsapp` "WhatsApp" / "হোয়াটসঅ্যাপ"; `sendSms` "SMS" / "এসএমএস"; `shareTitle` "Share link" / "শেয়ার লিংক"; `shareHelp` "Anyone with the link can see this receipt without signing in." / "লিংক থাকলে যে কেউ লগইন ছাড়া রসিদটি দেখতে পারবে।"; `shareCreate` "Create link" / "লিংক তৈরি করুন"; `shareRevoke` "Turn off link" / "লিংক বন্ধ করুন"; `shareRevokeTitle` "Turn off this link?" / "এই লিংক বন্ধ করবেন?". Existing `fees:invoiceDetail.*` keys (load errors, copy, toasts, `send.noGuardians`, `share.linkHidden`, `totalAmount`, dates) keep being read from `fees`.
2. **Loader.** `loadRouteNamespaces('fees', 'payments')`.
3. **Header.** Remove the back `Link`. Same inline DetailHeader markup and classes as payments-2 step 3 (`header` → `min-w-0` block with `h1 className="text-h1"` + badges, facts `dl mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:flex md:flex-wrap`; the student fact `className="col-span-2"`). No header actions (the primary lives in the print card). Payment fact text: `t('invoiceDetail.paymentValue', { method: t('record.method.methods.<M>'), date: formatDate(parseServerDate(snapshot.payment.payment_date), config) })`.
4. **Layout.** `<div className="flex flex-col gap-6 md:flex-row md:items-start">`; main column `order-2 min-w-0 flex-1 space-y-6 md:order-1`; aside `order-1 space-y-6 md:order-2 md:w-80 md:shrink-0`.
5. **Line-item cards.** For each `invoice.snapshot.students` entry: Card `overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1`, header `p-4 md:p-5` (`h2 text-h2` name, `mt-1 text-text-secondary` "`class_name` · `registration_number`", class omitted when null), table per `PATTERN: DataTable (unpaginated)` with `caption className="sr-only"` = `lines.caption`. Amounts via `formatServerAmount`. `period_label` rendered as given (`—` when empty). The totals band (`dl space-y-2 border-t border-border-subtle bg-muted p-4 md:px-5`, rows `flex justify-between gap-4`, last row `border-t border-border-subtle pt-2` with value `text-h3`) goes at the bottom of the last card. If `snapshot.students` is empty (old rows), render only the totals band in a Card.
6. **Print card** (`INVOICE_PRINT`): Card, `h2` `printTitle`, `RadioGroup` with legend `payments:printFormat.label` and three option rows (`flex min-h-11 w-full items-center gap-3 rounded-md border px-3 md:min-h-8`, checked `border-primary bg-secondary font-semibold text-secondary-foreground`, labels `payments:printFormat.a4|pos80|pos58`), keep `persistPrintFormat`; primary `Button className="mt-4 w-full"` with `Printer` icon → `printInvoice(invoice.id, format)`.
7. **Send card** (`INVOICE_READ`): Card, `h2` `sendTitle`; `grid grid-cols-2 gap-2` with two outline buttons (`MessageCircle`, `MessageSquare`) keeping `startSend` / loading / disabled logic; `noGuardians` help under them when empty. Then `mt-4 border-t border-border-subtle pt-4`: `h3` `shareTitle`, help `shareHelp`, and the existing share states restyled — create = outline full width (`Link` icon); live link + URL = read-only `Input` (label `fees:invoiceDetail.share.urlLabel`) + outline "লিংক কপি করুন"; live link without URL = `share.linkHidden` text; revoke = ghost `text-destructive` `shareRevoke`. Replace the revoke `Dialog` with `ConfirmDialog tone="danger" title={shareRevokeTitle} description={fees:invoiceDetail.share.revokeConfirmExplanation} confirmLabel={shareRevoke}`. Guardian picker `Dialog` → `size="sm"`.
8. **Pending/error** as payments-2 step 5.
9. Delete the file-header paragraph saying line items are not rendered; run `pnpm --filter client-admin test invoices/\$invoiceId`, then `graphify update .`.

## Tests
- `$invoiceId.test.tsx` — no back link; `h1` is the invoice number; a snapshot with 2 students renders 2 tables with their lines and a totals band whose "পরিশোধিত" equals `totals.paid`; credit note shows the pill and a "মূল চালান" link; exactly one filled button ("প্রিন্ট করুন"), and choosing "রসিদ প্রিন্টার — ৮০ মিমি" then printing calls `printInvoice(id, 'pos80')`; revoke opens a `ConfirmDialog` (`role="alertdialog"`); no element contains the invoice UUID as text.
- `e2e/journeys/invoice-sharing.spec.ts` — radio name `t('payments.printFormat.pos80')`; print button `t('payments.invoiceDetail.printAction')`; create `t('payments.invoiceDetail.shareCreate')`; revoke button and confirm `t('payments.invoiceDetail.shareRevoke')`, dialog role `alertdialog` with name `t('payments.invoiceDetail.shareRevokeTitle')`. `invoices.spec.ts` / `reversal.spec.ts` keep passing (`fees.invoiceDetail.totalAmount` fact and the CANCELLED status text stay).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The fees on the invoice are listed with a totals band.
- [ ] Paper size sits in the same card as "প্রিন্ট করুন"; no "পস" wording.
- [ ] Credit note links to its original invoice; invoice links to its payment.

## Out of scope
- Last crumb shows the invoice UUID (B16) — owned by 31.3.5.
- `period_label` is built in English on the server (`invoices.service.ts:102`, `MONTH_NAMES`), so Bangla screens show "September 2026" — filed in shared-requests (server should store `period_start`, page then uses `formatMonth`).
- `DetailShell` with optional `tabs` — filed with payments-2.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server period_start on snapshot lines | Accepted | 31.3.7d | field: snapshot.students[].lines[].period_start ('YYYY-MM'; back-filled on read for old invoices) -> formatMonth(period_start); period_label only if period_start is missing |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: payments   Decisions: D5, D6, D9, D15, D16, D19, D21, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.payments-3
