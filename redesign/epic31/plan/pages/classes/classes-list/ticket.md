# [31.4.classes-1] Classes list — kit table, labelled filters, cleaner class form

## Goal
`/classes` shows one kit table (icon row actions, total, 25 per page) under labelled filters, rows tell same-named classes apart, and the class form dialog follows the kit with no raw server text.

## What and why
The page lists the classes of one academic year so an admin can open, add, edit or delete a class. Today the filters have no visible labels, row actions are underlined text links, grades show Latin digits, two classes with the same name (one per shift) look identical, rows expand into a nested sections table that duplicates the detail page, and the delete dialog can show a server sentence that contains the class's UUID. The redesign uses the kit's FilterBar, DataTable and RowActions, adds shift · version under the name, drops the inline expansion, and makes every message a translated sentence.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/classes/classes-list/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/classes/classes-list/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/classes/classes-list/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/classes/classes-list/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `ListShell` title "শ্রেণি" + one primary "শ্রেণি যোগ করুন" with a `plus` icon; no breadcrumb row (top-level page). | D16, C7 |
| 2 | Filter bar | Kit `FilterBar` with visible labels: শিক্ষাবর্ষ, শিফট, ভার্সন (shift/version only when the tenant has 2+ entries, as today). Non-default choices show as removable chips + "সব মুছুন". Phone: one "ফিল্টার (n)" button opening the sheet. | D24 |
| 3 | Name cell | Name is a plain `font-medium` link (no underline, `hover:text-primary`); **New** second line `text-caption text-text-secondary` with "শিফট · ভার্সন" when either is set. | D29; two "ষষ্ঠ শ্রেণি" rows were indistinguishable |
| 4 | Number columns | গ্রেড, শাখা, শিক্ষার্থী right-aligned, every value through `formatNumber` (grade too); missing grade "—". | D6, D19 |
| 5 | Actions column | `rowActions`: view (link to `/classes/$classId`), edit, delete. Text links "সম্পাদনা/মুছুন" go. | D19 |
| 6 | Inline row expansion | Removed (`expandRowLabel` / `renderExpandedRow`). Sections are managed on the detail page's Sections tab, reached by the view action. | One place per task; nested table was unusable on phone |
| 7 | Pager | Default page size 25 (remove `limit: 10`); footer shows `TableCount`. | D19, B23 |
| 8 | Empty state | `EmptyState` (icon `school`, title, one sentence, outline "শ্রেণি যোগ করুন" when allowed). The backup "migrate a whole school" hint moves into the EmptyState as its `secondaryAction` (ghost link to `/settings?section=backup`). | D28 |
| 9 | Class form dialog | `DialogContent size="md"`; every field a `FormField` with a real `<label>`; name and academic year marked required; select placeholders "বাছুন"; the "no shift / no version" option reads "নেই"; save errors show `classForm.errorMessage`, never `error.message`. | D21, D25, D9 |
| 10 | Delete dialog | Blocked (409) state shows **New** `deleteClassDialog.blockedMessage`; other failures show `deleteClassDialog.errorMessage`; never `error.message` (it contains the class UUID). Confirm button = danger variant. | D9, D29 |

## Mobile behaviour
- Primary "শ্রেণি যোগ করুন" full width under the title.
- Filters behind one outline "ফিল্টার (n)" button (bottom sheet); chips stay visible under it.
- DataTable card mode: title = class name, subtitle = shift · version, fields গ্রেড / শাখা / শিক্ষার্থী, action row with labelled দেখুন / সম্পাদনা / মুছুন.
- Pager stacks under the count.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Inline sections expansion | keep / drop | drop | Detail page already has a Sections tab with the same `SectionsPanel`; the nested table broke the phone card layout and the "one obvious action" rule. |
| Telling duplicate names apart | new columns / subtitle under name | subtitle | No new column for data most schools leave empty; zero width cost. |
| Year filter default | chip for the default year / no chip | no chip | The year select always shows its value; a chip only for non-default choices keeps "সব মুছুন" meaningful. |
| Row action labels | "{name} সম্পাদনা" / plain "সম্পাদনা" | plain | Matches the kit; keeps `getByRole('link', { name: className })` in the keyboard spec unique. |
| Delete blocked text | show server message / one translated sentence | translated sentence | Server text is English and embeds a UUID (D9); counts need a server change (shared request filed). |

## Files
- `client-admin/src/routes/_staff/classes/index.tsx` — FilterBar fields, columns, rowActions, page size, EmptyState, drop expansion
- `client-admin/src/routes/_staff/classes/-class-form-dialog.tsx` — kit dialog form, placeholders, translated errors
- `client-admin/src/routes/_staff/classes/-delete-class-dialog.tsx` — ConfirmDialog look, translated blocked/failed text
- `ui/src/i18n/locales/bn/classes.json` — keys below
- `ui/src/i18n/locales/en/classes.json` — keys below
- `client-admin/src/routes/_staff/classes/index.test.tsx` — update

## Steps
1. **Header.** In `index.tsx` keep `ListShell` (it renders `PageContainer` + `PageHeader`). Pass `primaryAction` as the `PageHeader` action `{ id: 'add', label: t('list.addClass'), icon: <PlusIcon />, priority: 'primary', allowed: canManage, onClick }` (use the prop shape `ListShell` exposes after 31.2; it accepts `PageAction`).
2. **Filters.** Replace the hand-made `<div className="flex flex-wrap …">` of three `Select`s with `FilterBar` `fields`: `{ key: 'academic_year_id', label: t('list.academicYearLabel'), type: 'select', options: [{ value: ALL_VALUE, label: t('list.allAcademicYears') }, …years] }`, then `shift` and `version` (only when `showShiftFilter` / `showVersionFilter`). Keep `ALL_VALUE` (leading space is load-bearing — keep its comment) and the three-state `effectiveAcademicYearId` logic unchanged. Chip text = "label: option label" (never the raw id). Pass `resultCount={classesQuery.data?.total}`.
3. **Columns.**
   - `name`: `<Link to="/classes/$classId" params={{ classId: row.id }} className="font-medium text-text-primary hover:text-primary">{row.name}</Link>` and, when `row.shift || row.version`, `<span className="block text-caption text-text-secondary">{[row.shift, row.version].filter(Boolean).join(' · ')}</span>` (**New**).
   - `grade`: `row.numeric_grade == null ? t('list.noGrade') : formatNumber(row.numeric_grade, regionConfig)`, `align: 'end'`.
   - `sections`, `students`: unchanged values, already `align: 'end'`.
   - Delete the `actions` column object.
4. **Row actions.** Pass `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/classes/${row.id}` }, { intent: 'edit', label: t('list.edit'), onClick: () => setEditing(row), allowed: canManage }, { intent: 'delete', label: t('list.delete'), onClick: () => setDeleting(row), allowed: canManage }]}` (use the router-typed `to` form `RowActions` documents).
5. **Paging.** `useListShellState()` with no `limit` (25 comes from the hook, B23). Remove `pageSizeLabel` if `DataTable` now supplies it.
6. **Drop expansion.** Remove `expandRowLabel`, `renderExpandedRow`, the `SectionsPanel` import and the `list.expandLabel` key. `SectionsPanel` stays for the detail page (classes-2 owns its restyle). Keep `-sections-panel.tsx` on disk — it is listed in `unregistered-actions.ts`.
7. **Empty / error.** Replace `emptyMessage` with `emptyState={{ icon: <SchoolIcon />, title: t('list.emptyMessage'), explanation: t('list.emptyExplanation'), action: canManage ? { label: t('list.addClass'), onClick: () => setCreateOpen(true) } : undefined, secondaryAction: isEmpty && canManageBackup ? { label: tBackup('migrateWholeSchoolLink'), to: '/settings', search: { section: 'backup' } } : undefined }}` and delete the separate `<p>` with the backup link. `error` stays `t('list.errorMessage')` (DataTable renders `ErrorState` with Retry).
8. **Class form dialog** (`-class-form-dialog.tsx`):
   - `<DialogContent size="md">`; wrap each field in `FormField` (`label`, `htmlFor`, `required` for name and — create mode — academic year). Replace the `<span>` labels with the FormField label so every Select trigger is labelled by a real `<label>`.
   - Grade stays a text input with `inputMode="numeric"` (not `type="number"`), placeholder `t('classForm.gradePlaceholder')`.
   - Placeholders: `classForm.academicYearPlaceholder`, `shiftPlaceholder`, `versionPlaceholder` become "বাছুন" / "Select". The `NONE_VALUE` item label becomes `t('classForm.noneOption')` (**New**). Keep `NONE_VALUE` and its comment.
   - Validation and save errors render with the kit error-text style under the form (`role="alert"`, `circle-alert` icon). Server failure: always `t('classForm.errorMessage')` — delete the `mutation.error instanceof Error ? mutation.error.message` branch.
   - Footer: Cancel (outline) then primary save, `loading={mutation.isPending}`.
9. **Delete dialog** (`-delete-class-dialog.tsx`): `DialogContent size="sm"`, `role="alertdialog"`. Keep the three states and the "move students" link. Blocked: `<p role="alert">{t('deleteClassDialog.blockedMessage')}</p>` inside a Card-less block `rounded-md bg-status-overdue-bg p-3 text-status-overdue-fg`. Failed: `t('deleteClassDialog.errorMessage')`. Remove both `deleteClass.error.message` branches. Confirm button: `variant="danger"` with `Trash2Icon`.
10. **i18n** (`classes.json`, both languages):

    | Key | bn | en |
    |---|---|---|
    | `list.view` (**New**) | দেখুন | View |
    | `list.emptyExplanation` (**New**) | প্রথম শ্রেণি যোগ করলে তালিকা এখানে দেখা যাবে। | Classes you add will appear here. |
    | `list.emptyMessage` (changed) | এখনো কোনো শ্রেণি নেই | No classes yet |
    | `classForm.academicYearPlaceholder` / `shiftPlaceholder` / `versionPlaceholder` (changed) | বাছুন | Select |
    | `classForm.noneOption` (**New**) | নেই | Not set |
    | `deleteClassDialog.blockedMessage` (**New**) | এই শ্রেণিতে এখনও শিক্ষার্থী বা শাখা আছে, তাই এটি মোছা যাবে না। আগে শিক্ষার্থীদের সরান এবং শাখাগুলো মুছুন। | This class still has students or sections, so it can't be deleted. Move the students and delete the sections first. |

    Remove now-unused keys: `list.columnActions`, `list.expandLabel`.

## Tests
- `client-admin/src/routes/_staff/classes/index.test.tsx`: assert filters have visible labels (`getByLabelText('শিক্ষাবর্ষ')`); grade renders in tenant numerals; a class with shift/version shows "প্রভাতী · বাংলা" under its name; row actions are buttons/links named দেখুন / সম্পাদনা / মুছুন and hidden without `CLASS_MANAGE` (view stays); no expand button exists; default request has `limit=25`; delete 409 shows `blockedMessage` and does not render the server message; class form save failure shows `classForm.errorMessage`.
- `e2e/keyboard/organisation-structure.spec.ts` (not in Files — updated by 31.5.0): re-run; the flow (tab to "শ্রেণি যোগ করুন", form fields, save, `getByRole('link', { name: className })`, shift filter) must still pass — update only the tab budget numbers if the new eye/edit/delete buttons add stops before the target.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Every filter shows its label; phone shows one "ফিল্টার (n)" button.
- [ ] Row actions are icons with tooltips on desktop, labelled on phone cards; no underlined text links.
- [ ] Two classes with the same name are told apart by the shift · version line.
- [ ] No expand chevron on rows.
- [ ] Footer reads "১–৮ দেখানো হচ্ছে, মোট ৮" style count; 25 rows per page.
- [ ] Deleting a class that still has students shows the translated sentence, never a UUID.

## Out of scope
- Class delete 409 with counts / codes — shared request filed (`classes-list | server classes.service.ts:309-321`).
- `nav.json` "classes": "ক্লাস" (C23) — glossary ticket.
- Restyle of `SectionsPanel` and the section dialogs — classes-2.
- Search box on the list — the API has no search param for classes (D1).
- `e2e/keyboard/organisation-structure.spec.ts` (touched by classes-1 and settings-1a) — updated by 31.5.0 (wave-4 close), not by this ticket; re-run it locally and report a break, do not edit it.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server class delete 409 details.code + count | Deferred | — | use the fallback in the ticket (one translated sentence, no count, never server text) |

Wave: 9   Lane: classes   Decisions: D6, D9, D15, D16, D19, D21, D24, D25, D28, D29   Depends on: 31.3.8b
