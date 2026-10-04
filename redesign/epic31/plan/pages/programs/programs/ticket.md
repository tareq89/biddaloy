# [31.4.programs-1] Programs list — subtitle, short table, row actions

## Goal
`/programs` shows a kit page header with one primary, a visible "show archived" checkbox, and a short unpaginated table with the program's description, tenant numerals, a readable report-card column and icon row actions.

## What and why
The page lists the school's programs (Hifz, clubs, courses) so staff can open one and track students' milestones. Today the name is an underlined link with no context, counts are Latin digits, the report-card column is a bare "✓" or blank, there are no row actions, and a pager ("১ পাতার মধ্যে ১ নম্বর পাতা" + 25) sits under a list of two rows. The redesign adds a one-line subtitle, the description under each name, a total instead of a pager, view/edit icons, and a status column only when archived programs are shown.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/programs/programs/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/programs/programs/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/programs/programs/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/programs/programs/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title "প্রোগ্রাম" + **New** subtitle "শিক্ষার্থীর অগ্রগতি মাইলস্টোন ধরে দেখুন।"; primary "প্রোগ্রাম যোগ করুন" with `plus` icon. | D16 — page says what it is for |
| 2 | Archived toggle | The `FilterBar` with one checkbox becomes a plain kit Checkbox row above the table, label "আর্কাইভ করা প্রোগ্রামও দেখান" (changed text). Still drives the `archived` URL filter. | D24 phone rule would hide a single checkbox behind a "ফিল্টার" button |
| 3 | Table | `paginated={false}`; footer "মোট ৪টি" (`TableCount`). The client-side pager goes. | D19 — short reference list |
| 4 | Name cell | Link `font-medium text-text-primary hover:text-primary` (no underline) + description below in `text-caption text-text-secondary` (one line, truncated; desktop only). | D19; names alone said nothing |
| 5 | Counts | মাইলস্টোন / সক্রিয় শিক্ষার্থী through `formatNumber`, `align: 'end'`. | D6, B24 |
| 6 | Report card column | Header "রিপোর্ট কার্ডে" (changed); cell "হ্যাঁ" / "না" (**New** keys) instead of "✓" / blank. | D9 — a blank cell read as "no data" |
| 7 | Status column | **New** column "অবস্থা" with `StatusBadge` (success "সক্রিয়" / neutral "আর্কাইভড"), rendered only when the archived checkbox is on. | D27; when only active programs show, a column of "সক্রিয়" is noise |
| 8 | Row actions | `rowActions`: view → `/programs/$programId`; edit (only with `PROGRAM_MANAGE`) opens the existing `ProgramFormDialog` in edit mode. | D19 |
| 9 | Empty state | `emptyState` with `milestone` icon, title "এখনও কোনো প্রোগ্রাম নেই" (changed), sentence (**New**), outline action "প্রোগ্রাম যোগ করুন" (manage only). | D28 |

## Mobile behaviour
- Primary is full width under the title; no More menu (nothing else to put in it).
- Checkbox row stays visible (44 px target).
- Table becomes the kit's compact two-line rows in one Card: name (44 px link) over "৩০টি মাইলস্টোন · ৫ জন সক্রিয়"; view + edit icons on the right. Description hidden.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Paging | keep client pager / unpaginated | unpaginated | A school runs a handful of programs; the list is already loaded whole (`usePrograms` has no paging). |
| Archived filter | FilterBar field / plain checkbox | plain checkbox | One boolean; FilterBar on phone hides fields behind a button and this page has no search. |
| Status column | always / only with archived shown | only with archived shown | Without archived rows every badge would be "সক্রিয়". |
| Edit from the list | none / row edit icon | row edit icon | Renaming a program should not need a detail visit; reuses the existing dialog, no new feature. |

## Files
- `client-admin/src/routes/_staff/programs/index.tsx` — header, checkbox, columns, rowActions, unpaginated table, empty state, edit dialog state
- `ui/src/i18n/locales/bn/programs.json`, `ui/src/i18n/locales/en/programs.json` — keys below
- `client-admin/src/routes/_staff/programs/index.test.tsx` — update

## Steps
1. **Header.** Pass `subtitle={t('list.subtitle')}` to `ListShell` (prop added by 31.2.5a; it renders `PageHeader`). Primary action stays `canManage &&` a `Button` with `<PlusIcon />` + `t('actions.add')`.
2. **Archived checkbox.** Remove the `filters` prop and `filterFields`. Above the table render the kit Checkbox row (`patterns.md` §6 "Checkbox row": `flex min-h-11 items-center gap-3 md:min-h-8`) using `Checkbox` from `@biddaloy/ui` with `checked={includeArchived}` and `onCheckedChange={(c) => actions.setFilters({ ...state.filters, archived: c === true ? 'true' : undefined })}`, label `t('list.showArchived')`. Pass that row through `ListShell`'s existing `filterBar` slot (`filterBar={<label …>…</label>}`) — no wrapper with its own padding or `max-w-*`.
3. **Columns.**
   - `name`: `<Link to="/programs/$programId" params={{ programId: row.id }} className="inline-flex min-h-11 items-center font-medium text-text-primary hover:text-primary md:min-h-0">{row.name}</Link>` then, when `row.description`, `<span className="hidden truncate text-caption text-text-secondary md:block">{row.description}</span>`, then the phone summary `<span className="block text-caption text-text-secondary md:hidden">{t('list.mobileSummary', { milestones: formatNumber(…), students: formatNumber(…) })}</span>`. `card: 'title'`. Keep it a real link (the keyboard spec tabs to it).
   - `milestones` / `activeStudents`: `formatNumber(row.milestone_count ?? 0, regionConfig)` / `formatNumber(row.active_enrollment_count ?? 0, regionConfig)`, `align: 'end'`, `card: 'hidden'` (the phone summary line in the name cell carries them). Get `regionConfig` from `useTenantRegionConfig()` (same as `academic-years/index.tsx`).
   - `reportCard`: header `t('list.columns.reportCard')`, cell `row.show_on_report_card ? t('list.yes') : t('list.no')`, `card: 'hidden'`.
   - `status` (**New**, only `if (includeArchived)`): `<StatusBadge tone={row.is_active ? 'success' : 'neutral'} label={row.is_active ? t('status.ACTIVE') : t('detail.archivedBadge')} />`.
   - `status` column: `card: 'badge'`.
4. **Table.** `paginated={false}`; drop `page`, `pageSize`, `onPageChange`, `onPageSizeChange`, `pageSizeLabel`, `totalCount`, and the `limit: 25` in `useListShellState`. Keep `sorting`.
5. **Row actions.** `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/programs/${row.id}` }, { intent: 'edit', label: t('formDialog.editTitle'), allowed: canManage, onClick: () => setEditing(row) }]}` with `const [editing, setEditing] = React.useState<Program | null>(null)`. Render `{canManage && editing && <ProgramFormDialog open mode="edit" program={editing} onOpenChange={(o) => !o && setEditing(null)} onSaved={() => setEditing(null)} />}`.
6. **Empty state.** Replace `emptyMessage` with `emptyState={{ icon: <MilestoneIcon />, title: t('list.empty'), explanation: t('list.emptyExplanation'), action: canManage ? { label: t('actions.add'), onClick: () => navigate({ search: { ...search, new: '1' } }) } : undefined }}`.
7. Keep the `?new=1 / ?enrol=1 / ?record=1 / ?student=` search contract and the three dialogs exactly as they are (command palette depends on them).
8. **i18n** (`programs.json`):

   | Key | bn | en |
   |---|---|---|
   | `list.subtitle` (**New**) | শিক্ষার্থীর অগ্রগতি মাইলস্টোন ধরে দেখুন। | Track students' progress milestone by milestone. |
   | `list.showArchived` (changed) | আর্কাইভ করা প্রোগ্রামও দেখান | Also show archived programs |
   | `list.columns.reportCard` (changed) | রিপোর্ট কার্ডে | On report card |
   | `list.columns.status` (**New**) | অবস্থা | Status |
   | `list.yes` / `list.no` (**New**) | হ্যাঁ / না | Yes / No |
   | `list.view` (**New**) | দেখুন | View |
   | `list.mobileSummary` (**New**) | {{milestones}}টি মাইলস্টোন · {{students}} জন সক্রিয় | {{milestones}} milestones · {{students}} active |
   | `list.empty` (changed) | এখনও কোনো প্রোগ্রাম নেই | No programs yet |
   | `list.emptyExplanation` (**New**) | হিফজ, ক্লাব বা কোর্সের জন্য একটি প্রোগ্রাম যোগ করুন, তারপর তার মাইলস্টোন ঠিক করুন। | Add a program for Hifz, a club or a course, then set its milestones. |

## Tests
- `programs/index.test.tsx`: subtitle renders; counts render in Bangla digits under bn; report card shows "হ্যাঁ"/"না"; no pager, "মোট ২টি" shown; status column absent by default and present after ticking the checkbox (and the URL gets `archived=true`); edit icon hidden without `PROGRAM_MANAGE`, opens the edit dialog with it; empty list shows the EmptyState with an outline button.
- `e2e/keyboard/programs.spec.ts` and `e2e/journeys/programs.spec.ts`: re-run — the name stays a link with the program name, so `getByRole('link', { name })` and `tabUntilFocused(..., { tag: 'A' })` keep working. No edit expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No pager; "মোট n টি" under the table.
- [ ] Name is not underlined; description shows under it on desktop.
- [ ] Report-card column reads "হ্যাঁ"/"না"; no "✓".
- [ ] Ticking "আর্কাইভ করা প্রোগ্রামও দেখান" adds the status column with badges.

## Out of scope
- `ProgramFormDialog` layout, archive and delete — programs-2a (detail page) owns that change.
- Sidebar label "প্রোগ্রাম ও মাইলস্টোন" → "প্রোগ্রাম" is already done by 31.3.4a.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: programs   Decisions: D6, D9, D16, D19, D24, D27, D28   Depends on: 31.3.8b
