# [31.4.reports-2] Print & documents — one status, icon actions, print button

## Goal
`/reports/printables` lists every printed card with one status badge per row, icon row actions, kit filters with labels, the total and a 25-row page, plus a "আইডি কার্ড প্রিন্ট করুন" primary; roles without `USER_READ` / `DOCUMENT_PRINT` no longer get a red "no permission" toast on open.

## What and why
Office staff use this page to find a card that was printed, see it, print it again or cancel (revoke) a lost one. Today two separate pill columns (ফলাফল, অবস্থা) say overlapping things, row actions are three text links, the copy number shows as `#2` in Latin digits, the page size is 10, there is no way to start printing from here (the empty text even says "go to a student's page"), and the filter bar fetches `/users` and `/print-templates` for every role — EXECUTIVE, OFFICE_STAFF and EXAM_CONTROLLER lack the permissions and get a 403 toast. The redesign merges the two statuses into one `StatusBadge`, uses `RowActions`, gates the two option fetches, and adds the print entry point.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/reports/reports_printables/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/reports/reports_printables/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/reports/reports_printables/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/reports/reports_printables/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `ListShell` title (already "প্রিন্ট ও কাগজপত্র" via 31.3.4b) + **New** subtitle = `caption` ("এ পর্যন্ত যা ছাপা হয়েছে, নতুনগুলো আগে।") + **New** primary "আইডি কার্ড প্রিন্ট করুন" (`id-card`) → `/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&from=/reports/printables`, only with `DOCUMENT_PRINT`. | D16; the page had no way forward |
| 2 | Columns | Order: ছাপার সময়, ব্যক্তি (`font-medium`), নথি (template name + caption "সংস্করণ n"), যিনি ছেপেছেন, কপি (number, right-aligned, `formatNumber`), অবস্থা, কাজ. | Who before what; D6 |
| 3 | Status | One `StatusBadge` from both fields: revoked → `neutral` "বাতিল করা"; FAILED → `danger` "ছাপা হয়নি"; PENDING → `warning` "অপেক্ষায়"; OK → `success` "ছাপা হয়েছে". The separate ফলাফল column and the local `Pill` go away. | D27; one answer to "is this card good?" |
| 4 | Row actions | `RowActions`: view (`দেখুন`), print (`আবার ছাপুন`, only `DOCUMENT_PRINT` and not revoked), reject (`circle-x`, `বাতিল করুন`, only `DOCUMENT_REVOKE` and not revoked). | D19 |
| 5 | Filters | Same 7 fields, labelled, kit layout: search (4 cols), নথির ধরন, নকশা, যিনি ছেপেছেন, ফলাফল (2 cols each), তারিখ range (4), অবস্থা (2). নকশা options fetched only with `DOCUMENT_PRINT`, যিনি ছেপেছেন only with `USER_READ`; the field is hidden when its options cannot be fetched. | D24; 403 toast for 3 roles |
| 6 | Paging | Default page size 25 (drop `?? 10` in two places). | D19, B23 |
| 7 | Revoke / reprint dialogs | `DialogContent size="sm"`, footer Cancel then confirm (revoke confirm stays the danger button — it is a confirm dialog). | D21, D29 |
| 8 | Subject history | `SubjectPrintHistory` (student/staff documents tab) uses the same `StatusBadge` mapping instead of `Pill`. | `Pill` is deleted |

## Mobile behaviour
- Primary full width under the title.
- Search + "ফিল্টার (n)" button; chips under them (kit FilterBar).
- Rows become cards: person name + badge, date-time as subtitle, `dl` with নথি (full width), যিনি ছেপেছেন, কপি; actions with visible labels.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Two status columns | keep both / merge | merge | A revoked card's print outcome no longer matters; one badge reads faster. Filters keep both fields (they answer different questions). |
| Revoke intent | `delete` / `reject` / `archive` | `reject` (`circle-x`, red) | The record stays, the card stops being valid. |
| Option fetch for restricted roles | ask for server permission change / hide the field | hide the field | No API change (D1); the filter is a convenience. |
| Primary action | none / print ID cards | print ID cards | This is the print hub in the sidebar; starting a print here is the next step. |
| Revoke label | "কার্ড বাতিল করুন" / keep "বাতিল করুন" | keep | Keeps the e2e selector and fits the phone card action. |

## Files
- `client-admin/src/routes/_staff/reports/printables.tsx` — passes `onPrintIdCards`
- `client-admin/src/components/print/history/print-history-page.tsx` — header action, columns, badge, RowActions, gated fetches
- `client-admin/src/components/print/history/print-history-page.test.tsx`
- `client-admin/src/components/print/history/print-history-page.stories.tsx`
- `client-admin/src/components/print/history/print-history-filters.ts` — default limit 25
- `client-admin/src/components/print/history/print-history-filters.test.ts`
- `client-admin/src/components/print/history/subject-print-history.tsx` — `StatusBadge`
- `client-admin/src/components/print/history/subject-print-history.test.tsx`
- `client-admin/src/components/print/history/reprint-dialog.tsx` — `size="sm"`
- `client-admin/src/components/print/history/revoke-dialog.tsx` — `size="sm"`
- `ui/src/i18n/locales/{en,bn}/printHistory.json`
- `e2e/journeys/print-id-cards.spec.ts` — copy-cell selector (lines ~150–165 only)
- `e2e/keyboard/print-history.spec.ts` — row-scoped view button

## Steps
1. **Locale `printHistory.json`.** Change `outcome.FAILED` "Failed" → "Not printed" / "ব্যর্থ" → "ছাপা হয়নি"; `status.REVOKED` "Revoked" → "Revoked" / "বাতিল" → "বাতিল করা"; `filters.template` / `filters.allTemplates` → "Design" / "নকশা", "All designs" / "সব নকশা"; `filters.searchPlaceholder` → "Search by person's name" / "ব্যক্তির নাম দিয়ে খুঁজুন"; `caption` bn add the full stop. Add `printIdCards` "Print ID cards" / "আইডি কার্ড প্রিন্ট করুন"; `versionValue` "Version {{version}}" / "সংস্করণ {{version}}" (version via `formatNumber`). Delete `copyValue`, `documentValue`, `columns.result`.
2. **`print-history-page.tsx`.**
   - Props: add `onPrintIdCards?: () => void`. Pass `ListShell` `subtitle={t('caption')}` and `actions={canPrint && onPrintIdCards ? [{ id: 'print-id-cards', label: t('printIdCards'), icon: <IdCard />, priority: 'primary', onClick: onPrintIdCards }] : []}` (not the deprecated `primaryAction`).
   - Fetches: `const canReadUsers = useHasPermission(Permission.USER_READ)`; `useQuery({ ...usersQueryOptions({ limit: 100 }), enabled: canReadUsers })` and `useQuery({ ...printTemplatesQueryOptions(), enabled: canPrint })` (both exported from `@biddaloy/ui/hooks`, same pattern as `print-id-card-modal.tsx:73-79`). Build the `template_id` field only when `canPrint`, the `printed_by` field only when `canReadUsers`.
   - Delete `Pill`. Add `function rowStatus(row): { tone, label }` per Change 3 and render `<StatusBadge tone={…} label={…} />` in the `status` column (`card: 'badge'`). Remove the `result` column.
   - `document` column: `accessorFn` renders `<>{row.template_name}<span className="block text-caption text-text-secondary">{t('versionValue', { version: formatNumber(row.template_version, region) })}</span></>`. `copy` column: `formatNumber(row.copy_number, region)`, `align: 'end'`. Move `person` before `document`.
   - Actions: drop the `actions` column; pass `rowActions={(row) => [{ intent: 'view', label: t('actions.view'), onClick: () => setViewId(row.item_id) }, { intent: 'print', label: t('actions.reprint'), onClick: () => setReprintRow(row), allowed: canPrint && !row.revoked_at }, { intent: 'reject', label: t('actions.revoke'), onClick: () => setRevokeRow(row), allowed: canRevoke && !row.revoked_at }]}`.
   - `pageSize={search.limit ?? 25}`; drop `emptyMessage` for `emptyState={{ title: t('empty'), icon: <Printer/> }}` (action = the same print button when allowed, as an outline per EmptyState).
3. **`print-history-filters.ts`.** `limit: search.limit ?? 25`.
4. **`printables.tsx`.** `onPrintIdCards={() => void navigate({ to: '/print/preview', search: { kind: DocumentKind.STUDENT_ID_CARD, subject_type: PrintSubjectType.STUDENT, from: '/reports/printables' } })}`.
5. **`subject-print-history.tsx`.** Replace `Pill` with `StatusBadge` using the same `rowStatus` (export it from `print-history-page.tsx`).
6. **Dialogs.** `reprint-dialog.tsx` and `revoke-dialog.tsx`: `<DialogContent size="sm">`; nothing else.
7. Run `yarn test:frontend run components/print/history reports/printables`, then `graphify update .`.

## Tests
- `print-history-page.test.tsx`: one status badge per row with the mapped label (revoked row → "Revoked", failed → "Not printed"); no "Result" column header; revoked row shows only the view action; copy cell shows `2` (en) and `২` under `locale: 'bn'`; with role `EXECUTIVE` no request to `/users` or `/print-templates` is made and those two filters are absent; with `DOCUMENT_PRINT` the "Print ID cards" button calls `onPrintIdCards`; default request has `limit=25`.
- `print-history-filters.test.ts`: `toHistoryFilters({})` → `limit: 25`.
- `subject-print-history.test.tsx`: badge text for a valid and a revoked row.
- `e2e/journeys/print-id-cards.spec.ts`: the copy-2 row filter becomes `page.getByRole('cell', { name: '২', exact: true })` (bn tenant numerals; use `e2e/i18n.ts`'s number helper if one exists by then); the revoke button and `status.REVOKED` lookups keep working through `t()`.
- `e2e/keyboard/print-history.spec.ts`: find the view button inside the row (`page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: t('printHistory.actions.view') })`).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (none for roles without `DOCUMENT_PRINT`).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Opening the page as OFFICE_STAFF or EXECUTIVE shows no red toast.
- [ ] One status badge per row; row actions are icons with tooltips; the table shows "১–n দেখানো হচ্ছে, মোট N".

## Out of scope
- Template names are whatever the school typed (seeded "Student ID card" is English) — data, not UI.
- `HistoryItemDialog` layout is unchanged (default `md` from the foundation is fine).

Wave: 9   Lane: reports   Decisions: D6, D9, D15, D16, D19, D21, D24, D27, D29   Depends on: 31.3.8b, 31.4.reports-1
