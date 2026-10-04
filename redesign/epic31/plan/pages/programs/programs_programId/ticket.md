# [31.4.programs-2a] Program detail — facts header, one primary, kit lists

## Goal
`/programs/$programId` opens with a kit detail header (crumbs, name + status badge, facts, "অর্জন রেকর্ড করুন" as the one primary, Enrol outline, Edit / Archive / Delete in More), and both tabs use kit lists with icon actions, translated dates and a confirm dialog for removals.

Split: this is part **a** (page, tabs, form dialog). Part **b** (`ticket-b.md`, runs after a) turns the Enrol and Record dialogs into full-page modals.

## What and why
Staff open a program to record which milestones each enrolled student has reached and, for admins, to enrol students and maintain the milestone list. Today the header shows a run-on "সক্রিয় শিক্ষার্থী: 5 · মাইলস্টোন: 30" line, "Edit" is the filled button while "Enrol" inside the Students tab is a second filled one, archive and delete hide inside the edit dialog, rows use ▸ / ⋮ / ↑ ↓ text glyphs, the status filter is labelled "তালিকাভুক্ত করুন", the checklist prints ISO dates, and removing a milestone asks inline in a red box. The redesign moves the page's actions into one header, turns the tabs into kit lists and makes every state visible.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/programs/programs_programId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/programs/programs_programId/mobile.webp?raw=true" width="260"> |

(The mockup shows `?tab=students` with the first row expanded.)

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `DetailShell` with `statusBadge` = `StatusBadge` success "সক্রিয়" / neutral "আর্কাইভড" and **New** `facts`: মাইলস্টোন "৩০টি", সক্রিয় শিক্ষার্থী "৫ জন", রিপোর্ট কার্ডে "দেখানো হয়" / "দেখানো হয় না". Replaces `identifiers`. | D16, D6, D27 |
| 2 | Header actions | Outline "শিক্ষার্থী তালিকাভুক্ত করুন" (`user-plus`, manage only) → `?enrol=1`; **primary** "অর্জন রেকর্ড করুন" (`award`, record or manage) → `?record=1`; More: "সম্পাদনা", "আর্কাইভ করুন" / "আর্কাইভ থেকে ফেরান", "মুছে ফেলুন" (danger, last). | D16, D29 — recording is the frequent job, for teachers too |
| 3 | Archive / delete | Leave the edit dialog. Archive toggles at once from More. Delete opens a **New** `ConfirmDialog tone="danger"`; hidden when the program has active enrolments; a 409 shows `formDialog.deleteConflict` in the dialog; success goes to `/programs`. | D29; destructive actions were buried in a form |
| 4 | Edit dialog | `DialogContent size="sm"`; FormField labels, name required; only name, description, report-card checkbox + Cancel / Save. | D21, D25 |
| 5 | Tabs | Line tabs (DetailShell after 31.2.5b); order and ids unchanged (`milestones`, `students`). | D20, B1 |
| 6 | Students tab toolbar | Status Select gets a visible label "অবস্থা" (`w-full md:w-56`); the tab's own Record and Enrol buttons go (header has them). | D24/D25; the select's aria-label was "তালিকাভুক্ত করুন" |
| 7 | Students list | One Card, rows divided: chevron toggle (`chevron-right` / `chevron-down`) + name + "রোল ১২"; `ProgressBar` with label "১২ / ৩০" in tenant digits; `RowActions`: record (`award`) + More with only the transitions that apply (ACTIVE → "সম্পন্ন হিসেবে চিহ্নিত করুন", "প্রত্যাহার করুন"; COMPLETED / WITHDRAWN → "পুনরায় সক্রিয় করুন"). Footer `TableCount` "মোট ৫টি". | D19, D6; "Reactivate" on an active row did nothing |
| 8 | Checklist dates | `achievedOn` passed as `formatDate(achieved_on)` instead of the ISO string. | D5, D9 |
| 9 | Students empty | `EmptyState` (`users-round`), title `studentTab.empty`, **New** sentence, outline "শিক্ষার্থী তালিকাভুক্ত করুন" (manage only). | D28 |
| 10 | Milestones tab | One Card: ordered list with number (tenant digits), name, description; icon buttons `arrow-up` / `arrow-down` (Alt+↑/↓ kept), `RowActions` edit (`pencil`) + delete (`trash-2`). Inline edit form gets FormField labels. Add form at the bottom with a visible label "নতুন মাইলস্টোনের নাম", description field and an **outline** "মাইলস্টোন যোগ করুন". | D19, D25, D29 — the add button was a second filled one |
| 11 | Remove milestone | Inline red box → `ConfirmDialog tone="danger"` with the existing count sentence. | D29 |

## Mobile behaviour
- Crumbs show "প্রোগ্রাম › name"; facts in a 2-column grid.
- Header: primary "অর্জন রেকর্ড করুন" `flex-1` + More; Enrol moves into More (PageHeader does this).
- Student row: line 1 toggle (44 px) with name and roll; line 2 progress bar + count, record icon, More icon.
- Expanded checklist rows are full width under the row.
- Milestone rows: text on top, the four icon buttons on a second line, end-aligned.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| The one primary | Edit (today) / Enrol / Record | Record | Most frequent action and the only one a teacher (`PROGRAM_RECORD`) has. Edit is rare → More. |
| Where archive/delete live | inside edit dialog (today) / header More | header More | D29: a destructive button does not belong in a form; More keeps the header clean. |
| Default tab | switch to Students / keep Milestones | keep | Keeps URLs and the keyboard spec's ArrowRight step; the header primary already covers the daily job. |
| Status transitions | all three always / only valid ones | only valid ones | Showing "Reactivate" on an active row was a no-op. |
| Milestone add | dialog / inline form | inline form, restyled | Keeps the keyboard flow (type, Enter, next) that the e2e spec drives. |

## Files
- `client-admin/src/routes/_staff/programs/$programId.tsx` — facts, status badge, actions, archive toggle, delete ConfirmDialog
- `client-admin/src/routes/_staff/programs/-program-form-dialog.tsx` — size, labels, archive/delete block removed
- `client-admin/src/routes/_staff/programs/-students-tab.tsx` — toolbar, row layout, RowActions, valid transitions, formatted dates, empty state, count
- `client-admin/src/routes/_staff/programs/-milestone-editor.tsx` — Card list, icon buttons, labels, ConfirmDialog
- `ui/src/i18n/locales/bn/programs.json`, `ui/src/i18n/locales/en/programs.json` — keys below (also changed by programs-1, runs earlier)
- `client-admin/src/routes/_staff/programs/$programId.test.tsx`, `-students-tab.test.tsx`, `-milestone-editor.test.tsx`, `-program-form-dialog.test.tsx` — update
- `e2e/keyboard/programs.spec.ts` — new milestone-name label

## Steps
1. **`$programId.tsx` header.**
   - `const canRecord = useHasPermission(Permission.PROGRAM_RECORD) || canManage;` `const regionConfig = useTenantRegionConfig();`
   - Remove `identifiers`. Add `statusBadge={<StatusBadge tone={program.is_active ? 'success' : 'neutral'} label={program.is_active ? t('status.ACTIVE') : t('detail.archivedBadge')} />}`.
   - `facts={[{ label: t('detail.factMilestones'), value: t('detail.milestoneCount', { count: milestoneTotal }) }, { label: t('detail.factActiveStudents'), value: t('detail.studentCount', { count: program.active_enrollment_count ?? 0 }) }, { label: t('detail.factReportCard'), value: program.show_on_report_card ? t('detail.reportCardShown') : t('detail.reportCardHidden') }]}` (counts render in tenant digits through the 31.2.1b i18n number formatter).
   - `actions`: `{ id: 'enrol', label: t('actions.enrol'), icon: <UserPlusIcon />, priority: 'secondary', allowed: canManage, onClick: () => navigate({ search: { ...search, enrol: '1' } }) }`, `{ id: 'record', label: t('actions.record'), icon: <AwardIcon />, priority: 'primary', allowed: canRecord, onClick: () => navigate({ search: { ...search, record: '1' } }) }`, `{ id: 'edit', label: t('formDialog.editTitle'), icon: <PencilIcon />, priority: 'tertiary', allowed: canManage, onClick: () => setEditOpen(true) }`, `{ id: 'archive', label: program.is_active ? t('formDialog.archive') : t('formDialog.unarchive'), icon: <ArchiveIcon /> or <ArchiveRestoreIcon />, priority: 'tertiary', allowed: canManage, onClick: () => updateProgram.mutate({ is_active: !program.is_active }) }`, `{ id: 'delete', label: t('formDialog.delete'), icon: <Trash2Icon />, priority: 'destructive', allowed: canManage && (program.active_enrollment_count ?? 0) === 0, onClick: () => setDeleteOpen(true) }`. `const updateProgram = useUpdateProgram(program.id)` must be called before the early returns (use `programId`).
   - Delete: `<ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} tone="danger" title={t('detail.deleteTitle')} description={deleteConflict ? t('formDialog.deleteConflict') : t('formDialog.deleteConfirm')} confirmLabel={t('formDialog.deleteConfirmButton')} busy={deleteProgram.isPending} onConfirm={() => deleteProgram.mutate(program.id, { onSuccess: () => navigate({ to: '/programs' }) })} />`, `deleteConflict` = `deleteProgram.error instanceof ApiError && deleteProgram.error.statusCode === 409`.
   - Remove the outer `<div className="flex flex-col gap-4">` (use a fragment); keep the `?enrol` / `?record` dialogs exactly as today.
2. **`-program-form-dialog.tsx`.** `DialogContent size="sm"`. Name and description use `FormField` (name `required`). Checkbox in the kit Checkbox row (`flex min-h-11 items-center gap-3 md:min-h-8`). Delete the whole `mode === 'edit' && program &&` block, `useDeleteProgram`, `confirmDelete`, `toggleActive`, `handleDelete`, `deleteConflict`, `hasEnrolments`. Keep create/edit save and `formDialog.errorMessage`.
3. **`-students-tab.tsx` toolbar.** Replace the toolbar with `<FormField label={t('students.statusLabel')} className="md:w-56">` holding the existing `Select` (trigger `w-full`, no `aria-label`). Remove the two buttons, `toolbarRecordOpen` and its `RecordDialog`. Drop the now-unused `onOpenEnrol` prop **only if** the empty state below does not use it — it does, keep it.
4. **Students list.** Wrap in `<div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">`; `<ul className="divide-y divide-border-subtle" aria-label={t('studentTab.listLabel')}>`; after the list `<TableCount total={enrollments.length} />` in `border-t border-border-subtle px-4 py-3`. Empty: `<EmptyState icon={<UsersRoundIcon />} title={t('studentTab.empty')} explanation={t('studentTab.emptyExplanation')} action={canManage ? { label: t('actions.enrol'), onClick: onOpenEnrol } : undefined} />` instead of the `<p>`.
5. **`StudentRow`.** Row `<div className="flex flex-col gap-2 px-2 py-2 md:flex-row md:items-center md:gap-4 md:px-4 md:py-1.5">`:
   - toggle `<button aria-expanded className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-start hover:bg-muted md:min-h-9">` with `ChevronRightIcon` / `ChevronDownIcon` (`size-4 text-text-secondary`), name `truncate font-medium`, roll `shrink-0 text-text-secondary` = `t('students.roll', { roll })` where `roll = /^\d+$/.test(r) ? formatNumber(Number(r), regionConfig) : r`.
   - second part `<div className="flex items-center gap-2 ps-8 md:contents">`: `ProgressBar` in `min-w-0 flex-1 md:w-72 md:flex-none` (only when `showProgress`), label `t('students.progress', { done: formatNumber(…), total: formatNumber(…) })`; then `<RowActions actions={[…]} />`.
   - actions: `{ intent: 'edit', icon: <AwardIcon />, label: t('students.recordFor', { name }), onClick: onRecord }`, and only when `canManage`: if `status === 'ACTIVE'` → `{ intent: 'approve', label: complete ? t('students.completePrompt') : t('students.markComplete'), onClick: () => onStatusChange('COMPLETED') }`, `{ intent: 'remove', label: t('students.withdraw'), onClick: () => onStatusChange('WITHDRAWN') }`; else `{ intent: 'restore', label: t('students.reactivate'), onClick: () => onStatusChange('ACTIVE') }`. Pass `status` from `StudentsTab` into `StudentRow`. With 2–3 actions RowActions shows them as icons; that is fine — do not force a More menu.
   - checklist panel `className="border-t border-border-subtle bg-bg px-2 py-2 md:ps-12 md:pe-4"`; `achievedOn: m.achievement ? formatDate(m.achievement.achieved_on, regionConfig) : null` (keeps the null = not achieved meaning).
6. **`-milestone-editor.tsx`.** Wrap everything in one Card (`overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1`).
   - Empty: `<p className="px-4 py-6 text-center text-text-secondary">{t('milestones.emptyHint')}</p>`.
   - List: `<ol className="divide-y divide-border-subtle" aria-label={t('detail.tabs.milestones')}>` (keep the accessible name — e2e uses it). Row `flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-3`: number `w-6 shrink-0 text-text-secondary tabular-nums` = `formatNumber(index + 1, regionConfig)`, text block `min-w-0 flex-1` (name `font-medium`, description `text-text-secondary`), actions `flex justify-end` with two ghost icon buttons (`ArrowUpIcon` / `ArrowDownIcon`, icon-button classes `size-11 md:size-8 text-text-secondary`, existing aria-labels, `disabled` at the ends, keep `handleKeyDown` on both) then `<RowActions actions={[{ intent: 'edit', label: t('milestones.edit'), onClick: () => startEdit(m) }, { intent: 'delete', label: t('milestones.remove'), onClick: () => setPendingRemoveId(m.id) }]} />`. Read-only users (`!canManage`) get no action column.
   - Inline edit: `FormField label={t('formDialog.nameLabel')}` + `FormField label={t('formDialog.descriptionLabel')}`; buttons Cancel (outline) then Save (primary) in `flex justify-end gap-2`.
   - Remove confirm: `<ConfirmDialog open={!!pendingRemove} onOpenChange={(o) => !o && setPendingRemoveId(null)} tone="danger" title={t('milestones.removeTitle')} description={t('milestones.removeConfirm', { count })} confirmLabel={t('milestones.remove')} busy={removeMilestone.isPending} onConfirm={…} />` replaces the inline `role="alertdialog"` box.
   - Add form: `border-t border-border-subtle p-4 md:p-5`, `grid gap-4 md:grid-cols-2`: `FormField label={t('milestones.nameLabel')}` Input (no placeholder-as-label), `FormField label={t('formDialog.descriptionLabel')}` Textarea; then `Button variant="outline"` with `PlusIcon` + `t('milestones.add')` aligned end.
7. **i18n** (`programs.json`, en + bn):

   | Key | bn | en |
   |---|---|---|
   | `detail.factMilestones` (**New**) | মাইলস্টোন | Milestones |
   | `detail.factActiveStudents` (**New**) | সক্রিয় শিক্ষার্থী | Active students |
   | `detail.factReportCard` (**New**) | রিপোর্ট কার্ডে | On report card |
   | `detail.milestoneCount_one/_other` (**New**) | {{count}}টি | {{count}} milestone / {{count}} milestones |
   | `detail.studentCount_one/_other` (**New**) | {{count}} জন | {{count}} student / {{count}} students |
   | `detail.reportCardShown` / `detail.reportCardHidden` (**New**) | দেখানো হয় / দেখানো হয় না | Shown / Not shown |
   | `detail.deleteTitle` (**New**) | প্রোগ্রাম মুছবেন? | Delete this program? |
   | `students.statusLabel` (**New**) | অবস্থা | Status |
   | `students.roll` (**New**) | রোল {{roll}} | Roll {{roll}} |
   | `students.recordFor` (**New**) | {{name}}-এর অর্জন রেকর্ড করুন | Record achievement for {{name}} |
   | `studentTab.listLabel` (**New**) | তালিকাভুক্ত শিক্ষার্থী | Enrolled students |
   | `studentTab.emptyExplanation` (**New**) | শিক্ষার্থী তালিকাভুক্ত করলে তাদের অগ্রগতি এখানে দেখা যাবে। | Enrol students to see their progress here. |
   | `milestones.nameLabel` (**New**) | নতুন মাইলস্টোনের নাম | New milestone name |
   | `milestones.removeTitle` (**New**) | মাইলস্টোন সরাবেন? | Remove this milestone? |

   Remove unused: `formDialog.deleteDisabledHint`, `milestones.reorderHint`.

## Tests
- `$programId.test.tsx`: facts show counts in Bangla digits; status badge "আর্কাইভড" for an inactive program; Record is the only filled button and is visible for a `PROGRAM_RECORD`-only user, Enrol/Edit/Archive/Delete hidden for that user; Delete hidden when `active_enrollment_count > 0`; Delete confirm calls the mutation and navigates to `/programs`; a 409 shows the conflict sentence.
- `-program-form-dialog.test.tsx`: edit mode no longer renders archive/delete; labels are visible.
- `-students-tab.test.tsx`: status select has the visible label "অবস্থা"; an ACTIVE row's More offers complete + withdraw but not reactivate, a WITHDRAWN row offers only reactivate; expanded checklist shows `formatDate` output, never `2026-01-12`; empty list shows the EmptyState.
- `-milestone-editor.test.tsx`: remove opens a ConfirmDialog with the count sentence; Alt+ArrowDown still reorders; add input is found by label `milestones.nameLabel`.
- `e2e/keyboard/programs.spec.ts`: change `getByRole('textbox', { name: t('programs.milestones.add') })` to `t('programs.milestones.nameLabel')`. `e2e/journeys/programs.spec.ts`: re-run (tab names, `listitem` rows and `button[aria-expanded]` unchanged).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Header shows name + status badge + three facts; no "label: value · label: value" line.
- [ ] No ▸ ▾ ⋮ ↑ ↓ text glyphs anywhere on the page.
- [ ] Archive and delete are in the header More menu, not in the edit dialog.
- [ ] Removing a milestone asks in a ConfirmDialog.

## Out of scope
- Enrol / Record dialogs (native date inputs, student checklist → full-page modal) — part b, `ticket-b.md`.
- `MilestoneChecklist` row height, checkbox look and underlined "undo" link — shared request filed (`ui/src/components/programs/milestone-checklist.tsx`).
- Program description is not shown on the detail page today; left as is (no new content).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| milestone-checklist rows 44/32px, kit checkbox look, ghost Undo, kit tokens | Accepted | 31.2.14b | pass achievedOn already formatted with formatDate; no other change |
| student-route search params for Enrol/Record (students-lane file) | Accepted | 31.5.0 | URLs: /students/<id>?enrolProgram=1 and ?recordMilestone=<enrollmentId>; EnrolDialog/RecordDialog props unchanged |

Wave: 9   Lane: programs   Decisions: D5, D6, D9, D16, D19, D20, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.programs-1
