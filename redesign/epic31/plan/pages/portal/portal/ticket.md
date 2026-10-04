# [31.4.portal-1] Portal overview — real title, two columns, one card per child

## Goal
`/portal` has the title "সারসংক্ষেপ", a family total, one self-contained card per child (with that child's "due this month" inside it), and upcoming events in a side column, matching the "after" screenshots.

## What and why
This page tells a guardian, at a glance, how much the family owes and what is coming up, then sends them into one child's fees. Today it has no visible title (the `<h1>` is the small "মোট বকেয়া" label), the upcoming card is wider than everything under it, "কোনো বকেয়া নেই" is painted in the warning colour, and every child is followed by a second card that usually just says "এই মাসে কিছু বাকি নেই". The redesign gives the page a normal header, merges each child into one card, hides empty "this month" blocks and moves upcoming events to the side.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageHeader` with title = nav label "সারসংক্ষেপ" (`nav:items.portalOverview`), no actions. It is the `<h1>` in every loaded frame (multi-child and single-student). | D16, D32; "where am I" fails today (no visible title) |
| 2 | Layout | `PageContainer` (wide) + `grid gap-6 md:grid-cols-3 md:items-start`: main column `md:col-span-2` (surveys card, total, children), side column (`UpcomingCalendarCard`). Remove every `max-w-2xl` wrapper. | D15; the upcoming card no longer has its own width |
| 3 | Surveys card | Moves from above everything to the top of the main column; kit Card look with an icon well (`clipboard-list`) and `chevron-right`. Still renders nothing when no survey waits. | One obvious next action when a survey waits |
| 4 | Family total | Card: label `text-label text-text-secondary` (now an `<h2>`, not the page `<h1>`), amount `text-display tabular-nums`, meta line `mt-0.5 text-text-secondary`. When the total is 0 the amount ("কোনো বকেয়া নেই") uses `text-status-paid-fg` (today `text-status-due-fg`). | Colour matched the wrong state |
| 5 | Children | `<h2 class="text-h2">আপনার সন্তানেরা</h2>` (no uppercase micro-label) + `grid gap-4 md:grid-cols-2 md:items-start` of child cards. | Section reads as a section |
| 6 | Child card | One `<article>` Card per child: name `text-h3` + `StatusBadge`, class/roll line, amount `text-h2` in the status tone, due line `text-caption`; then the **this-month block inside the same card** (only when the child has a this-month or carried-over line); then a footer link row "ফি-এর বিস্তারিত দেখুন" + `chevron-right` to `/portal/fees?student=<id>`. The card itself is no longer a link. **New** aria-label on the footer link: `children.viewFeesFor`. | Two cards per child doubled the scroll; empty "nothing due this month" blocks are noise |
| 7 | Paid-up child | Shows "কোনো বকেয়া নেই" (paid tone) and, when known, "সর্বশেষ পরিশোধ <date>"; no this-month block. | Nothing to read twice |
| 8 | Numbers | Roll, child counts and day counts render in the tenant's numerals (`formatNumber`). | D6 (today "রোল 3", "Class 6 B") |
| 9 | Single-student frame | `<h1>` becomes the page title (change 1); the student's name + class line becomes the PageHeader subtitle; total card keeps "ফি-এর বিস্তারিত দেখুন" as the page's one filled primary (`Button` default variant, `asChild` Link); `DueThisMonthCard` and `RecentPayments` follow in the main column with kit Card padding; "সব পরিশোধ দেখুন" becomes a ghost button-link (`inline-flex h-11 items-center rounded-md px-3 font-medium text-primary hover:bg-muted`). | D16, D29 |

## Mobile behaviour
- One column in DOM order: header, surveys card, total, children, upcoming.
- Child card footer link is a full-width `h-11` row.
- No filled button in the multi-child frame (read-only page); the bottom bar marks "সারসংক্ষেপ".

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Page `<h1>` | keep the hidden total label / student name; nav label | nav label | D16; `useRouteFocus` still finds an `<h1>` in `<main>` |
| "Due this month" | sibling card per child (today); inside the child card; drop it | inside the child card, only when it has lines | halves the cards, keeps the information |
| Card tap target | whole card is a link (today); explicit footer link | footer link with child-named aria-label | the card now holds a list, which must not be read as one giant link name |
| Primary button | add one; none | none in multi-child frame, "ফি-এর বিস্তারিত দেখুন" in single-student frame | read-only page; inventing an action breaks D1 |
| Upcoming card position | above everything (today); side column | side column, last on phone | money first; events are secondary |

## Files
- `client-admin/src/routes/portal/index.tsx` — layout, header, child card, tones, numerals
- `client-admin/src/routes/portal/-due-this-month-card.tsx` — becomes a card section (`DueThisMonthSection`) usable inside the child card; keeps the standalone card for the single-student frame
- `client-admin/src/routes/portal/-surveys-card.tsx` — kit look (icon well, padding, tokens)
- `client-admin/src/routes/portal/index.test.tsx` — updated assertions
- `client-admin/src/routes/portal/-due-this-month-card.test.tsx` — updated for the section variant
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — one new key

## Steps
1. In `PortalOverviewRoute`, render `<PageContainer>` (wide) → `<PageHeader title={t('items.portalOverview', { ns: 'nav' })} />` once at the top for the loaded frames. Loading and error frames keep rendering no `<h1>` (skeleton / `ErrorState`), as today; the empty frame keeps `EmptyState` (its title is no longer an `<h1>` after 31.2.8, so render the PageHeader above it too).
2. Below the header render `<div className="grid gap-6 md:grid-cols-3 md:items-start">` with `<div className="min-w-0 space-y-6 md:col-span-2">` holding `<PortalSurveysCard />` then the frame content, and `<aside className="space-y-6"><UpcomingCalendarCard calendarPath="/portal/calendar" /></aside>`. Delete every `max-w-2xl` and `gap-3` wrapper class in `MultiChildView`, `SingleStudentView` and `PortalSkeleton` (D15/D37); the skeleton keeps its shapes but drops the max width.
3. `MultiChildView` total Card: classes `p-4 md:p-5`; `<h2 className="text-label text-text-secondary">{t('hero.label')}</h2>`; amount `<p className="mt-1 text-display tabular-nums {tone}">`; meta `<p className="mt-0.5 text-text-secondary">`. Tone: `total === 0 ? 'text-status-paid-fg' : overdueTotal > 0 ? 'text-status-overdue-fg' : 'text-status-due-fg'`. Pass `withDue`/`total` to `hero.acrossChildren` through `formatNumber(n, config)`.
4. Children heading: `<section className="space-y-3"><h2 className="text-h2">{t('children.title')}</h2><div className="grid gap-4 md:grid-cols-2 md:items-start">…</div></section>`.
5. Rewrite `ChildCard` as `<Card asChild><article className="flex flex-col p-0">` with an inner `div.space-y-3.p-4.md:p-5`: row `flex items-start justify-between gap-3` (`h3.truncate.text-h3` name + meta `p.text-text-secondary`, `StatusBadge domain="fee"`), amount block (`p.text-h2.tabular-nums` + tone via existing `toneFor`, due line `p.text-caption.text-text-secondary`; for a paid child with a known last received payment show `hero.lastPaid` — only data already on the page, else nothing), then `<DueThisMonthSection dues={child.dues} now={now} config={config} />` (renders `null` when there is no this-month and no carried-over line). Footer: `<Link to="/portal/fees" search={{ student: child.id }} aria-label={t('children.viewFeesFor', { name: child.fullName })} className="flex h-11 items-center justify-between gap-2 rounded-b-lg border-t border-border-subtle px-4 font-medium text-primary hover:bg-muted md:px-5">{t('actions.viewFeeBreakdown')}<ChevronRightIcon className="size-4" aria-hidden="true" /></Link>`. Remove the outer `Card asChild` Link and its `MultiChildView` sibling `<DueThisMonthCard>`.
6. In `-due-this-month-card.tsx`, extract the body into `export function DueThisMonthSection(...)`: wrapper `div.space-y-2.border-t.border-border-subtle.pt-3`, title `<h4 className="text-label text-text-secondary">{t('fees.dueThisMonth')}</h4>`, lines `ul.space-y-1` with `li.flex.items-baseline.justify-between.gap-3`, carried-over header `p.text-label.text-status-overdue-fg`, total row `p.flex.justify-between.border-t.border-border-subtle.pt-2.font-semibold`; fine tag and note use `text-caption` (replace both `text-[11px]`). Return `null` when both lists are empty. `DueThisMonthCard` (single-student frame) = Card `p-4 md:p-5` wrapping the same pieces with an `h2.text-h2` title, and keeps showing `fees.nothingDueThisMonth` when empty.
7. `formatMeta`: pass `roll: formatNumber(roll, config)`; `hero.daysLate` count already goes through i18next `{{count}}` numerals after 31.2.1 — do not re-format it.
8. `SingleStudentView`: pass `subtitle={`${child.fullName} · ${child.meta}`}` to the PageHeader (lift the PageHeader into the frame components so each frame passes its own subtitle); total Card as step 3 with tone `toneFor(child.status)`; replace the outline `Button size="sm"` with the default (primary) `Button asChild` holding the `Link to="/portal/fees"` (full width on phone: `w-full md:w-auto`). `RecentPayments`: Card padding `p-4 md:p-5`, title `h2.text-h2`, rows `py-3` with `divide-y divide-border-subtle`, every `text-xs`/`text-sm` → `text-caption`/default body; "সব পরিশোধ দেখুন" as `inline-flex h-11 items-center rounded-md px-3 font-medium text-primary hover:bg-muted` (no underline); the "no payments" line stays a paragraph.
9. `-surveys-card.tsx`: `Card asChild` Link classes `flex min-h-11 items-center gap-3 p-4 hover:bg-muted md:p-5`; leading icon well `flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground` with `ClipboardListIcon`; texts `font-semibold` and `text-text-secondary`; trailing `ChevronRightIcon` `text-text-secondary`.
10. Add `children.viewFeesFor` — en `"View {{name}}'s fees"`, bn `"{{name}}-এর ফি দেখুন"`.
11. Replace every `text-muted-foreground`, `text-xs`, `text-sm`, `text-lg`, `text-3xl` on this page with the kit tokens above (`text-text-secondary`, `text-caption`, body, `text-h2`, `text-display`).

## Tests
- `index.test.tsx`: assert one `heading` level 1 named "Overview" in multi-child and single-student frames; the child link is found by `getByRole('link', { name: "View Fatima Rahman's fees" })` with `href="/portal/fees?student=student-1"` (replaces the `closest('a')`/`data-slot="card"` assertions); a paid-up child card has no "Due this month" text; a zero family total renders "Nothing due" with class `text-status-paid-fg`; single-student frame has exactly one primary-variant link "View fee breakdown".
- `-due-this-month-card.test.tsx`: `DueThisMonthSection` returns nothing for empty lists; existing carried-over/total arithmetic cases run against the section.
- `e2e/journeys/fines.spec.ts` step 2 asserts `portal.fees.dueThisMonth` is visible on `/portal`; it keeps passing while any child of the seeded parent owes this month (the shared parent has many children). That spec belongs to lane fines — do not edit it here; if it fails, see the shared request.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (none in the multi-child frame; "ফি-এর বিস্তারিত দেখুন" in the single-student frame).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The `<h1>` reads "সারসংক্ষেপ" and equals the sidebar label.
- [ ] Each child is one card; a child with nothing due this month shows no "এই মাসে বাকি" block.
- [ ] Upcoming events sit in the right column on desktop and last on phone.
- [ ] A zero total is green, not orange.

## Out of scope
- Inside of `UpcomingCalendarCard` (owned by lane calendar, ticket calendar-1b) — shared request filed for its card padding/title/row height.
- `StudentPicker` look is not on this page.
- Sidebar lighting two items and the phone header (foundation 31.2.9 / 31.3.2).
- `e2e/journeys/fines.spec.ts` (lane fines) — shared request filed in case its `dueThisMonth` assertion needs relaxing.
- Self-service payment (#291) — no "pay" action is added.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| amounts in tenant digits under the value-less RegionConfigProvider | Accepted | 31.2.1b | keep the value-less provider; 31.2.1b adds the guard test (provider + formatServerAmount give ৳০.০০ in bn) and fixes the cause if it fails |
| upcoming-calendar-card side-column look | Refused | — | use the fallback in the ticket — file is owned by calendar-1 (Addendum 8), not foundation; orchestrator may route the look to calendar-1 |
| e2e/journeys/fines.spec.ts dueThisMonth assertion | Accepted | 31.5.0 | conditional: 31.5.0 drops only that assertion if the seeded parent owes nothing this month; portal-1 edits nothing |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: portal   Decisions: D5, D6, D9, D15, D16, D17, D27, D28, D29, D32   Depends on: 31.3.8b
