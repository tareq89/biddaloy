# [31.4.students-6a] Student detail Enrollment, Subjects, Programs tabs — cards and names

## Goal
The student's "ভর্তি তথ্য", "বিষয় নির্বাচন" and "প্রোগ্রাম" tabs match the "after" screenshots' look: an enrolment-history card with its action in the card header, long dates, subject names in the reader's language (never an id), program status badges, and no filled button inside a tab.
Split for size: Attendance, Results, Homework and Performance are students-6b (b runs after a).

## What and why
These tabs show where the student has studied, which optional subjects they picked and which programs they are in. Today the enrolment table shows ISO dates, splits class and section into two columns and puts the promotion-override sentence in an extra full-width row; the subject picker shows English subject names in the Bangla UI and falls back to the raw subject id, and prints backend error text; the Programs tab has a filled "নথিভুক্ত করুন" next to the header's primary, ISO dates and its status as grey plain text. The redesign uses a Card with header action, `DataTable` (unpaginated), `StatusBadge`, `EmptyState`, and translated, formatted values.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_enrollment/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_enrollment/mobile.webp?raw=true" width="260"> |

The shot is the Enrollment tab; Subjects and Programs use the same Card and row styles.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Enrollment card | One Card: header row = h2 "ভর্তির ইতিহাস" (**New** key) + outline "শ্রেণি পরিবর্তন" (`arrow-right-left`), then the table, then "মোট n টি". Today the button floats alone above a bare table. | Control next to what it changes. |
| 2 | Enrollment columns | শিক্ষাবর্ষ · শ্রেণি (`সপ্তম · শাখা ক`, class + section merged) · অবস্থা (StatusBadge) · ভর্তির তারিখ (`formatDate`, was ISO). Newest first. | D5, kit DataTable. |
| 3 | Override note | The promotion-override sentence sits under the year in the same row (`text-caption text-status-due-fg` + `info` icon), not in an extra full-width row. The header shows the short badge (students-4). | Belongs to the row. |
| 4 | Move-class dialog | `DialogContent size="sm"`; select placeholders "বাছুন"; capacity warning as a warning box (`bg-status-due-bg text-status-due-fg` rounded-md p-3 with `triangle-alert`). | D21, D25. |
| 5 | Subject names | Name = `name_bn` when the UI is Bangla and it exists, else `name_en`; an unknown id shows "—", never the id. | D9. |
| 6 | Subject picker layout | Each choice group and the 4th-subject group is a Card holding a `fieldset` (legend `text-h3`); each option row is the whole 44 px target (`flex min-h-11 items-center gap-3 md:min-h-8`); "not picked yet" line in `text-text-secondary`. | D25, touch targets. |
| 7 | Subject save error | Always the translated `subjectChoicesPanel.errorMessage`, never `error.message`. Loading = Skeleton shaped like two cards. Empty = EmptyState. | D9, D28. |
| 8 | Programs action | Filled "নথিভুক্ত করুন" → outline (`plus`), top right; in the empty state it is the EmptyState's outline action. | D29. |
| 9 | Program card | Each enrolment is a Card: name `text-h3` + StatusBadge (ACTIVE success, COMPLETED info, WITHDRAWN neutral; labels from `programs:status.*`), dates `formatDateRange(started_on, ended_on)` or "{date} থেকে", progress bar on the right (below on phone), milestone checklist unchanged. | D5, D27. |

## Mobile behaviour
- Enrollment: two-line rows — year + badge, then "class · ভর্তি {date}", then the override note; the card-header button stays beside the title.
- Subjects: one Card per group, full-width option rows.
- Programs: progress bar moves under the name; enrol button full width above the list.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Class + section | two columns · one | One `সপ্তম · শাখা ক` | Same as the list page (students-1). |
| Override sentence | own row · inside the year cell | Inside the year cell | A DataTable row cannot hold a spanning sub-row; and it reads as part of that year. |
| Override wording ("ওভাররাইডের মাধ্যমে…") | Fix here · request | Request — the text lives in `promotions.json` | Namespace owned by the promotions lane (filed). |
| Subject language | always English · reader's language | Reader's language with English fallback | Bangla UI must not show English names when a Bangla name exists. |

## Files
- `client-admin/src/routes/_staff/students/-detail/enrollment-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/enrollment-tab.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/-transfer-dialog.tsx`
- `client-admin/src/routes/_staff/students/-detail/subject-choices-panel.tsx`
- `client-admin/src/routes/_staff/students/-detail/subject-choices-panel.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/subject-choices-panel.stories.tsx`
- `client-admin/src/routes/_staff/students/-detail/programs-panel.tsx`
- `client-admin/src/routes/_staff/students/-detail/programs-panel.test.tsx`
- `ui/src/i18n/locales/bn/students.json` — keys below (also changed by students-1…5b, run earlier)
- `ui/src/i18n/locales/en/students.json` — same keys

## Steps
1. **`enrollment-tab.tsx`.** Wrap everything in `<Card className="overflow-hidden">` (no padding). Header `<div className="flex items-center justify-between gap-3 p-4 md:px-5"><h2 className="text-h2">{t('detail.enrollment.title')}</h2>{canUpdate && <Button variant="outline" onClick={…}><ArrowRightLeftIcon />{t('detail.enrollment.moveClassAction')}</Button>}</div>`. Inside `TabQueryState`, `DataTable tableId="student-enrollments" paginated={false}` on `[...enrollments].sort((a, b) => b.enrolled_at.localeCompare(a.enrolled_at))`, columns `academicYear` (cell = year name + the override line when `override` matches, `<span className="mt-1 flex items-start gap-1 text-caption text-status-due-fg"><InfoIcon className="mt-0.5 size-3.5 shrink-0" />{t(\`badge.${…}\`, { ns: 'promotions', … })}</span>`), `class` (`t('detail.enrollment.classValue', { class: e.class.name, section: e.section?.section_name ?? '—' })`), `status` (StatusBadge), `enrolledAt` (`formatDate(e.enrolled_at, regionConfig)`); card subtitle `t('detail.enrollment.cardSubtitle', { class, date })`; `emptyState={{ title: t('detail.enrollment.emptyMessage'), explanation: t('detail.enrollment.emptyExplanation') }}`. Remove the `columnSection` column and the extra override `TableRow`.
2. **`-transfer-dialog.tsx`.** `<DialogContent size="sm" closeLabel={…}>`; Select placeholders → `t('common:form.select')` if 31.3.4a added it, else change `detail.moveClassDialog.classPlaceholder` / `sectionPlaceholder` to "বাছুন" / "Select"; capacity warning `<p role="status" className="flex items-start gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg"><TriangleAlertIcon className="size-4 shrink-0" />…</p>`; error lines use the Error-text classes.
3. **`subject-choices-panel.tsx`.** `const { i18n } = useTranslation('exams')`; `nameOf = (id) => { const s = subjectById.get(id); if (!s) return t('list.emptyValue', { ns: 'students' }); return i18n.language === 'bn' && s.name_bn ? s.name_bn : s.name_en; }` (map stores the whole subject). Each `fieldset` → `<Card padded><fieldset className="flex flex-col gap-2"><legend className="text-h3">…`. Option `label` → `flex min-h-11 items-center gap-3 md:min-h-8`. Error line → `t('subjectChoicesPanel.errorMessage')` only. Loading → two `Skeleton className="h-32 w-full rounded-lg"` in `space-y-4`; empty → `EmptyState` (title `subjectChoicesPanel.empty`, explanation `detail.subjects.emptyExplanation` from `students`). Wrap the groups in `space-y-4`. Keep `fieldset`/`legend` (e2e finds `role="group"` by name).
4. **`programs-panel.tsx`.** Enrol button → `variant="outline"` + `PlusIcon`, in `flex justify-end` (`w-full md:w-auto`); empty → `EmptyState` (title `studentProgramsPanel.empty`, explanation `detail.programs.emptyExplanation`, `action={canManage ? { label: t('students.enrol'), onClick: () => setEnrolOpen(true) } : undefined}`). Each `li` → `<Card padded>`; header `flex flex-col gap-3 md:flex-row md:items-start md:justify-between`: left = `<div className="flex flex-wrap items-center gap-2"><h3 className="text-h3">{name}</h3><StatusBadge tone={PROGRAM_TONE[status]} label={t(\`status.${status}\`)} /></div>` + `<p className="mt-0.5 text-text-secondary">{dates}</p>`, right = ProgressBar. `PROGRAM_TONE = { ACTIVE: 'success', COMPLETED: 'info', WITHDRAWN: 'neutral' }` (default neutral). `dates = ended_on ? formatDateRange(started_on, ended_on, rc) : t('detail.programs.since', { ns: 'students', date: formatDate(started_on, rc) })`. List `space-y-3`.
5. **i18n** (`students.json`, bn / en):
   - add `detail.enrollment.title` "ভর্তির ইতিহাস" / "Enrolment history"
   - add `detail.enrollment.classValue` "{{class}} · শাখা {{section}}" / "{{class}} · Section {{section}}"
   - add `detail.enrollment.cardSubtitle` "{{class}} · ভর্তি {{date}}" / "{{class}} · Enrolled {{date}}"
   - add `detail.enrollment.emptyExplanation` "শ্রেণি পরিবর্তন করলে বা নতুন বছরে ভর্তি হলে এখানে দেখা যাবে।" / "Class moves and new-year enrolments show up here."
   - delete `detail.enrollment.columnSection`
   - add `detail.subjects.emptyExplanation` "এই শ্রেণিতে বেছে নেওয়ার মতো কোনো বিষয় নেই।" / "This class has no optional subjects to choose."
   - add `detail.programs.emptyExplanation` "কোনো প্রোগ্রামে নথিভুক্ত করলে অগ্রগতি এখানে দেখা যাবে।" / "Enrol the student in a program to track progress here."
   - add `detail.programs.since` "{{date}} থেকে" / "Since {{date}}"
   - (only if `common:form.select` does not exist) change `detail.moveClassDialog.classPlaceholder` and `sectionPlaceholder` to "বাছুন" / "Select"

## Tests
- `enrollment-tab.test.tsx`: enrolled date long form; one "শ্রেণি" column reading `সপ্তম · শাখা ক`, no "শাখা" header; newest year first; override text inside the first row; "শ্রেণি পরিবর্তন" is outline and hidden for a non-active student.
- `subject-choices-panel.test.tsx`: Bangla UI shows `name_bn`; a subject missing from the list shows "—", never its id; a failed save shows the translated message, not the server text; option rows still form a `group` per legend.
- `programs-panel.test.tsx`: enrol button is outline; status renders as a badge; dates long form; empty state's action opens the enrol dialog.
- `subject-choices-panel.stories.tsx`: update the fixture to include `name_bn`.
- E2E: `e2e/keyboard/subject-choices.spec.ts` (group by legend), `e2e/keyboard/programs.spec.ts` (program detail only) — run, no change expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (the header's).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Enrollment card has its action in the card header and shows "মোট n টি".
- [ ] Subject options never show an id or English name in Bangla when a Bangla name exists.
- [ ] Program status is a badge; no filled button in the Programs tab.

## Out of scope
- "ওভাররাইডের মাধ্যমে …" wording in `promotions.json` `badge.*` — promotions lane (filed).
- `EnrolDialog` / `RecordDialog` / `MilestoneChecklist` (programs lane / shared ui) — unchanged.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| promotions.json badge.* without "ওভাররাইড" | Accepted | 31.3.4b | badge.promote/retain/graduate start "বিশেষ বিবেচনায় উত্তীর্ণ / … একই শ্রেণিতে / … পাস সম্পন্ন"; same keys and placeholders |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: students   Decisions: D5, D9, D19, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.students-5b
