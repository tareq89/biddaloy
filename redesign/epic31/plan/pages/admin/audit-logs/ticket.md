# [31.4.admin-1] Activity log — record names, long dates, kit table

## Goal
`/audit-logs` reads like the kit list page: a one-line read-only subtitle instead of a note in the action slot, labelled filters, long-form dates, the record's real name instead of `type + short id` (B14), 25 rows with a total, a phone diff that reads top to bottom, and a real empty state.

## What and why
The page is the school's read-only trail of who did what and when. Today the "read-only" note sits where a button would be and wraps on phone, dates read `২০২৬-১০-০৪ ১৪:১৮`, the record column shows `ব্যবহারকারী beafdcce` (a UUID fragment, D9), filters have no labels and use typed `YYYY-MM-DD` boxes, and the pager says "১৯ পাতার মধ্যে ১ নম্বর পাতা" with 10 rows and no total. The redesign keeps the same columns and expand-to-see-changes behaviour, but names the record from the new `entity_label` field, moves the note into the subtitle and lets the kit FilterBar / DataTable do the rest.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/audit-logs/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/audit-logs/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/audit-logs/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/audit-logs/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `primaryAction={<p>…readOnlyNote</p>}` removed; the note becomes the PageHeader `subtitle` (shorter text). No action buttons at all. | D16 — the action slot is for actions; a wrapped note on phone pushes the list down |
| 2 | Header | h1 = `list.title` = "কার্যক্রমের রেকর্ড" (already renamed by 31.3.4b, equals the nav label) | D16, D32 |
| 3 | "কোন রেকর্ড" column | Shows `entity_label` from the API: "শিক্ষার্থী: রহিম উদ্দিন", "চালান: INV-2026-0142". When `entity_label` is `null` it shows the type alone ("পেমেন্ট") — never the short id. **New** key `list.whatWithLabel`. | B14, D9 |
| 4 | "কী ঘটেছে" column, UPDATE rows | Summary no longer repeats the record type ("এই শিক্ষার্থী-এর ২টি…" → "২টি তথ্য পরিবর্তন হয়েছে।") — the record column already names it, and the old Bangla genitive was broken | D32, plain wording |
| 5 | "কখন" column | Stays `formatDateTime` — after 31.2.1a it renders "৪ঠা অক্টোবর, ২০২৬, দুপুর ২:১৮"; `whitespace-nowrap` on the cell | D5, D7 |
| 6 | Filters | Unchanged descriptors; FilterBar (foundation) gives visible labels, DatePicker triggers for the range, chips + "সব মুছুন"; phone: one "ফিল্টার (n)" button (this page has no search field) | D24, D25 |
| 7 | Table footer | Default page size 25 (route stops forcing 10); TableCount "১–২৫ দেখানো হচ্ছে, মোট ১৮৪" comes from DataTable | D19, B23 |
| 8 | Expanded row (DiffPanel) | Desktop keeps the before/after table, restyled to kit tokens (`text-caption` header, `divide-y divide-border-subtle`). **Phone (< md):** a `dl` per field — field name + "পরিবর্তিত", then "আগে: …" (secondary) and "পরে: …" (`font-semibold text-primary`) on their own lines | a 3-column table inside a 358 px card squeezes every value into a narrow column |
| 9 | Empty | `emptyMessage` → `emptyState` (EmptyState): icon `scroll-text`, title + one sentence; when a filter is active, outline action "সব ফিল্টার মুছুন" | D28 |
| 10 | Error | Unchanged `error` text (`list.errorMessage`); DataTable shows the kit ErrorState | D28 |

## Mobile behaviour
- Cards (DataTable card layout): title = who, top-right = action label, subtitle = when, fields "কোন রেকর্ড" + "কী ঘটেছে".
- The expand toggle lives in the card footer. A visible "পরিবর্তন দেখুন / পরিবর্তন লুকান" label there is a shared request (see Out of scope); until it lands the footer keeps today's icon-only chevron, still named by `expandRowLabel`.
- Expanded card shows the stacked diff (change 8) between the fields and the footer.
- Filters behind one "ফিল্টার (n)" button opening the FilterSheet; chips stay visible under it.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Fallback when `entity_label` is null | type + short id (today) / type only / "—" | type only | D9 bans id fragments; the type still says what kind of thing changed |
| Action column look | StatusBadge / plain text | plain text (as today) | an audit action is a category, not a state with a good/bad tone (D27 is for status) |
| Where the read-only note goes | action slot / subtitle / banner | subtitle | one line, under the title, no fake button area |
| Phone diff | keep 3-col table / stacked pairs | stacked pairs below `md` | values (addresses, phones) need the full card width |
| Empty-state action | none / "সব ফিল্টার মুছুন" | only when a filter is active | with no filter there is nothing to undo; D28's one action applies when it helps |

## Files
- `client-admin/src/routes/_staff/audit-logs/index.tsx` — subtitle, entity label column, page size, emptyState
- `client-admin/src/routes/_staff/audit-logs/-diff-panel.tsx` — kit classes, stacked phone layout
- `client-admin/src/routes/_staff/audit-logs/-humanize.ts` — delete `shortEntityId` (no caller left)
- `client-admin/src/routes/_staff/audit-logs/-humanize.test.ts` — drop the `shortEntityId` block
- `client-admin/src/routes/_staff/audit-logs/index.test.tsx` — new/updated cases
- `client-admin/src/routes/_staff/audit-logs/-diff-panel.test.tsx` — phone layout case
- `client-admin/src/routes/_staff/audit-logs/-diff-panel.stories.tsx` — add a mobile-viewport story
- `ui/src/i18n/locales/en/auditLogs.json`, `ui/src/i18n/locales/bn/auditLogs.json` — keys below

## Steps
1. **Read first:** `PLAN/kit/patterns.md` §3 PageHeader, §4 FilterBar / DataTable / TableCount, §5 EmptyState; `index.tsx` header comment (read-only contract stays: no control that changes data). 31.3.7 has already added `entity_label: string | null` to `AuditLogResponseDto`, so `AuditLog['entity_label']` exists in `ui/src/api/schema.d.ts`.
2. **Header (`index.tsx`).** Remove the `primaryAction` prop. Pass `subtitle={t('list.readOnlyNote')}` to `ListShell` (its `subtitle` prop is added by 31.2.5a). No `actions`.
3. **Page size.** `useListShellState({ limit: 10 })` → `useListShellState()`; in `loaderDeps`, `limit: search.limit ?? 10` → `?? 25`. Remove nothing else (the zod `max(100)` stays).
4. **Record column.** Replace the `what` accessor:
   ```ts
   accessorFn: (row) =>
     row.entity_label
       ? t('list.whatWithLabel', { entity: entityLabel(row.entity_type), label: row.entity_label })
       : entityLabel(row.entity_type),
   ```
   Delete the `shortEntityId` import, the function in `-humanize.ts` (`:243`) and its test block (`-humanize.test.ts:212-220`). Delete the `list.whatWithId` key (en + bn).
5. **When column.** `DataTableColumn` has no class prop, so return a node: `accessorFn: (row) => <span className="whitespace-nowrap">{whenLabel(row)}</span>`; keep `whenLabel` = `formatDateTime(new Date(row.created_at), regionConfig)` (still used by `expandRowLabel`).
6. **Summary wording.** In `summaries.UPDATE_one/_other` drop the entity: en "{{count}} detail changed." / "{{count}} details changed."; bn "{{count}}টি তথ্য পরিবর্তন হয়েছে।" (both plural forms). The `entity` interpolation argument may stay in the call; i18next ignores unused values.
7. **Empty state.** Replace `emptyMessage={…}` with
   ```tsx
   emptyState={{
     icon: <ScrollText />,               // lucide-react
     title: t('list.emptyTitle'),
     explanation: t('list.emptyMessage'),
     ...(hasActiveFilter ? { action: { label: t('list.clearFilters'), onClick: clearFilters } } : {}),
   }}
   ```
   `hasActiveFilter = Object.values(filters).some((v) => v !== undefined)`; `clearFilters = () => actions.setFilters({ action: null, entity_type: null, performed_by_user_id: null, from_date: null, to_date: null })` (the same explicit-`null` patch FilterBar sends).
8. **DiffPanel (`-diff-panel.tsx`).** Keep logic (`diffFields`, `linkFor`, show-unchanged toggle) as is. Desktop (`hidden md:block` wrapper around the existing `Table`): caption `pb-2 text-start text-label text-text-secondary`, header cells `h-8 text-caption font-medium text-text-secondary`, rows `divide-y divide-border-subtle`, cells `h-9 pe-4`; changed marker `text-caption font-semibold text-primary`, unchanged `text-caption text-text-secondary`; "after" of a changed field `font-semibold text-primary`, "before" `text-text-secondary`. Replace `text-sm`/`text-xs`/`text-muted-foreground` with `text-body`/`text-caption`/`text-text-secondary`. Phone (`md:hidden`): `<dl className="mt-2 space-y-3">`, per field `<div><dt className="font-medium">{label} <span …marker/></dt><dd className="text-text-secondary">{t('diff.beforeInline', { value })}</dd><dd className="font-semibold text-primary">{t('diff.afterInline', { value })}</dd></div>` (multi-line values: render `ValueLines` inside the `dd` after the prefix). The show/hide-unchanged button: ghost, `inline-flex h-11 items-center gap-1 rounded-md px-2 text-label font-medium text-primary md:h-8`, `chevron-down`/`chevron-up` icon.
9. **i18n — new / changed keys** (`auditLogs.json`):
   | key | en | bn |
   |---|---|---|
   | `list.readOnlyNote` (changed) | Who did what, and when — view only, nothing here can be changed. | কে, কখন, কী করেছেন — শুধু দেখা যায়, বদলানো যায় না। |
   | `list.whatWithLabel` (**New**) | {{entity}}: {{label}} | {{entity}}: {{label}} |
   | `list.emptyTitle` (**New**) | No activity found | কোনো রেকর্ড পাওয়া যায়নি |
   | `list.emptyMessage` (changed) | Nothing matches these filters. Change them and look again. | এই ফিল্টারে কোনো কার্যক্রম নেই। ফিল্টার বদলে আবার দেখুন। |
   | `list.clearFilters` (**New**) | Clear all filters | সব ফিল্টার মুছুন |
   | `summaries.UPDATE_one/_other` (changed) | see step 6 | see step 6 |
   | `diff.beforeInline` (**New**) | Before: {{value}} | আগে: {{value}} |
   | `diff.afterInline` (**New**) | After: {{value}} | পরে: {{value}} |
   | `list.whatWithId` | (deleted) | (deleted) |
10. Do not touch `ENTITY_TYPES`, the filter descriptors, the search schema or the loader's `swallowUnlessOffline`.

## Tests
- `index.test.tsx`:
  - a row with `entity_label: 'Rahim Uddin'`, `entity_type: 'Student'` renders "Student: Rahim Uddin"; a row with `entity_label: null` renders the type alone and no 8-character id fragment (`queryByText(/[0-9a-f]{8}/)` is null).
  - no button other than filters, pager and expand toggles exists (read-only contract) and the read-only text is in the subtitle under the h1.
  - the first request asks for `limit=25`.
  - empty response + an active filter → EmptyState title "No activity found" and a "Clear all filters" button that clears every filter param from the URL; empty response without filters → no button.
  - UPDATE summary reads "2 details changed."
- `-diff-panel.test.tsx`: renders both layouts; in the `md:hidden` block a changed field shows "Before: …" and "After: …" text.
- `-humanize.test.ts`: `shortEntityId` block removed; the rest unchanged.
- No e2e spec targets this page's selectors (`e2e/journeys/permissions.spec.ts` only checks access); run it to confirm.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (this page has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The read-only note is a one-line subtitle under the h1, not in the action area.
- [ ] The record column shows "type: name" or the type alone — never a hex fragment.
- [ ] 25 rows by default with "১–২৫ দেখানো হচ্ছে, মোট n" under the table.
- [ ] On phone an expanded row shows each changed field as "আগে / পরে" lines, full width.

## Out of scope
- Shared request filed: DataTable phone card — visible text on the expand toggle ("পরিবর্তন দেখুন / লুকান"), full-width in the card footer. Until then the footer keeps the icon-only chevron.
- `entity_label` itself is server work (31.3.7); types not in its whitelist keep the type-only fallback.
- Seven identical "সাইন ইন" rows in a row (demo data) — no grouping/collapsing; filtering by action covers it.
- Breadcrumb label and sidebar label rename belong to 31.3.4a / 31.3.5.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| DataTable phone card expand toggle with visible text (expandRowText) | Refused | — | use the fallback in the ticket (icon-only chevron named by expandRowLabel); one page, new DataTable API |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: admin   Decisions: D5, D7, D9, D16, D19, D24, D25, D28, D32   Depends on: 31.3.8b
