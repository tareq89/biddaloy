# [31.4.guest-3] Public receipt and document check — framed, translated, with a way out

## Goal
`/i/$token` (shared fee receipt) and `/v/$token` (QR document check) sit in `AuthLayout` with a visible heading, show every value in the visitor's language and numerals (no "CASH", no "(January 2026)", no Latin-digit copy number), and give the visitor a way out — matching the "after" screenshots.

## What and why
`/i/$token` is the receipt a guardian opens from an SMS or WhatsApp link; `/v/$token` is what a phone shows after scanning the QR code on an ID card or ACR. Today both are bare text at the top of an empty page: no logo, no card, no visible title (the `<h1>` is screen-reader only), no language switcher; the receipt prints the payment method as the raw value "CASH", the month in English ("January 2026") and always uses English digits (`REGION_BD_EN` is hard-coded), and the check page's states have no link anywhere. The redesign puts both in `AuthLayout`, shows the title, translates the values in the route, and adds a "home" ghost link.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — `/i/$token` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/i_token/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/i_token/before-mobile.webp?raw=true" width="260"> |
| After — `/i/$token` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/i_token/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/i_token/mobile.webp?raw=true" width="260"> |
| Before — `/v/$token` (not-found state) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/v_token/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/v_token/before-mobile.webp?raw=true" width="260"> |
| After — `/v/$token` (valid document) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/v_token/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/v_token/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Both routes | Wrap in `AuthLayout` from `@biddaloy/ui` (logo, language switcher, one `max-w-md` card, centred on desktop). Remove the `max-w-[420px] sm:max-w-[640px]` / `sm:max-w-[520px]` wrappers. | D34, D15; top-aligned bare text, no language switcher |
| 2 | Both routes | The `sr-only` `<h1>` becomes the visible card heading `text-h1`: "চালান রসিদ" (`fees:invoiceDetail.publicReceipt.pageTitle`) / "নথি যাচাই" (`verify:pageTitle`). | "Where am I" failed; no "রসিদ" heading |
| 3 | Receipt numerals and dates | `config={REGION_BD_EN}` → `useRegionConfig()` (the visitor's language; `AuthLayout` provides the region). Dates then render per D5 through `InvoiceReceipt`'s own `formatDate`. | D5, D6 — English digits and ISO-looking dates in a Bangla page |
| 4 | Receipt payment method | The route maps `payment.method` to `payments:record.method.methods.<METHOD>` ("নগদ টাকা") before passing the data; unknown value → "—". | D9 — raw "CASH" |
| 5 | Receipt month | The route turns each line's `period_label` ("January 2026", an English snapshot written by the server) into `formatMonth('2026-01')` ("জানুয়ারি ২০২৬"); anything that does not match "<Month> <year>" stays as it is. | D5 — English month inside Bangla text |
| 6 | Receipt action | "পিডিএফ হিসেবে সংরক্ষণ করুন" becomes the page's primary `Button` (full width, `Download` icon, still `print:hidden`). | One obvious next action; hand-rolled button classes |
| 7 | Both routes | **New** ghost link "SchoolManager হোম পাতায় যান" → `/` under the content, in every state (loaded, not found, error). | No way out |
| 8 | Error / not-found states | Hand-rolled dashed cards → `GuestStatus` (from guest-2's `-guest-status.tsx`) with `headingLevel="h2"`: not found = `FileQuestion` / warning, revoked receipt link same, network error = `TriangleAlert` / danger + outline "আবার চেষ্টা করুন", too many checks (`/v` 429) = `Clock` / warning. | Card-in-card; D28; retry was an underlined text button |
| 9 | `/v` result | Status banner keeps its tone but uses kit tokens: `flex items-center gap-3 rounded-lg p-4` + `bg-status-paid-bg text-status-paid-fg` (valid, `CircleCheck size-8`) or `bg-status-overdue-bg text-status-overdue-fg` (revoked, `TriangleAlert size-8`), title `text-h3`, revoked date `text-body`. | D27 tones; inline SVG → lucide |
| 10 | `/v` details | `<dl>` loses its own border/card (`mt-4 divide-y divide-border-subtle border-y border-border-subtle`), rows `flex justify-between gap-4 py-3`, `dt text-text-secondary`, `dd text-end font-medium`. Copy number via `formatNumber`; issued / revoked date via `formatDate(iso, region)`; unknown document kind falls back to "নথি" (`rows.type`) instead of the enum. | Card-in-card; D6 (copy "2" in Latin digits); D9 |

## Mobile behaviour
- One column; the receipt's two-column rows (label / amount) keep `justify-between` and wrap the label, never the amount (`tabular-nums` on amounts — already `whitespace-nowrap` enough at 360 px with the mockup data).
- Primary button and home link full width, `h-11`.
- The card starts near the top (`AuthLayout` below `md`).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Frame for a public document | Own bare layout / `AuthLayout` / a print-style A4 sheet | `AuthLayout` | D34 says guest pages share it; gives logo, card and language switcher for free; `max-w-md` suits a phone-first receipt |
| Where to translate method and month | Change `InvoiceReceipt` (shared `ui`) / change the server snapshot / map in the route | Map in the route (`i/-receipt-display.ts`) | Inside the lane's territory; `InvoiceReceipt` already formats whatever it is given |
| `/v` banner vs `StatusBadge` | Small `StatusBadge` / keep a tone banner | Tone banner with StatusBadge tone tokens | The verdict is the whole answer of the page; a 24 px badge would hide it |
| Way out target | `/login` / `/` | `/` | Root redirects signed-in users to their home and others to sign-in; a QR scanner is often not a user at all |

## Files
- `client-admin/src/routes/i/$token.tsx` — layout, visible heading, region config, mapped data, primary button, `GuestStatus` states, home link.
- `client-admin/src/routes/i/-receipt-display.ts` — **new**: `toDisplayReceipt()` and `localizePeriod()`.
- `client-admin/src/routes/i/-receipt-display.test.ts` — **new**.
- `client-admin/src/routes/i/$token.test.tsx` — cases below.
- `client-admin/src/routes/v/$token.tsx` — layout, visible heading, banner/dl classes, formatters, `GuestStatus` states, home link.
- `client-admin/src/routes/v/$token.test.tsx` — cases below.
- `ui/src/i18n/locales/en/verify.json`, `ui/src/i18n/locales/bn/verify.json` — one new key.

Imports only (not changed): `client-admin/src/routes/-guest-status.tsx` (created by guest-2, runs earlier).

## Steps
1. **Locale (`verify.json`).** **New** `home`: en "Go to SchoolManager home", bn "SchoolManager হোম পাতায় যান". No `fees.json` / `payments.json` edits (other lanes' namespaces) — those are only read.
2. **`i/-receipt-display.ts` (new).**
   ```ts
   import type { InvoiceReceiptData } from '@biddaloy/ui/components';
   import type { RegionConfig } from '@biddaloy/ui/i18n';
   import { formatMonth } from '@biddaloy/ui/utils';
   const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
   /** The server snapshots `period_label` as "<English month> <year>" (invoices.service.ts:102). */
   export function localizePeriod(label: string, config: RegionConfig): string {
     const match = /^([A-Za-z]+) (\d{4})$/.exec(label);
     const index = match ? MONTHS.indexOf(match[1]!) : -1;
     return index < 0 ? label : formatMonth(`${match![2]}-${String(index + 1).padStart(2, '0')}`, config);
   }
   export function toDisplayReceipt(receipt: InvoiceReceiptData, config: RegionConfig, methodLabel: (method: string) => string): InvoiceReceiptData {
     return {
       ...receipt,
       students: receipt.students.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, period_label: localizePeriod(l.period_label, config) })) })),
       payment: { ...receipt.payment, method: methodLabel(receipt.payment.method) },
     };
   }
   ```
3. **`i/$token.tsx`.**
   - `loader: () => loadRouteNamespaces('fees', 'payments', 'verify', 'common')`.
   - `const region = useRegionConfig();` `const { t } = useTranslation(['fees', 'payments', 'verify', 'common']);` drop `REGION_BD_EN`.
   - Render `<AuthLayout><h1 className="text-h1">{t('fees:invoiceDetail.publicReceipt.pageTitle')}</h1> … </AuthLayout>`; the body goes in `<div className="mt-4">`.
   - Loading: `<div role="status" aria-busy="true" aria-label={…loading} className="flex flex-col gap-3">` with the two `Skeleton`s.
   - Not found (404/410): `<GuestStatus headingLevel="h2" icon={FileQuestion} tone="warning" title={…notFoundTitle} explanation={…notFoundExplanation} />`.
   - Other error: `<GuestStatus headingLevel="h2" icon={TriangleAlert} tone="danger" title={…errorTitle} explanation={…errorExplanation}><Button variant="outline" className="w-full" onClick={() => void receiptQuery.refetch()}><RotateCcw aria-hidden />{t('fees:invoiceDetail.publicReceipt.errorRetry')}</Button></GuestStatus>`.
   - Loaded: `<InvoiceReceipt receipt={toDisplayReceipt(receiptQuery.data, region, (m) => t(\`payments:record.method.methods.${m}\`, { defaultValue: '—' }))} width="a4" config={region} labels={…unchanged} />` then `<Button className="mt-5 w-full print:hidden" onClick={() => window.print()}><Download aria-hidden />{…saveAsPdf}</Button>`.
   - Every state ends with `<Link to="/" className="mt-2 flex h-11 w-full items-center justify-center rounded-md px-3 font-medium text-primary hover:bg-muted print:hidden">{t('verify:home')}</Link>`.
   - Delete the inline `ReceiptIcon`. Keep the file-header comment about never importing auth state — `AuthLayout` reads no session (it only sets density, region defaults and the language switcher).
4. **`v/$token.tsx`.**
   - Wrap in `<AuthLayout>`; visible `<h1 className="text-h1">{t('pageTitle')}</h1>`; body in `<div className="mt-4">`.
   - `MessageCard` / local `ErrorState` → `GuestStatus` with `headingLevel="h2"`: 404 → `FileQuestion` / warning / `notFoundTitle` + `notFoundExplanation`; 429 → `Clock` / warning / `tooMany`; other → `TriangleAlert` / danger / `errorTitle` + `errorExplanation` + outline retry (`errorRetry`, `RotateCcw`).
   - `VerifiedDocument`: banner and `<dl>` classes from changes 9–10; `StatusIcon` SVG → lucide `CircleCheck` / `TriangleAlert` (`size-8 shrink-0`, `aria-hidden`); `formatDate(data.issued_at, region)` (drop the `new Date()` wrapper — the formatter takes ISO strings); copy `formatNumber(data.copy_number, region)`; kind `t(\`kind.${data.document_kind}\`, { defaultValue: t('rows.type') })`; footer `mt-4 text-center text-caption text-text-secondary`.
   - Every state ends with the same home `Link` as step 3 (`t('home')`).
5. If the shared request on `AuthLayout` print styles (see Out of scope) has landed, nothing else is needed for printing; otherwise leave it — do not add print CSS to the route.
6. `rtk vitest client-admin/src/routes/i client-admin/src/routes/v`, i18n key check, `rtk tsc`.

## Tests
- `i/-receipt-display.test.ts` (new): `localizePeriod('January 2026', bnConfig)` → `'জানুয়ারি ২০২৬'`; en config → `'January 2026'`; `''` and `'Term 1'` returned unchanged; `toDisplayReceipt` replaces `payment.method` via the passed function and leaves totals untouched.
- `i/$token.test.tsx`: loaded receipt shows a heading named by `pageTitle`, the method label (`'Cash'` in en) instead of `'CASH'`, a `'Go to SchoolManager home'` link to `/`; the existing not-found / retry cases keep passing (retry is now a `button` named `'Try again'`).
- `v/$token.test.tsx`: valid case also finds heading `'Verify document'` and the home link; existing assertions (`'2'` in en, school name, footer) stay valid.
- e2e: `e2e/journeys/invoice-sharing.spec.ts` (reads `publicReceipt.billed` / `notFoundExplanation` via `t()`) and `e2e/journeys/print-id-cards.spec.ts` (`verify.revoked`) — run once; no edit expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] At most one filled primary per view (receipt: "পিডিএফ হিসেবে সংরক্ষণ করুন"; `/v`: none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Both pages show the logo, language switcher, one card and a visible title.
- [ ] Receipt in Bangla shows "নগদ টাকা", "জানুয়ারি ২০২৬", Bangla digits in amounts and dates; invoice number stays Latin.
- [ ] `/v` copy number follows the visitor's numerals; unknown kinds read "নথি".
- [ ] Every state of both pages has the "SchoolManager হোম পাতায় যান" link; no dashed card anywhere.

## Out of scope
- `InvoiceReceipt` (`ui/src/components/print/invoice-receipt.tsx`) keeps its own `text-sm` / `text-muted-foreground` classes — shared component, not this lane's.
- The server's English `period_label` snapshot (better: store year + month) — server change, not D1 scope; the route maps it instead.
- Shared request filed: `AuthLayout` print styles so the saved PDF holds only the receipt.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| AuthLayout print: hide language row + logo, drop card frame | Accepted | 31.2.12 | nothing to pass; print:hidden / print:border-0 are built into AuthLayout |

Wave: 9   Lane: guest   Decisions: D5, D6, D9, D15, D27, D28, D29, D34   Depends on: 31.3.8b, 31.4.guest-2 (uses `-guest-status.tsx`)
