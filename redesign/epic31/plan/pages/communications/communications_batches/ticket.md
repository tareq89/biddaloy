# [31.4.communications-3] Reminder history and round detail — readable template, translated failures

## Goal
`/communications/batches` and `/communications/batches/$batchId` match the "after" screenshots: a standard list with one primary, an eye action and a total; a detail page with crumbs, facts in tenant numerals, the template shown with Bangla placeholder labels and every delivery failure as a translated sentence.

## What and why
Reminder history lists every round of bulk reminders and lets the user open one to see who got it, who did not and why, and resend the failures. Today the list carries a double gutter, an outline-only header action and a 20-row page; the detail page has a "সব ব্যাচ" back link, raw digits in its facts, the raw template `Dear {{guardian_name}}…`, and the worker's English error "SMS (Greenweb) is not configured for this tenant… GREENWEB_API_KEY" in the table (D9). The redesign puts both pages in the kit's list and detail patterns and translates the template and the failure reasons.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_batches/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_batches/before-mobile.webp?raw=true" width="260"> |
| Before — detail | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_batches_batchId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_batches_batchId/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_batches/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_batches/mobile.webp?raw=true" width="260"> |
| After — detail | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_batches_batchId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_batches_batchId/mobile.webp?raw=true" width="260"> |

The UUID last crumb (B16) and the red "no permission" toast (B8) in the "before" shots are fixed by 31.3.5 and 31.3.6.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | List frame | Drop the `div.p-4` around `ListShell`; subtitle "একসাথে পাঠানো প্রতিটি রিমাইন্ডারের দফা, নতুনটা আগে।"; header action becomes the filled primary "একসাথে অনেককে রিমাইন্ডার" (`send` icon). | D15 (double gutter), D16, D29 |
| 2 | List page size | Remove `useListShellState({ limit: 20 })` and the loader's `?? 10` → the kit default 25. | D19, B23 |
| 3 | List columns | Name is plain `font-medium` text; new last column "কাজ" with `RowActions` view (eye → detail). "সফল" header renamed "পৌঁছেছে". | D19 — no text links in a table |
| 4 | List empty | `emptyState` with `send` icon, title, sentence, outline action "একসাথে অনেককে রিমাইন্ডার". | D28 |
| 5 | Detail frame | `DetailShell` (no tabs): crumbs from the layout, name `h1` + `StatusBadge`, facts তৈরি / প্রাপক / পৌঁছেছে / ব্যর্থ (`formatDate`, `formatNumber`), primary "ব্যর্থগুলো আবার পাঠান" (`rotate-ccw`) only when retry is possible. "সব ব্যাচ" link removed. | D16, D6, kit DetailHeader |
| 6 | Template card | **New** `TemplatePreview`: "যে বার্তা পাঠানো হয়েছে"; each supported `{{token}}` is a `bg-secondary` chip with its Bangla label; help line under it. | D9 — raw `{{guardian_name}}` |
| 7 | Delivery table | Heading "কার কাছে পৌঁছেছে"; columns প্রাপক, মাধ্যম, মোবাইল বা ইমেইল (`formatPhone` for phones), অবস্থা, "কেন পৌঁছায়নি" (translated via **New** `deliveryErrorKey`); 25 per page. Phone: cards, the reason as red text with `circle-alert`. | D9, D8, D19 |
| 8 | Skipped card | Card "পাঠানোর আগে বাদ পড়া (n)"; rows reason ↔ "n জন শিক্ষার্থী" (tenant digits); empty → one muted line inside the card. | D17, D6 |
| 9 | Load error / loading | `ErrorState` with Retry instead of a red `p`; loading uses the route's detail skeleton instead of "…". | D28 |
| 10 | Retry dialog | `DialogContent size="md"`; unchanged flow and texts. | D21 |

## Mobile behaviour
- List: search + "ফিল্টার" button (FilterBar phone mode); rows are cards (title, badge, date, প্রাপক/পৌঁছেছে/ব্যর্থ in 3 columns, "দেখুন" action with label).
- Detail: last two crumbs, title wraps, badge under it, facts in 2 columns, primary full width; log rows are cards without an action row.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Failure reason | show server text / map in the client / wait for a server code | map known texts in the client now (`-shared/delivery-error.ts`), unknown → "পাঠানো যায়নি।"; shared request filed for a server `error_code` | D9 today; the map shrinks to a code lookup once the server sends codes |
| Template display | translate the whole template / chips for tokens only | chips for tokens; the staff-written text stays as written | The text is the school's own content |
| List header action | outline / filled | filled primary | It is the page's only action and the main next step |
| Logs page size | 50 / 25 | 25 | D19 default |

## Files
- `client-admin/src/routes/_staff/communications/batches/index.tsx` — frame, page size, columns, RowActions, empty state
- `client-admin/src/routes/_staff/communications/batches/index.test.tsx` — updated
- `client-admin/src/routes/_staff/communications/batches/$batchId.tsx` — DetailShell, facts, template, table, skipped card, states, dialog size
- `client-admin/src/routes/_staff/communications/batches/$batchId.test.tsx` — updated
- `client-admin/src/routes/_staff/communications/-shared/delivery-error.ts` — **New**
- `client-admin/src/routes/_staff/communications/-shared/delivery-error.test.ts` — **New**
- `client-admin/src/routes/_staff/communications/-shared/template-preview.tsx` — **New** (uses `PLACEHOLDER_NAMES` / `usePlaceholderLabels` from `template-placeholders.ts`, added by communications-2a, runs earlier)
- `ui/src/i18n/locales/en/communications.json`, `ui/src/i18n/locales/bn/communications.json` (also changed by communications-1, -2a, -2b, run earlier)

## Steps
1. **List frame** (`index.tsx`). Return `<ListShell … />` directly (no `div.p-4`). `subtitle={t('batches.subtitle')}`. `primaryAction` → `<Button asChild><Link to="/communications/reminders" search={{ mode: 'bulk' }}><Send aria-hidden />{t('bulk.entryAction')}</Link></Button>` (default = filled). If 31.2.5a's `ListShell` takes `actions: PageAction[]` instead, pass one action with `priority: 'primary'`.
2. **Page size.** `useListShellState()` with no `limit`; loader `limit: search.limit ?? 25`.
3. **Columns.** `name` → `accessorFn: (row) => row.batch_name`, `card: 'title'`, keep `pinned`/`sortable`; `successful` header `t('batches.successfulHeader')` (text changes, key stays); add `rowActions={(row) => [{ intent: 'view', label: t('batches.viewAction'), to: `/communications/batches/${row.id}` }]}` (or the `RowActions` column per 31.2.4a's API). Count columns keep `formatNumber` + `align: 'end'`.
4. **Empty.** Replace `emptyMessage` with `emptyState={{ icon: <Send />, title: t('batches.empty'), explanation: t('batches.emptyHelp'), action: { label: t('bulk.entryAction'), to: '/communications/reminders?mode=bulk' } }}` (shape per kit EmptyState; the action renders outline). Error stays `t('batches.error')` (ListShell shows ErrorState).
5. **`delivery-error.ts` (New).**
   ```ts
   /** Worker error text → communications i18n key. ponytail: string matching on English server text;
    *  switch to an `error_code` lookup when the server sends one (shared request). */
   export function deliveryErrorKey(error: string | null): string | null {
     if (error === null || error === '') return null;
     if (/is not configured for this tenant/i.test(error)) return 'deliveryErrors.notConfigured';
     if (/^No provider registered/i.test(error)) return 'deliveryErrors.noProvider';
     return 'deliveryErrors.generic';
   }
   ```
   The texts come from `server/src/modules/communications/config/provider-not-configured.error.ts:13` and `worker/communications.processor.ts:351`. The UI passes `{ medium: t(`mediums.${row.medium}`) }` to the key.
6. **`template-preview.tsx` (New).** `TemplatePreview({ template }: { template: string })`: split on `/(\{\{[^{}]*\}\})/`; a part whose trimmed inner name is in `PLACEHOLDER_NAMES` renders `<span className="rounded-sm bg-secondary px-1.5 py-0.5 text-label text-secondary-foreground">{labels[name]}</span>`; any other part renders as text. Wrapper `p.mt-3 whitespace-pre-wrap leading-loose`, then `p.mt-2 text-caption text-text-secondary` `t('batches.detail.templateHelp')`.
7. **Detail frame** (`$batchId.tsx`). Delete the back `Link` and the hand-made header/`dl`. Render `<DetailShell name={batch.batch_name} statusBadge={<StatusBadge domain="reminderBatch" status={batch.status} />} facts={[{ label: t('batches.detail.createdLabel'), value: formatDate(new Date(batch.created_at), config) }, { label: t('batches.detail.totalLabel'), value: formatNumber(batch.total_recipients, config) }, { label: t('batches.detail.successLabel'), value: formatNumber(batch.successful_count, config) }, { label: t('batches.detail.failedLabel'), value: formatNumber(batch.failed_count, config) }]} actions={canRetry && batch.message_template !== null ? [{ id: 'retry', label: t('batches.detail.retryAction'), icon: <RotateCcw />, priority: 'primary', onClick: () => setRetryOpen(true) }] : []}>` and put the sections below as children (`space-y-6`). Remove `mx-auto … max-w-5xl p-4`.
8. **Template card.** `Card padded` with `h2.text-h2` `t('batches.detail.templateLabel')` + `<TemplatePreview template={batch.message_template} />` when the template exists; `retryNoTemplate` stays as a `text-text-secondary` line when retry is possible but no template.
9. **Delivery table.** `section.space-y-3` with `h2.text-h2` `t('batches.detail.logsTitle')`. `LOGS_PAGE_SIZE = 25`. Columns: recipient (`card: 'title'`, `font-medium`), channel, address `row.medium === 'EMAIL' ? row.recipient_address : formatPhone(row.recipient_address, config)` (`card: 'subtitle'` joined with channel if the DataTable card API allows; otherwise its own field), status (`card: 'badge'`), error → `const key = deliveryErrorKey(row.error); key ? t(key, { medium: t(`mediums.${row.medium}`) }) : '—'` rendered `text-text-secondary`, and on phone as `flex items-start gap-1.5 text-status-overdue-fg` with `CircleAlert size-4`. Keep the polling/`isFetching` logic untouched. Swap `emptyMessage` for `emptyState={{ title: t('batches.detail.logsEmpty') }}`.
10. **Skipped card.** `Card padded`, `h2.text-h2` `skippedTitle` (count via `formatNumber`); `ul.mt-2 divide-y divide-border-subtle`, rows `flex flex-col gap-0.5 py-3 md:flex-row md:justify-between md:gap-4`: `t(skipReasonKey(reason))` (no raw fallback — 2a made the key total) and `p.text-text-secondary` `skippedStudents`. Empty → `p.mt-1.text-text-secondary` `noneSkipped`.
11. **States.** `batchQuery.isError` → `<ErrorState message={t('batches.detail.loadError')} onRetry={() => void batchQuery.refetch()} />`. `batch === undefined` → `<RoutePending variant="detail" … />` (same as `BatchDetailPending`).
12. **Retry dialog.** `<DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>`; the warning `p` uses `text-text-secondary`; error `p` kit error-text classes. Logic unchanged.
13. **Locale keys** (en + bn). The 31.3.4b glossary has already replaced "batch/ব্যাচ" with "round/দফা" in `batches.*` — keep those; add/change only:

| Key | en | bn |
|---|---|---|
| `batches.subtitle` (new) | Every round of reminders sent together, newest first. | একসাথে পাঠানো প্রতিটি রিমাইন্ডারের দফা, নতুনটা আগে। |
| `batches.successfulHeader` (changed) | Delivered | পৌঁছেছে |
| `batches.viewAction` (new) | View | দেখুন |
| `batches.emptyHelp` (new) | Rounds appear here after you send reminders to many students at once. | একসাথে অনেককে রিমাইন্ডার পাঠালে দফাগুলো এখানে দেখা যাবে। |
| `batches.detail.successLabel` (changed) | Delivered | পৌঁছেছে |
| `batches.detail.templateLabel` (changed) | Message that was sent | যে বার্তা পাঠানো হয়েছে |
| `batches.detail.templateHelp` (new) | The highlighted parts were replaced with each guardian's real name and amount. | রঙিন অংশগুলো প্রত্যেক অভিভাবকের জন্য আসল নাম ও টাকায় বদলে পাঠানো হয়েছে। |
| `batches.detail.logsTitle` (changed) | Who received it | কার কাছে পৌঁছেছে |
| `batches.detail.addressHeader` (changed) | Mobile or email | মোবাইল বা ইমেইল |
| `batches.detail.errorHeader` (changed) | Why it failed | কেন পৌঁছায়নি |
| `deliveryErrors.notConfigured` (new) | Sending by {{medium}} is not set up for this school. Turn it on in Settings › Communication. | এই স্কুলে {{medium}} পাঠানোর ব্যবস্থা চালু নেই। সেটিংস › যোগাযোগ থেকে চালু করুন। |
| `deliveryErrors.noProvider` (new) | {{medium}} cannot be sent automatically. | {{medium}} স্বয়ংক্রিয়ভাবে পাঠানো যায় না। |
| `deliveryErrors.generic` (new) | Could not be sent. | পাঠানো যায়নি। |

`batches.detail.backToList` becomes unused — delete it in en + bn.

## Tests
- `delivery-error.test.ts`: the `provider-not-configured` sentence → `deliveryErrors.notConfigured`; `No provider registered for medium "SMS"` → `deliveryErrors.noProvider`; any other text → `generic`; `null`/`''` → `null`.
- `batches/index.test.tsx`: heading "Reminder history" once; the primary link "Remind many at once" points to `/communications/reminders?mode=bulk`; each row has a "View" action linking to the detail; the request asks for 25 rows; empty response shows the empty state with its outline action and no pager.
- `batches/$batchId.test.tsx`: no "All rounds" link; facts render via `formatNumber` (bn digits under a bn config); a template `Dear {{guardian_name}}` renders "Guardian name" as a chip and never the text `{{guardian_name}}`; a FAILED log with the Greenweb sentence shows "Sending by SMS is not set up for this school…" and never "GREENWEB_API_KEY"; phone addresses read `01711-000004`; load error shows a Retry button; existing polling and retry tests stay green.
- E2E: none reference these pages.

## Acceptance
- [ ] Desktop at 1440 px matches both "after" screenshots.
- [ ] Mobile at 390 px matches both "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route files (D15).
- [ ] List: no double gutter; 25 rows per page; eye action per row; total shown.
- [ ] Detail: no "সব ব্যাচ" link; facts in tenant digits; no `{{…}}` and no English worker text anywhere.
- [ ] Failed rows show the translated reason; phones as `01711-000004`.

## Out of scope
- Shared request filed: server `error_code` on failed communication logs (see `shared-requests.md`).
- UUID crumb on the detail page (B16) — 31.3.5; "no permission" toast (B8) — 31.3.6.
- Filtering the delivery table to failures only — would be a new feature (D1).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server error_code on reminder logs | Deferred | — | use the fallback in the ticket (map the two known messages client-side, else "পাঠানো যায়নি।") |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: communications   Decisions: D5, D6, D8, D9, D15, D16, D19, D21, D27, D28, D29   Depends on: 31.3.8b, 31.4.communications-2b
