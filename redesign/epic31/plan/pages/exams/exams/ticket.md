# [31.4.exams-1] Exams list — class and year columns, status badges, edit

## Goal
`/exams` shows every exam with its class, academic year and a status badge, has labelled year + class filters, a total count and page size 25, and each row opens or edits the exam from icon actions.

## What and why
An admin or exam controller comes here to find one exam (for example "Half-yearly, Class 7, 2026") and open it, or to add a new one. Today a row shows only name, kind and status as plain text, so two exams with the same name for different classes look identical; the year filter has no visible label, there is no total, the page size is 10, and an exam's name or kind can never be fixed because the edit mode of the form dialog is never opened. The redesign adds the class and year columns, a class filter, status badges, row actions (view, edit), the kit pager and empty state, and tidies the create/edit dialog.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title "পরীক্ষা", **New** subtitle "প্রতিটি পরীক্ষা একটি শ্রেণি ও একটি শিক্ষাবর্ষের।", one primary "পরীক্ষা যোগ করুন" (`plus` icon), only with `EXAM_MANAGE`. | D16 |
| 2 | Filters | `FilterBar` with two labelled select fields: "শিক্ষাবর্ষ" (existing) and **New** "শ্রেণি" (`class_id`, the API already accepts it). The class field is disabled with placeholder "আগে শিক্ষাবর্ষ বাছুন" until a year is picked; picking another year clears it. Chips + "সব মুছুন" under the controls. | D24; class names repeat every year, so a class list only makes sense inside one year |
| 3 | Table columns | নাম · **New** শ্রেণি (`row.class.name`, already in the list response) · **New** শিক্ষাবর্ষ (name looked up from the year list) · ধরন · অবস্থা. | Two "Half-yearly" exams of different classes are told apart |
| 4 | Status | `ExamStatusBadge` (**New**, lane-local): DRAFT → neutral "খসড়া", PROCESSED → info "প্রক্রিয়াকৃত", PUBLISHED → success "প্রকাশিত". | D27 |
| 5 | Name cell | Plain link `font-medium hover:text-primary` (no underline) to `/exams/$examId`. | D29 — underline only inside a sentence |
| 6 | Row actions | `RowActions`: view (`to` the detail) · **New** edit (opens `ExamFormDialog mode="edit"`, only with `EXAM_MANAGE`). | D19; the dialog's edit mode exists but is unreachable today |
| 7 | Footer | `DataTable` default page size 25 (drop `limit: 10`), `TableCount` "১–৫ দেখানো হচ্ছে, মোট ৫". | D19, B23 |
| 8 | Empty | `EmptyState` (`file-pen-line`): "এখনো কোনো পরীক্ষা নেই" + "প্রথম পরীক্ষা যোগ করলে নম্বর দেওয়া শুরু করা যাবে।" + outline "পরীক্ষা যোগ করুন" (only with `EXAM_MANAGE`). With filters set: "এই ফিল্টারে কোনো পরীক্ষা নেই" + "ফিল্টার বদলে আবার দেখুন।" + outline "সব মুছুন". | D28 |
| 9 | Create / edit dialog | `DialogContent size="md"`; every field a `FormField` with visible label; নাম, শিক্ষাবর্ষ, শ্রেণি carry the required mark; empty selects show "বাছুন" at full width; শ্রেণি disabled until a year is picked; the error line shows `examForm.errorMessage`, never `mutation.error.message`. | D21, D25, D9 |

## Mobile behaviour
- Header: title, subtitle, then the primary full width.
- Filters: one outline button "ফিল্টার (n)" opens the `FilterSheet` with both selects; chips stay visible under it. There is no search box (the API has none).
- Rows are cards: name (`text-h3`) + status badge, subtitle "সপ্তম শ্রেণি · শিক্ষাবর্ষ ২০২৬", a `dl` with ধরন, action row "দেখুন" · "সম্পাদনা" with labels.
- Pager stacks under the count.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Edit action | leave unreachable / list row / detail page only | list row (and the detail page's More menu in exams-2a) | The dialog and `PATCH /exams/:id` already exist; a typo in an exam name cannot be fixed today. No new API. |
| Delete action | add / leave out | leave out | No `useDeleteExam` hook exists (`ui/src/hooks` is not ours); not requested — see Out of scope. |
| Class filter | none / always on / only after a year | only after a year | `useClasses({ academic_year_id })` returns one year's classes; without a year the same class name would appear once per year. |
| Academic year names | `useAcademicYears()` / with a large limit | `useAcademicYears({ limit: 100 })` | Server default is 10 (same trap as B13); a missing name renders a skeleton bar, never the id. |
| Status badge helper | inline in each route / one lane file | `-exam-status-badge.tsx` | exams-2a uses the same mapping in the detail header. |

## Files
- `client-admin/src/routes/_staff/exams/index.tsx` — header, FilterBar, columns, row actions, empty states, edit dialog wiring, page size
- `client-admin/src/routes/_staff/exams/index.test.tsx`
- `client-admin/src/routes/_staff/exams/-exam-status-badge.tsx` — **New** (also used by exams-2a, runs later)
- `client-admin/src/routes/_staff/exams/-exam-form-dialog.tsx` — size, labels, required marks, placeholders, translated error, class disabled until year
- `client-admin/src/routes/_staff/exams/-exam-form-dialog.test.tsx`
- `ui/src/i18n/locales/{en,bn}/exams.json` — keys below

## Steps
1. **Locale (`exams.json`, en + bn).** Add under `list`: `subtitle` "Every exam belongs to one class and one academic year." / "প্রতিটি পরীক্ষা একটি শ্রেণি ও একটি শিক্ষাবর্ষের।"; `columnClass` "Class" / "শ্রেণি"; `columnAcademicYear` "Academic year" / "শিক্ষাবর্ষ"; `classLabel` "Class" / "শ্রেণি"; `allClasses` "All classes" / "সব শ্রেণি"; `classNeedsYear` "Pick an academic year first" / "আগে শিক্ষাবর্ষ বাছুন"; `view` "View" / "দেখুন"; `edit` "Edit" / "সম্পাদনা"; `emptyTitle` "No exams yet" / "এখনো কোনো পরীক্ষা নেই"; `emptyText` "Add the first exam to start entering marks." / "প্রথম পরীক্ষা যোগ করলে নম্বর দেওয়া শুরু করা যাবে।"; `noMatchTitle` "No exams match these filters" / "এই ফিল্টারে কোনো পরীক্ষা নেই"; `noMatchText` "Change the filters and look again." / "ফিল্টার বদলে আবার দেখুন।". Delete `list.emptyMessage`. Under `examForm`: `classNeedsYear` same text as above; change `academicYearPlaceholder` and `classPlaceholder` to "Select" / "বাছুন" (D25).
2. **`-exam-status-badge.tsx`.** `export function ExamStatusBadge({ status }: { status: Exam['status'] })` → `<StatusBadge tone={TONE[status]} label={t(\`status.${status}\`)} />` from `@biddaloy/ui`, `TONE = { DRAFT: 'neutral', PROCESSED: 'info', PUBLISHED: 'success' }`.
3. **`index.tsx` — header.** `ListShell` `title={t('list.title')}`, `subtitle={t('list.subtitle')}`, primary action `PageAction` `{ id: 'add', label: t('list.addExam'), icon: <Plus />, priority: 'primary', allowed: canManage, onClick: () => setCreateOpen(true) }` (keep the `?create=1` / `?template=` handling as is).
4. **`index.tsx` — filters.** Replace the bare `Select` with the `FilterBar` (`filterBar` slot of `ListShell`) and two select fields: `academic_year_id` (label `list.academicYearLabel`, first option `list.allAcademicYears`, options from `useAcademicYears({ limit: 100 })`) and `class_id` (label `list.classLabel`, first option `list.allClasses`, options from `useClasses({ academic_year_id }, { enabled: !!academicYearId })`, disabled with placeholder `list.classNeedsYear` while no year is set). Setting a new year sets `class_id` to `undefined`. Send `class_id` to `useExams` when set. Keep the `ALL_VALUE` sentinel only if `FilterBar` still needs it; chips show "শিক্ষাবর্ষ: ২০২৬", "শ্রেণি: সপ্তম" (names, never ids).
5. **`index.tsx` — table.** `useListShellState()` without `{ limit: 10 }`; drop `pageSizeLabel` if the kit `DataTable` supplies it. Columns: `name` (`Link` `className="font-medium hover:text-primary"`), `class` (`row.class?.name ?? '—'`), `academicYear` (`yearNameById.get(row.academic_year_id)` — while the year list is loading render `<Skeleton className="h-3 w-12" />`, if still missing `—`), `kind` (`t(\`kind.${row.kind}\`)`), `status` (`<ExamStatusBadge status={row.status} />`). `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: \`/exams/${row.id}\` }, { intent: 'edit', label: t('list.edit'), allowed: canManage, onClick: () => setEditing(row) }]}`. `emptyState` per Change 8 (choose the "no match" variant when any filter is set; its action clears the filters).
6. **`index.tsx` — edit.** `const [editing, setEditing] = useState<Exam | null>(null)`; render a second `ExamFormDialog` with `mode="edit"`, `examId={editing.id}`, `initialValues={{ name: editing.name, kind: editing.kind }}`, `open={editing !== null}`, `onOpenChange={(o) => !o && setEditing(null)}`, `onSaved={() => setEditing(null)}` (the update hook already invalidates the list).
7. **`-exam-form-dialog.tsx`.** `DialogContent size="md"`. Each field uses `FormField` (label + control, `gap-1.5`); fields `flex flex-col gap-4`. Required mark on নাম, শিক্ষাবর্ষ, শ্রেণি (create mode). Class `Select` `disabled={!academicYearId}` with placeholder `examForm.classNeedsYear` while disabled. Error block: validation error as today; a failed mutation shows `t('examForm.errorMessage')` only. Footer per the Dialog pattern (Cancel outline, then primary "সংরক্ষণ করুন" with `loading`). No other behaviour change.
8. Run `pnpm --filter client-admin test exams/index exams/-exam-form`, then `graphify update .`.

## Tests
- `index.test.tsx` — columns include শ্রেণি and শিক্ষাবর্ষ with names (mock `class: { name: 'Class 7' }` and a year list), status renders as a badge with the translated label (no `DRAFT` text); view action links to `/exams/<id>`; edit action opens the dialog titled `examForm.editTitle` prefilled with the name, and is absent without `EXAM_MANAGE`; class filter is disabled until a year is chosen and sends `class_id`; empty list shows `list.emptyTitle`; filtered empty shows `list.noMatchTitle`; existing `?create=1` test still passes.
- `-exam-form-dialog.test.tsx` — a rejected mutation shows `examForm.errorMessage` and not the server text; class select is disabled with no year.
- `e2e/journeys/exam-controller-role.spec.ts` — reads comboboxes by `examForm.academicYearLabel` / `classLabel`; no change expected, run it.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Every row shows class and academic year names; no UUID while the year list loads.
- [ ] Status is a coloured badge with an icon.
- [ ] Both filters have visible labels; the class filter waits for a year.
- [ ] Footer shows the total; default page size is 25.
- [ ] An exam's name can be edited from its row.

## Out of scope
- Deleting an exam: the API has `DELETE /exams/:id` but `ui/src/hooks/exams.ts` has no hook; not added (D1, not requested). Filed as a shared request.
- The crumb's raw `entities.exam` key (B15) and the missing `/exams` sidebar label (#1221) — 31.3.4.
- "প্রক্রিয়াকৃত" stays as the PROCESSED label; the glossary does not cover it.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| useDeleteExam() hook for DELETE /exams/:id | Accepted | 31.2.14d | import { useDeleteExam } from '@biddaloy/ui/hooks'; mutate(examId); invalidates the exams list |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: exams   Decisions: D9, D16, D19, D21, D24, D25, D27, D28, D29   Depends on: 31.3.8b
