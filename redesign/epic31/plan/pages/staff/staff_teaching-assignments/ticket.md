# [31.4.staff-3] Teacher assignments — one card per section, assign beside it

## Goal
`/staff/teaching-assignments` matches the "after" screenshots: a labelled class picker that opens on the first class, then one card per section with its own "শিক্ষক দিন" button and an unpaginated table of that section's teachers with an icon remove action.

## What and why
The page answers "who teaches what in each section of a class" and lets an admin add or remove a teacher there. Today it opens on an empty table with column headers and a pager, the class picker has no visible label, and the "Assign teacher" button acts on a section chosen in a second, unlabelled picker that only appears for classes with 2+ sections — the control is far from what it changes. The redesign shows the first class straight away, groups teachers by section, and puts "শিক্ষক দিন" on each section's card, so the second picker goes away.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_teaching-assignments/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_teaching-assignments/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_teaching-assignments/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_teaching-assignments/mobile.webp?raw=true" width="260"> |

The "after" shots show class সপ্তম with three sections: two with teachers (section ক has a class teacher, an assistant class teacher and three subject teachers), one empty.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title "শিক্ষকের দায়িত্ব" (renamed by 31.3.4b), **New** subtitle "কোন শাখায় কে শ্রেণি শিক্ষক, কে কোন বিষয় পড়ান". No header action. Crumbs as the layout renders them (কর্মী › শিক্ষকের দায়িত্ব). | D16, D32 |
| 2 | Class picker | One labelled `FormField` "শ্রেণি" (`md:w-72`) with the kit Select. With no `classId` in the URL the page shows the **first class** (no URL write); the "একটি শ্রেণি নির্বাচন করুন" option and the empty starting table go away. | D25; nothing useless on screen |
| 3 | Section picker | Removed. | It only chose the target of "Assign"; that is now per card (#4). |
| 4 | Section cards | One Card per section of the class (`overflow-hidden`): header row `শাখা {name}` (`h2 text-h2`) + outline "শিক্ষক দিন" (`user-plus`, only with `CLASS_MANAGE`) which opens `AssignTeacherDialog` for that section. | Control next to what it changes |
| 5 | Table | Per card an unpaginated `DataTable`: শিক্ষক (name `font-medium` + employee id `text-caption text-text-secondary`), দায়িত্ব = the row's `assignment_type` through `classes.json` `assignmentType.*` (শ্রেণি শিক্ষক / সহকারী শ্রেণি শিক্ষক / বিষয় শিক্ষক — as main already does since #1407), বিষয় (`—` when none), কাজ = `RowActions` `remove` "দায়িত্ব থেকে সরান" (was a red underlined text button). Rows keep main's order: class teacher, assistants, then subject teachers (`sortByAssignmentType`). Footer "মোট n জন". Section column removed (the card says it). | D19, D9 |
| 6 | Empty section | Inside the card: `EmptyState` (icon `users-round`, "এখনও কেউ নেই", "এই শাখায় এখনও কোনো শিক্ষককে দায়িত্ব দেওয়া হয়নি।", no action — the card header has it). | D28 |
| 7 | No classes / errors | No classes → page-level `EmptyState` "এখনও কোনো শ্রেণি নেই" with outline link "শ্রেণি যোগ করুন" to `/classes`. Class list error and per-section errors → `ErrorState` with Retry (per section inside its card). | D28 |
| 9 | Replace warning | The card's "শিক্ষক দিন" passes that section's current class teacher to `AssignTeacherDialog` (`currentClassTeacher`), so picking a different class teacher shows the dialog's existing warning "{{name}} আর শ্রেণি শিক্ষক থাকবেন না…" here too (today it shows only on the class Teachers tab). No dialog edit — it is a prop the dialog already has. | The server silently replaces the class teacher (47.0 D3); the admin should see it before saving |
| 8 | Remove confirm | `ConfirmDialog` `tone="danger"`: title "দায়িত্ব থেকে সরাবেন?", description "{{teacherName}}-কে শাখা {{sectionName}}-এর দায়িত্ব থেকে সরানো হবে।", confirm "সরান". | D29, kit ConfirmDialog |

## Mobile behaviour
- Class picker full width (44 px).
- Each section card: title + "শিক্ষক দিন" (outline, 44 px) on one row; teacher rows are the compact two-line rows of `PATTERN: DataTable (unpaginated)` — name, then "employee id · role · subject" — with the remove icon (44 px) at the end.
- No bottom action bar; each card owns its action.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where "assign" lives | Header primary + section picker · header primary + a section step · one button per section card | Per section card | `AssignTeacherDialog` (classes lane, not editable here) takes one fixed `sectionId`; a per-card button gives it without any picker. |
| Page primary | Keep a filled header button · none | None (outline per card) | There is no page-wide action left; several filled buttons would break D29. Acceptance: at most one filled primary. |
| Starting class | Empty prompt · first class | First class, not written to the URL | Shows data at once; the URL still records an explicit choice. |
| Grouping | One table with a section column · one table per section | One per section | Matches how a head teacher reads it; the empty section is visible instead of missing. |
| Role display | StatusBadge · labelled column | Labelled "দায়িত্ব" column (phone: in the subtitle line) | A role is not a state — D27 tones (success/warning/…) would read as a status; the column header labels it, and main's sort puts the class teacher first. |
| Replace warning on this page | Leave out · pass `currentClassTeacher` | Pass it | Data is already loaded per card (`q.data`); one prop keeps the PR's D3 warning on every place that can replace a class teacher. |
| Teacher link to staff detail | Add · leave out | Leave out | Rows carry `teacher_id`, not the user id the detail route needs (API change, D1). |

## Files
- `client-admin/src/routes/_staff/staff/teaching-assignments.tsx` — picker, per-section cards, RowActions, ConfirmDialog
- `client-admin/src/routes/_staff/staff/teaching-assignments.test.tsx` — update assertions
- `ui/src/i18n/locales/bn/teacherAssignments.json`, `ui/src/i18n/locales/en/teacherAssignments.json` — keys below

## Steps
1. **Shell.** Replace `ListShell` with a plain page: `<PageContainer size="wide">` (from `@biddaloy/ui/shells`, kit pattern PageContainer) → `<PageHeader title={t('list.title')} subtitle={t('list.subtitle')} />` → picker → cards in `div className="space-y-6"`. Drop `useListShellState`; keep the class in the URL with the route's search: add `validateSearch: z.object({ classId: z.string().uuid().optional().catch(undefined) })` and read/write it with `Route.useSearch()` / `navigate({ search: { classId } })`. (Same param name as today's filter key, so old links keep working.)
2. **Effective class.** `const classes = classesQuery.data ?? []; const effectiveClassId = search.classId ?? classes[0]?.id;` Delete `NO_CLASS` and its `SelectItem`. While `classesQuery.isLoading` render a `Skeleton` card; if `classes.length === 0` render `EmptyState` (`list.noClassesTitle`, `list.noClassesExplanation`, action `{ label: t('list.addClass'), to: '/classes' }`).
3. **Picker.** `<div className="md:w-72"><FormField label={t('list.classLabel')} htmlFor="ta-class"><Select value={effectiveClassId} onValueChange={(v) => { navigate({ search: { classId: v } }); setUnassigning(null); }}><SelectTrigger id="ta-class">…`. Remove the section `Select` and `assignSectionId` state's picker role (keep the state, set from the card button).
4. **Cards.** `sections.map((section, i) => { const q = sectionTeacherQueries[i]; … })`: `<section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">`; header `div className="flex items-center justify-between gap-4 p-4 md:px-5 md:py-4"` with `<h2 className="text-h2">{t('list.sectionTitle', { name: section.section_name })}</h2>` and, when `canManage`, `<Button variant="outline" onClick={() => { setAssignSectionId(section.id); setAssignOpen(true); }}><UserPlusIcon />{t('list.assign')}</Button>`. Body: `q.isError` → `ErrorState` (`list.errorMessage`, retry `q.refetch`); else `DataTable` `tableId={`teacher-assignments-${section.id}`}` `caption={t('list.sectionCaption', { name: section.section_name })}` `data={q.data ?? []}` `loading={q.isLoading}` `paginated={false}` `getRowId={(r) => r.id}` `sorting={null}` `onSortingChange={() => {}}` `emptyState={{ title: t('list.emptyTitle'), explanation: t('list.emptyMessage') }}` and the columns of Changes #5: `teacher` (`card: 'title'`, cell = name + `<span className="block text-caption text-text-secondary">{row.employee_id}</span>`), `role` (header `t('list.columnDuty')`, cell `tClasses(`assignmentType.${row.assignment_type}`)` — keep main's `const { t: tClasses } = useTranslation('classes')`; never branch on `subject_id`), `subject` (`row.subject_name ?? '—'`). `data={sortByAssignmentType(q.data ?? [])}` (keep main's import from `../classes/-assign-teacher-dialog`; the per-card table has no column sorting). `rowActions={(row) => [{ intent: 'remove', label: t('list.unassign'), allowed: canManage, onClick: () => setUnassigning({ ...row, classId: effectiveClassId! }) }]}`.
5. **Assign dialog.** Mount once: `{canManage && effectiveClassId && assignSectionId && <AssignTeacherDialog open={assignOpen} onOpenChange={setAssignOpen} classId={effectiveClassId} sectionId={assignSectionId} currentClassTeacher={currentClassTeacher} onAssigned={() => setAssignOpen(false)} />}` (component from `../classes/-assign-teacher-dialog`, not edited here). Compute `const assignIndex = sections.findIndex((s) => s.id === assignSectionId); const ct = sectionTeacherQueries[assignIndex]?.data?.find((a) => a.assignment_type === 'CLASS_TEACHER'); const currentClassTeacher = ct && { teacherId: ct.teacher_id, name: ct.full_name };` — same shape `classes/-detail/teachers-tab.tsx` (`AssignDialogForSection`) passes on main. The dialog owns the role radios, the replace warning and the translated 409 text.
6. **Unassign confirm.** Replace the hand-built `Dialog` with `<ConfirmDialog open={unassigning !== null} onOpenChange={(o) => !o && setUnassigning(null)} tone="danger" title={t('unassignDialog.title')} description={t('unassignDialog.description', { teacherName, sectionName })} confirmLabel={t('unassignDialog.confirm')} cancelLabel={t('unassignDialog.cancel')} busy={unassignTeacher.isPending} onConfirm={() => unassignTeacher.mutate({...}, { onSuccess: () => setUnassigning(null) })} />`; on mutation error close nothing and render `<p role="alert" className="flex items-center gap-1 text-caption text-destructive"><CircleAlertIcon className="size-4" />{t('unassignDialog.errorMessage')}</p>` directly under the picker (page level, ConfirmDialog has no error slot) — never the server text.
7. **i18n** (`teacherAssignments.json`, bn / en; `list.title` is already renamed by 31.3.4b — do not touch):
   - add `list.subtitle` "কোন শাখায় কে শ্রেণি শিক্ষক, কে কোন বিষয় পড়ান" / "Who is class teacher and who teaches what, section by section"
   - add `list.sectionTitle` "শাখা {{name}}" / "Section {{name}}"; `list.sectionCaption` "শাখা {{name}}-এর শিক্ষক" / "Teachers of section {{name}}"
   - add `list.columnDuty` "দায়িত্ব" / "Duty" (use it as the `role` column header instead of `list.columnRole`)
   - add `list.emptyTitle` "এখনও কেউ নেই" / "No one yet"
   - change `list.emptyMessage` "এই শাখায় এখনও কোনো শিক্ষককে দায়িত্ব দেওয়া হয়নি।" / "No teacher has been given this section yet."
   - add `list.noClassesTitle` "এখনও কোনো শ্রেণি নেই" / "No classes yet"; `list.noClassesExplanation` "শ্রেণি যোগ করলে এখানে শাখা ও শিক্ষক দেখা যাবে।" / "Add a class and its sections and teachers show up here."; `list.addClass` "শ্রেণি যোগ করুন" / "Add class"
   - change `list.assign` "শিক্ষক দিন" / "Add teacher"; `list.unassign` "দায়িত্ব থেকে সরান" / "Remove from section"
   - change `list.errorMessage` "এই শাখার শিক্ষকদের তালিকা আনা যায়নি।" / "Couldn't load this section's teachers."
   - change `unassignDialog.title` "দায়িত্ব থেকে সরাবেন?" / "Remove this teacher?"; `unassignDialog.description` "{{teacherName}}-কে শাখা {{sectionName}}-এর দায়িত্ব থেকে সরানো হবে।" / "{{teacherName}} will be removed from section {{sectionName}}."; `unassignDialog.confirm` "সরান" / "Remove"; `unassignDialog.unassigning` "সরানো হচ্ছে…" / "Removing…"; `unassignDialog.errorMessage` "সরানো যায়নি। আবার চেষ্টা করুন।" / "Couldn't remove. Try again."
   - leave `list.sectionLabel`, `list.selectClassPrompt`, `list.classPlaceholder`, `list.caption`, `list.columnSection`, `list.columnActions`, `list.announceResults` for the unused-key report — and `list.columnRole`, `list.roleClassTeacher`, `list.roleSubjectTeacher` (unused on main since #1407; role labels come from `classes.json` `assignmentType.*`, do not re-add them here).
8. Remove every inline `text-sm` / `underline` class from the file.

## Tests
- `teaching-assignments.test.tsx`: with no `classId` search the first class's sections render as cards titled "শাখা ক", "শাখা খ"; there is no section picker; each card has its own "শিক্ষক দিন" (hidden without `CLASS_MANAGE`) and clicking it opens the assign dialog for that card's section; a section with no teachers shows "এখনও কেউ নেই" and no pager; the remove icon button "দায়িত্ব থেকে সরান" opens the confirm dialog whose confirm calls the unassign mutation with that row's class/section/assignment ids; a school with no classes shows "এখনও কোনো শ্রেণি নেই"; a card with `CLASS_TEACHER`, `ASSISTANT_CLASS_TEACHER` and `SUBJECT_TEACHER` rows (given in reverse order) lists them class → assistant → subject with the labels "শ্রেণি শিক্ষক", "সহকারী শ্রেণি শিক্ষক", "বিষয় শিক্ষক" (main's fixtures already carry `assignment_type: 'CLASS_TEACHER'` — keep it on every fixture row); opening "শিক্ষক দিন" on a card whose section has a class teacher and picking another teacher shows `classes.assignDialog.replaceWarning` with the current name.
- E2E `e2e/keyboard/teaching-assignments.spec.ts`: still selects the new class by typeahead on the "শ্রেণি" trigger and finds the unassign button by `t('teacherAssignments.list.unassign')` (value changes, key does not); the teacher cell now also holds the employee id — `getByRole('cell', { name: 'Keyboard Teacher' })` matches by substring, keep it. The confirm button key `unassignDialog.confirm` is unchanged. Run it; adjust only if the ConfirmDialog's role is `alertdialog` (`getByRole('dialog')` → `getByRole('alertdialog')`).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (this page has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The page opens on the first class with data; the class picker has a visible label.
- [ ] One card per section, each with its own "শিক্ষক দিন"; no section picker.
- [ ] Remove is a red icon with a tooltip; confirm is a ConfirmDialog with a red confirm button.
- [ ] Each section table shows "মোট n জন" and no pager.
- [ ] The দায়িত্ব column shows all three roles (incl. সহকারী শ্রেণি শিক্ষক), class teacher first.
- [ ] Assigning a new class teacher from a card warns that the current one will be replaced.

## Out of scope
- `AssignTeacherDialog` (`classes/-assign-teacher-dialog.tsx`) belongs to the classes lane (restyled by 31.4.classes-2) — placed, not edited; this page only passes its existing `currentClassTeacher` prop.
- Linking a teacher row to the staff detail page needs the user id in `SectionTeacherAssignment` (API change) — left out.
- Sidebar showing two active items on this page (B2) — foundation 31.2.9.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server user_id on SectionTeacherAssignment | Deferred | — | use the fallback in the ticket (name + employee id, no link) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: staff   Decisions: D9, D16, D19, D25, D28, D29, D32   Depends on: 31.3.8b, 31.4.staff-2c
