# Foundation tickets (Epic 31.0 waves 1, 2, 3, 5) — brief for the drafting agents

You write plan-grade GitHub sub-issue bodies. You change NO app code. A cheaper model (Sonnet,
low effort) implements each ticket later with no other context, so every ticket names exact files,
the existing thing to clone, and concrete steps. Read the real code before writing — never state
a path, prop or line you did not look up.

Repo: <repo> (rule: one `graphify query` to orient
before grepping; prefix shell commands with `rtk`).
PLAN = PLAN

Read first: `PLAN/kit/DECISIONS.md` (D1–D40), `PLAN/kit/patterns.md` (component names, props,
classes — this IS the spec you turn into tickets), `PLAN/kit/conflicts.md` (C1–C24: where the kit
meets today's code/docs, with file:line), `PLAN/kit/BUGS.md` (confirmed bug causes and owners),
`PLAN/kit/nav-icons.md`, and `<repo>/.plan-epic-31-ux-retrofit.md`
("Verified today" sections — facts with file:line). Look at `PLAN/kit/desktop.png`/`mobile.png`
crops in `PLAN/kit/crops/` when you need to see a pattern; markup is in `PLAN/kit/patterns.html`
(`grep -n "PATTERN:"`).
Package conventions: read `ui/CLAUDE.md`, `client-admin/CLAUDE.md`, `server/CLAUDE.md` if they exist.

## The whole ticket list (so you know your neighbours — files must not overlap inside a wave)

Wave 1 — scaffold (two tickets, file-disjoint)
- 31.1.1 ui — tokens & base rules: spacing tokens (D17), `--color-destructive-foreground` (D31), global cursor rule (D18), phone density rule (C2), radius alignment (C10) in `ui/src/styles/globals.css`; spacing-scale section + C2–C4 edits in `docs/architecture/09-design-direction.md`.
- 31.1.2 ui — scaffold: create every NEW component/util file as a typed, exported, minimal working stub with its final props (PageHeader, PageContainer, RowActions, TableCount, FullPageShell, MonthPicker, TimeInput, ConfirmDialog, AuthLayout, FilterSheet, formatter function signatures…), add the exports to `ui/src/components/index.ts`, `ui/src/shells/index.ts`, `ui/src/utils/index.ts`, and add ALL new shared strings to `ui/src/i18n/locales/{en,bn}/common.json`. After this ticket no wave-2 ticket touches an `index.ts` or `common.json`.

Wave 2 — ui foundation (parallel lanes; each ticket owns its files)
- 31.2.1 ui — formatters: `formatDate` long form + `formatDateTime`, `formatMonth`, `formatTime`, `toIsoDate`, `formatNumber`/digits, i18next `{{count}}` numerals, `formatPhone` (D5–D8, B19, B22, B24) — `ui/src/utils/{date,number,digits,currency,phone}.ts`, `ui/src/i18n/i18n.ts`.
- 31.2.2 ui — DatePicker, MonthPicker, TimeInput (D25, D26) — `ui/src/components/{date-picker,month-picker,time-input}.tsx`.
- 31.2.3 ui — Calendar: MonthGrid + AgendaList + routine grid/agenda times (D26, B21) — `ui/src/components/calendar/**`, `routine-grid.tsx`, `routine-agenda.tsx`, `attendance-month-grid.tsx`.
- 31.2.4 ui — DataTable: RowActions, TableCount, total in footer and cards, page size 25, empty → no pager (D19, B23) — `ui/src/components/{data-table,data-table-cards,pagination,table,row-actions,table-count,tooltip}.tsx`, `ui/src/routes/use-list-url-state.ts`, `e2e/pages/list-shell.ts`.
- 31.2.5 ui — shells: PageContainer + PageHeader in List/Detail/Form/Wizard shells; tabs fix, left-aligned scrolling tab strip (D15, D16, D20, B1) — `ui/src/shells/{list-shell,detail-shell,form-shell,wizard-shell,page-header,page-container,use-detail-shell-tab}.tsx|ts`, `ui/src/primitives/tabs.tsx`, `e2e/pages/{detail-shell,form-shell}.ts`.
- 31.2.6 ui — Dialog sizes + padding, ConfirmDialog, FullPageShell (D17, D21, D22) — `ui/src/primitives/dialog.tsx`, `ui/src/components/{dialog,confirm-dialog}.tsx`, `ui/src/shells/full-page-shell.tsx`.
- 31.2.7 ui — FilterBar labels + phone sheet + chips; Select/Combobox empty width + placeholder; FormField required/help (D24, D25) — `ui/src/shells/{filter-bar,use-filter-bar-state}.ts(x)`, `ui/src/components/{filter-sheet,select,combobox,form-field,label}.tsx`.
- 31.2.8 ui — states & buttons: EmptyState (no h1, C17), ErrorState, Skeleton, StatusBadge tones+icons, translated router error fallback, toast offset above the bottom bar, Button variants incl. `danger` (D27–D29, C4) — `ui/src/components/{empty-state,error-state,skeleton,status-badge,route-error-boundary,route-status-state,route-pending,toast,button,card}.tsx`, `ui/src/primitives/button.tsx`.
- 31.2.9 ui — AppShell: sidebar single-active + group resync, phone top bar, drawer with sticky close, breadcrumbs phone separator, account menu contents (D10–D13, B2, B3, B17, #879) — `ui/src/components/{app-shell,app-header,breadcrumbs,user-menu,locale-switcher,theme-toggle,tenant-bar}.tsx`, `e2e/pages/app-shell.ts`.
- 31.2.10 ui — BottomNav fixed + page reserve, bell badge (D14, D31, B4, B5) — `ui/src/components/{bottom-nav,notification-bell}.tsx`. Same lane as 31.2.9 (runs after it; it also edits the bottom-nav slot and main padding in `app-shell.tsx`).
- 31.2.11 ui — notifications: persisted client store + infinite list (D4) — `ui/src/api/notification-state.ts`, `ui/src/api/notify.ts`, `ui/src/hooks/notifications.ts`, `ui/src/components/notification-list.tsx`.
- 31.2.12 ui — AuthLayout for signed-out pages (D34, C22) — `ui/src/components/auth-layout.tsx`, `ui/src/components/{sign-in-form,otp-sign-in-form,set-password-form,school-picker}.tsx` only where the layout wrapper lives there.
- 31.2.13 wave close — stories for every new/changed component, unit + client-admin test fallout from the formatter/table/tabs changes (≈20 client-admin tests assert numeric dates), `yarn test` green; no route redesign.

Wave 3 — app layouts, wording, shared fixes (parallel lanes)
- 31.3.1 client-admin — staff layout: icons for all nav items, per-role bottom-bar cells, phone top-bar slots, chromeless ↔ FullPageShell wiring — `client-admin/src/routes/_staff.tsx`, `client-admin/src/nav-tree.ts`, `client-admin/src/components/{staff-user-menu,command-palette-launcher}.tsx`.
- 31.3.2 client-admin — portal layout on the same shell rules (D33, C21): one-row phone header, language in account menu, single active item, crumbs — `client-admin/src/routes/portal.tsx`.
- 31.3.3 client-admin — platform console inside AppShell (D33): nav (Schools, Holiday sets), crumbs, bottom bar — `client-admin/src/routes/_platform/route.tsx`.
- 31.3.4 i18n — glossary + shared labels: `nav.json`, `common.json` entities/enums, the missing crumb keys (B15), jargon renames across namespaces (D32), enum labels for Father/Mother/CASH/None/Partial/Full/Active (D9), `bulkImport.json` — locale files only, en + bn. This is the ONLY wave-3 ticket touching `ui/src/i18n/locales/**`. Includes a glossary table (old → new, en + bn) that page tickets apply inside their own namespaces.
- 31.3.5 client-admin — breadcrumbs: entity resolvers for the 8 UUID crumbs, skeleton instead of id, crumbs only at 2+ levels (B16, C5, C7) — `client-admin/src/{use-breadcrumbs,route-crumbs}.ts` (+ tests). Runs after 31.3.4 (needs its keys).
- 31.3.6 ui — no permission toast on page open (B8): gate `useTenantRegionConfig` on the permission, make background-query 403s silent — `ui/src/i18n/use-tenant-region-config.ts`, `ui/src/api/query-client.ts`.
- 31.3.7 server + api types — list responses carry names: holiday-set list loads entries (B7), intake list returns class + section names (B12), audit log returns `entity_label` (B14); regenerate `ui/src/api/schema.d.ts`. Follow `server/CLAUDE.md` test standards and the multi-tenancy rules (tenant-scoped joins only).
- 31.3.8 wave close — e2e shell specs (`e2e/responsive/{drawer,staff-mobile-nav}.spec.ts`, `e2e/sticky-header.spec.ts`, `e2e/focus-management.spec.ts`, smoke), full unit + e2e pass, visual check in en + dark. Every page ticket depends on this one.

Wave 4 — page redesigns (child epic; 87 tickets in 25 lanes; not yours)

Wave 5 — close-out (after wave 4)
- 31.5.1 client-admin — palette registry (D35): register the create/record dialogs, allow-list the rest of the 75 `UNREGISTERED_ACTIONS` with a reason — `client-admin/src/{action-registry,unregistered-actions}.ts` (+ tests).
- 31.5.2 e2e — one keyboard journey per nav group for the 26 uncovered nav routes (D36) — `e2e/keyboard/*.spec.ts`.
- 31.5.3 guards (D37): lint rules / CI checks + their tests — find where the repo's ESLint config and custom checks live (`ui/scripts/check-i18n-keys.mjs` is the pattern to clone).
- 31.5.4 docs: `docs/architecture/15-ux-principles.md` (C5, C6, registries table), `09-design-direction.md` remaining edits, `06-frontend-architecture.md` component list; update `.claude/skills/redesign-page/starter.html` from `PLAN/kit/starter.html`. Follow the repo's documentation style (diagram over paragraph, concrete example).
- 31.5.5 epic close: run every sweep (`--project=chromium-sweeps`: a11y, reflow, target-size) on all manifest routes, en + bn, light + dark; fix or file what fails; update visual baselines.

## Ticket file format

Write each ticket to `PLAN/foundation/<code>-<slug>.md`, e.g. `PLAN/foundation/31.2.4-datatable.md`:

```markdown
# [31.2.4] ui — DataTable: icon row actions, total count, page size 25

## Goal
one sentence — what "done" means
## Files
- path (new | changed) — what
## Steps
1. ordered, concrete; name the existing thing to clone by path; quote the classes/props from patterns.md; cite file:line for what changes
## Tests
- <file>: <cases>
## Acceptance
- [ ] …
Wave: 2   Decisions: D19, D23   Depends on: 31.1.2   (or "—")
```

Rules:
- Sonnet-low sized: ≤ ~15 files, one afternoon. If a ticket in the list is bigger, split it into
  `31.2.4a` / `31.2.4b` with DISJOINT files (or say they share a lane and run in order) and report it.
- Never restate a decision — cite `Dn`. Cite conflicts as `Cn`, bugs as `Bn`.
- Backward compatible wherever possible: wave-2 changes must not require any route file to change
  in the same wave (pages are redesigned later in wave 4). When a change does alter what existing
  pages render (formatDate output, DataTable footer, tabs), say which tests break and that
  31.2.13 fixes them — or fix them in your ticket if they sit in your files.
- If the file lists above are wrong (a file does not exist, a needed file is missing, two tickets
  need the same file), fix your ticket's `## Files` to reality and REPORT the change in your final
  message so the lane table can be corrected. Do not silently share a file with a neighbour ticket.
- New props must match `patterns.md`. If the code makes a prop in patterns.md impossible or wrong,
  write the working alternative and report it.

Final message (terse): per ticket `file | title | files count | size S/M/L`, then every deviation
from the list above (splits, moved files, changed props), then open questions.
