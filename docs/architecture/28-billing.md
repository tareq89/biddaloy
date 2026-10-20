# Billing: seat orders and bKash payment

A school buys **seats** (BDT 10 per student per month). An order starts `PENDING`, becomes
`PAID` once, and `EntitlementService` recomputes `schools.seat_limit` from paid orders.
This doc covers the **bKash pay step** (Epic 49 W4, #1820) and the **receipt** (W5, #1822).
Code: `server/src/modules/billing/` (`bkash/` for the gateway).

## The flow

```mermaid
sequenceDiagram
    participant A as Admin (Settings > Seats & billing)
    participant S as Server
    participant B as bKash
    A->>S: POST /billing/orders  (seats, months, idempotency_key)
    S-->>A: order {id, status: PENDING}
    A->>S: POST /billing/orders/:id/pay/bkash
    S->>B: grant token (cached in Redis ~50 min)
    S->>B: create (amount "3000.00", merchantInvoiceNumber = order id)
    B-->>S: paymentID + bkashURL
    S-->>A: { bkash_url }
    A->>B: pays on the bKash page
    B->>A: redirect to GET /billing/bkash/callback?paymentID=..&status=success
    A->>S: callback
    S->>B: query, check order + stored paymentID, then execute
    B-->>S: Completed, trxID, amount, merchantInvoiceNumber
    S->>S: checks match, then OrdersService.markPaid
    S-->>A: 302 /settings?section=billing&order=<id>
    A->>S: GET /billing/summary (polls while PENDING)
```

## What is trusted

The URL the browser comes back with is **never trusted**. `paymentID` and `status` only say
_which_ payment to ask bKash about. The order is paid only when bKash itself answers:

| Check                                                                   | Why                                       |
| ----------------------------------------------------------------------- | ----------------------------------------- |
| `transactionStatus = Completed`                                         | not cancelled, not still pending          |
| `merchantInvoiceNumber` is our order id                                 | the payment belongs to an order we made   |
| `amount` equals the order amount (BDT, 2 decimals) and `currency = BDT` | no short payment                          |
| `trxID` present                                                         | it is the `platform_payments.gateway_ref` |

Anything else redirects to the generic error page (`payment=error`) and changes nothing (Rule 23: the message never echoes
the paymentID). Details go to the log, not the response.

## Idempotency

`OrdersService.markPaid` does `UPDATE ... WHERE status = 'PENDING'`. A replayed callback finds
the order `PAID`, writes no second `platform_payments` row, and does not recompute. The unique
`(method, gateway_ref)` key is the second guard. Example: opening the callback link twice gives one
payment row and the same seats.

Creating an order is idempotent per `(school, idempotency_key)`: the same body returns the first
order; a different `seats`/`months` body on a used key is `409 IDEMPOTENCY_KEY_REUSED`.

A paid purchase's period starts on the later of today and the school's last PAID `period_end`, so
paying early extends the seats instead of counting them twice. A platform `GRANT` starts today and
adds seats (see [22-onboarding.md](22-onboarding.md#free-period-and-seats)).

## Orders that stay PENDING

- **Cancelled or failed return**: the order stays `PENDING`. It is never set `FAILED` from the
  callback, because a late payment could still arrive and the order must be able to take it.
- **Callback lost** (browser closed, execute timed out): `BkashReconciler` (BullMQ, every 10 min)
  asks bKash `query` about `PENDING` orders whose payment started under 24 h ago and settles the ones that are already `Completed` (e.g. `execute` worked but `markPaid` failed). A payment the customer approved but never executed is not completed by bKash and lapses unpaid, so no money moves and the admin pays again. After a callback fails, the callback re-queries once after 1 s (not 3 times).
  The order id to paymentID link lives in Redis (`bkash:pay:<orderId>`, 25 h), so no new table.
- **Create fails** at bKash (nothing was charged): the order becomes `FAILED`; the admin makes a new
  order. The Buy dialog already uses a fresh idempotency key when the numbers change.

## Safety rules applied

- **Outbound (Rule 7)**: every bKash call goes `assertSafeHttpDestination` then `fetchPinnedJson`.
  The host is operator config (`BKASH_BASE_URL`), so sandbox vs production is just which URL is set.
- **Public route (Rule 1)**: `GET /billing/bkash/callback` is on the route-guard allowlist
  (`server/test/helpers/route-path.helper.ts`) with a reason. It is throttled `STRICT_RATE_LIMIT`.
- **Redis down (Rule 15)**: the pay route is `@FailClosedWithoutRedis()` (it creates money state).
  The callback is **not** fail-closed (no 503 on a gateway redirect): the token cache falls back
  to a fresh grant, but the stored paymentID cannot be matched, so the callback redirects to the
  generic error page. Nothing is executed, so nobody is charged; the payment lapses and the admin pays again.
- **Known limit**: the order-to-paymentID link is Redis only. If `markPaid` fails after `execute` and Redis is flushed before the reconciler runs, a completed payment must be matched by hand from the bKash merchant panel.
- **Snapshot (Rule 20)**: `route-status.snapshot.txt` has the callback (open) and the pay route (admin only).

## Configuration

All five are needed; if any is missing the pay route answers a generic 503.

| Variable                            | Example                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `BKASH_BASE_URL`                    | sandbox `https://tokenized.sandbox.bka.sh/v1.2.0-beta` |
| `BKASH_APP_KEY`, `BKASH_APP_SECRET` | from the bKash merchant portal                         |
| `BKASH_USERNAME`, `BKASH_PASSWORD`  | the merchant API user                                  |

The callback URL bKash redirects to is `<APP_BASE_URL>/api/v1/billing/bkash/callback`.

## Receipts

Every order paid by bKash or an offline payment gets a numbered receipt. A platform `GRANT` is a
zero-value gift and gets none.

```mermaid
flowchart LR
    P["markPaid (once)"] --> N["receipt_number = SMR-2026-000012<br/>(same transaction)"]
    N --> E["after commit: email the admins<br/>(link to Settings, Seats & billing)"]
    A["Admin clicks the number in the orders table"] --> R["GET /billing/orders/:id/receipt"]
    R --> H["A4 HTML, bn or en by school locale"]
    H --> S["Browser: Save as PDF"]
```

- **Number**: `SMR-YYYY-NNNNNN`, one series for the whole platform per Asia/Dhaka year
  (`receipt-number.util.ts`). It is taken inside the payment transaction under an advisory lock,
  and `seat_orders.receipt_number` is unique, so a replay never makes a second number.
- **Download**: `ParseUUIDPipe`, `SETTINGS_MANAGE`, `@AllowWhenSuspendedForBilling` (a school that
  is read-only or paused must still reach its receipt). Another school's order, an unpaid order
  and a grant all answer the same 404.
- **VAT**: set `BILLING_VAT_REGISTRATION` and the receipt shows the number and a VAT line; unset,
  neither shows.
- **Email**: the `receipt` admin notice (en/bn). A failed send is logged and never fails the payment.

## Learning (Epic 49)

| Surprise                                                            | Cost                                                                                | Fix                                                                                           | Rule candidate                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| The server has no PDF library, and print is browser-only (Epic 32). | A "PDF receipt" would need a new dependency and a Bangla font.                      | Ship print-ready A4 HTML; the browser saves it as PDF.                                        | Prefer the browser print path for documents; add a PDF engine only if a document must be attached to an email. |
| The email could not attach a file.                                  | The ticket's "email with attachment" was not possible through `AdminNoticeService`. | The email carries a link; the download route is authenticated.                                | Send links to authenticated downloads, not files.                                                              |
| Orders are paid from two places (bKash, offline).                   | A receipt hook in each caller would drift.                                          | The number and the email hook sit in `OrdersService.markPaid`, the one place both go through. | Hook money side effects in the service that writes the money, not its callers.                                 |

## Not done here

- **IPN / webhook**: tokenized checkout settles through the callback plus the reconciler. If the
  merchant account enables IPN, add it through `verifyWebhookSignature` (Rule 19) and call the same
  `markPaid`.
- **Manual sandbox run**: needs the merchant credentials from #1816. Run one payment on the
  sandbox, check the order turns `PAID` and the seats update, and add the screenshots here.
- **Receipt as a PDF file**: not built. If a file must be attached to the email, add a PDF engine and render the same template.
- **Receipt email as a queue job**: it runs right after commit in the same process, not in BullMQ. Move it to a queue if the notice provider gets slow.
- **CI**: no real bKash call (no credentials); the client and service are covered by unit specs
  with a mocked bKash, and the API e2e covers the public callback's refusal paths.
