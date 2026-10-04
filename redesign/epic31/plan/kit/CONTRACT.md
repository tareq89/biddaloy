# Page-redesign contract (Epic 31.0, wave 4) — read fully before starting

You plan the redesign of a few existing pages. You change NO app code. For each page you
produce a mockup, two screenshots and a plan-grade ticket file. A cheaper model will implement
the ticket later with no other context, so the ticket must be exact.

Repo: <repo>
Plan dir (PLAN): PLAN
Read first: `PLAN/kit/DECISIONS.md` (D1–D40), `PLAN/kit/patterns.md`, `PLAN/kit/patterns.html`
(the pattern gallery — copy its markup, do not invent new patterns), `PLAN/kit/starter.html`.
Look at `PLAN/kit/desktop.png` and `PLAN/kit/mobile.png` once so you know the target look.

## Per page — steps

1. **Ground.** `graphify query "<page name> route"` once (repo rule), then read the route file and
   the components it renders. Read the page's `bn` locale namespace
   (`ui/src/i18n/locales/bn/<ns>.json`) — mockup text is Bangla and uses the real strings.
   Look at the current screenshots: `PLAN/../ux-audit/desktop/<role>__<slug>.png` and
   `…/mobile/<role>__<slug>.png` (`ls` the folder; slug = route path with `/ $ .` → `_`).
   If a desktop shot is taller than ~3000 px, view only what you need. Write one sentence:
   the job of the page.
2. **Diagnose.** In 5 seconds can I tell where I am? Is there exactly one obvious next action?
   Does each control sit next to what it changes? Can I see the current state? Is anything shown
   that I do not need now? Each "no" is a finding. Add every D-rule the page breaks today.
3. **Mock up.** Copy `PLAN/kit/starter.html` to `PLAN/pages/<lane>/<slug>/mockup.html` and replace
   what is inside `<main>` (for a full-page modal use the kit's full-page frame instead of the
   shell). One file serves both sizes via `md:` utilities. Only the app's Tailwind tokens
   (`bg-surface`, `text-h1`, `border-border-subtle`, `shadow-e1`…): no hex, no arbitrary px.
   Only real content of the page; anything new is marked **New** in the ticket. Fake names only.
   Phone layout is designed, not shrunk: one column, tables become cards, filters behind one
   button, primary action reachable, every control ≥ 44 px.
4. **Shoot.** `cd` to the repo root, then
   `node .claude/skills/redesign-page/scripts/shoot.mjs PLAN/pages/<lane>/<slug>/mockup.html`
   Exit 1 = hard failure (sideways scroll, h1 count ≠ 1, unlabeled control, script error): fix,
   re-shoot. Fix `smallTargets` on mobile unless they are links inside a sentence.
5. **Review.** Open `desktop.png` and `mobile.png` with Read and look. Nothing overlaps, clips or
   wraps badly; one filled button per view, visible without scrolling; every finding from step 2
   is visibly fixed; it looks like the kit. At most 2 fix rounds, then keep the best.
6. **Ticket.** Write `PLAN/pages/<lane>/<slug>/ticket.md` from the template below.

## Territory — the rule that prevents collisions (D3)

`## Files` of your ticket may contain ONLY:
- the page's route file(s) and its `-helper` files / folders under `client-admin/src/routes/…`
- feature files used only by this lane (`client-admin/src/features/<x>/**`, `client-admin/src/pages/<x>/**`, `client-admin/src/components/<x>/**` when your brief lists them)
- the locale namespace files your brief lists (`ui/src/i18n/locales/{en,bn}/<ns>.json`)
- test, story and e2e spec files that belong to those files
- any extra file your brief explicitly grants

NEVER list: anything in `ui/src/components`, `ui/src/shells`, `ui/src/primitives`, `ui/src/utils`,
`ui/src/styles`, `ui/src/hooks` (unless granted), `ui/src/api`, `nav.json`, `common.json`,
`_staff.tsx`, `portal.tsx`, `_platform/route.tsx`, `nav-tree.ts`, `route-crumbs.ts`,
`route-permissions.ts`, `action-registry.ts`, `unregistered-actions.ts`, `routeTree.gen.ts`,
`e2e/route-manifest.json`, `e2e/pages/**`, `e2e/a11y/**`, `e2e/responsive/**`, `e2e/smoke/**`,
`server/**`, `shared/**`. No new routes, no route renames, no API changes.

Every kit pattern (PageHeader, PageContainer, RowActions, table count, tabs, FilterBar labels and
phone sheet, DatePicker/MonthPicker/TimeInput, MonthGrid, StatusBadge, EmptyState, ErrorState,
Dialog sizes, FullPageShell, formatDate/formatTime/formatNumber, AuthLayout, new shell) will
ALREADY EXIST when your ticket is implemented — foundation tickets build them first. Your ticket
says "use `<X>` from `@biddaloy/ui`", never "create `<X>`". Component names and props are in
`patterns.md`.

If the page needs something shared that the kit does not have (a new shared prop, a nav label, a
crumb label, a missing API field, a permission, a palette action), do NOT design around it
silently and do NOT put the shared file in `## Files`. Append one line to
`PLAN/pages/<lane>/shared-requests.md`:
`- <slug> | <shared file or area> | <what is needed> | <what the page does if it is refused>`
and mention it under `## Out of scope` in the ticket.

Tickets of one lane run one after another, so two tickets of YOUR lane may share a file. Tickets of
different lanes run at the same time and must never share a file.

## Ticket template (keep the headings exactly; first line is the issue title)

```markdown
# [31.4.<lane>-<n>] <Page name> — <what changes, ≤ 8 words>

## Goal
<one sentence — what "done" means>

## What and why
<2–3 plain sentences: the job of the page, what gets in the way today, what the redesign does.>

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="BASE/<lane>/<slug>/before-desktop.png?raw=true" width="560"> | <img src="BASE/<lane>/<slug>/before-mobile.png?raw=true" width="260"> |
| After | <img src="BASE/<lane>/<slug>/desktop.png?raw=true" width="560"> | <img src="BASE/<lane>/<slug>/mobile.png?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | … | … | … |

Mark anything that does not exist today with **New**.

## Mobile behaviour
<short list of what differs below `md`>

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|

## Files
- `path` — what changes

## Steps
1. <ordered, concrete; name the component, the kit pattern (by its name in patterns.md), the
   classes/tokens, the i18n keys to add (en + bn text), and any logic beyond styling>

## Tests
- <unit/component test file + what it asserts>
- <e2e spec to update when selectors or flow change — name the file>

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] <one line per change above that can be checked by looking>

## Out of scope
<what you noticed and left alone, one line each; shared requests filed>

Wave: 4   Lane: <lane>   Decisions: D<n>, D<n>…   Depends on: 31.3.8 (foundation closed)
```

`BASE` = `https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31`
`<n>` = the ticket number your brief gives. The "before" image files are produced centrally —
just write the URLs. If a page has no audit screenshot, write `_not captured_` in that cell.

A ticket may cover two pages when your brief says so: then make one mockup folder per page
(`<slug>` each) and put two rows of "After" (and "Before") images in the table, labelled.

Sizing: ≤ ~15 files and one afternoon of work. If it is bigger, say so on the first line under
`## Goal` and propose the split in your final report — do not split it yourself.

## Locale namespaces — each file has ONE owner lane

`PLAN/kit/LANES.md` lists which namespaces your lane owns. New keys and label fixes go ONLY into
namespaces your lane owns (a portal page adds to `portal.json`, a student-detail tab adds to
`students.json`, even when the page also reads another namespace). A wording fix needed in a
namespace you do not own, in `nav.json` or in `common.json` is a shared request. Keys that the
kit patterns need (table count, filter button, close, today, date placeholder…) already exist in
`common.json` by then — do not add them.

## Mockup mechanics (learned while building the kit — follow exactly)

1. Never use `fixed` or `sticky bottom-0` in a mockup: the screenshot is one full-page frame and a
   fixed bar is painted across the middle. The starters keep the bottom bar / footer in normal flow.
2. Adapt the shell in 3 spots only: move `aria-current="page"` to the one sidebar link, move `open`
   to its `<details>` group, set the bottom-bar cell (`aria-current="page"` on a cell, or
   `data-active="true"` on "আরও" when the page is in no cell). No class edits to the shell.
3. Starters: staff `starter.html`; guardian portal `starter-portal.html`; platform console
   `starter-platform.html`; full-page modal `starter-fullpage.html`; signed-out pages
   `starter-guest.html`. Bottom-bar cells of other roles are in `nav-icons.md`.
4. Control height: staff/platform `h-11 md:h-8` and `size-11 md:size-8`; portal, guest and full-page
   header/footer `h-11` at every width. Never put `hidden` next to a base `flex`/`inline-flex`.
5. Exactly one `<h1>`; the gallery's `<p data-h1>` becomes `<h1>` in a page and its card titles
   `<h2>`. The only `max-w-*` is the PageContainer's. Breadcrumbs only when the page is 2+ levels
   deep; no separate "back to list" link.
6. Do not read all of `patterns.html` (164 KB): `grep -n "PATTERN:" PLAN/kit/patterns.html`, then
   read the block you need. `patterns.md` §1 has the shared class strings.
7. Desktop row actions: icon + tooltip. Phone cards: icon + visible label. EmptyState's action is an
   outline button so the page keeps one filled primary. Default page size 25.
8. Known bugs with confirmed causes are in `PLAN/kit/BUGS.md` — if one sits on your page and the fix
   is inside your territory, put the fix in your ticket's steps; otherwise it is already owned by
   the foundation ticket named there.

## What you return (final message, terse)

For each ticket: `ticket path | title | pages | files count | size S/M/L`, then the
shared-requests you filed, then anything you could not resolve. Nothing else.

## Addendum — lessons from the first batch (binding)

1. **Folder name = the audit slug** (the part after `<role>__` in the screenshot file name, e.g.
   `students_studentId`, `fees_dues`, `portal_routine`). For a page with no audit shot, build the slug
   the same way from the route path. Ticket ids stay as LANES.md gives them.
2. **Read your lane's existing tickets first** (`ls PLAN/pages/<lane>/*/ticket*.md`): earlier tickets of
   the lane run before yours. Do not contradict them, do not re-do their work, and name any file you
   share with them under `## Files` with "(also changed by <id>, runs earlier)".
3. **Too big? Split it yourself.** More than ~15 files or more than one afternoon → write two ticket
   files in the same folder, `ticket.md` (`<lane>-<n>a`) and `ticket-b.md` (`<lane>-<n>b`), with
   disjoint files where possible and "b runs after a". Both carry the Before/After table.
4. **Wording comes from the glossary.** Read `PLAN/foundation/31.3.4a-shared-labels.md` and the table
   in `PLAN/foundation/31.3.4b-namespace-jargon.md`: those renames are ALREADY APPLIED to your
   namespace files before your ticket runs. Use the new words in the mockup and ticket; never list a
   rename the glossary already makes; add only new keys and fixes the glossary does not cover.
5. **Read-only pages** (most of the portal): the acceptance line is "at most one filled primary".
6. **Tailwind classes in steps are logical**: `ms-`/`me-`/`ps-`/`pe-`/`text-start`/`text-end`/`start-`/`end-`
   (a lint rule rejects `ml-`, `pl-`, `left-`, `text-left` in `ui`; keep route files consistent).
7. **Foundation facts settled since the kit was written** (use them, do not request them):
   `PageContainer` sets width only — the page gutter stays on `<main>`; `DetailShell` takes
   `variant="line"` tabs and `tabs` is optional (a detail page without tabs still uses it);
   `RowActions` items carry `data-focus-anchor`; formatters also include `formatDateRange`,
   `formatMonthName`, `formatWeekday`, `toIsoDate`; `Card` takes `padded`; `DialogContent` takes
   `size` and `closeLabel`; `useCloseFullPage()` closes a full-page modal; default page size is 25
   with options 25/50/100; `ConfirmDialog` exists; `EmptyState` renders an `h2`; `BulkUploadPreview`
   lets the host own the Confirm button; the staff sidebar gains a "পেমেন্ট" (`/payments`) item.
8. **Files that already have an owner** — place them, never edit them:
   `client-admin/src/components/upcoming-calendar-card.tsx` and `calendar-feed-card.tsx` → calendar-1;
   `ui/src/components/student-picker.tsx` → foundation; `routes/_staff/students/-guardian-picker.tsx`
   and `-student-form-schema.ts` → students lane; `fees.json` → fees lane (invoice/payment pages add
   their keys to `payments.json`).
9. Mockups of accountant / teacher pages may keep the starter's admin bottom bar.

## Addendum 2 — main moved (PR #1407, Epic 47.0 "Class teacher & My class", merged 2026-10-04)

- Read app code from the worktree at current main: `SCRATCH/main-wt` (path given in your brief), NOT the
  original checkout (it is one commit behind). Run `shoot.mjs` from the ORIGINAL repo root (the
  worktree has no `node_modules`): `cd <original repo> && node .claude/skills/redesign-page/scripts/shoot.mjs <mockup>`.
- What the PR added: `teacher_class_sections.assignment_type` (class teacher / assistant class teacher /
  subject teacher), the assign-teacher dialog with a role choice and a "replace" warning (409 body
  `{ message, details: { code } }`), role display in the class Teachers tab and staff teaching
  assignments, the `MY_CLASS_VIEW` permission (TEACHER only), new routes `/my-class` and
  `/my-class/$sectionId` (`client-admin/src/routes/_staff/my-class/`), a new namespace `myClass`,
  a sidebar item, a palette action "Take my class attendance", `GET /my-class/sections`,
  `GET /attendance/sections/:id/streaks`.
- See the change to one file with: `git -C SCRATCH/main-wt show 1bb014b4 -- <path>`.
