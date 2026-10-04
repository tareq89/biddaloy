# [31.4.classes-2] Class detail — facts header, line tabs, kit tables

## Goal
`/classes/$classId` opens with a kit detail header (crumbs, name, key facts, Edit + More), one underline tab row, and every tab's list uses kit tables with icon row actions; the Teachers tab and the shared assign-teacher dialog keep #1407's three roles (class teacher / assistant / subject teacher), replace warning and translated 409s in kit form; editing from this page no longer wipes the class's shift and version.

Size: 17 files (15 + the assign dialog and its test, added after #1407 landed). If that is too much for one afternoon, split the Teachers tab + assign dialog (rows 9 and 13, steps 7 and 7b, their tests) into a `ticket-b.md` that runs after this one.

## What and why
The page is where an admin manages one class: its sections, students, fee structures, teachers and subjects. Today it has a "back to list" link, a "গ্রেড — · year" line instead of facts, pill tabs that wrap, underlined text actions, Latin digits, raw server error text, and a real bug: the Edit dialog opened here is not given the class's shift/version, so saving it sends `shift: null, version: null` and erases them. The redesign uses the kit's DetailHeader, Tabs and DataTable patterns, fixes the bug and translates every message.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/classes/class-detail/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/classes/class-detail/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/classes/class-detail/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/classes/class-detail/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Top | Remove the underlined "শ্রেণি" back link; the layout's breadcrumb "শ্রেণি › <name>" is the way back. | D16 |
| 2 | Header | `DetailShell` with `facts`: গ্রেড, শিক্ষাবর্ষ, শিফট (if set), ভার্সন (if set), শাখা ("৩টি"). Replaces `identifiers`. | D16, D6; "গ্রেড —" was noise |
| 3 | Header actions | Edit = outline with `pencil`; Delete moves into the More menu (danger item, last). No filled button in the header. | D16, D29 |
| 4 | Edit bug | Pass `shift: klass.shift ?? null, version: klass.version ?? null` in the Edit dialog's `initialValues`. | Data loss: saving cleared shift/version |
| 5 | Tabs | Line tabs, one row, scroll sideways on phone, selected tab in `?tab=` (DetailShell does this after 31.2.5). | D20, B1 |
| 6 | Sections tab | Panel header: h2 "শাখা" + one-line description + the panel's one primary "শাখা যোগ করুন". Table unpaginated (`paginated={false}`, "মোট ৩টি"); columns শাখা, গ্রুপ, ধারণক্ষমতা (end), ভর্তিকৃত (end, `formatNumber`); `rowActions` edit + delete. Heading "শাখা — {class}" goes (the h1 already names the class). | D19, D29, D6 |
| 7 | Students tab | Name link not underlined; roll through `formatNumber`, `align: 'end'`; `rowActions` view → student; page size 25. | D19, D6 |
| 8 | Fee structures tab | Amount `align: 'end'`; page size 25; `EmptyState`. | D19 |
| 9 | Teachers tab | Each section is a Card: h3 section name + outline "নিয়োগ"; assignments in an unpaginated list, one row per teacher: name (`font-medium`) with the role on a labelled second line from `assignmentType.*` ("শ্রেণি শিক্ষক" / "সহকারী শ্রেণি শিক্ষক" / "বিষয় শিক্ষক · গণিত"), class teacher first (main's `sortByAssignmentType`); a `remove` row action that opens a **New** `ConfirmDialog`; empty texts become `EmptyState`. | D19, D28, D29, D9 |
| 10 | Subjects tab | Panel header h2 "বিষয়সমূহ" + primary "বিষয় যোগ করুন"; unpaginated table; name shows `name_bn` in Bangla when set; ঐচ্ছিক = `StatusBadge` neutral "ঐচ্ছিক" or nothing; `remove` row action. | D19, D27 |
| 11 | Section / subject dialogs | `size="sm"` (section form `md`), FormField labels, placeholders "বাছুন", required marks; errors are translated keys only — delete every `error.message` branch. Delete-section 409 shows **New** `deleteSectionDialog.blockedMessage`. | D9, D21, D25 |
| 12 | Loading / error | Page pending = `RoutePending variant="detail"` (already); the inline `Skeleton` block and the page-level `ErrorState` stay but the error uses `ErrorState` with a translated sentence (already) — no change beyond removing the wrapper `div`. | D28 |
| 13 | Assign-teacher dialog (`-assign-teacher-dialog.tsx`, shared with the staff pages) | `size="md"`; every picker a `FormField` with a visible label and required mark; the role choice (**exists since #1407**: শ্রেণি শিক্ষক / সহকারী শ্রেণি শিক্ষক / বিষয় শিক্ষক) becomes a fieldset with the visible legend "নিয়োগের ধরন" and 44 px whole-row radio targets, all three labels from `assignmentType.*`; the "will be replaced" line becomes a warning notice (warning tone + `triangle-alert`) in the same polite live region; validation and 409 errors use the kit error text, still chosen by `details.code`, never the server sentence. | D21, D25, D9, D27 |

## Mobile behaviour
- Crumbs show the last two crumbs; facts in a 2-column grid.
- Header actions: Edit outline `flex-1` + More icon.
- Tab row scrolls sideways with the right-edge fade.
- Sections and subjects become compact two-line rows inside one Card ("গ্রুপ: বিজ্ঞান · ভর্তি ৩৮ / ৪০"), icon actions on the right.
- The panel's primary ("শাখা যোগ করুন") is full width under the panel title.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where the one primary lives | header "সম্পাদনা" filled / per-tab add button filled | per-tab add | Adding sections/subjects/teachers is the frequent job here; editing the class is rare. Only one tab panel is visible, so the page still has one filled button. |
| Sections / subjects paging | keep local 20-row pager / unpaginated | unpaginated | A class has a handful of sections and ~15 subjects; kit "short reference list". |
| Teacher removal | instant (today) / confirm | confirm | The action becomes a small icon next to others; an accidental tap removed an assignment silently. |
| Teacher role display | StatusBadge per role · labelled second line | Second line `text-caption text-text-secondary` under the name | A role is not a state (D27 tones mean paid/due/failed…); the class teacher is already first in the list. Keeps main's `roleLabel` text, incl. the subject name. |
| Replace warning | `ConfirmDialog` after Assign · inline warning notice | Inline notice in the dialog (as #1407 built it, restyled) | It appears as soon as another teacher is picked, before saving; a second confirm step adds a click to the common "change class teacher" job, and the e2e spec reads it from the `aria-live` region. |
| Radio labels | `classTeacherOption` / `subjectTeacherOption` ("শ্রেণি-শিক্ষক") · `assignmentType.*` ("শ্রেণি শিক্ষক") | `assignmentType.*` for all three | One word per thing (D32): the same label the list rows show. |
| Optional column | "হ্যাঁ/না" text / badge only when optional | badge only when optional | D27; "না" on every row was noise. |

## Files
- `client-admin/src/routes/_staff/classes/$classId.tsx` — facts, actions, back link removed, edit bug fix
- `client-admin/src/routes/_staff/classes/-sections-panel.tsx` — panel header, unpaginated table, rowActions, numerals
- `client-admin/src/routes/_staff/classes/-section-form-dialog.tsx` — kit dialog, translated errors
- `client-admin/src/routes/_staff/classes/-delete-section-dialog.tsx` — ConfirmDialog, translated blocked text
- `client-admin/src/routes/_staff/classes/-detail/students-tab.tsx` — link style, roll numerals, view action, page size
- `client-admin/src/routes/_staff/classes/-detail/fee-structures-tab.tsx` — align, page size, EmptyState
- `client-admin/src/routes/_staff/classes/-detail/teachers-tab.tsx` — section Cards, role line, remove action + confirm, EmptyState (keep #1407's `AssignDialogForSection` and `sortByAssignmentType` use)
- `client-admin/src/routes/_staff/classes/-assign-teacher-dialog.tsx` — kit dialog form, labelled role fieldset, warning notice, kit error text (also placed — not edited — by staff-2b and staff-3; keep its exports and props)
- `client-admin/src/routes/_staff/classes/-detail/subjects-tab.tsx` — panel header, unpaginated table, badge, remove action
- `client-admin/src/routes/_staff/classes/-attach-subject-dialog.tsx` — FormField labels, translated error
- `client-admin/src/routes/_staff/classes/-remove-subject-dialog.tsx` — ConfirmDialog, translated error
- `ui/src/i18n/locales/bn/classes.json`, `ui/src/i18n/locales/en/classes.json` — keys below
- `client-admin/src/routes/_staff/classes/$classId.test.tsx`, `-detail/teachers-tab.test.tsx`, `-detail/subjects-tab.test.tsx`, `-assign-teacher-dialog.test.tsx` — update

## Steps
1. **`$classId.tsx`.** Delete the `<Link to="/classes">` and the wrapping `flex flex-col gap-4` div (DetailShell provides PageContainer spacing). Replace `identifiers` with
   `facts={[{ label: t('detail.factGrade'), value: klass.numeric_grade == null ? '—' : formatNumber(klass.numeric_grade, regionConfig) }, { label: t('detail.factAcademicYear'), value: klass.academic_year.name }, ...(klass.shift ? [{ label: t('list.shiftLabel'), value: klass.shift }] : []), ...(klass.version ? [{ label: t('list.versionLabel'), value: klass.version }] : []), { label: t('detail.factSections'), value: t('detail.sectionCount', { count: klass.sections.length }) }]}`.
   Actions: `{ id: 'edit', label: t('list.edit'), icon: <PencilIcon />, priority: 'secondary', allowed: canManage, onClick }`, `{ id: 'delete', label: t('list.delete'), icon: <Trash2Icon />, priority: 'destructive', allowed: canManage, onClick }` (PageHeader puts destructive into More, last). Edit dialog `initialValues={{ name: klass.name, numericGrade: klass.numeric_grade ?? undefined, shift: klass.shift ?? null, version: klass.version ?? null }}`. Keep `TAB_IDS` and `useDetailShellTab`. Keep the file names of every dialog (they are listed in `unregistered-actions.ts`; its test requires them to exist).
2. **`-sections-panel.tsx`.** Drop the `padded` prop and its branches (only the detail tab uses the panel after classes-1). Header: `<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><h2 className="text-h2">{t('sections.heading')}</h2><p className="mt-0.5 text-text-secondary">{t('sectionForm.description')}</p></div>{canManage && <Button onClick=…><PlusIcon />{t('sections.addSection')}</Button>}</div>`. DataTable: `paginated={false}`, `data={sections}`, remove `PAGE_SIZE`/`page` state. Columns: name = `section.section_name` as stored, `font-medium` (the mockup's "শাখা ক" is just sample data — do not prefix); `group` column = `section.group_name ?? '—'`; capacity `section.capacity == null ? '—' : formatNumber(section.capacity, regionConfig)` `align: 'end'`; enrolled `formatNumber(section.enrolled_count, regionConfig)` `align: 'end'`. Remove the `actions` column; `rowActions={(s) => [{ intent: 'edit', label: t('sections.edit'), onClick: () => setEditing(s), allowed: canManage }, { intent: 'delete', label: t('sections.delete'), onClick: () => setDeleting(s), allowed: canManage }]}`. `emptyState={{ icon: <LayoutGridIcon />, title: t('sections.emptyMessage'), explanation: t('sections.emptyExplanation') }}` (no action — the panel header already has the button).
3. **`-section-form-dialog.tsx`.** `DialogContent size="md"`; FormField per field (name required); group select placeholder `t('sectionForm.groupPlaceholder')` = "বাছুন"; error = `t('sectionForm.errorMessage')` only.
4. **`-delete-section-dialog.tsx`.** `ConfirmDialog tone="danger"` with `description={t('deleteSectionDialog.description', { name })}`; on 409 show `t('deleteSectionDialog.blockedMessage')`, other failures `t('deleteSectionDialog.errorMessage')`; remove `deleteSection.error.message`.
5. **`students-tab.tsx`.** Name link class `font-medium text-text-primary hover:text-primary`; roll `formatNumber(student.roll_number, regionConfig)`, `align: 'end'`; `rowActions={(s) => [{ intent: 'view', label: t('detail.students.view'), to: `/students/${s.id}` }]}`; `PAGE_SIZE = 25`; `emptyState={{ icon: <GraduationCapIcon />, title: t('detail.students.emptyMessage') }}`.
6. **`fee-structures-tab.tsx`.** Amount column `align: 'end'`; `PAGE_SIZE = 25`; `emptyState={{ icon: <ListChecksIcon />, title: t('detail.feeStructures.emptyMessage') }}`.
7. **`teachers-tab.tsx`** (main after #1407: `TeachersTab` → `AssignDialogForSection` (passes `currentClassTeacher` from the cached `useSectionTeachers`) → `SectionTeachersPanel` with `roleLabel` and `sortByAssignmentType(query.data)` — keep all three). Outer wrapper `space-y-4` (drop `p-4`). `SectionTeachersPanel` → Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`), header `flex items-center justify-between gap-3`: `<h3 className="text-h3">` + outline Button "নিয়োগ" with `UserPlusIcon` (keep its `aria-label` `detail.teachers.assignAria` and its visible text — `e2e/keyboard/class-teachers.spec.ts` tabs to it by "নিয়োগ"). List = `ul className="mt-3 divide-y divide-border-subtle"` over `sortByAssignmentType(query.data)`, row `li className="flex items-center justify-between gap-3 py-2"`: `<div className="min-w-0"><p className="font-medium">{assignment.full_name}</p><p className="text-caption text-text-secondary">{roleLabel(assignment)}</p></div>` (main's `roleLabel` unchanged: `assignmentType.SUBJECT_TEACHER` + ` · ${subject_name}` for subject teachers, else `assignmentType.<type>`; never branch on `subject_id`; the old " — " separator goes), then `<RowActions actions={[{ intent: 'remove', label: t('detail.teachers.remove'), onClick: () => setRemoving(assignment), allowed: canManage }]} />`. Delete the hand-made underlined remove `<button>`. **New** `ConfirmDialog` (`tone="danger"`, title `t('detail.teachers.removeConfirmTitle')`, description `t('detail.teachers.removeConfirmDescription', { name, section })`, confirm `t('detail.teachers.remove')`, `busy={unassignTeacher.isPending}`) runs `unassignTeacher.mutate`. Empty texts → `EmptyState` (`emptyMessage` with no action; `emptySectionMessage` as a single `text-text-secondary` line inside the card — an EmptyState per section is too heavy).
7b. **`-assign-teacher-dialog.tsx`** (main after #1407 — keep `TeacherAssignmentType`, `sortByAssignmentType` (exported; used by `staff/teaching-assignments.tsx` and `staff/-detail/teaching-assignments-tab.tsx`), the `currentClassTeacher` prop, the `replaced` rule, the bound/unbound mutation split and every request body unchanged):
   - `<DialogContent size="md">` (picker mode has up to five fields).
   - Class, section, teacher and subject pickers: replace each `<span className="text-sm font-medium">` label with `FormField` (`label`, `required`); keep each `Combobox`'s `aria-label` (unit + e2e tests find them by name). Subject option label: `i18n.language === 'bn' && subject.name_bn ? subject.name_bn : subject.name_en` + ` (${subject.code})` (same rule as the Subjects tab).
   - Role choice: `<fieldset className="flex flex-col gap-1.5"><legend className="text-label text-text-primary">{t('assignTeacherForm.modeLabel')}</legend>` (+ the kit required mark) around the existing `RadioGroup` (keep its `aria-label`, values `CLASS_TEACHER` / `ASSISTANT_CLASS_TEACHER` / `SUBJECT_TEACHER`, ids, default `CLASS_TEACHER`, and this order). Each option row `div className="flex min-h-11 items-center gap-3 md:min-h-8"` with the `RadioGroupItem` and `<label htmlFor=… className="flex-1 cursor-pointer">`; all three labels `t('assignmentType.<TYPE>')`. Nothing focusable may sit between the teacher combobox and the radio group: the e2e spec presses Tab once from the combobox and expects the checked radio.
   - Replace warning: keep the always-mounted `<div aria-live="polite">`; its content becomes `<p className="flex items-start gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{t('assignDialog.replaceWarning', { name: replaced.name })}</p>` — the warning tone of the kit's StatusBadge table, no new pattern. Shown only when `replaced` (CLASS_TEACHER chosen and a different teacher than the current one), as today.
   - Errors: validation and API errors use the kit error text `<p role="alert" className="flex items-center gap-1 text-caption text-destructive"><CircleAlertIcon className="size-4" />…</p>` (drop `text-sm`). Keep the mapping on `apiError.details?.code`: `TEACHER_ALREADY_HOMEROOM` → `assignTeacherForm.errorAlreadyHomeroom`, any other 409 → `assignTeacherForm.errorDuplicateAssignment`, else `assignTeacherForm.errorMessage`. Never render `error.message`.
   - Footer unchanged: Cancel (outline) then the primary save with `loading`.
8. **`subjects-tab.tsx`.** Keep `PresetWarningBanner` first. Header like step 2 with h2 `t('subjects.heading')` and primary `t('subjects.addSubject')` (`plus`). Unpaginated DataTable (drop the local `PAGE_SIZE`). Name: `i18n.language === 'bn' && row.subject.name_bn ? row.subject.name_bn : row.subject.name_en`. Code stays Latin (identifier, D6). Optional column: `row.is_optional ? <StatusBadge tone="neutral" label={t('subjects.optional')} /> : null`. `rowActions` → `{ intent: 'remove', label: t('subjects.remove'), onClick: …, allowed: canManage }`. Remove the `actions` column and the `yes`/`no` keys.
9. **`-attach-subject-dialog.tsx`** (`size="sm"`) and **`-remove-subject-dialog.tsx`** (`ConfirmDialog tone="danger"`): FormField labels, placeholder "বাছুন", errors from `subjectAttachForm.errorMessage` / `removeSubjectDialog.errorMessage` only.
10. **i18n** (`classes.json`):

    | Key | bn | en |
    |---|---|---|
    | `detail.factGrade` (**New**) | গ্রেড | Grade |
    | `detail.factAcademicYear` (**New**) | শিক্ষাবর্ষ | Academic year |
    | `detail.factSections` (**New**) | শাখা | Sections |
    | `detail.sectionCount_one/_other` (**New**) | {{count}}টি | {{count}} section / {{count}} sections |
    | `detail.students.view` (**New**) | দেখুন | View |
    | `detail.teachers.removeConfirmTitle` (**New**) | শিক্ষকের নিয়োগ বাতিল করবেন? | Remove this teacher? |
    | `detail.teachers.removeConfirmDescription` (**New**) | {{name}}-কে {{section}} শাখা থেকে সরানো হবে। পরে আবার নিয়োগ দেওয়া যাবে। | {{name}} will be removed from section {{section}}. You can assign them again later. |
    | `sections.heading` (changed) | শাখা | Sections |
    | `sections.addSection` (changed) | শাখা যোগ করুন | Add section |
    | `sections.emptyExplanation` (**New**) | শাখা যোগ করলে শিক্ষার্থীরা সেখানে ভর্তি হতে পারবে। | Students can be enrolled once you add a section. |
    | `subjects.addSubject` (changed) | বিষয় যোগ করুন | Add subject |
    | `subjects.optional` (**New**) | ঐচ্ছিক | Optional |
    | `sectionForm.groupPlaceholder`, `subjectAttachForm.subjectPlaceholder` (changed) | বাছুন | Select |
    | `assignTeacherForm.description` (changed — still names only two roles) | এই শাখায় একজন শিক্ষককে শ্রেণি শিক্ষক, সহকারী শ্রেণি শিক্ষক বা বিষয় শিক্ষক হিসেবে দিন। | Make a teacher this section's class teacher, assistant class teacher or subject teacher. |
    | `deleteSectionDialog.blockedMessage` (**New**) | এই শাখায় এখনও শিক্ষার্থী ভর্তি আছে, তাই এটি মোছা যাবে না। আগে শিক্ষার্থীদের অন্য শাখায় সরান। | This section still has students, so it can't be deleted. Move them to another section first. |

    Remove unused: `detail.grade`, `sections.columnActions`, `subjects.columnActions`, `subjects.yes`, `subjects.no`, `assignTeacherForm.classTeacherOption`, `assignTeacherForm.subjectTeacherOption`, `detail.teachers.removeAria`. Use #1407's keys as they are — `assignmentType.CLASS_TEACHER` / `ASSISTANT_CLASS_TEACHER` / `SUBJECT_TEACHER`, `assignDialog.replaceWarning`, `assignTeacherForm.errorAlreadyHomeroom` — do not add new role or warning keys.

## Tests
- `$classId.test.tsx`: no "শ্রেণি" back link; facts show grade in tenant numerals, year, shift, version, section count; Edit is outline and Delete sits in the More menu; **saving the Edit dialog without touching shift sends the existing shift (not `null`)** — regression test for the data-loss bug.
- `-detail/teachers-tab.test.tsx`: remove icon opens the confirm dialog; confirm calls unassign; cancel does not (the existing "removes a teacher assignment" case clicks the button named `Remove <name> (Class teacher)` — change it to the "Remove" action inside that row's `listitem`, then confirm). Rewrite the existing "labels rows from assignment_type" case for the two-line row: list items come in the order Cy Class / Ann Assistant / Sam Subject and each contains its role text ("Class teacher", "Assistant class teacher", "Subject teacher"); drop the `' — '` filter.
- `-assign-teacher-dialog.test.tsx`: keep every existing case (class / assistant / subject bodies, replace warning only for CLASS_TEACHER and only for a different teacher, `TEACHER_ALREADY_HOMEROOM` → translated text, generic 409, teacher-centric mode); add: the role group has a visible legend "Assignment type" and three radios named "Class teacher", "Assistant class teacher", "Subject teacher"; the replace warning sits inside the `aria-live="polite"` element.
- `-detail/subjects-tab.test.tsx`: Bangla name used when `name_bn` set; optional shows a badge, non-optional shows nothing; remove action hidden without `CLASS_MANAGE`.
- `e2e/keyboard/class-teachers.spec.ts` (+109 lines in #1407: assign, assign-with-type, assistant keeps the class teacher, replace warning): re-run; no edit expected as long as the assign button keeps "নিয়োগ", the teacher combobox is followed directly by the radio group, the radios are named by `classes.assignmentType.*`, the warning stays in `[aria-live="polite"]`, and the submit reads `assignTeacherForm.save`.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No "back to list" link; crumbs read "শ্রেণি › <class name>".
- [ ] Tabs are one underline row; only the selected panel is in the DOM.
- [ ] Sections table shows "মোট n টি", numbers right-aligned in tenant numerals, icon actions.
- [ ] Editing a class from this page keeps its shift and version.
- [ ] No server error sentence appears in any dialog on this page.
- [ ] Teachers tab: each teacher row shows the role (শ্রেণি শিক্ষক / সহকারী শ্রেণি শিক্ষক / বিষয় শিক্ষক · subject) under the name, class teacher first.
- [ ] Assign dialog: "নিয়োগের ধরন" is a visible label over three 44 px radio rows; choosing a different class teacher shows the warning notice; a homeroom 409 shows the translated sentence.

## Out of scope
- Section delete 409 with counts — shared request filed (`class-detail | server classes.service.ts:547` on main after #1407, was 611).
- Homework and Performance tabs: content unchanged (their components belong to the homework / performance features); they only inherit the line tabs.
- In teacher-centric mode (opened from the staff pages without a fixed section) the dialog shows no replace warning — #1407 scoped `currentClassTeacher` to a fixed section, and staff-3 passes it from its section cards. Looking up the picked section's class teacher inside the dialog is a possible follow-up, not done here.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server section delete 409 details.code + count | Deferred | — | use the fallback in the ticket (one translated sentence, no count) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: classes   Decisions: D6, D9, D16, D19, D20, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.classes-1 (shares `classes.json`, `-sections-panel.tsx`)
