# [31.4.reports-1] Fee collection report — fix the crash, net first

## Goal
`/reports/collections` loads with real payments in the range (no crash, filters no longer 400), shows net collection as the headline, and lays the four breakdowns out as small total-bearing tables that print as a cash-close sheet.

## What and why
An accountant opens this page at the end of the day or month to see how much money came in, by method, by collector, by fee type and by day, then prints it or downloads the CSV. Today the page crashes as soon as one payment exists (B6): the hook is typed by hand with field names the server never sends, so `formatCurrency(undefined)` throws; the method and collector filters send `method` / `collector_id`, which the server rejects with a 400. Even when it renders, eight equal tiles hide the one number that matters, methods and fee types show raw enum names (`CASH`, `MONTHLY_TUITION`), dates are ISO, and the three side-by-side tables have no totals. The redesign types the hook from the generated schema, sends the server's own parameter names, leads with the net figure, and turns the breakdowns into four plain tables.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/reports/reports_collections/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/reports/reports_collections/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/reports/reports_collections/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/reports/reports_collections/mobile.webp?raw=true" width="260"> |

(The "before" shot is the crash screen — that is the bug.)

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | `ui/src/hooks/reports.ts` | Every type is an alias of the generated schema (`components['schemas']['CollectionsReportDto']` …); the filter type is the operation's query type, so the params are `payment_method` / `received_by_user_id`. Delete the hand-typed interfaces and the "HAND-TYPED CONTRACT" comment. | B6 root cause: hand-typed shape ≠ server DTO, wrong param names |
| 2 | Amount formatting | Every amount uses `formatServerAmount` (server sends taka as decimals, e.g. a pro-rated standing discount of `1666.67`), never `formatCurrency` (which wants integer paisa and throws). | B6 second cause; `formatCurrency` throws on a fraction |
| 3 | Header | `PageHeader`: h1 = `title` (already "ফি আদায়ের প্রতিবেদন" via 31.3.4b); subtitle = `formatDateRange(from, to)` + " · " + method label + " · " + collector label (the "সব …" labels when unfiltered). Actions: outline "সিএসভি ডাউনলোড করুন" (`download`), primary **New** "প্রিন্ট করুন" (`printer`, `window.print()`). | D16, D5; the sheet is printed at cash close and the print CSS already exists |
| 4 | Filters | `FilterBar` with three selects (তারিখের পরিসর, পদ্ধতি, আদায়কারী); the date-range pickers appear only for "কাস্টম". URL keys become `payment_method` and `received_by_user_id` (one name end to end). Collector options skip rows whose `user_id` is null. | D24, B6 |
| 5 | Totals | Three Cards: মোট আদায় (+ "nটি পেমেন্ট"), বাতিল হওয়া (+ "মোট থেকে বাদ যায়"), নিট আদায় (`text-primary`, + "মোট আদায় থেকে বাতিল বাদে"). | One headline number instead of eight equal tiles |
| 6 | Secondary totals | One Card "ছাড় ও জমা টাকা" with a `dl` of the other five totals (স্থায়ী ছাড়, একবারের ছাড়, জমা টাকা ব্যবহার, জমা টাকা যোগ, ফেরত দেওয়া ভাংতি). | Still on the sheet, no longer competing |
| 7 | Breakdowns | Four `DataTable (unpaginated)` cards in a 2-column grid, each with an `h2`, a one-line help and "মোট nটি": by method (পদ্ধতি, পেমেন্ট, আদায়, বাতিল, নিট), by collector (same columns), by fee type (ফির ধরন, ছাড়, আদায়), by day (তারিখ, আদায়, বাতিল, নিট). Numbers right-aligned. | D19; the server returns count/collected/reversed/net per row and the page threw half of it away |
| 8 | Labels | Method = `filters.method.<M>`; fee type = `feeStructures:feeTypes.<T>`; collector null name = **New** `tables.unknownCollector`; day = `formatDate`. | D9, D5 |
| 9 | Chart | Remove the unlabeled SVG bar chart; the by-day table replaces it. | No axis, no dates, ISO tooltips; a table prints and reads better |
| 10 | States | Loading: each card renders its `DataTable loading` skeleton and the tiles show a `h-7 w-32` skeleton bar; error: `ErrorState` (message `errorMessage`, retry `refetch`) in place of tiles + tables. | D28 |

## Mobile behaviour
- Header: "প্রিন্ট করুন" full width + More (`ellipsis`) holding "সিএসভি ডাউনলোড করুন".
- Filters: one "ফিল্টার (n)" button opening the FilterBar sheet (kit behaviour).
- Totals: নিট আদায় first and full width, মোট আদায় and বাতিল হওয়া side by side below (`text-h2`).
- Tables: compact two-line rows — name + caption ("৩৮টি পেমেন্ট · বাতিল ৳২,০০০.০০"), net (or আদায় for fee type) on the right; other columns hidden.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Hook types | patch the hand-typed interfaces / alias the generated schema | alias `schema.d.ts` | The hand copy drifted once already; the generated types move with the server. Exported names stay the same so `ui/src/hooks/index.ts` needs no change. |
| URL filter keys | keep `method`/`collector_id` and map / use server names | server names | One name from URL to API; nothing to map, nothing to drift. Old links lose those two filters — acceptable, they never worked (400). |
| Primary action | CSV / print / none | print | Cash close is a printed sheet; CSV is the secondary export. |
| Daily chart | keep and fix labels / table | table | A bar chart with readable dates needs a chart lib or much SVG code; the table carries the same numbers and prints. |
| Tile count | 8 equal / 3 + secondary card | 3 + card | Net is what gets checked against the cash box. |

## Files
- `ui/src/hooks/reports.ts` — schema aliases, params (granted to this ticket)
- `ui/src/hooks/reports.test.ts` — **New** test file
- `client-admin/src/routes/_staff/reports/collections.tsx` — page
- `client-admin/src/routes/_staff/reports/collections.test.tsx` — fixed mock + new cases
- `ui/src/i18n/locales/{en,bn}/reports.json` — keys below

## Steps
1. **`ui/src/hooks/reports.ts`.**
   ```ts
   import type { components, operations } from '../api/schema';
   type S = components['schemas'];
   export type CollectionsReportResponse = S['CollectionsReportDto'];
   export type CollectionsReportTotals = S['CollectionsReportTotals'];
   export type CollectionsByMethod = S['CollectionsByMethod'];
   export type CollectionsByCollector = S['CollectionsByCollector'];
   export type CollectionsByFeeType = S['CollectionsByFeeType'];
   export type CollectionsByDay = S['CollectionsByDay'];
   export type CollectionsReportFilters =
     operations['ReportsController_getCollections_v1']['parameters']['query'];
   ```
   `toParams` drops `undefined` values and returns the rest as-is (`from`, `to`, `payment_method?`, `received_by_user_id?`). Keep `collectionsReportKeys`, the query options and `downloadCollectionsReportCsv` (the CSV route takes the same query). Rewrite the file header comment to one line: types come from `schema.d.ts`.
2. **Locale `reports.json`** (en / bn). Change: `totals.collected` "Total collected" / "মোট আদায়"; `totals.reversed` "Reversed" / "বাতিল হওয়া"; `totals.net` "Net collected" / "নিট আদায়"; `chart.title` → delete with `chart.empty` and `print.range` (unused). Add: `subtitleAllMethods` "All methods" / "সব পদ্ধতি", `subtitleAllCollectors` "All collectors" / "সব আদায়কারী"; `totals.paymentCount` "{{count}} payments" / "{{count}}টি পেমেন্ট"; `totals.reversedHelp` "Taken off the total" / "মোট থেকে বাদ যায়"; `totals.netHelp` "Total collected minus reversed" / "মোট আদায় থেকে বাতিল বাদে"; `totals.otherTitle` "Discounts and credit" / "ছাড় ও জমা টাকা"; `actions.print` "Print" / "প্রিন্ট করুন"; `actions.more` "More actions" / "আরও অ্যাকশন"; `tables.payments` "Payments" / "পেমেন্ট"; `tables.collected` "Collected" / "আদায়"; `tables.reversed` "Reversed" / "বাতিল"; `tables.net` "Net" / "নিট"; `tables.discount` "Discount" / "ছাড়"; `tables.date` "Date" / "তারিখ"; `tables.unknownCollector` "Unknown" / "অজানা"; `tables.byMethodTitle` "By payment method" / "পদ্ধতি অনুযায়ী আদায়", `tables.byMethodHelp` "How the money came in." / "কোন পথে কত টাকা এসেছে।"; `tables.byCollectorTitle` "By collector" / "আদায়কারী অনুযায়ী", `tables.byCollectorHelp` "Who took how much — to match the cash in hand." / "কে কত টাকা নিয়েছেন — দিনশেষে হাতের টাকা মেলাতে।"; `tables.byFeeTypeTitle` "By fee type" / "ফির ধরন অনুযায়ী", `tables.byFeeTypeHelp` "What the money was for, and the discount given." / "কোন ফি বাবদ কত টাকা এসেছে, আর কত ছাড় গেছে।"; `tables.byDayTitle` "By day" / "দিন অনুযায়ী", `tables.byDayHelp` "Each day's collection, oldest first." / "প্রতিদিনের আদায়, পুরোনো দিন আগে।"; `tables.rowCaption` "{{count}} payments · reversed {{amount}}" / "{{count}}টি পেমেন্ট · বাতিল {{amount}}". Where a bn value still says "সংগ্রহ" for money after 31.3.4b, change it to "আদায়" (`errorMessage`, `filters.collectorLabel` → "আদায়কারী", `filters.allCollectors` → "সব আদায়কারী", the three `*Caption` keys). In the mockup the mobile payment caption `count` is `formatNumber`-ed.
3. **`collections.tsx` — data.** `loadRouteNamespaces('reports', 'feeStructures', 'common')`. `CollectionsFilters` keys: `preset`, `from`, `to`, `payment_method`, `received_by_user_id`. Build the hook filter object with those keys (cast `payment_method` to the operation's enum type after checking it is one of `Object.values(PaymentMethod)`; otherwise omit it). The same object feeds `downloadCollectionsReportCsv`. Replace `formatCurrency` with `formatServerAmount` everywhere. Keep `resolvePresetRange` / `dhakaNow` as they are.
4. **Header.** `PageHeader title={t('title')} subtitle={…} actions={[{ id: 'csv', label: t('actions.downloadCsv'), icon: <Download/>, priority: 'secondary', onClick: handleDownloadCsv }, { id: 'print', label: t('actions.print'), icon: <Printer/>, priority: 'primary', onClick: () => window.print() }]}`. Subtitle = `formatDateRange(from, to, region)` then method label (`t('filters.method.<M>')` or `subtitleAllMethods`) then collector name (from `by_collector`, or `subtitleAllCollectors`), joined with " · ". Wrap the header actions and FilterBar in `print:hidden` (the subtitle prints).
5. **Filters.** `FilterBar` fields as today with the new keys; collector options = `by_collector.filter((c) => c.user_id !== null).map((c) => ({ value: c.user_id!, label: c.full_name ?? t('tables.unknownCollector') }))`.
6. **Totals.** `<div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6">` with three `Card padded` sections: label `h2 className="text-label text-text-secondary"`, value `p className="mt-1 text-h2 md:text-h1 tabular-nums"`, help `p className="mt-0.5 text-caption text-text-secondary"`. মোট আদায় help = `totals.paymentCount` with `count = by_method.reduce((n, r) => n + r.count, 0)` (formatNumber); বাতিল হওয়া help = `totals.reversedHelp`; নিট আদায় card gets `col-span-2 order-first md:col-span-1 md:order-last`, value `text-h1 text-primary`, help `totals.netHelp`.
7. **Other totals.** `Card padded`: `h2 className="text-h3"` `totals.otherTitle`, `dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5"`, items label `text-caption text-text-secondary`, value `font-medium tabular-nums`.
8. **Breakdowns.** `<div className="grid items-start gap-6 md:grid-cols-2 print:grid-cols-1">`, four sections. Each = `Card` with `overflow-hidden` (no padding): header `p-4 md:p-5` (`h2 text-h2` + help `mt-1 text-text-secondary`), then `DataTable paginated={false}` (`getRowId`: method → `payment_method`, collector → `user_id ?? 'unknown'`, fee type → `fee_type`, day → `date`). Columns per Change 7 with `align: 'end'` on numbers; first column carries the phone caption (`tables.rowCaption`; fee type: `tables.discount` + amount; day: `tables.collected` amount · `tables.reversed` amount) per `PATTERN: DataTable (unpaginated)`. `emptyState={{ title: t('tables.emptyMessage') }}`.
9. Delete the SVG chart and `maxByDay`. Error: when `reportQuery.isError`, render `ErrorState message={t('errorMessage')} onRetry={() => void reportQuery.refetch()}` instead of tiles and tables.
10. Remove the page's own `<div className="flex flex-col gap-6">` wrapper classes that duplicate `PageContainer` spacing; no `max-w-*`.
11. Run `yarn test:frontend run reports/collections hooks/reports` and `yarn workspace @biddaloy/ui check:i18n`, then `graphify update .`.

## Tests
- `ui/src/hooks/reports.test.ts` (**New**, clone the MSW harness of `ui/src/hooks/admission-reports.test.tsx`): `useCollectionsReport({ from, to, payment_method: 'CASH', received_by_user_id: 'u-1' })` sends exactly those four query params (no `method`, no `collector_id`); `downloadCollectionsReportCsv` sends the same params.
- `collections.test.tsx`: fix `reportResponse()` to the real DTO shape (`by_method: [{ payment_method: 'CASH', count: 12, collected: 3000, reversed: 0, net: 3000 }]`, `by_collector: [{ user_id: 'user-1', full_name: 'Karim Rahman', count: 12, collected: 3000, reversed: 0, net: 3000 }]`, `by_fee_type: [{ fee_type: 'MONTHLY_TUITION', collected: 4000, discount: 166.67 }]`, `by_day: [{ date: '2026-09-15', collected: 1000, reversed: 0, net: 1000 }]`, totals with a fractional `standing_discount: 1666.67`).
  - **New** "renders with a payment present": no error boundary text, `getByText('Cash')` (translated, not `CASH`), `getByText('Monthly tuition')`, `getByText('Karim Rahman')`, net total formatted, "15th September, 2026" in the by-day table, and "Total 1" under each table.
  - **New** "filter params": open `/reports/collections?payment_method=CASH&received_by_user_id=user-1` and assert the JSON request carries `payment_method=CASH` and `received_by_user_id=user-1`; update the CSV test to the same names.
  - Keep the error test (now `ErrorState` with a Retry button) and the `resolvePresetRange` suite; delete the chart-empty test.
- No e2e spec selects inside this page (`committee-role.spec.ts` only checks access) — none to update.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] With seeded payments (including a reversal and a pro-rated discount) the page renders — no "Something went wrong".
- [ ] Choosing a method or collector narrows the numbers (network tab: 200, `payment_method` / `received_by_user_id`).
- [ ] নিট আদায় is the first and largest number on phone, last tile on desktop.
- [ ] Every breakdown table ends with "মোট nটি".
- [ ] Printing (Ctrl+P) hides filters and buttons and keeps subtitle, tiles and tables.

## Out of scope
- Sidebar label and crumb ("সংগ্রহ প্রতিবেদন" → "ফি আদায়ের প্রতিবেদন") come from 31.3.4a, not this ticket.
- A real chart (axis, hover) — add when a chart component exists in `@biddaloy/ui`.
- Reversed-payment count is not in the DTO; the বাতিল হওয়া tile shows a help line instead of a count.

Wave: 9   Lane: reports   Decisions: D5, D6, D9, D15, D16, D19, D24, D28, D29, D32, D40   Depends on: 31.3.8b
