# [31.4.fees-4b] Automatic billing rule — detail header, exclusions, history

## Goal
`/fees/schedules/$id` matches the "after" screenshots of `fees_schedules_id`: a detail header (crumbs, rule name, status badge, key facts, one filled "সম্পাদনা" that opens the rule form at `?edit=1`), a "বাদ দেওয়া শিক্ষার্থী" card with one search + one reason field and a kit table, and a "বিল তৈরির ইতিহাস" table built from the same columns as `/fees/generate`, with one `h1` on the page.

Split: this is part **b**; it runs after fees-4a (`ticket.md`), which creates `-schedule-summary.ts` and the full-page rule form, and after fees-3a, which exports `useBatchColumns`.

## What and why
This page answers "what does this rule do, who is left out, and what has it billed so far". Today it shows only the name under a "back" link — none of the rule's settings — then an inline search where every result row has its own reason box, a bare table, and a run-history block that renders a second page title (`BatchTable` wraps `ListShell`, so the page has two `h1`s). The redesign uses the kit `DetailShell` with facts, a single reason field shared by the search results, a `DataTable` for exclusions, and `DataTable` + `useBatchColumns` for the history under an `h2`.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list (fees-4a) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules/before-mobile.webp?raw=true" width="260"> |
| After — list (fees-4a) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules/mobile.webp?raw=true" width="260"> |
| Before — rule detail | _not captured_ | _not captured_ |
| After — rule detail | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules_id/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules_id/mobile.webp?raw=true" width="260"> |

The "after" shot shows a search for "তানভীর" with one result and a reason typed.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `DetailShell` (no tabs): crumbs "স্বয়ংক্রিয় বিল › {name}", `h1` = rule name, StatusBadge সক্রিয় / নিষ্ক্রিয়; facts (**New**): শিক্ষাবর্ষ, কাদের জন্য, কখন, পরিশোধের সময় ("মেয়াদ শুরুর ৭ দিন পর"), পরের বিল তৈরি, চলবে (date range or "… থেকে"), ফি (names with amounts). The "back" link is removed. | D16, D20 (no back link), D5; the page never said what the rule does. |
| 2 | Edit | One primary "সম্পাদনা" (`pencil`, needs `SCHEDULE_MANAGE`) sets `?edit=1` and renders fees-4a's full-page `ScheduleFormDialog` over this page (**New** entry point to the existing form). | D16 one primary, D22. |
| 3 | Exclusions | Card "বাদ দেওয়া শিক্ষার্থী" + one-line explanation (**New**); `grid md:grid-cols-2` of "শিক্ষার্থী খুঁজুন" and "কারণ*" (one reason for whichever result you exclude); results list rows = name + registration number + outline "বাদ দিন" (`user-minus`, disabled until a reason is typed); then a `DataTable` (unpaginated) শিক্ষার্থী, কারণ, বাদ দেওয়ার তারিখ (**New**, from `created_at`), action `restore` "আবার যুক্ত করুন"; "মোট ২টি". | D19, D25; one reason box per row was confusing. |
| 4 | History | `h2` "বিল তৈরির ইতিহাস" + `DataTable` with `useBatchColumns()` ("কীভাবে তৈরি" hidden — always automatic), `view` action opens the bills dialog, 25 per page with `TableCount`. | One `h1` (today two); D19, B23 (today 10). |
| 5 | Loading / error | `RoutePending` stays; the error becomes `ErrorState` with Retry instead of a red line. | D28. |

## Mobile behaviour
- Header: crumbs (last two), name + badge, facts in a 2-column grid (ফি spans both), primary full width.
- Exclusions: search and reason stack; each result row keeps "বাদ দিন" on the right; table rows become two-line rows (name, then "reason · date") with the restore icon at the end (`PATTERN: DataTable (unpaginated)`).
- History: cards (period, badge, fee names; শিক্ষার্থী, মোট বিল, আদায়, তৈরির তারিখ; "বিলগুলো দেখুন").

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Header component | hand-built (today) · `DetailShell` without tabs | `DetailShell` | Addendum 7: tabs optional; same header as every detail page. |
| Primary action | none · "সম্পাদনা" · "শিক্ষার্থী বাদ দিন" | "সম্পাদনা" | Excluding is done in the card where the list is; editing the rule is the page-level action. |
| Add-exclusion UI | dialog with search + list (would be a full page, D21) · inline in the card | inline, one shared reason field | Two fields; keeps the list in view. |
| Confirm before "আবার যুক্ত করুন" | ConfirmDialog · none | none | Reversible in one click, as today. |
| History table | keep `BatchTable` (renders an `h1`) · `DataTable` + `useBatchColumns` | `DataTable` + `useBatchColumns` | One `h1`; same columns as `/fees/generate`. |
| Clone / switch off on this page | add to a More menu · list only | list only | Not asked for (D1); one primary is enough here. |

## Files
- `client-admin/src/routes/_staff/fees/schedules/$id.tsx` — DetailShell, facts, `?edit=1`, history table, error state
- `client-admin/src/routes/_staff/fees/schedules/$id.test.tsx` — update assertions
- `client-admin/src/routes/_staff/fees/schedules/-exclusions-table.tsx` — card layout, single reason, DataTable
- `client-admin/src/routes/_staff/fees/schedules/-exclusions-table.test.tsx` — update assertions
- `ui/src/i18n/locales/bn/fees.json` — `schedules.detail.*` keys below (also changed by fees-1, fees-3a, fees-4a, run earlier)
- `ui/src/i18n/locales/en/fees.json` — same keys (also changed by fees-1, fees-3a, fees-4a, run earlier)

Uses without editing: `-schedule-summary.ts`, `-schedule-form-dialog.tsx` (fees-4a), `-generations/batch-table.tsx` `useBatchColumns`, `-generations/batch-bills-drawer.tsx` (fees-3a).

## Steps
1. **Search param.** Add `validateSearch: z.object({ edit: z.literal(1).optional().catch(undefined), page: …, limit: … })` — keep whatever keys `useListShellState` needs (copy them from `generate.tsx`'s schema: `page`, `limit`, `selected`). `openEdit = () => navigate({ search: (p) => ({ ...p, edit: 1 }) })`; `closeEdit = useCloseFullPage(() => void navigate({ search: ({ edit: _e, ...rest }) => rest, replace: true }))`. Render `{canManage && search.edit === 1 && <ScheduleFormDialog open mode="edit" schedule={schedule} onOpenChange={(o) => !o && closeEdit()} onSaved={closeEdit} />}`.
2. **Header.** Replace the hand-built block (`:93-105`) with `<DetailShell name={schedule.name} statusBadge={<StatusBadge tone={schedule.is_active ? 'success' : 'neutral'} label={t(schedule.is_active ? 'schedules.statusActive' : 'schedules.statusInactive')} />} facts={facts} actions={[{ id: 'edit', label: t('schedules.edit'), icon: <PencilIcon />, priority: 'primary', allowed: canManage, onClick: openEdit }]}>` with the cards as children (or siblings — follow `DetailShell`'s API for a page without tabs). `facts`:
   - `detail.factYear` → year name from `useAcademicYears()` (`find(id)?.name ?? '—'`)
   - `schedules.columnAudience` → `audienceSummary(...)` (classes from `useClasses({})`, programs gated on `PROGRAM_READ` as in fees-4a)
   - `schedules.columnRule` → `ruleSummary(...)`
   - `detail.factDueDays` → `t('schedules.detail.dueDaysValue', { count: schedule.due_days_after_period_start })`
   - `schedules.columnNextRun` → `nextRunDate(schedule, dhakaNow())` → `formatDate` or "—"
   - `detail.factPeriod` → `ends_on ? formatDateRange(starts_on, ends_on, config) : t('schedules.detail.fromDate', { date: formatDate(starts_on) })`
   - `detail.factFees` → names with amounts from `useFeeStructures({ academic_year_id: schedule.academic_year_id })`, `` `${name} (${formatServerAmount(amount)})` `` joined with ", "; omit ids that are not found.
   Breadcrumbs come from the layout (`route-crumbs.ts` already has the two crumbs).
3. **Error.** Replace `<p className="text-sm text-destructive">` with `<ErrorState message={t('schedules.errorMessage')} onRetry={() => void scheduleQuery.refetch()} />`.
4. **Exclusions** (`-exclusions-table.tsx`; keep the export name and props):
   - Wrap in `<Card padded>`: `<h2 className="text-h2">{t('schedules.detail.exclusionsTitle')}</h2>` + `<p className="mt-0.5 text-text-secondary">{t('schedules.detail.exclusionsExplanation')}</p>` (`$id.tsx` drops its own `section` + `h2`).
   - `canManage` only: `grid gap-4 md:grid-cols-2 mt-4` with Field "শিক্ষার্থী খুঁজুন" (`<Label htmlFor="exclusion-search">`, search icon inside, placeholder `detail.studentSearchPlaceholder`) and Field "কারণ" (required mark, `Input id="exclusion-reason"`, placeholder `detail.exclusionReasonPlaceholder`). Replace `reasonByStudent` with one `reason` string.
   - Results (when the debounced search is non-empty): `<ul aria-live="polite" className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle">`, row `<li className="flex items-center justify-between gap-3 px-3 py-2">` = `<span className="min-w-0"><span className="block font-medium">{full_name}</span><span className="block text-caption text-text-secondary">{registration_number}</span></span>` + `<Button variant="outline" className="shrink-0" disabled={addExclusion.isPending || reason.trim() === ''} onClick={() => handleAdd(id)}><UserMinusIcon />{t('schedules.detail.excludeButton')}</Button>`. No-results row `px-3 py-3 text-text-secondary`. On success clear `search` and `reason`.
   - Table: `<div className="-mx-4 mt-4 border-t border-border-subtle md:-mx-5">` + `DataTable` `paginated={false}` (`tableId="schedule-exclusions"`), columns `student` (`student_name`, `card: 'title'`), `reason` (`reason ?? '—'`), `excludedOn` (header `detail.columnExcludedOn`, `formatDate(created_at)`), `rowActions={(row) => [{ intent: 'restore', label: t('schedules.detail.removeExclusion'), allowed: canManage, onClick: () => removeExclusion.mutate(row.student_id) }]}`; `emptyState={{ title: t('schedules.detail.exclusionsEmptyMessage') }}`. Delete the `Table*` imports and every `text-sm` / `text-muted-foreground` / `max-w-48`.
5. **History.** Replace `ScheduleRunHistory`'s `BatchTable` with `<section aria-labelledby="schedule-history" className="space-y-3"><h2 id="schedule-history" className="text-h2">{t('schedules.detail.runHistoryTitle')}</h2><DataTable tableId="schedule-history" caption={…} columns={useBatchColumns()} defaultColumnVisibility={{ source: false }} rowActions={(row) => [{ intent: 'view', label: t('generations.viewBills'), onClick: () => setSelectedBatch(row) }]} … /></section>` with `useListShellState()` (default 25, B23) driving `page` / `pageSize` / `onPageChange` / `onPageSizeChange`, `emptyState={{ title: t('schedules.detail.runHistoryEmptyMessage') }}`. Keep `BatchBillsDrawer`.
6. Delete the `Link` / `detail.back` usage and the outer `flex flex-col gap-6` wrapper (the PageContainer spaces sections).
7. **i18n** (`fees.json` → `schedules.detail.*`, bn / en; the glossary already renamed `runHistoryTitle`):
   - add `factYear`: "শিক্ষাবর্ষ" / "Academic year"; `factDueDays`: "পরিশোধের সময়" / "Time to pay"; `dueDaysValue_one/_other`: "মেয়াদ শুরুর {{count}} দিন পর" / "{{count}} day after the period starts" · "{{count}} days after the period starts"; `factPeriod`: "চলবে" / "Runs"; `fromDate`: "{{date}} থেকে" / "From {{date}}"; `factFees`: "ফি" / "Fees"
   - add `exclusionsExplanation`: "এই শিক্ষার্থীদের জন্য এই নিয়মে বিল তৈরি হবে না।" / "This rule does not bill these students."; `excludeButton`: "বাদ দিন" / "Exclude"; `columnExcludedOn`: "বাদ দেওয়ার তারিখ" / "Excluded on"
   - change `exclusionsTitle`: "বাদ দেওয়া শিক্ষার্থী" / "Excluded students"; `removeExclusion`: "আবার যুক্ত করুন" / "Include again"; `studentSearchPlaceholder`: "নাম বা রেজিস্ট্রেশন নম্বর" / "Name or registration number"
   - delete `back`, `addExclusion` (replaced by `excludeButton`; confirm no other user with `rg`).

## Tests
- `schedules/$id.test.tsx`:
  - "shows the schedule name…": exactly one `h1` (the rule name); facts show the year name, "প্রতি মাসের ১ তারিখে" and "মেয়াদ শুরুর ৭ দিন পর"; no "back" link.
  - "scopes run-history…": the request still carries `recurring_schedule_id` and `source=SCHEDULE`, `limit=25`; the row shows a month name; the history heading is an `h2`.
  - **New**: "সম্পাদনা" sets `edit=1` and shows the form `h1` `form.editTitle`; hidden without `SCHEDULE_MANAGE`.
  - **New**: a failing detail request shows a Retry button.
- `-exclusions-table.test.tsx`:
  - "searches students and adds one…": type a reason once, the result's "বাদ দিন" enables, click posts `{ student_id, reason }` and clears both fields.
  - "lists existing exclusions…": a "বাদ দেওয়ার তারিখ" cell shows a long date; total "মোট n টি".
  - "removes an existing exclusion": the "আবার যুক্ত করুন" icon button calls `DELETE …/exclusions/:studentId`.
  - "hides add/remove actions when canManage is false": no search, no reason, no restore button.
- E2E: no spec covers this route.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] One `h1` on the page; no "back to list" link.
- [ ] The header says the rule's year, audience, timing, time to pay, next billing date, run dates and fees.
- [ ] One reason field; "বাদ দিন" stays disabled until it has text.
- [ ] History rows read month names and page by 25.

## Out of scope
- Last crumb shows the rule name only if `use-breadcrumbs.ts` resolves `scheduleDetail` — filed in shared-requests.md (31.3.5); otherwise it reads "স্বয়ংক্রিয় বিলের নিয়ম".
- Class / section of excluded students — the exclusion API returns only `student_name`.
- Clone / switch on-off on this page — list only (D1).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| palette entry for the rule form (?new=1 / ?edit=<id>) | Accepted | 31.5.1b | feeSchedules.create -> /fees/schedules?new=1 (kind navigate, label "স্বয়ংক্রিয় বিলের নিয়ম যোগ করুন"); ?edit=<id> stays a row action, not a palette entry; 31.5.1a adds no flag here |
| crumb resolver: rule name | Accepted | 31.3.5 | resolver key scheduleDetail reads recurringScheduleQueryOptions(id) -> name; keep that query on the page |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: fees   Decisions: D5, D6, D9, D16, D19, D20, D22, D25, D27, D28   Depends on: 31.3.8b, 31.4.fees-4a
