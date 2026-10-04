# [31.4.staff-2c] Staff detail — ACR, incidents and performance tabs in kit cards

## Goal
Done = the ACR, Incidents and Performance tabs of `/staff/$userId` use kit Cards, StatusBadges, RowActions and outline buttons only (the header keeps the page's single filled button), with ACR status and incident severity as StatusBadges and no raw enum on these tabs (runs after staff-2b).

## What and why
These tabs hold the evaluation side of a staff member. Today "এসিআর শুরু করুন" and "ঘটনা জানান" are filled buttons competing with the header's primary, the ACR and incident lists are bare bordered `ul`s with plain-text status and severity, and the performance print button sits loose above the widgets. The redesign puts each tab's content in a kit Card with its outline action in the card header row, turns the ACR list into an unpaginated DataTable and the incidents into kit rows with badges.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/before-mobile.webp?raw=true" width="260"> |
| After (HR record tab) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/hr-record/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/hr-record/mobile.webp?raw=true" width="260"> |
| After (header + Profile, ticket a) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/mobile.webp?raw=true" width="260"> |

The before shot shows the Profile tab (the audit captured only the first tab). No tab of this ticket has its own mockup: follow the HR record tab's card look (staff-2b).

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | ACR tab | Card: title "এসিআরের ইতিহাস" + outline "এসিআর শুরু করুন"; unpaginated `DataTable` (শিক্ষাবর্ষ, অবস্থা as `StatusBadge` — চলমান warning / সম্পন্ন success, মোট নম্বর right-aligned via `formatNumber`, কাজ `view` "খুলুন" link); trend bars below in the same card (`h3 text-h3`, bar `h-3 rounded-sm bg-primary`). | D19, D27, D6 |
| 2 | Incidents tab | Card: title "ঘটনা" + outline "ঘটনা জানান"; rows `ul divide-y`: line 1 = type label `font-medium` + severity `StatusBadge` (কম neutral, মাঝারি warning, বেশি danger), line 2 = `formatDate(occurredOn)` `text-text-secondary`, line 3 = description. | D27 |
| 3 | Performance tab | Wrapper `space-y-6`; print button stays outline, moves into the SummaryCard's header row end (`print:hidden`); no other change (the widgets are shared). | D29 |

## Mobile behaviour
- Card header rows with a title + outline button wrap: button goes under the title when it does not fit (`flex flex-wrap items-center justify-between gap-2`).
- The ACR table shows the compact two-line rows of `PATTERN: DataTable (unpaginated)`; RowActions stay icons there (44 px).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Tab action buttons | Filled · outline | Outline, in the card header row | D29: the header's "সম্পাদনা করুন" is the page's one primary; each action sits next to what it changes. |
| ACR list | Keep `ul` · DataTable | Unpaginated DataTable | Gives the total line, right-aligned numbers and RowActions for free. |

## Files
- `client-admin/src/routes/_staff/staff/-detail/acr-tab.tsx` (+ `acr-tab.test.tsx`)
- `client-admin/src/routes/_staff/staff/-detail/incidents-tab.tsx` (+ `incidents-tab.test.tsx`)
- `client-admin/src/routes/_staff/staff/-detail/performance-tab.tsx`
- `ui/src/i18n/locales/{bn,en}/evaluations.json` — three keys below (later also changed by staff-4a, staff-4b, staff-5)

That is 3 source files + 2 tests + 2 locale files; all edits are markup/class swaps.

## Steps
1. **Shared card markup** (same as staff-2b) for every tab below: `<section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">`; header row `<div className="flex flex-wrap items-center justify-between gap-2">` with `<h2 className="text-h2">` and the outline action (`variant="outline"`, icon first, no `size="sm"`). A card holding a DataTable uses `overflow-hidden` with no padding and puts the header row in `p-4 md:px-5`. Remove every `text-sm`, `text-xs`, `text-base`, `text-muted-foreground`, `bg-primary/5` in these files.
2. **ACR tab.** Card (`overflow-hidden`) with header row (`acr.history.title`, outline `PlusIcon` `acr.start`); `DataTable` `tableId="staff-acr-history"` `caption={t('acr.history.title')}` `paginated={false}`, columns year (`yearName`), status (`<StatusBadge tone={r.status === 'COMPLETED' ? 'success' : 'warning'} label={t(`acr.status.${r.status}`)} />`), total (`align:'end'`, `r.total === null ? '—' : formatNumber(r.total, regionConfig)`, header `t('acr.history.columnTotal')`); `rowActions={(r) => [{ intent:'view', label:t('acr.register.open'), to:`/staff/${userId}/acr/${r.id}` }]}`; empty → `emptyState={{ title: t('acr.history.title'), explanation: t('acr.history.empty') }}`. `TrendBars` below the table inside `p-4 md:px-5`, `h3 text-h3`, bar `h-3 rounded-sm bg-primary`, value through `formatNumber`.
3. **Incidents tab.** Card + header row (`incident.title`, outline `FlagIcon` `incident.report`); `ul className="mt-4 divide-y divide-border-subtle"`, `li className="flex flex-col gap-1 py-3 first:pt-0"`: row 1 `flex flex-wrap items-center gap-2` = type `font-medium` + `<StatusBadge tone={{LOW:'neutral',MEDIUM:'warning',HIGH:'danger'}[r.severity]} label={t(`incident.severities.${r.severity}`)} />`; row 2 date `text-text-secondary`; row 3 description. Empty → EmptyState (unchanged).
4. **Performance tab.** Root `space-y-6`; keep `#performance-print-area`; move the print Button into a `div className="flex justify-end print:hidden"` directly above `SummaryCard` (already there) — only drop `className="size-4"` from the icon (Button sizes icons) and keep `variant="outline"`.
5. **i18n.** `evaluations.json` add (three keys; staff-4a, staff-4b and staff-5 edit this file later in the same lane): `acr.history.columnYear` "শিক্ষাবর্ষ" / "Academic year"; `acr.history.columnTotal` "মোট নম্বর" / "Total". `acr.history.columnStatus` "অবস্থা" / "Status".

## Tests
- `acr-tab.test.tsx`: status renders as a badge (COMPLETED → "সম্পন্ন"); "খুলুন" links to the ACR route; start button is outline.
- `incidents-tab.test.tsx`: HIGH severity renders the danger badge.
- Run the existing `performance-tab.test.tsx` unchanged; fix locators only if the print-button move breaks it.
- E2E: `e2e/journeys/acr.spec.ts`. Run it and fix locators only.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot's card look (HR record tab) on the ACR, Incidents and Performance tabs.
- [ ] Mobile at 390 px matches the "after" screenshot's card look; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (header); tab actions are outline.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] ACR status and incident severity are StatusBadges.

## Out of scope
- `StartAcrDialog`, `ReportIncidentDialog` — kit Dialog from the foundation; no change.
- The ACR form page itself — staff-5.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| ownership note: roles -role-card imports PermissionGroupList | Refused | — | nothing to change in shared code; keep PermissionGroupList's props unchanged as the ticket already says |

Wave: 9   Lane: staff   Decisions: D6, D9, D19, D27, D28, D29   Depends on: 31.3.8b, 31.4.staff-2b
