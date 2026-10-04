# [31.4.staff-2b] Staff detail — HR, assignments, documents, attendance tabs as kit cards

## Goal
Done = the Teacher assignments, HR record, Documents and Attendance & leave tabs of `/staff/$userId` use kit Cards, StatusBadges, RowActions and outline buttons only (the header keeps the page's single filled button), the HR record tab matches its "after" screenshot, and no ISO date or raw enum is left on these tabs (runs after staff-2a; staff-2c does the ACR, Incidents and Performance tabs after this).

## What and why
These tabs hold the HR side of a staff member. Today each tab has its own filled button ("নিয়োগ দিন", "পদোন্নতি", "আইডি কার্ড প্রিন্ট") competing with the header's primary, lists are bare bordered `ul`s, the HR record is a stack of grey `<details>` boxes, the MPO date shows as `2020-01-01` and is typed as free text, the current promotion uses a non-token `bg-primary/5`, and the leave block on someone else's page is titled "আমার ছুটি". The redesign puts every tab's content in kit Cards, makes tab actions outline buttons placed next to what they change, turns lists into unpaginated DataTables or kit rows, and fixes the dates and labels.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/before-mobile.webp?raw=true" width="260"> |
| After (HR record tab) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/hr-record/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/hr-record/mobile.webp?raw=true" width="260"> |
| After (header + Profile, ticket a) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/mobile.webp?raw=true" width="260"> |

The before shot shows the Profile tab (the audit captured only the first tab).

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Teacher assignments tab | Card holding an unpaginated `DataTable` (শ্রেণি · শাখা, দায়িত্ব, বিষয়, কাজ): class and section in one column `সপ্তম · ক`; দায়িত্ব shows the row's `assignment_type` label from `classes.json` (শ্রেণি শিক্ষক / সহকারী শ্রেণি শিক্ষক / বিষয় শিক্ষক — main since #1407), rows ordered class teacher → assistant → subject (`sortByAssignmentType`, as main); header row of the card has the title "শিক্ষকের দায়িত্ব" and an outline "শিক্ষক দায়িত্ব দিন" (was filled "নিয়োগ দিন"); row action `RowActions` `remove` "দায়িত্ব থেকে সরান" (was a red underlined text button); empty → `EmptyState`. | D19, D29, D32 |
| 2 | HR record tab | Each section is a Card-styled `<details>` (`group/hr`): summary row `min-h-14 md:min-h-12 px-4 md:px-5` with `h2 text-h3` + `chevron-down` that flips when open; body `border-t p-4 md:p-5`. Job and Promotion open by default (as today). | Kit Card; D17 |
| 3 | HR — Job | View: FieldGrid `grid grid-cols-2 gap-4 md:grid-cols-4`, MPO date via `formatDate`; "সম্পাদনা" outline at the bottom end of the card body. Edit form: MPO date is a `DatePicker` (was a text input), other fields `FormField` + `Input` in `grid gap-4 md:grid-cols-2`, footer Cancel + Save. | D5, D9, D25 |
| 4 | HR — Promotion | Title "পদোন্নতি ও পদের ইতিহাস"; history as `ol divide-y` rows (designation `font-medium`, date line `text-text-secondary`), current row gets `StatusBadge tone="success" label="বর্তমান"` (was `bg-primary/5` + a hand-made pill); "পদোন্নতি দিন" outline at the bottom end (was filled, top). | D27, D29, tokens only |
| 5 | HR — Documents section | Rows `rounded-md border border-border-subtle p-3` → kit text classes (`font-medium`, `text-caption text-text-secondary`), no `text-sm`. | Tokens |
| 6 | Documents tab | Two Cards: "আইডি কার্ডের ছবি" (sentence + outline "এইচআর রেকর্ড খুলুন") with an outline "আইডি কার্ড প্রিন্ট" (was filled) in its header row; "প্রিন্ট করা ডকুমেন্ট" holding `SubjectPrintHistory`. | D29 |
| 7 | Attendance & leave tab | Card "আজকের উপস্থিতি" (the status control, unchanged); Card "এই মাসের সারসংক্ষেপ" with the five figures as a `dl grid grid-cols-2 gap-4 md:grid-cols-5` (value `text-h3`, numbers via `formatNumber`, percentage `formatNumber(p)` + "%"); Card "ছুটির ব্যালেন্স" (was "আমার ছুটি") listing type + balance (`formatNumber`, `justify-between`, `divide-y`) with the outline "ছুটির আবেদন করুন" in its header row. | D6, wording on someone else's page |

## Mobile behaviour
- HR sections: one column; FieldGrid drops to 2 columns; summary rows are 56 px tall (whole row is the target).
- Card header rows with a title + outline button wrap: button goes under the title when it does not fit (`flex flex-wrap items-center justify-between gap-2`).
- Unpaginated tables show the compact two-line rows of `PATTERN: DataTable (unpaginated)`; RowActions stay icons there (44 px).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Tab action buttons | Filled · outline | Outline, in the card header row (or card footer for HR edit / promote) | D29: the header's "সম্পাদনা করুন" is the page's one primary; each action sits next to what it changes. |
| HR sections | Tabs inside a tab · accordion cards | Accordion cards (`<details>`) | Keeps today's behaviour (open/close, Job + Promotion open), no new state; native disclosure is keyboard-accessible. |
| Role display | StatusBadge · labelled column | Labelled "দায়িত্ব" column | A role is not a state (D27 tones would read as status); main's labels and order are kept as they are. |
| MPO date input | Text · DatePicker | DatePicker (`toIsoDate` on save) | Column is a SQL `date`; free text could send an invalid value (D25). |
| Leave title | Keep "আমার ছুটি" · own key | New `staff.json` key "ছুটির ব্যালেন্স" | `leave.json` belongs to the attendance lane; the label is wrong only on this page. |

## Files
- `client-admin/src/routes/_staff/staff/-detail/teaching-assignments-tab.tsx` (+ `teaching-assignments-tab.test.tsx`)
- `client-admin/src/routes/_staff/staff/-detail/hr-record-tab.tsx` (+ `hr-record-tab.test.tsx`)
- `client-admin/src/routes/_staff/staff/-detail/hr-record-job-section.tsx` (+ `hr-record-job-section.test.tsx`)
- `client-admin/src/routes/_staff/staff/-detail/hr-record-promotion-section.tsx` (+ `hr-record-promotion-section.test.tsx`)
- `client-admin/src/routes/_staff/staff/-detail/hr-record-documents-section.tsx`
- `client-admin/src/routes/_staff/staff/-detail/documents-tab.tsx` (+ `documents-tab.test.tsx`)
- `client-admin/src/routes/_staff/staff/-detail/attendance-leave-tab.tsx`
- `ui/src/i18n/locales/{bn,en}/staff.json` — keys below (also changed by staff-1 and staff-2a, run earlier)

That is 7 source files + 5 tests + 2 locale files; all edits are markup/class swaps except the MPO DatePicker.

## Steps
1. **Shared card markup** for every tab below: `<section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">`; header row `<div className="flex flex-wrap items-center justify-between gap-2">` with `<h2 className="text-h2">` and the outline action (`variant="outline"`, icon first, no `size="sm"`). A card holding a DataTable uses `overflow-hidden` with no padding and puts the header row in `p-4 md:px-5`. Remove every `text-sm`, `text-xs`, `text-base`, `text-muted-foreground`, `bg-primary/5` in these files.
2. **Teacher assignments tab.** Card + header row (`t('detail.teachingAssignments.title')`, outline `UserPlusIcon` `t('detail.teachingAssignments.assign')`, only with `CLASS_MANAGE`). DataTable: `paginated={false}`, drop `page/pageSize/totalCount/onPageChange`, columns `class` = `` `${row.class_name} · ${row.section_name}` `` (header `columnClass`), delete only the `section` column; keep `role` exactly as main has it (`accessorFn: (row) => tClasses(`assignmentType.${row.assignment_type}`)` with `const { t: tClasses } = useTranslation('classes')` — never branch on `subject_id`; header `columnRole`, relabelled below) and `subject` (`row.subject_name ?? '—'`); keep `data={sortByAssignmentType(rows)}` (import from `../../classes/-assign-teacher-dialog`, already on main); `rowActions={(row) => canManage ? [{ intent:'remove', label:t('detail.teachingAssignments.remove'), onClick:() => unassign.mutate({...}) }] : []}`; delete the hand-built `actions` column; `emptyState={{ title: t('detail.teachingAssignments.emptyMessage'), explanation: t('detail.teachingAssignments.emptyExplanation') }}`. Keep the `removeError` alert above the table.
3. **HR record tab.** Replace the `<details>` classes with `className="group/hr rounded-lg border border-border-subtle bg-surface shadow-e1"`; `summary` → `className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 md:min-h-12 md:px-5"` containing `<h2 className="text-h3">` + `<ChevronDownIcon className="size-4 shrink-0 text-text-secondary group-open/hr:rotate-180" aria-hidden />`; body `div className="border-t border-border-subtle p-4 md:p-5"`; wrapper `space-y-3`.
4. **Job section.** View `dl` → `grid grid-cols-2 gap-4 md:grid-cols-4`, dt `text-caption text-text-secondary`; `mpo_date` value → `record.mpo_date ? formatDate(record.mpo_date, regionConfig) : '—'`. Edit button: outline, `PencilIcon`, `t('hrRecord.job.editActionShort')`, in `div className="mt-4 flex justify-end"`. Edit form: `mpo_date` field becomes `<DatePicker value={form.mpo_date ? parseServerDate(form.mpo_date) : undefined} onValueChange={(d) => setForm(c => ({ ...c, mpo_date: d ? toIsoDate(d) : '' }))} />` inside a `FormField`; others `FormField` + `Input`; grid `grid gap-4 md:grid-cols-2`; footer `mt-4 flex flex-col-reverse gap-2 md:flex-row md:justify-end` Cancel (outline) + Save (primary — the only filled button while the form is open, the header's primary is far above; acceptable as the form's own submit, like a SettingsSection).
5. **Promotion section.** Move the promote Button below the list: `div className="mt-4 flex justify-end"`, `variant="outline"`, `ArrowUpRightIcon`. List `ol className="divide-y divide-border-subtle"`, `li className="flex flex-col items-start gap-1 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between"`, keep `aria-current`; current marker `<StatusBadge tone="success" label={t('hrRecord.promotion.current')} />`. EmptyState's action stays (outline by the kit).
6. **Documents section.** Swap classes per step 1 only.
7. **Documents tab.** Card 1: header row `documents.photoTitle` + outline `PrinterIcon` `documents.printButton` (same navigate call); sentence `mt-1 text-text-secondary`; outline `documents.openHrRecord` in `mt-4`. Card 2: `h2 documents.historyTitle` + `SubjectPrintHistory` in `mt-4`.
8. **Attendance & leave tab.** Three Cards in `space-y-6`: (1) `h2 t('grid.title')` → use new `staff.json` key `detail.attendanceLeave.todayTitle` and the status control; (2) `detail.attendanceLeave.monthTitle`, `dl` per Change 7, each value `formatNumber(..., regionConfig)`; (3) header row `detail.attendanceLeave.leaveTitle` + outline `tLeave('myLeave.requestButton')`; list `ul className="mt-4 divide-y divide-border-subtle"`, `li className="flex min-h-11 items-center justify-between"`, balance `formatNumber(row.balance, regionConfig)`. Use `useRegionConfig()`.
9. **i18n.**
   - `staff.json` add: `detail.teachingAssignments.title` "শিক্ষকের দায়িত্ব" / "Teacher assignments"; `detail.teachingAssignments.emptyExplanation` "এই শিক্ষককে কোনো শ্রেণি বা বিষয়ের দায়িত্ব দেওয়া হলে এখানে দেখা যাবে।" / "Classes and subjects given to this teacher show up here."; `hrRecord.job.editActionShort` "সম্পাদনা" / "Edit"; `detail.attendanceLeave.todayTitle` "আজকের উপস্থিতি" / "Today's attendance"; `detail.attendanceLeave.monthTitle` "এই মাসের সারসংক্ষেপ" / "This month"; `detail.attendanceLeave.leaveTitle` "ছুটির ব্যালেন্স" / "Leave balance".
   - `staff.json` change: `detail.teachingAssignments.columnClass` "শ্রেণি ও শাখা" / "Class & section"; `detail.teachingAssignments.columnRole` "দায়িত্ব" / "Duty" (was "ভূমিকা", which the glossary keeps for sign-in roles; same word staff-3 uses); `detail.teachingAssignments.assign` "শিক্ষক দায়িত্ব দিন" / "Assign"; `detail.teachingAssignments.remove` "দায়িত্ব থেকে সরান" / "Remove assignment"; `detail.teachingAssignments.emptyMessage` "এখনও কোনো দায়িত্ব নেই" / "No assignments yet"; `detail.teachingAssignments.removeError` "দায়িত্বটি সরানো যায়নি। আবার চেষ্টা করুন।" / "Couldn't remove the assignment. Try again."; `hrRecord.sections.promotion` "পদোন্নতি ও পদের ইতিহাস" / "Promotions & posts"; `hrRecord.promotion.promoteAction` "পদোন্নতি দিন" / "Promote".

## Tests
- `teaching-assignments-tab.test.tsx`: class cell reads "সপ্তম · ক"; the দায়িত্ব column shows "সহকারী শ্রেণি শিক্ষক" for an `ASSISTANT_CLASS_TEACHER` row and rows come class → assistant → subject; fixtures carry `assignment_type`; remove is a button named "দায়িত্ব থেকে সরান" and calls the mutation; assign button is outline (not `variant=default`); hidden without `CLASS_MANAGE`.
- `hr-record-job-section.test.tsx`: a record with `mpo_date: '2020-01-01'` shows "১লা জানুয়ারি, ২০২০" (bn) and never `2020-01-01`; the edit form's MPO field is a date-picker trigger, picking a day sends ISO `YYYY-MM-DD`.
- `hr-record-promotion-section.test.tsx`: current row has the "বর্তমান" status badge; the promote button is outline and comes after the list.
- `documents-tab.test.tsx`: print button is outline and still navigates to `/print/preview` with `kind=STAFF_ID_CARD`.
- E2E: `e2e/keyboard/staff-hr-record.spec.ts` (opens HR sections by keyboard — summary is still a native `<summary>`, check its locator), `e2e/keyboard/staff-teaching-assignments.spec.ts` (uses `staff.detail.teachingAssignments.assign` / `emptyMessage` through `t()` — values change, keys do not), `e2e/staff-attendance-leave.spec.ts` (leave block title now from `staff.json`; update the locator if it used `leave.myLeave.title`). Run them and fix locators only.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (HR record tab).
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (header); tab actions are outline.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] HR sections are cards with a chevron; MPO date is a long-form date and a date picker in edit.
- [ ] Teacher assignments show all three roles (incl. সহকারী শ্রেণি শিক্ষক) in a "দায়িত্ব" column, class teacher first.
- [ ] Attendance & leave figures use the tenant's numerals; the leave card says "ছুটির ব্যালেন্স".

## Out of scope
- `RepeatableRowForm` (family, address, experience, education, training, achievement, language sections) — shared component in `ui/src/components`, styled by the foundation; those seven section files are not edited.
- `PromoteStaffDialog`, `LeaveRequestDialog` — kit Dialog from the foundation; no change. `AssignTeacherDialog` — classes lane (restyled by 31.4.classes-2); placed, not edited.
- From this tab the dialog runs in teacher-centric mode (no fixed section), so it shows no "will be replaced" warning when a class teacher is assigned — #1407 scoped the warning to a fixed section. A fix belongs in the classes lane's dialog (look up the picked section's class teacher); not done here.
- ACR, Incidents and Performance tabs — staff-2c.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| ownership note: roles -role-card imports PermissionGroupList | Refused | — | nothing to change in shared code; keep PermissionGroupList's props unchanged as the ticket already says |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: staff   Decisions: D5, D6, D9, D17, D19, D25, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.staff-2a
