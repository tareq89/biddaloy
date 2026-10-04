# [31.4.fees-4a] Automatic billing — readable rules, full-page rule form

## Goal
`/fees/schedules` matches the "after" screenshots of `fees_schedules` (subtitle, one filled "নিয়ম যোগ করুন", plain-language columns, Bangla numerals, status badges, icon actions with a More menu, "মোট n টি"), the rule form matches `fees_schedules_new` as a `FullPageShell` opened by `?new=1` / `?edit=<id>`, the copy dialog follows the kit, and the red "no permission" toast is gone (B10).

Split: this is part **a** (list + rule form + copy dialog). Part **b** (`ticket-b.md`, fees-4b, the rule detail page) runs after it.

## What and why
An admin or accountant sets rules here so fee bills are created on their own every month or week. Today the column words are jargon ("শ্রোতা", "পরবর্তী রান"), the day reads `1 তারিখে` with a Latin digit, the next run is `২০২৬-১১-০১`, the last run would show the raw `2026-02-01`, status is plain text, "active students only" repeats on every row, the actions are three underlined links (one red), deactivating has no confirmation, and the 12-field form is squeezed into a scrolling dialog with unlabelled selects. The form is mounted even when closed, so its programs request makes an accountant see a red toast on page open (B10). The redesign uses PageHeader, DataTable with StatusBadge / RowActions / unpaginated total, a ConfirmDialog for switching off, and a FullPageShell form with four labelled cards.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules/mobile.webp?raw=true" width="260"> |
| Before — rule form | _not captured_ | _not captured_ |
| After — rule form | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules_new/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules_new/mobile.webp?raw=true" width="260"> |
| Before — rule detail (fees-4b) | _not captured_ | _not captured_ |
| After — rule detail (fees-4b) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules_id/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fees_schedules_id/mobile.webp?raw=true" width="260"> |

The form shot is the create mode with a monthly rule. Weekly rules show day chips instead of "মাসের কোন দিন" (step 6). The copy dialog is `PATTERN: Dialog (md)` at size `sm`; the switch-off confirm is `PATTERN: ConfirmDialog` with the default tone.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title "স্বয়ংক্রিয় বিল" (glossary), subtitle "নিয়ম অনুযায়ী শুধু সক্রিয় শিক্ষার্থীদের বিল নিজে থেকে তৈরি হয়।" (**New**), primary "নিয়ম যোগ করুন" (`plus`) → `?new=1`. | D16, D22, D32. |
| 2 | Columns | নাম (`font-medium`), কাদের জন্য (`সপ্তম · খ`, `পুরো বিদ্যালয় · হিফজ প্রোগ্রাম`), কখন (`প্রতি মাসের ১ তারিখে`, `প্রতি রবিবার ও বুধবার`), পরের বিল তৈরি (long date or "—"), শেষ বিল তৈরি (`অক্টোবর ২০২৬` / long date / muted "এখনো হয়নি"), অবস্থা (StatusBadge সক্রিয় / নিষ্ক্রিয়). "শুধু সক্রিয় শিক্ষার্থী" moves to the subtitle; the program now shows in the audience (**New**). | D5, D6, D9, D27, D32; the program-scoped rule read "whole school". |
| 3 | Row actions | `RowActions`: দেখুন (`view` → detail), সম্পাদনা (`edit` → `?edit=<id>`), অন্য শিক্ষাবর্ষে কপি করুন (`duplicate`), নিষ্ক্রিয় করুন (`archive`) / সক্রিয় করুন (`restore`); manage actions need `SCHEDULE_MANAGE`. The name is no longer a link. | D19. |
| 4 | Switch on / off | Both go through `ConfirmDialog` (default tone); switching off uses the existing unused `deactivateConfirm*` copy. | D29; switching off stops billing — it should not be one stray click. |
| 5 | Total | Unpaginated (`paginated={false}`), footer "মোট ৪টি". | D19: rules are few; the API is unpaginated. |
| 6 | Empty / error | `EmptyState` (glossary title) + sentence (**New**) + outline "নিয়ম যোগ করুন"; `ErrorState` with Retry. | D28. |
| 7 | B10 | The form mounts only while `?new=1` / `?edit=` is set, and its programs query runs only with `PROGRAM_READ`. | B10. |
| 8 | Rule form | `FullPageShell` titled "স্বয়ংক্রিয় বিলের নতুন নিয়ম" / "স্বয়ংক্রিয় বিলের নিয়ম সম্পাদনা"; cards: নাম ও শিক্ষাবর্ষ (name*, year* — locked on edit with help), ফি* (checkbox rows with amounts, **New** amounts), কাদের জন্য (শ্রেণি, শাখা disabled while whole school, প্রোগ্রাম only with `PROGRAM_READ`), কখন বিল তৈরি হবে (কত দিন পরপর, মাসের কোন দিন **or** weekday chips, পরিশোধের সময় (দিন) with help, শুরুর তারিখ*, শেষের তারিখ with "সর্বোচ্চ …" help, notify checkbox row); edit mode adds a card "এখন কতজন পাবে" with the existing preview button. Errors sit under their field and are all shown at once. | D21/D23 (12 fields → full page), D25. |
| 9 | Copy dialog | `DialogContent size="sm"`, visible Label tied to the year select, placeholder "বাছুন", "ক্লোন" → "কপি". | D21, D25, D32 (jargon). |

## Mobile behaviour
- Header: title, subtitle (truncates), primary full width.
- Cards: title = name, status badge on the right, subtitle = audience; fields কখন, পরের বিল তৈরি, শেষ বিল তৈরি; footer = labelled দেখুন, সম্পাদনা + More icon (copy, switch on/off).
- Form: one column; weekday chips wrap and are 44 px tall; footer Cancel / Save 44 px.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Pager | client paging (today) · unpaginated with total | unpaginated | Few rows; the API returns all of them. |
| Status words | চালু / বন্ধ · existing সক্রিয় / নিষ্ক্রিয় | existing keys | No new wording; "বন্ধ করুন" already means Close. |
| Confirm on switching on | none · confirm | confirm (default tone) | One component for both directions; switching on starts billing families. |
| Form URL | local state · `?new=1` and `?edit=<id>` | search params | D22; also fixes B10 because nothing mounts until asked. |
| "Active students only" | per row · once in the subtitle and the form | once | It is always true (`enrollment_status` accepts only `ACTIVE`). |
| Fee amounts in the form | names only (today) · name + amount | name + amount | Same data `useFeeStructures` already returns; avoids picking the wrong "monthly fee". |
| How many icons before More | per mockup (view, edit, More) · `RowActions` rule | the component's rule | patterns.md: first 3 allowed actions are icons, the rest go to More; the mockup shows the component's likely split, the component decides. |

## Files
- `client-admin/src/routes/_staff/fees/schedules/index.tsx` — header, search params, columns, RowActions, confirm, total, empty state
- `client-admin/src/routes/_staff/fees/schedules/index.test.tsx` — **New**
- `client-admin/src/routes/_staff/fees/schedules/-schedule-summary.ts` — **New**: `ruleSummary`, `audienceSummary`, `nextRunDate`, `lastBilledLabel` (moved out of `index.tsx`; fees-4b reuses them)
- `client-admin/src/routes/_staff/fees/schedules/-schedule-summary.test.ts` — **New**
- `client-admin/src/routes/_staff/fees/schedules/-schedule-form-dialog.tsx` — FullPageShell form
- `client-admin/src/routes/_staff/fees/schedules/-schedule-form-dialog.test.tsx` — update assertions
- `client-admin/src/routes/_staff/fees/schedules/-schedule-form-dialog.stories.tsx` — full-page state
- `client-admin/src/routes/_staff/fees/schedules/-clone-dialog.tsx` — kit dialog
- `client-admin/src/routes/_staff/fees/schedules/-clone-dialog.test.tsx` — update assertions
- `client-admin/src/routes/_staff/fees/schedules/-clone-dialog.stories.tsx` — label text
- `ui/src/i18n/locales/bn/fees.json` — `schedules.*` keys below (also changed by fees-1 and fees-3a, run earlier)
- `ui/src/i18n/locales/en/fees.json` — same keys (also changed by fees-1 and fees-3a, run earlier)

## Steps
1. **`-schedule-summary.ts`** (move, then change):
   - Move `ruleSummary`, `audienceSummary`, `dhakaNow`, `nextRunDate` and their helpers from `index.tsx` unchanged in logic; export `ruleSummary`, `audienceSummary`, `nextRunDate`, `dhakaNow`.
   - `ruleSummary(schedule, t, config, language)`: monthly → `t('schedules.ruleMonthly', { day: formatNumber(day, config) })` / `ruleMonthlyLast`; weekly → `t('schedules.ruleWeekly', { days: new Intl.ListFormat(language, { type: 'conjunction' }).format(names) })` (stdlib; gives "রবিবার ও বুধবার").
   - `audienceSummary(schedule, t, classesById, sectionsById, programsById)`: join class and section with `' · '` (not `' — '`); no class → `schedules.wholeSchool`; when `audience.program_id` is set append `programsById.get(id) ?? t('schedules.someProgram')`; drop the `activeOnly` part and its comment (moved to the subtitle).
   - **New** `lastBilledLabel(schedule, t, config)`: `null` → `t('schedules.neverBilled')`; `rule.kind === 'MONTHLY'` → `formatMonth(last_run_period.slice(0, 7), config)`; else `formatDate(last_run_period, config)`.
2. **Search params (D22, B10).** Add `validateSearch: z.object({ new: z.literal(1).optional().catch(undefined), edit: z.string().optional().catch(undefined) })`. `openNew = () => navigate({ search: (p) => ({ ...p, new: 1 }) })`, `openEdit = (id) => navigate({ search: (p) => ({ ...p, edit: id }) })`, `closeForm = useCloseFullPage(() => void navigate({ search: ({ new: _n, edit: _e, ...rest }) => rest, replace: true }))`. Render `{canManage && search.new === 1 && <ScheduleFormDialog open mode="create" onOpenChange={(o) => !o && closeForm()} onSaved={closeForm} />}` and `{canManage && editing && <ScheduleFormDialog open mode="edit" schedule={editing} … />}` with `const editing = search.edit ? allSchedules.find((s) => s.id === search.edit) : undefined`. Delete `createOpen` / `editing` state. Drop `useListShellState` and the client-side slicing.
3. **Header.** `ListShell` gets `subtitle={t('schedules.subtitle')}` and `actions={[{ id: 'add', label: t('schedules.addSchedule'), icon: <PlusIcon />, priority: 'primary', allowed: canManage, onClick: openNew }]}`; `paginated={false}`; remove `primaryAction`, `page*` props.
4. **Columns.**
   - `name`: `row.name` (DataTable gives `font-medium`), `card: 'title'`.
   - `audience` (header `columnAudience`): `audienceSummary(...)`, `card: 'subtitle'`. `programsById` from `useQuery({ ...programsQueryOptions({ includeArchived: true }), enabled: canReadPrograms })`, `canReadPrograms = useHasPermission(Permission.PROGRAM_READ)`.
   - `rule`: `ruleSummary(row, t, regionConfig, i18n.language)`.
   - `nextRun`: unchanged.
   - `lastRun`: `lastBilledLabel(...)`; render the never case in `text-text-secondary`.
   - `active` (header `columnActive`): `<StatusBadge tone={row.is_active ? 'success' : 'neutral'} label={t(row.is_active ? 'schedules.statusActive' : 'schedules.statusInactive')} />`, `card: 'badge'`.
   - Delete the `actions` column and `ScheduleRowActions`. `rowActions={(row) => [{ intent: 'view', label: t('schedules.view'), to: `/fees/schedules/${row.id}` }, { intent: 'edit', label: t('schedules.edit'), allowed: canManage, onClick: () => openEdit(row.id) }, { intent: 'duplicate', label: t('schedules.clone'), allowed: canManage, onClick: () => setCloning(row) }, row.is_active ? { intent: 'archive', label: t('schedules.deactivate'), allowed: canManage, onClick: () => setToggling(row) } : { intent: 'restore', label: t('schedules.activate'), allowed: canManage, onClick: () => setToggling(row) }]}`.
5. **Switch on / off.** `const [toggling, setToggling] = React.useState<RecurringSchedule | null>(null)`; render `{toggling && <ToggleScheduleConfirm schedule={toggling} onDone={() => setToggling(null)} />}` — a small component in `index.tsx` that calls `useUpdateRecurringSchedule(schedule.id)` and renders `<ConfirmDialog open tone="default" onOpenChange={(o) => !o && onDone()} title={t(schedule.is_active ? 'schedules.deactivateConfirmTitle' : 'schedules.activateConfirmTitle')} description={t(schedule.is_active ? 'schedules.deactivateConfirmDescription' : 'schedules.activateConfirmDescription')} confirmLabel={t(schedule.is_active ? 'schedules.deactivate' : 'schedules.activate')} busy={mutation.isPending} onConfirm={() => mutation.mutate({ is_active: !schedule.is_active }, { onSuccess: onDone })} />`.
6. **Rule form** (`-schedule-form-dialog.tsx`; keep the export name and `ScheduleFormDialogProps`).
   - `if (!open) return null;` then render an inner component that initialises state from `schedule` once (delete the reset-on-open effect; the component remounts each time).
   - `<FullPageShell title={isEdit ? t('schedules.form.editTitle') : t('schedules.form.createTitle')} onClose={() => onOpenChange(false)} dirty={dirty} size="form" primary={{ label: t('schedules.form.save'), onClick: () => handleSubmit(), busy: mutation.isPending }} secondary={{ label: t('schedules.form.cancel'), onClick: () => onOpenChange(false) }}>`; `dirty` = `JSON.stringify(snapshot()) !== initialSnapshot` (a `useRef` of the first snapshot of all field values, dates as `getTime()`).
   - Body `<form onSubmit={handleSubmit} className="space-y-6">`, four `<Card padded>`s titled `h2.text-h2` (`form.sectionName`, `form.feesLabel` + required mark, `form.audienceLegend` + text `form.activeOnlyNotice`, `form.ruleLegend`), fields as in patterns.md §6 (`flex flex-col gap-1.5`, `<Label htmlFor>`, ids on every `SelectTrigger`, no `aria-label`s).
   - Card 1 `grid gap-4 md:grid-cols-2`: name (`md:col-span-2`, placeholder `form.namePlaceholder`), year (`SelectValue` without placeholder → "বাছুন"; `disabled={isEdit}`; help `form.academicYearLocked`).
   - Card 2: `<ul className="mt-4 divide-y divide-border-subtle rounded-md border border-border-subtle">`, rows like the fees-3b fee list (Checkbox + name + `formatServerAmount(fee.amount)` at the end); error under the list.
   - Card 3 `grid gap-4 md:grid-cols-3`: class (`allClasses` option = "পুরো বিদ্যালয়"), section (always shown, `disabled={classId === ''}`), program (only when `canReadPrograms`; programs query `useQuery({ ...programsQueryOptions({ includeArchived: … }), enabled: canReadPrograms })` — B10).
   - Card 4 `grid gap-4 md:grid-cols-2`: kind (`form.ruleKindLabel`, options `ruleModeMonthly` / `ruleModeWeekly`); monthly → day select (options `t('schedules.form.dayOfMonthOption', { day: formatNumber(d) })` + `dayOfMonthLast`); weekly → `<div role="group" aria-labelledby=…>` of chips `inline-flex h-11 items-center rounded-full border px-4 md:h-8 md:px-3` + selected `border-primary bg-primary text-primary-foreground` / else `border-border-functional bg-surface text-text-primary hover:bg-muted`, `aria-pressed`; due days `Input inputMode="numeric"` (label `form.dueDaysLabel`, help `form.dueDaysHelp`, store a number, show digits in tenant numerals is not required for an input); an empty cell on desktop (`hidden md:block`); starts on `DatePicker` (required), ends on `DatePicker` with `max={yearEndDate}` and help `t('schedules.form.endsOnHelp', { date: formatDate(yearEndDate) })` (keep the clamp effect); then `<div className="mt-4 border-t border-border-subtle pt-3">` + notify checkbox row (`flex min-h-11 items-center gap-3 md:min-h-8`, no `aria-label`).
   - Edit only, Card 5 (title `form.previewTitle`): `flex flex-wrap items-center justify-between gap-3`, the existing preview text (fix the loading state to `form.previewLoading`, not `form.saving`) + outline `form.previewButton`.
   - Validation: `errors: { name?: string; fees?: string; weekdays?: string }`, all collected at once, each rendered under its control with the Error text classes + `aria-invalid` / `aria-describedby`; focus the first. Server error: one `role="alert"` line at the end of the body.
   - Update the header comment (full-page modal per D21/D23; the two dropped controls stay explained).
7. **Copy dialog** (`-clone-dialog.tsx`): `<DialogContent size="sm">`; `<Label htmlFor="clone-schedule-year">`, drop the trigger's `aria-label`; `SelectValue` with no placeholder ("বাছুন"); Cancel label `t('actions.cancel', { ns: 'common' })`; error line with the Error text classes; remove `text-sm`.
8. **Empty state.** `emptyState={{ title: t('schedules.emptyMessage'), explanation: t('schedules.emptyExplanation'), action: canManage ? { label: t('schedules.addSchedule'), onClick: openNew } : undefined }}`.
9. **i18n** (`fees.json` → `schedules.*`, bn / en). Do not touch the glossary renames (`title`, `emptyMessage`, `errorMessage`, `form.createTitle`, `form.editTitle`, `columnLastRun`, `columnNextRun`, `detail.runHistoryTitle`).
   - add `subtitle`: "নিয়ম অনুযায়ী শুধু সক্রিয় শিক্ষার্থীদের বিল নিজে থেকে তৈরি হয়।" / "Bills for active students are created on their own, on the rule you set."
   - add `view`: "দেখুন" / "View"; `someProgram`: "একটি প্রোগ্রাম" / "A program"; `neverBilled`: "এখনো হয়নি" / "Not yet"
   - add `emptyExplanation`: "একটি নিয়ম যোগ করলে প্রতি মাসে বা সপ্তাহে নিজে থেকে বিল তৈরি হবে।" / "Add a rule and bills are created every month or week on their own."
   - add `activateConfirmTitle`: "এই নিয়মটি আবার সক্রিয় করবেন?" / "Turn this rule back on?"; `activateConfirmDescription`: "পরের নির্ধারিত দিন থেকে আবার বিল তৈরি হবে।" / "Bills will be created again from the next scheduled day."
   - change `addSchedule`: "নিয়ম যোগ করুন" / "Add rule"; `columnAudience`: "কাদের জন্য" / "Who is billed"; `columnRule`: "কখন" / "When"; `columnActive`: "অবস্থা" / "Status" (leave `columnNextRun` / `columnLastRun` as 31.3.4b set them — the mockup's "পরের বিল তৈরি" is that column)
   - change `wholeSchool`: "পুরো বিদ্যালয়" / "Whole school"; `form.allClasses`: "পুরো বিদ্যালয়" / "Whole school"
   - change `ruleMonthly`: "প্রতি মাসের {{day}} তারিখে" / "Every month on day {{day}}"
   - change `clone`: "অন্য শিক্ষাবর্ষে কপি করুন" / "Copy to another year"; `cloneDialog.title`: "নিয়মটি অন্য শিক্ষাবর্ষে কপি করুন" / "Copy this rule to another year"; `cloneDialog.description`: "একই ফি, শিক্ষার্থী আর সময় নিয়ে নতুন শিক্ষাবর্ষের জন্য একটি নিয়ম তৈরি হবে।" / "Creates a rule for another year with the same fees, students and timing."; `cloneDialog.confirm`: "কপি করুন" / "Copy"; `cloneDialog.cloning`: "কপি হচ্ছে…" / "Copying…"; `cloneDialog.errorMessage`: "নিয়মটি কপি করা যায়নি। আবার চেষ্টা করুন।" / "Couldn't copy this rule. Try again."
   - add `form.sectionName`: "নাম ও শিক্ষাবর্ষ" / "Name and year"; `form.namePlaceholder`: "যেমন: সপ্তম শ্রেণির মাসিক বেতন" / "e.g. Class 7 monthly tuition"; `form.academicYearLocked`: "সংরক্ষণের পর শিক্ষাবর্ষ বদলানো যায় না।" / "The year can't be changed after saving."
   - change `form.nameLabel`: "নিয়মের নাম" / "Rule name"; `form.feesLabel`: "ফি" / "Fees"; `form.audienceLegend`: "কাদের জন্য" / "Who is billed"; `form.activeOnlyNotice`: "শুধু এখন ভর্তি থাকা (সক্রিয়) শিক্ষার্থীদের বিল হবে।" / "Only students who are enrolled now (active) are billed."; `form.ruleLegend`: "কখন বিল তৈরি হবে" / "When bills are created"
   - add `form.ruleKindLabel`: "কত দিন পরপর" / "How often"; change `form.ruleModeMonthly`: "প্রতি মাসে" / "Every month"; `form.ruleModeWeekly`: "প্রতি সপ্তাহে" / "Every week"; `form.dayOfMonthLabel`: "মাসের কোন দিন" / "Day of the month"; add `form.dayOfMonthOption`: "{{day}} তারিখ" / "Day {{day}}"; change `form.weekdaysLabel`: "সপ্তাহের কোন দিন" / "Days of the week"
   - change `form.dueDaysLabel`: "পরিশোধের সময় (দিন)" / "Days to pay"; add `form.dueDaysHelp`: "মেয়াদ শুরুর কত দিনের মধ্যে টাকা দিতে হবে।" / "How many days after the period starts the bill is due."
   - add `form.endsOnHelp`: "সর্বোচ্চ {{date}} (শিক্ষাবর্ষের শেষ দিন)।" / "At most {{date}} (the last day of the year)."; delete `form.endsOnCappedNotice`
   - change `form.notifyFamiliesLabel`: "বিল তৈরি হলে পরিবারকে জানান" / "Notify families when bills are created"
   - add `form.previewTitle`: "এখন কতজন পাবে" / "Who gets billed now"; `form.previewLoading`: "দেখা হচ্ছে…" / "Checking…"; change `form.previewButton`: "দেখুন" / "Check"
   - change `form.save`: "সংরক্ষণ করুন" / "Save"; `form.cancel`: "বাতিল করুন" / "Cancel"
   - delete `columnActions`, `activeOnly`, `form.description`.

## Tests
- `schedules/index.test.tsx` (**New**): rows show "প্রতি মাসের ১ তারিখে" (tenant digits), a long next-billing date, "অক্টোবর ২০২৬" for a monthly `last_run_period: '2026-10-01'`, a StatusBadge; total "মোট n টি"; header "নিয়ম যোগ করুন" is the only filled button and sets `new=1`; edit action sets `edit=<id>` and opens the form titled with `form.editTitle`; "নিষ্ক্রিয় করুন" opens an `alertdialog` and only confirm calls `PATCH … { is_active: false }`; **B10**: rendering as a role without `PROGRAM_READ` makes no `GET /programs` and shows no toast.
- `-schedule-summary.test.ts` (**New**): `ruleSummary` weekly `[7, 3]` → contains both weekday names joined by "ও" in bn; `audienceSummary` with an unresolved program → contains "একটি প্রোগ্রাম"; `lastBilledLabel(null)` → "এখনো হয়নি"; one `nextRunDate` case (moved logic still returns the same date).
- `-schedule-form-dialog.test.tsx`: keep every existing behaviour test; query controls by their visible labels (`getByLabelText`); "shows the right validation error for each unmet requirement, in order" becomes "shows every unmet requirement at once, under its field"; add: `open={false}` renders nothing; Close with an edited name asks to discard; without `PROGRAM_READ` there is no program field.
- `-clone-dialog.test.tsx`: the year select is found by its label "শিক্ষাবর্ষ"; confirm button "কপি করুন".
- E2E: no spec covers `/fees/schedules` today; nothing to update.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] An accountant opening the page sees no red toast (B10).
- [ ] No underlined text links in the table; switching a rule off asks first.
- [ ] A program-scoped rule names its program in "কাদের জন্য".
- [ ] "নিয়ম যোগ করুন" / "সম্পাদনা" change the URL (`?new=1` / `?edit=…`); Back closes the form; refresh reopens it.
- [ ] Every form field has a visible label; validation errors sit under their fields.

## Out of scope
- "Run now" (no server route) — unchanged.
- Server-side next-billing date — still computed on the client (`nextRunDate`).
- Palette actions for the rule form (`unregistered-actions.ts` lists `-schedule-form-dialog.tsx`) — 31.5.1b decides; the URL is `/fees/schedules?new=1` (filed in shared-requests.md).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| palette entry for the rule form (?new=1 / ?edit=<id>) | Accepted | 31.5.1b | feeSchedules.create -> /fees/schedules?new=1 (kind navigate, label "স্বয়ংক্রিয় বিলের নিয়ম যোগ করুন"); ?edit=<id> stays a row action, not a palette entry; 31.5.1a adds no flag here |
| crumb resolver: rule name | Accepted | 31.3.5 | resolver key scheduleDetail reads recurringScheduleQueryOptions(id) -> name; keep that query on the page |

Wave: 9   Lane: fees   Decisions: D5, D6, D9, D16, D19, D21, D22, D23, D25, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.fees-3b
