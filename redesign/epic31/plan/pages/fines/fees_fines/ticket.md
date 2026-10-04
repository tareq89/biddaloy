# [31.4.fines-1a] Fines + fine rules — kit header, labelled filters, icon actions

## Goal
`/fees/fines` and `/fees/fines/rules` each have one kit header whose title matches the crumb, labelled filters, the totals above the table, icon row actions and default page size 25; deleting a rule asks first. (Split: this is part a; the two full-page modals and the waive dialog are fines-1b, which runs after a.)

## What and why
`/fees/fines` is where the accountant sees every fine (logged by hand or made from attendance rules), filters it and waives one; `/fees/fines/rules` is where the rules that turn absences and late arrivals into fines are kept. Today a tab row sits above the page title, the six filters have no labels ("সব" alone means "all origins"), the month filter lists `01`–`12`, month-only fines show `2026-03`, row actions are underlined text links, the totals sit below the pager, and page size is 20. On the rules page the active state is plain text, actions are text links, and "মুছে ফেলুন" deletes a rule with no question. The redesign gives both pages the kit header (rules becomes a child page reached from a header button, matching its crumbs), labelled `FilterBar`, a totals Card above the table, `StatusBadge`s, `RowActions`, and a `ConfirmDialog` for delete.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — fines | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines/before-mobile.webp?raw=true" width="260"> |
| After — fines | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines/mobile.webp?raw=true" width="260"> |
| Before — fine rules | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines_rules/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines_rules/before-mobile.webp?raw=true" width="260"> |
| After — fine rules | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines_rules/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines_rules/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Both — tabs | `FinesTabs` (a tab row between a page and its child page, above the title) is deleted. Fines header gets an outline "জরিমানার নিয়ম" action; the rules page is reached by it and returns by its crumb "জরিমানা". | D16 (title = last crumb; crumbs already say জরিমানা › জরিমানার নিয়ম), D20 tabs are for panels of one page |
| 2 | Fines — header | `PageContainer` + `PageHeader` title "জরিমানা", **New** subtitle "হাতে লেখা আর নিয়ম থেকে তৈরি সব জরিমানা", actions: outline "জরিমানার নিয়ম" (`list-checks`), outline "জরিমানা যোগ করুন" (`plus`), primary "নিয়ম থেকে জরিমানা তৈরি" (`file-plus-2`). Phone: primary + More. | D16, D29; "যোগ করুন" vs "তৈরি করুন" was indistinguishable |
| 3 | Fines — filters | `FilterBar` with visible labels: মাস, শ্রেণি, শাখা, **New** label "জরিমানার ধরন", উৎস ("সব উৎস", was "সব"), অবস্থা. Month options read "জানুয়ারি … ডিসেম্বর" (`formatMonthName`) instead of `01`–`12`. Phone: "ফিল্টার (n)" sheet + chips. | D24, D9, D6 |
| 4 | Fines — totals | Totals `dl` under the pager → a Card between filters and table, `grid-cols-2 md:grid-cols-4`, values `text-h3`, "বাকি আছে" in `text-status-overdue-fg`; **New** sr-only heading "এই তালিকার হিসাব". "মাফ করা হয়েছে" → "মওকুফ হয়েছে". | Sits next to what it sums; D32 one word (status badge already says "মওকুফ") |
| 5 | Fines — table | Composed page (no `ListShell`, see Decisions): `DataTable` with `rowActions`: view "শিক্ষার্থী দেখুন" (`to` student) and **New** look for waive "মওকুফ করুন" (intent `edit`, icon `badge-minus`, `allowed` = can waive and status not WAIVED/PAID). Student name is plain `font-medium` text (the link duplicated the view action). Column "ঘটনার তারিখ" → "তারিখ"; month-only rows show "মার্চ ২০২৬" (`formatMonth`) instead of `2026-03`. | D19, D5, D9 |
| 6 | Fines — page size | `useListShellState({ limit: 20 })` → default (25, options 25/50/100). | D19, B23 |
| 7 | Fines — empty / error | Empty table → `DataTable emptyState` (icon `gavel`, outline action "জরিমানা যোগ করুন" when allowed); filtered-empty → **New** "এই ফিল্টারে কোনো জরিমানা নেই"; error → `ErrorState` with a real sentence (today the error shows the empty title). Header stays visible in every state. | D28 |
| 8 | Rules — header | `PageHeader` title "জরিমানার নিয়ম" + **New** subtitle "অনুপস্থিতি বা দেরিতে আসার জন্য কত জরিমানা হবে"; outline "গত বছর থেকে কপি করুন" (`copy`), primary "নিয়ম যোগ করুন" (`plus`). | D16 |
| 9 | Rules — year | Academic-year `Select` gets a real `<label>` (was a `span` + aria-label), sits in a filter row `md:col-span-3`. | D24, D25 |
| 10 | Rules — table | `DataTable paginated={false}` footer "মোট ৩টি"; status column → `StatusBadge` success "সক্রিয়" / neutral "নিষ্ক্রিয়"; numbers via `formatNumber`; min-late "১০ মিনিট" (**New** key). | D19, D27, D6 |
| 11 | Rules — actions | Three text links → `RowActions`: edit (`pencil`), **New** look for activate / deactivate (intent `restore` + `circle-play` / intent `archive` + `circle-pause`), delete (`trash-2`). | D19 |
| 12 | Rules — delete | **New** `ConfirmDialog tone="danger"` before `deleteRule.mutate` (existing `deleteRuleDialog.*` keys). | D29 — destructive action without a question |
| 13 | Rules — dialogs | Rule form `size="md"` (drops `max-h-[85vh]`), labels become real `<label>`s, server error never shown raw; copy dialog `size="sm"`. | D21, D9, D25 |

## Mobile behaviour
- Fines: title, subtitle, then primary "নিয়ম থেকে জরিমানা তৈরি" (`flex-1`) + More (holds "জরিমানার নিয়ম" and "জরিমানা যোগ করুন").
- Filters collapse to one "ফিল্টার (n)" button opening the FilterSheet; active filters stay as chips.
- Totals Card is 2 × 2; rows become cards: student name + status badge, fine type, then কারণ (full width), তারিখ, উৎস, পরিমাণ, পরিশোধিত; action row with visible labels.
- Rules: primary "নিয়ম যোগ করুন" + More ("গত বছর থেকে কপি করুন"); year select full width; rule cards with edit / toggle labels and an icon-only delete.
- Bottom bar: "আরও" marked (fines is not a cell).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Fines ⇄ rules navigation | keep tabs / header button + crumbs | header button + crumbs | The rules route is a child (`জরিমানা › জরিমানার নিয়ম`), so its h1 differs from a sibling tab's; tabs above an h1 also broke D16's order. |
| Rules link key | new key / reuse `tabs.rules` | reuse `tabs.rules` | Same text; `e2e/keyboard/fines.spec.ts` finds the control by it. `tabs.fines` is deleted. |
| Rules link element | `<a>` / PageAction button | PageAction with `onClick: navigate` | `PageAction` has no `to` (shared request filed); spec tag updated to `button`. |
| ListShell vs composed | `ListShell` / compose `PageHeader` + `FilterBar` + Card + `DataTable` | compose | The totals Card must sit between filters and table; `ListShell` has no slot there, and the header must stay on the empty state. |
| Waive look | `remove` (as students-5b) / `edit` + `badge-minus` | `edit` + `badge-minus` | Here the row stays in the list with a new status; "remove" reads as "take out of this list". |
| "মাফ" vs "মওকুফ" | keep both / one word | "মওকুফ" in `fines.json` | The shared fee status already says "মওকুফ" (D32). Two `fees.json` labels are a shared request. |
| Totals position | under pager / above table | above table | It summarises the filtered list; above, it is seen before scrolling. |
| Primary action | Log / Generate | Generate | Unchanged from today; monthly generation is the routine task. |

## Files
- `client-admin/src/routes/_staff/fees/fines/index.tsx` — composed page, header, totals Card, empty / error states, page size
- `client-admin/src/routes/_staff/fees/fines/index.test.tsx` — update
- `client-admin/src/routes/_staff/fees/fines/rules.tsx` — container; header moves into the panel
- `client-admin/src/routes/_staff/fees/fines/-list/fines-filters.tsx` — month names, fine-type label, origin "all" label
- `client-admin/src/routes/_staff/fees/fines/-list/fines-filters.test.ts` — month labels
- `client-admin/src/routes/_staff/fees/fines/-list/fines-table.tsx` — columns, date/month format, rowActions builder
- `client-admin/src/routes/_staff/fees/fines/-list/fines-tabs.tsx` — delete
- `client-admin/src/routes/_staff/fees/fines/-rules/rules-panel.tsx` — PageHeader, year field, badges, RowActions, ConfirmDialog
- `client-admin/src/routes/_staff/fees/fines/-rules/rules-panel.test.tsx` — update
- `client-admin/src/routes/_staff/fees/fines/-rules/rule-form-dialog.tsx` — `size="md"`, labels, translated error
- `client-admin/src/routes/_staff/fees/fines/-rules/rule-form-dialog.test.tsx` — 409 message assertion
- `client-admin/src/routes/_staff/fees/fines/-rules/copy-rules-dialog.tsx` — `size="sm"`, label
- `ui/src/i18n/locales/bn/fines.json` — keys below
- `ui/src/i18n/locales/en/fines.json` — keys below
- `e2e/keyboard/fines.spec.ts` — rules link is a button

## Steps
1. **Delete `-list/fines-tabs.tsx`** and its imports in `index.tsx` and `rules.tsx`.
2. **Fines page (`index.tsx`).** Replace the `<>…</>` with `<PageContainer>` holding, in order:
   - `<PageHeader title={t('title')} subtitle={t('subtitle')} actions={actions} />` where `actions` = `[{ id: 'rules', label: t('tabs.rules'), priority: 'secondary', icon: <ListChecks />, onClick: () => void navigate({ to: '/fees/fines/rules' }) }, { id: 'log', label: t('logForm.title'), priority: 'secondary', icon: <Plus />, allowed: canGenerate, onClick: openLog }, { id: 'generate', label: t('generate.title'), priority: 'primary', icon: <FilePlus2 />, allowed: canGenerate, onClick: openGenerate }]` (`openLog` / `openGenerate` are today's `setLogFineOpen(true)` / `setGenerateFinesOpen(true)`; fines-1b turns them into URL changes).
   - `<FilterBar fields={filterFields} values={state.filters} onChange={handleFilterChange} resultCount={finesQuery.data?.total} />` (`@biddaloy/ui/shells`).
   - `<FinesTotals totals={totals} />` — only when `finesQuery.data` exists and `total > 0`. Rewrite `FinesTotalsFooter` as `<section aria-labelledby="fines-totals" className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">`, `<h2 id="fines-totals" className="sr-only">{t('totals.heading')}</h2>`, `<dl className="grid grid-cols-2 gap-4 md:grid-cols-4">`, `dt` `text-caption text-text-secondary`, `dd` `text-h3 tabular-nums` (outstanding adds `text-status-overdue-fg`), values `formatServerAmount` (unchanged).
   - `<DataTable tableId="fees-fines" caption={t('title')} columns={columns} data={fines} getRowId=… rowActions={buildFineRowActions(t, { canWaive, onWaive: setWaiving })} page/pageSize/totalCount/onPageChange/onPageSizeChange from `state`/`actions` loading={finesQuery.isLoading} isFetching=… emptyState={…} />`. `emptyState`: no active filter → `{ icon: <Gavel />, title: t('empty.title'), explanation: t('empty.description'), action: canGenerate ? { label: t('logForm.title'), onClick: openLog } : undefined }`; any filter set → `{ icon: <SearchX />, title: t('emptyFiltered.title'), explanation: t('emptyFiltered.description') }`.
   - `finesQuery.isError` → `<ErrorState message={t('loadError')} retryLabel={t('actions.retry', { ns: 'common' })} onRetry={() => void finesQuery.refetch()} />` in place of the table.
   - Remove the `isEmpty` branch (the header and filters now stay on screen). `useListShellState()` with no `limit` (B23). Keep the palette-flag effect, the `l` / `g` key listener and the three modal mounts as they are (fines-1b changes them).
3. **Filters (`-list/fines-filters.tsx`).** `month` options: `label: formatMonthName(index + 1, regionConfig)` — add `regionConfig` to `FinesFilterSources` and pass `useRegionConfig()` from `index.tsx`; drop the `monthOptions` source and the `monthOptions` `useMemo` in `index.tsx` (values stay `'1'`…`'12'`). `fee_structure_id` label → `t('filters.fineTypeLabel', { ns: 'fines' })`. Chip text then reads "মাস: মার্চ" (FilterBar shows the option label).
4. **Columns (`-list/fines-table.tsx`).** `buildFinesColumns(t, regionConfig)` drops its third (callbacks) argument; export a second function `buildFineRowActions(t, { canWaive, onWaive })` returning `(row) => RowAction[]`: `{ intent: 'view', label: t('openStudent', { ns: 'fines' }), to: \`/students/${row.student_id}\` }`, `{ intent: 'edit', icon: <BadgeMinus />, label: t('waiveDialog.confirm', { ns: 'fines' }), onClick: () => onWaive(row), allowed: canWaive && row.status !== 'WAIVED' && row.status !== 'PAID' }`. Delete the `actions` column and the file comment about the missing menu primitive. `student` column: plain `row.student_name ?? '—'` (never the id, D9), `card: 'title'`. `incidentDate`: `row.incident_date ? formatDate(parseServerDate(row.incident_date), regionConfig) : formatMonth(row.period_start.slice(0, 7), regionConfig)`. `reason`: keep the 40-char truncation + tooltip, `card` none (shows as a field). `origin` gets no card role (field).
5. **Rules page (`rules.tsx` + `-rules/rules-panel.tsx`).** `rules.tsx` renders `<PageContainer><RulesPanel /></PageContainer>`. In `RulesPanel`, replace the top `div` with:
   - `<PageHeader title={t('rules.title', { ns: 'fines' })} subtitle={t('rules.subtitle', { ns: 'fines' })} actions={[{ id: 'copy', label: t('fines.rules.copyFromLastYear'), priority: 'secondary', icon: <Copy />, allowed: canCreate, onClick: () => setCopyOpen(true) }, { id: 'add', label: t('fines.rules.addRule'), priority: 'primary', icon: <Plus />, allowed: canCreate, onClick: () => setCreateOpen(true) }]} />`. Add `'fines'` to the panel's `useTranslation(['fees', 'fines'])`.
   - `<div className="md:grid md:grid-cols-12 md:gap-4"><FormField label={t('fines.rules.academicYearLabel')} className="md:col-span-3">` around the existing `Select` (drop the `span` and the trigger's `aria-label`; the `n`-key guard on `[role="combobox"]` stays).
   - `DataTable`: add `paginated={false}`, `rowActions={(row) => [...]}` (below), `emptyState={{ icon: <Gavel />, title: t('fines.rules.emptyTitle'), explanation: t('fines.rules.emptyMessage'), action: canCreate ? { label: t('fines.rules.addRule'), onClick: () => setCreateOpen(true) } : undefined }}`; remove the separate `EmptyState` branch, `page`/`pageSize`/`onPageChange` and the `actions` column (delete `RuleRowActions`).
   - Columns: `freePerPeriod` → `formatNumber(row.free_per_period, regionConfig)`; `minMinutesLate` → value `null` ? `'—'` : `t('rules.minutes', { ns: 'fines', count: n, n: formatNumber(n, regionConfig) })`; `active` → `<StatusBadge tone={row.is_active ? 'success' : 'neutral'} label={row.is_active ? t('fines.rules.statusActive') : t('fines.rules.statusInactive')} />`.
   - Row actions need per-row mutations: lift them to the panel — `const updateRule = useUpdateFineRule(academicYearId)` and `const deleteRule = useDeleteFineRule(academicYearId)` (every listed rule has the panel's `academicYearId`). `rowActions = (row) => [{ intent: 'edit', label: t('fines.rules.edit'), allowed: canUpdate, onClick: () => setEditing(row) }, row.is_active ? { intent: 'archive', icon: <CirclePause />, label: t('fines.rules.deactivate'), allowed: canUpdate, onClick: () => updateRule.mutate({ id: row.id, is_active: false }) } : { intent: 'restore', icon: <CirclePlay />, label: t('fines.rules.activate'), allowed: canUpdate, onClick: () => updateRule.mutate({ id: row.id, is_active: true }) }, { intent: 'delete', label: t('fines.rules.delete'), allowed: canDelete, onClick: () => setDeleting(row) }]`.
   - **New** `const [deleting, setDeleting] = React.useState<FineRule | null>(null)` + `<ConfirmDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} tone="danger" title={t('deleteRuleDialog.title', { ns: 'fines' })} description={t('deleteRuleDialog.description', { ns: 'fines', trigger: triggerLabel(deleting), appliesTo: deleting?.class_name ?? t('fines.rules.wholeSchool') })} confirmLabel={t('deleteRuleDialog.confirm', { ns: 'fines' })} busy={deleteRule.isPending} onConfirm={() => deleting && deleteRule.mutate({ id: deleting.id }, { onSuccess: () => setDeleting(null), onError: () => toast.error(t('deleteRuleDialog.errorMessage', { ns: 'fines' })) })} />`. Add `deleting` to the `n`-key guard.
6. **Rule form (`-rules/rule-form-dialog.tsx`).** `<DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>` (drop `max-h-[85vh] overflow-y-auto`). Each field becomes `FormField` with a `<label htmlFor>` pointing at the `SelectTrigger` / input id (drop the `span`s and the triggers' `aria-label`s). Error line (`:188`): show `t('fines.rules.form.errorMessage')` for every error except the existing 409 duplicate branch, which keeps its own translated sentence; never `mutation.error.message`. Cancel button `variant="outline"`.
7. **Copy dialog (`-rules/copy-rules-dialog.tsx`).** `<DialogContent size="sm" closeLabel=…>`; year select gets a `<label>`; Cancel outline.
8. **i18n (`fines.json`, bn + en).** (31.3.4b already changed "ক্লাস" → "শ্রেণি" and `ruleForm.activeLabel` → "সক্রিয়".)

    | Key | bn | en |
    |---|---|---|
    | `subtitle` (**New**) | হাতে লেখা আর নিয়ম থেকে তৈরি সব জরিমানা | Every fine, logged by hand or made from a rule |
    | `loadError` (**New**) | জরিমানার তালিকা আনা যায়নি। | Couldn't load fines. |
    | `emptyFiltered.title` / `.description` (**New**) | এই ফিল্টারে কোনো জরিমানা নেই / অন্য মাস বা অবস্থা বাছুন, কিংবা ফিল্টার মুছে দিন। | No fines match these filters / Pick another month or status, or clear the filters. |
    | `filters.fineTypeLabel` (**New**) | জরিমানার ধরন | Fine type |
    | `filters.allOrigins` (changed) | সব উৎস | All sources |
    | `filters.originLabel` (en changed) | উৎস | Source |
    | `columns.incidentDate` (changed) | তারিখ | Date |
    | `totals.heading` (**New**) | এই তালিকার হিসাব | Totals for this list |
    | `totals.waived` (changed) | মওকুফ হয়েছে | Waived |
    | `generate.title` (changed) | নিয়ম থেকে জরিমানা তৈরি | Make fines from rules |
    | `rules.subtitle` (**New**) | অনুপস্থিতি বা দেরিতে আসার জন্য কত জরিমানা হবে | How much is fined for absences and late arrivals |
    | `rules.minutes` (**New**, `_one`/`_other` in en) | {{n}} মিনিট | {{n}} minute / {{n}} minutes |
    | `deleteRuleDialog.description` (changed) | “{{trigger}} — {{appliesTo}}” নিয়মটি মুছে ফেলবেন? এটি আর ফেরানো যাবে না। | Delete the rule “{{trigger}} — {{appliesTo}}”? This cannot be undone. |

    Delete `tabs.fines` and `rulesEmpty.*` if no file reads them (`rg "rulesEmpty|tabs\.fines" client-admin ui`). Keep `palette.*` unchanged (31.5.1b). The "মাফ" → "মওকুফ" sweep of `waiveDialog.*` is fines-1b.

## Tests
- `index.test.tsx`: h1 "Fines" and subtitle; header shows "Fine rules" (navigates to `/fees/fines/rules`), "Log fine" and "Make fines from rules" (only the last is filled); filters have visible labels incl. "Fine type"; month options read "January"…; totals Card renders four amounts above the table; rows show a View action linking to the student and a Waive action only for ADMIN on open fines; a month-only fine shows "March 2026"; no fines → empty state with header still present; a 500 → error sentence + Retry; default request uses `limit=25`; keep the URL-filter and EXECUTIVE tests; axe clean.
- `fines-filters.test.ts`: month option labels are month names, values `'1'`…`'12'`.
- `rules-panel.test.tsx`: h1 "Fine rules"; status shows a badge "Active"/"Inactive"; the year select has the label "Academic year"; edit / deactivate / delete are icon buttons with those names; clicking delete opens an alertdialog naming the rule and only its confirm calls `DELETE`; footer "Total 2"; keep the `n` key, ACCOUNTANT-without-delete, empty-state and cap tests.
- `rule-form-dialog.test.tsx`: a generic 500 shows "Failed to save fine rule", not the server text; the 409 test unchanged.
- `e2e/keyboard/fines.spec.ts` `:183`: `tabUntilFocused(page, t('fines.tabs.rules'), 90, { tag: 'button' })` (it is a header button now). Everything else unchanged.
- `e2e/journeys/fines.spec.ts` — run; the button and dialog are both found by `fines.generate.title`, whose text changes but not its key.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No tab row on either page; the rules page h1 equals its last crumb.
- [ ] Every filter has a visible label; month filter shows month names.
- [ ] Totals sit above the table.
- [ ] Row actions are icons with tooltips (desktop) and labelled buttons (phone); no underlined text links.
- [ ] Rule status is a StatusBadge; deleting a rule asks first.
- [ ] Default page size is 25.

## Out of scope
- Rule-made fines carry an English `note` written by the server ("3 absent days (1 free)") — shown as is in "কারণ"; server change filed as a shared request.
- `fees.json` `fines.rules.*` wording ("মাফ" in two labels, "চালু করুন / বন্ধ করুন" vs badge "সক্রিয় / নিষ্ক্রিয়", "সর্বোচ্চ" → "মাসে সর্বোচ্চ", "সর্বনিম্ন মিনিট দেরি" → "ন্যূনতম দেরি") — fees lane owns `fees.json`; shared request filed. The mockup shows the requested wording.
- `PageAction` has no `to` (the rules link is a button) — shared request filed.
- Amount digits like `৳৩৫০.00` — the formatter fix is 31.2.1 (D6).
- Generate / log full-page modals and the waive dialog — fines-1b.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| PageAction to?: string (render header action as a link) | Refused | — | use the fallback in the ticket (button + navigate; e2e keeps tag 'button'); one page |
| fees.json fines.rules.* wording (6 labels) | Accepted | 31.3.4b | applied before wave 4: columnCap "মাসে সর্বোচ্চ", columnFreePerPeriod + form.freePerPeriodLabel "মাসে যতবার মওকুফ", activate/deactivate "সক্রিয় করুন / নিষ্ক্রিয় করুন", columnMinMinutesLate "ন্যূনতম দেরি"; the page reads the same keys |
| server rule-made fine note not English | Accepted | 31.3.7d | new rule-made notes are written in the school's language and numerals ("৩ দিন অনুপস্থিত (১ দিন মওকুফ)"); keep showing note as is; notes written before 31.3.7d stay English (immutable history) |

Wave: 9   Lane: fines   Decisions: D5, D6, D9, D15, D16, D19, D20, D21, D24, D25, D27, D28, D29, D32   Depends on: 31.3.8b
