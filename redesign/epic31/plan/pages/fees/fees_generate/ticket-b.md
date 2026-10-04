# [31.4.fees-3b] Create fee bills form — full-page modal, plain steps

## Goal
The create-bills form (`GenerateFeesModal`) matches the "after" screenshots of `fees_generate_new`: a `FullPageShell` with four cards (মেয়াদ, শিক্ষার্থী, ফি, যাচাই করুন), every field labelled, a MonthPicker instead of a month select + number box, students listed with their registration number and an "inactive" badge, a plain bill count, duplicates explained by name, and Cancel / "বিল তৈরি করুন" in the footer. The export name and props stay the same, so `/fees/generate` and the student detail page keep working.

Split: this is part **b**; it runs after fees-3a (`ticket.md`), which already opens the form through `/fees/generate?generate=1`.

## What and why
The accountant uses this form to bill a set of students for a month (or a week). Today it is a 672 px dialog that stacks a dozen unlabelled controls (`aria-label` only), asks for the month as a select plus a typed year, hides the inactive-student warning in a hover tooltip, sums everything in one grey footer line, shows raw ids when a duplicate's name is unknown and shows backend error text. It also fires a `PROGRAM_READ` request an accountant cannot make (same red toast as B10). The redesign moves it into a full-page modal (D21: more than 6 fields and a list; D23 names it), groups it into four cards with visible labels, and keeps every behaviour (preview → duplicates → generate, program audience, select-all, Ctrl+Enter).

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_generate/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_generate/before-mobile.webp?raw=true" width="260"> |
| After — list (fees-3a) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_generate/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_generate/mobile.webp?raw=true" width="260"> |
| Before — create form | _not captured_ | _not captured_ |
| After — create form | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_generate_new/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_generate_new/mobile.webp?raw=true" width="260"> |

The "after" form shows the state right after a preview found two duplicates (the warning box and the three choices appear only then).

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | `FullPageShell` (size `form`), title "ফির বিল তৈরি করুন", Close "বন্ধ করুন"; footer secondary "বাতিল করুন", primary "বিল তৈরি করুন" (disabled until the form is complete, busy while previewing/generating). Asks before discarding when dirty. | D21, D22, D23. |
| 2 | মেয়াদ card | Fields শিক্ষাবর্ষ*, মেয়াদের ধরন, মাস* (`MonthPicker`) or সপ্তাহ শুরু* (`DatePicker`), শেষ তারিখ* (`DatePicker`) with help "মেয়াদ শুরুর ৯ দিন পর — চাইলে বদলান।" (**New**). | D25 (no number box for the year, no native date input), visible labels. |
| 3 | শিক্ষার্থী card | Title + "৪০ জন নির্বাচিত" pill; labelled search, শ্রেণি, শাখা (disabled while "সব শ্রেণি"), প্রোগ্রাম (only with `PROGRAM_READ`), checkbox "নিষ্ক্রিয় শিক্ষার্থীও দেখান"; "৪২ জন মিলেছে" (**New**) + ghost "মিলে যাওয়া ৪২ জন সবাইকে বাছুন"; list rows = checkbox + name + registration number, inactive rows carry a neutral StatusBadge "নিষ্ক্রিয়" (**New**, replaces the tooltip and the 50 % opacity). | D24/D25 labels, touch has no hover, B10-style toast. |
| 4 | ফি card | Checkbox rows with name and amount on the right; "প্রতি শিক্ষার্থী ৳২,০০০.০০" under the list. | Same data, readable. |
| 5 | যাচাই করুন card | "৭৮টি বিল তৈরি হবে" (`text-h3`) + "৪০ জন শিক্ষার্থী × ২টি ফি"; when the preview finds duplicates: a warning box naming them ("সাদিয়া ইসলাম — মাসিক বেতন — সপ্তম") and three radio rows with a hint each; checkbox row "বিল তৈরি হলে পরিবারকে জানান". | Count where the decision is made; D9 (no raw id fallback). |
| 6 | Errors | Submit errors are translated sentences only (`errors.rateLimited` / `errors.unknown`), never `error.message`; select-all failure says "সবাইকে বাছাই করা যায়নি।" (**New**) or the existing "too many" sentence. | D9. |
| 7 | Student page | Unchanged call: `recurring-fees-tab.tsx` still renders `<GenerateFeesModal open={billOneOffOpen} onOpenChange={setBillOneOffOpen} preselectedStudent={…} />`; the "Bill one-off" button sets `billOneOffOpen`; the full-page modal now covers the student page and closing returns to the tab. | Same export name and props (students lane imports it unchanged). |

## Mobile behaviour
- Header: title (truncates) + Close; footer: Cancel left, primary right, both 44 px, in normal flow under the body in the mockup (sticky in the app).
- Every card is one column; the class / section / program selects stack.
- Student rows and fee rows are 44 px touch targets (the whole row toggles the checkbox).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Body width | `form` (`max-w-3xl`) · `wide` (`max-w-5xl`) | `form` | The lists are checkbox inputs, not a data table or preview; one readable column. |
| Keep the component name | rename to `GenerateFeesPage` · keep `GenerateFeesModal` + props | keep | `students/-detail/recurring-fees-tab.tsx` (students lane) imports it unchanged. |
| State on reopen | persist across opens (today) · reset | reset (mount only while `open`) | A fresh form each time; matches FullPageShell being always-open. |
| URL on the student page | add `?bill=1` · local state | local state (unchanged) | The host file belongs to the students lane; noted under Out of scope. |
| Total amount in the summary | show · leave out | leave out | With "skip duplicates" the real total is unknown until generation; a wrong number is worse than none. |
| Section select while "all classes" | hidden (today) · disabled | disabled | No layout jump; same rule as fee-structures (fees-2). |
| Radio vs. select for the duplicate choice | select · radio rows with hints | radio rows (existing `RadioGroup`) | Three choices that need their explanation visible. |

## Files
- `client-admin/src/routes/_staff/fees/-generate/generate-fees-modal.tsx` — FullPageShell frame, cards, MonthPicker/DatePicker, summary, errors
- `client-admin/src/routes/_staff/fees/-generate/generate-fees-modal.test.tsx` — update / add assertions
- `client-admin/src/routes/_staff/fees/-generate/generate-fees-modal.stories.tsx` — show the full-page state
- `client-admin/src/routes/_staff/fees/-generate/audience-picker.tsx` — card layout, labels, inactive badge, `PROGRAM_READ` gate
- `client-admin/src/routes/_staff/fees/-generate/audience-picker.test.tsx` — update assertions
- `client-admin/src/routes/_staff/fees/-generate/fee-picker.tsx` — card layout, per-student total
- `client-admin/src/routes/_staff/fees/-generate/fee-picker.test.tsx` — update assertions
- `client-admin/src/routes/_staff/fees/-generate/duplicates-step.tsx` — warning box, radio rows, no raw ids
- `client-admin/src/routes/_staff/fees/-generate/duplicates-step.test.tsx` — update assertions
- `ui/src/i18n/locales/bn/feeGeneration.json` — keys below
- `ui/src/i18n/locales/en/feeGeneration.json` — same keys
- `e2e/journeys/generation.spec.ts` — month / due-date steps

## Steps
1. **Mount only while open.** Keep `export interface GenerateFeesModalProps` exactly. `export function GenerateFeesModal({ open, onOpenChange, preselectedStudent }: GenerateFeesModalProps) { if (!open) return null; return <GenerateFeesFullPage onClose={() => onOpenChange(false)} preselectedStudent={preselectedStudent ?? null} />; }`. Move today's body into `function GenerateFeesFullPage(…)`. Seed `selectedStudents` with `React.useState(() => preselectedStudent ? new Map([[preselectedStudent.id, preselectedStudent.name]]) : new Map())` and delete the `[open, preselectedStudent]` effect. `resetAndClose` becomes `onClose` (state dies with the component).
2. **Frame.** Return `<FullPageShell title={t('title')} onClose={onClose} dirty={dirty} size="form" primary={{ label: t('review.submitAction'), onClick: () => handleGenerateClick(), busy: previewMutation.isPending || generate.isPending, disabled: !canGenerate }} secondary={{ label: t('modal.cancel'), onClick: onClose }}>` (`@biddaloy/ui/shells`). `dirty = selectedFees.size > 0 || programId !== undefined || dueDateTouched || selectedStudents.size > (preselectedStudent ? 1 : 0)`. Make `handleGenerateClick(event?: React.FormEvent)` call `event?.preventDefault()`. Body: `<form onSubmit={handleGenerateClick} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGenerateClick(e); }} className="space-y-6">` holding four `<Card padded>`s (`@biddaloy/ui/components`), each titled `<h2 className="text-h2">` + optional `<p className="mt-0.5 text-text-secondary">`. Delete `Dialog*` imports and `className="max-w-2xl"`.
3. **মেয়াদ card** (title `section.periodTitle`, text `section.periodDescription`), fields in `grid gap-4 md:grid-cols-2`; every field = `<div className="flex flex-col gap-1.5">` + `<Label htmlFor>` + control with that `id`; required mark per patterns.md §6 on year, month/week start, due date.
   - Year: `Select` with `SelectTrigger id="generate-year"` (drop its `aria-label`), `SelectValue` without `placeholder` (foundation default "বাছুন").
   - Period type: `Select`, label `period.typeLabel`.
   - Month: `<MonthPicker id="generate-month" value={month && calendarYear ? `${calendarYear}-${month.padStart(2, '0')}` : undefined} onValueChange={(v) => { const [y, m] = v.split('-'); setCalendarYear(y); setMonth(String(Number(m))); }} min={…} max={…} />` with `min`/`max` = the selected year's `start_date`/`end_date` sliced to `YYYY-MM`. Delete `MONTHS`, the month `Select` and the year `Input`.
   - Week start: `DatePicker` (value `Date | undefined`; change `weekStart` state to `Date | undefined`, `periodStart` uses it directly).
   - Due date: `DatePicker`; change `dueDate` state to `Date | undefined`; the default effect sets `addDays(periodStart, 9)`; `onValueChange` also sets `dueDateTouched`. Serialize with the existing `toDateInputValue` (keep its comment — it documents the UTC bug). Help text `period.dueDateHelp`.
4. **শিক্ষার্থী card** — `AudiencePicker` renders the whole card (only this file uses it):
   - Header row `flex items-start justify-between gap-3`: h2 `audience.heading` + `section.studentsDescription`; pill `inline-flex h-6 shrink-0 items-center rounded-full bg-secondary px-2 text-label text-secondary-foreground` with `audience.selectedCount` (keep `data-testid="selected-count-chip"`).
   - `grid gap-4 md:grid-cols-3`: search Field `md:col-span-3` (visible Label `audience.searchLabel`, search icon inside, keep the Enter-swallow); class, section, program Fields; section `disabled={classId === ALL_VALUE}` instead of hidden; program Field rendered only when `onProgramIdChange && canReadPrograms` (`useHasPermission(Permission.PROGRAM_READ)`), and the query becomes `useQuery({ ...programsQueryOptions({ includeArchived: false }), enabled: canReadPrograms })`; "include inactive" = `<label className="flex min-h-11 items-center gap-3 md:col-span-3 md:min-h-8"><Checkbox …/>{label}</label>` (no `aria-label` on the Checkbox).
   - Row `mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3`: `<p className="text-text-secondary">{t('audience.matchCount', { count: studentsQuery.data?.total ?? 0 })}</p>` + `<Button variant="ghost" className="text-primary">` with `ListChecksIcon` + `audience.selectAllMatching`. Select-all error: `<p role="alert" className="flex items-center gap-1 text-caption text-destructive">` + ghost retry; message = 413 → `selectAllTooManyMatches`, else `audience.selectAllFailed` (never `error.message`).
   - List `<ul aria-label={t('audience.heading')} className="mt-2 max-h-80 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">`; row `<li className="px-3"><label className="flex min-h-11 items-center gap-3 md:min-h-9"><Checkbox checked onCheckedChange aria-label={student.full_name} /><span className="min-w-0 flex-1"><span className="block">{student.full_name}</span><span className="block text-caption text-text-secondary">{student.registration_number}</span></span>{!isActive && <StatusBadge tone="neutral" label={t('audience.inactiveBadge')} />}</label></li>`. Delete the `Tooltip` wrapper and `opacity-50`. Loading / empty rows: `<li className="px-3 py-3 text-text-secondary">`.
5. **ফি card** — `FeePicker` renders the card: h2 `fees.heading`, text `t('fees.description', { year: academicYearName })` (new prop `academicYearName: string`, the selected year's `name`); list styled like the student list (no max-height), row `label` = Checkbox + name + `<span className="ms-auto shrink-0 tabular-nums text-text-secondary">{amount}</span>`; under it `<p className="mt-3 text-text-secondary">{t('fees.perStudent', { amount: formatCurrency(runningTotal, config) })}</p>`. Remove the `studentCount` prop.
6. **যাচাই করুন card** (title `review.title`):
   - `bills` = today's expression; `<p className="mt-2 text-h3">{t('summary.bills', { count: bills })}</p>` and `<p className="text-text-secondary">{t('summary.detail', { students: effectiveStudentCount, fees: feeCount })}</p>`; the program-only case shows `summary.programAudience` instead of both lines.
   - `DuplicatesStep` (rewrite, same props): warning box `mt-4 rounded-md bg-status-due-bg p-4 text-status-due-fg` with `role="status"`: `<p className="flex items-center gap-2 font-medium"><ClockIcon className="size-4" aria-hidden />{t('duplicates.heading')}</p>` + `<ul className="mt-2 list-disc space-y-1 ps-5">` of `t('duplicates.row', { student: studentNames.get(id) ?? t('audience.unknownStudentName'), fee: feeStructureNames.get(id) ?? t('duplicates.unknownFee') })`; inactive count as `<p className="mt-2">`. Then `RadioGroup` `aria-label={t('duplicates.decisionLabel')}` `className="mt-3"`; each option `<label className="flex min-h-11 items-start gap-3 py-2"><RadioGroupItem value className="mt-0.5" /><span><span className="block font-medium">{label}</span><span className="block text-caption text-text-secondary">{hint}</span></span></label>`.
   - Notify: `<div className="mt-3 border-t border-border-subtle pt-3">` + checkbox row (as in step 4), label `notify.label`.
   - Submit error under it: `<p role="alert" className="mt-3 flex items-center gap-1 text-caption text-destructive"><CircleAlertIcon className="size-3.5" aria-hidden />{describeSubmitError(…)}</p>`; `describeSubmitError` returns `errors.rateLimited` for 429 / `RateLimitedError`, otherwise `errors.unknown` — delete the `error.message` branch.
7. Remove every `text-sm` / `text-xs` / `text-muted-foreground` className in the four component files; update each file's header comment ("full-page modal, D22", not "Dialog").
8. **i18n** (`feeGeneration.json`, bn / en):
   - change `title`: "ফির বিল তৈরি করুন" / "Create fee bills"; `modal.cancel`: "বাতিল করুন" / "Cancel"; `review.submitAction`: "বিল তৈরি করুন" / "Create bills"; `period.typeLabel`: "মেয়াদের ধরন" / "Period type"; `notify.label`: "বিল তৈরি হলে পরিবারকে জানান" / "Notify families when bills are created"
   - add `section.periodTitle`: "মেয়াদ" / "Period"; `section.periodDescription`: "কোন সময়ের বিল, আর কবের মধ্যে দিতে হবে।" / "Which period to bill, and when it is due."; `section.studentsDescription`: "কাদের বিল হবে, বেছে নিন।" / "Choose who gets a bill."; `review.title`: "যাচাই করুন" / "Check and create"
   - add `period.dueDateHelp`: "মেয়াদ শুরুর ৯ দিন পর — চাইলে বদলান।" / "9 days after the period starts — change it if you need to."
   - add `audience.matchCount_one/_other`: "{{count}} জন মিলেছে" / "{{count}} match" · "{{count}} match"; `audience.inactiveBadge`: "নিষ্ক্রিয়" / "Inactive"; `audience.selectAllFailed`: "সবাইকে বাছাই করা যায়নি।" / "Couldn't select everyone."
   - add `fees.description`: "{{year}} শিক্ষাবর্ষের ফি কাঠামো থেকে বাছুন।" / "Choose from the {{year}} fee structures."; `fees.perStudent`: "প্রতি শিক্ষার্থী {{amount}}" / "{{amount}} per student"
   - add `summary.bills_one/_other`: "{{count}}টি বিল তৈরি হবে" / "{{count}} bill will be created" · "{{count}} bills will be created"; `summary.detail`: "{{students}} জন শিক্ষার্থী × {{fees}}টি ফি" / "{{students}} students × {{fees}} fees"
   - change `duplicates.heading`: "এই মেয়াদের কিছু বিল আগে থেকেই আছে" / "Some bills for this period already exist"; `duplicates.row`: "{{student}} — {{fee}}" / "{{student}} — {{fee}}"; `duplicates.skipHint`: "যাদের এই মেয়াদের বিল নেই, শুধু তাদের বিল তৈরি হবে।" / "Only students without a bill for this period get one."; `duplicates.removeOlderLabel`: "আগের বিলটি মুছে নতুন তৈরি করুন" / "Delete the old bill and create a new one"; `duplicates.removeOlderHint`: "নতুন বিল তৈরির আগে পুরনো বিলটি মুছে ফেলা হবে।" / "The old bill is deleted before the new one is created."; `duplicates.createAnywayHint`: "একই মেয়াদের জন্য দ্বিতীয় একটি বিল তৈরি হবে। অ্যাডমিনের অনুমোদন লাগবে।" / "Creates a second bill for the same period. Needs admin approval."
   - add `duplicates.unknownFee`: "একটি ফি" / "A fee"; `duplicates.decisionLabel`: "আগে থেকে থাকা বিল নিয়ে কী করবেন" / "What to do with existing bills"
   - delete `modal.description`, `audience.inactiveTooltip`, `fees.runningTotal`, `summary.line`, and `months.*` (only the deleted month select used them — confirm with `rg "months\." client-admin/src e2e`).

## Tests
- `generate-fees-modal.test.tsx`:
  - open → an `h1` "ফির বিল তৈরি করুন" and a "বন্ধ করুন" button; `open={false}` renders nothing.
  - picking "অক্টোবর ২০২৬" in the MonthPicker sends `period_start: '2026-10-01'` in the preview request; the due date defaults to "১০ই অক্টোবর, ২০২৬".
  - with a fee ticked, Close opens the discard confirm; Cancel keeps the form.
  - `preselectedStudent` → pill "১ জন নির্বাচিত" and Close closes without a confirm (not dirty).
  - an `ApiError` with message "Internal thing" shows `errors.unknown`, not the message.
  - a duplicate whose student is not in the selection map shows `audience.unknownStudentName`, never an id.
  - footer primary is disabled until year, month, due date, a student and a fee are set.
- `audience-picker.test.tsx`: without `PROGRAM_READ` there is no program field and no `GET /programs`; an inactive student row shows "নিষ্ক্রিয়"; the section select is disabled while "সব শ্রেণি".
- `fee-picker.test.tsx`: per-student total reads "প্রতি শিক্ষার্থী ৳…" in tenant digits.
- `duplicates-step.test.tsx`: three radios named by their labels; unknown fee id shows "একটি ফি".
- `e2e/journeys/generation.spec.ts`: replace the month combobox + year `fill` (`:116-118`) with opening the MonthPicker (`getByRole('button', { name: t('feeGeneration.period.monthLabel') })`) and choosing January of 2026; replace the due-date `fill('2026-01-10')` (`:119`) with the DatePicker (or rely on the default, which is the 10th); inside `getByRole('dialog')` find the submit by `t('feeGeneration.review.submitAction')` (`:76-77`, `:166-167`). `FullPageShell` is a Radix dialog, so the `getByRole('dialog')` checks stay.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The form covers the app chrome; Close / Esc ask before discarding changes.
- [ ] Every field has a visible label; no number box for the year, no native date input.
- [ ] An accountant without `PROGRAM_READ` sees no program field and no red toast.
- [ ] The "Bill one-off" action on a student's fees tab opens this form with that student selected; closing returns to the tab.
- [ ] Ctrl/Cmd+Enter still submits.

## Out of scope
- URL reflection for the form when opened from the student page (`students/-detail/recurring-fees-tab.tsx`, students lane) — it keeps local state; the students lane may add `?bill=1`.
- Sorting fees by the students' majority class (`majorityClassId` seam) — unchanged.
- Palette action `fees.generate` → `/fees/generate?generate=1` — filed in shared-requests.md.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| FeeGeneration source union includes FINE_RULE | Accepted | 31.2.14d | FeeGeneration['source'] / FeeGenerationsFilters['source'] include 'FINE_RULE' — drop the `as string` casts |
| palette fees.generate -> /fees/generate?generate=1 | Accepted | 31.5.1b | run() becomes /fees/generate?generate=1, kind navigate; keep the key name generate |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: fees   Decisions: D9, D21, D22, D23, D25, D27, D29   Depends on: 31.3.8b, 31.4.fees-3a
