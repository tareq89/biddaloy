# [31.4.students-7b] Student detail Notes and Records tabs — cards, icon actions, confirm dialogs

## Goal
The student's "নোট" and "রেকর্ড" tabs use kit Cards, outline buttons, icon row actions and `ConfirmDialog`, with long dates, tenant digits and status badges — in the same look as the Guardians tab of students-7a.
b runs after a (students-7a); no shared files.

## What and why
Notes hold staff-only remarks about a student; Records hold family/health details, public-exam results and the leave/readmit history. Today the Notes tab has a filled "নোট যোগ করুন" (a second primary next to the header's) and an outline "মুছুন" text button on every note; Records stacks a form titled "ব্যক্তিগত তথ্য" (the same title as the new Overview card), a public-exams table with two outline text buttons per row and Latin GPA/year, and a timeline whose type is a hand-made grey pill. The redesign puts each block in a Card with an h2, turns row actions into RowActions, deletes through `ConfirmDialog`, and renames the Records form so it no longer clashes with Overview.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_guardians/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_guardians/mobile.webp?raw=true" width="260"> |

The shot is the Guardians tab (students-7a); Notes and Records use the same Card and table styles.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Notes action | Filled "নোট যোগ করুন" → outline (`plus`), top right. | D29. |
| 2 | Note card | Each note is a Card: author `font-medium` · `formatDate` on one line, delete as a danger icon button (`trash-2`, tooltip + `aria-label` "নোট মুছুন") on the right, stars, body. List `space-y-3`. | D19 colours; less noise. |
| 3 | Notes empty | Dashed box → `EmptyState` (icon `sticky-note`, existing title + sentence, no action — the outline button is above). | D28. |
| 4 | Note dialogs | Add: `DialogContent size="md"`. Delete: `ConfirmDialog tone="danger"`. | D21, D29. |
| 5 | Records form | Card form titled "পারিবারিক ও স্বাস্থ্য তথ্য" (was "ব্যক্তিগত তথ্য", same as Overview); fields in `grid gap-4 md:grid-cols-2`; footer `mt-4 flex justify-end border-t border-border-subtle pt-4` with an **outline** "সংরক্ষণ করুন" (shown only with write permission); read-only fields render as text, not disabled inputs. | D32 one word per thing; D29 one filled per view. |
| 6 | Public exams | Card with h2 + outline "পরীক্ষা যোগ করুন"; `DataTable paginated={false}`: পরীক্ষা, বোর্ড, রোল, রেজিস্ট্রেশন (Latin identifiers), জিপিএ (`formatNumber`, 2 decimals, end), সাল (tenant digits, no grouping); RowActions সম্পাদনা (`edit`) / মুছুন (`delete`). | D6, D19. |
| 7 | Exam dialogs | Form `DialogContent size="md"` (was `max-w-lg`), Cancel outline (was ghost); delete → `ConfirmDialog tone="danger"`. | D21, D29. |
| 8 | Timeline | Card with h2; `ol divide-y`; each event: StatusBadge by type (WITHDRAWN neutral, TRANSFERRED_OUT info, GRADUATED success, READMITTED success) + `formatDate`, then reason / destination / remark as label–value lines. | D27. |

## Mobile behaviour
- Notes: delete icon stays at the card's top right (44 px); text wraps under the author line.
- Records form: one column, Save full width.
- Public exams: two-line rows — exam type + year, then "বোর্ড · জিপিএ"; actions with labels.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Records Save button | filled (settings-style card rule) · outline | Outline | The page header already has the one filled button; the card-form exception is a Settings rule. |
| Records form title | keep "ব্যক্তিগত তথ্য" · rename | "পারিবারিক ও স্বাস্থ্য তথ্য" | Overview (students-4) uses "ব্যক্তিগত তথ্য" for different fields. |
| Passing year digits | `formatNumber` · digit swap only | `renderDigits(String(year), numerals)` | `formatNumber` would group "২,০২৪". |

## Files
- `client-admin/src/routes/_staff/students/-detail/notes-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/notes-tab.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/notes-tab.stories.tsx`
- `client-admin/src/routes/_staff/students/-detail/records-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/records-tab.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/records-tab.stories.tsx`
- `client-admin/src/routes/_staff/students/-detail/-records/profile-fields-form.tsx`
- `client-admin/src/routes/_staff/students/-detail/-records/profile-fields-form.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/-records/public-exams-section.tsx`
- `client-admin/src/routes/_staff/students/-detail/-records/lifecycle-timeline.tsx`
- `ui/src/i18n/locales/{bn,en}/student-notes.json`
- `ui/src/i18n/locales/{bn,en}/student-records.json`

## Steps
1. **`notes-tab.tsx`.** Add button → `variant="outline"` + `PlusIcon` in `flex justify-end` (`w-full md:w-auto`). Empty → `<EmptyState icon={<StickyNoteIcon />} title={t('empty')} explanation={t('emptyDescription')} />`. List `ul className="space-y-3"`. `NoteCard` → `<li><Card padded>`: top row `flex items-start justify-between gap-2` with `<p className="text-text-secondary"><span className="font-medium text-text-primary">{author}</span> · {formatDate(note.created_at, rc)}</p>` and, when `canDelete`, an icon button (Icon-button classes, `text-destructive`, `aria-label={t('deleteNote')}`, tooltip) — `size-11 md:size-8`; then stars (unchanged logic) and body. `AddNoteDialog`: `size="md"`. `DeleteNoteDialog` → `ConfirmDialog tone="danger" title={t('deleteTitle')} description={t('deleteDescription')} confirmLabel={t('delete')}` with the existing mutation as `onConfirm`, `busy` = pending; on error `toast.error(t('deleteError'))` if that key exists, else keep the dialog's error line inside `description`.
2. **`records-tab.tsx`.** `className="flex flex-col gap-8"` → `space-y-6`.
3. **`profile-fields-form.tsx`.** `<Card asChild padded><form …>` (or a `form` inside `Card`), `<h2 id="profile-title" className="text-h2">{t('profile.title')}</h2>`, fields `mt-4 grid gap-4 md:grid-cols-2`, labels Label classes. When `!canWrite` render each value as `<dl>` text (`dt` caption, `dd` value or `—`) instead of read-only inputs. Footer (only `canWrite`): `<div className="mt-4 flex justify-end border-t border-border-subtle pt-4"><Button type="submit" variant="outline" className="w-full md:w-auto" loading={update.isPending}>…</Button></div>`.
4. **`public-exams-section.tsx`.** Section → `Card` (no padding, `overflow-hidden`) with header `flex items-center justify-between gap-3 p-4 md:px-5` (h2 `text-h2` + outline add button with `PlusIcon`). `DataTable tableId="student-public-exams" paginated={false}`: type (translated), board, roll, registration, gpa (`exam.gpa === null ? '—' : formatNumber(Number(exam.gpa), rc, { decimals: 2 })`, end), year (`renderDigits(String(exam.passing_year), rc.numerals)`); card subtitle `t('exams.cardSubtitle', { board, gpa })`; `rowActions={(exam) => [{ intent: 'edit', label: t('exams.edit'), onClick: () => setEditing(exam), allowed: canWrite }, { intent: 'delete', label: t('exams.delete'), onClick: () => setDeleting(exam), allowed: canWrite }]}`; empty → `EmptyState` (title `exams.empty`, icon `ScrollTextIcon`). Form dialog `<DialogContent size="md">`, Cancel `variant="outline"`. `DeleteExamDialog` → `ConfirmDialog tone="danger"` (title `exams.deleteConfirm.title`, description `exams.deleteConfirm.body`, confirm `exams.deleteConfirm.confirm`); keep its error text by showing `toast.error(t('exams.deleteConfirm.error'))`.
5. **`lifecycle-timeline.tsx`.** `Card padded`, `h2 className="text-h2"`, `ol className="mt-2 divide-y divide-border-subtle"`, `li className="flex flex-col gap-1 py-3"`; type → `<StatusBadge tone={EVENT_TONE[event.event_type] ?? 'neutral'} label={t(\`timeline.types.${event.event_type}\`)} />` with `EVENT_TONE = { WITHDRAWN: 'neutral', TRANSFERRED_OUT: 'info', GRADUATED: 'success', READMITTED: 'success' }`; label–value lines `text-text-secondary` label + value.
6. **i18n:**
   - `student-records.json`: change `profile.title` "পারিবারিক ও স্বাস্থ্য তথ্য" / "Family and health details"; add `exams.cardSubtitle` "{{board}} · জিপিএ {{gpa}}" / "{{board}} · GPA {{gpa}}"
   - `student-notes.json`: add `deleteNote` "নোট মুছুন" / "Delete note" (if `delete` already reads that, reuse it and skip)

## Tests
- `notes-tab.test.tsx`: add button is outline; delete is an icon button named "নোট মুছুন" and opens an `alertdialog`; empty state renders title + sentence; date long form.
- `records-tab.test.tsx`: form heading "পারিবারিক ও স্বাস্থ্য তথ্য"; public-exam rows expose "সম্পাদনা" / "মুছুন" buttons; GPA in tenant digits; year not grouped; timeline type is a badge.
- `profile-fields-form.test.tsx`: Save is outline and hidden without write permission; read-only mode renders text, not inputs; health notes still hidden without `STUDENT_RECORDS_READ`.
- Stories (`notes-tab.stories.tsx`, `records-tab.stories.tsx`): update to the new markup; still render.
- E2E: `e2e/keyboard/student-lifecycle.spec.ts` checks the Records/Notes tabs exist by name — unchanged.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot's card and table style.
- [ ] Mobile at 390 px matches the "after" screenshot's row style; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (the header's).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Notes and public exams delete through the red confirm dialog only.
- [ ] Records form title differs from the Overview card title.
- [ ] Timeline events show a status badge and a long date.

## Out of scope
- Editing a note after saving — not a feature (D1).

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: students   Decisions: D5, D6, D19, D21, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.students-7a
