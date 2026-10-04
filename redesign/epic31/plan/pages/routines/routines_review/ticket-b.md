# [31.4.routines-3b] Substitute teachers — labelled filters, full table, simpler dialog

## Goal
`/routines/substitutions` lists every cover and cancellation in a kit table that says which day, period, class, subject and teachers each one is about, with a kit FilterBar (labels, chips, phone sheet), and its "add" dialog asks for date → section → period from a short list instead of a four-select cascade. b runs after `routines-3a`.

## What and why
This page is the log of days when a teacher was absent and someone else took the period, or the period was cancelled. Today a row only shows an ISO date (`2026-02-09`), a red "বাতিল" word and the reason — not which class, period or teachers — the filters are browser date inputs and `<select>`s, and the add dialog is a class → section → slot cascade of raw selects whose server error is shown in English. The redesign joins each record to its routine period on the client, shows it in a `DataTable` with a `StatusBadge`, uses `FilterBar`, and rebuilds the dialog so the period list only offers periods that happen on the chosen date.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_substitutions/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_substitutions/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_substitutions/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_substitutions/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageContainer` + `PageHeader` title `substitutionsPage.title` ("বদলি শিক্ষক" after the glossary) + **New** subtitle; primary "বদলি শিক্ষক যোগ করুন" (`plus`). Remove `p-4` wrapper and raw `<h1>`. | D15, D16 |
| 2 | Filters | Raw date inputs + `<select>`s → `FilterBar`: তারিখ (date range, two `DatePicker`s, `from`/`to`), বদলি শিক্ষক, অনুপস্থিত শিক্ষক, শ্রেণি, শাখা (placeholder "আগে শ্রেণি বাছুন" and disabled until a class is chosen). Chips + "সব মুছুন". Phone: "ফিল্টার (n)" + sheet. | D24, D25, D37 |
| 3 | Class in URL | Class was local state (lost on reload, so the section chip had no class). **New** search param `class_id`; it is stripped before calling the API; changing it clears `section_id`. | Filters are bookmarkable (route docblock) |
| 4 | Table | `<ul>` → `DataTable` (paginated, 25): তারিখ (`formatDate` over `formatWeekday` caption), পিরিয়ড ("পিরিয়ড ২ · সকাল ৮:৪৫" over subject caption), শ্রেণি ও শাখা, অনুপস্থিত শিক্ষক (the period's teachers), বদলি শিক্ষক (name or "—"), অবস্থা, কারণ (`text-text-secondary`, "—" when empty). | D5, D7, D19, D9 |
| 5 | Status | Red text "বাতিল" → `StatusBadge`: info "বদলি হয়েছে" / neutral "পিরিয়ড বাতিল". | D27 |
| 6 | Join | **New**: each record's `routine_slot_id` is looked up in the current year's routine slots (`useRoutineSlots`), sections via `useSectionLookup`, periods via `usePeriodSlotLookup`, subjects via `useSubjects`, teachers via `useTeachers`. Not found → "—", never an id. | The API returns only `routine_slot_id`; no API change (D1) |
| 7 | States | Loading → `DataTable loading`. Error → **New** `ErrorState` `substitutionsPage.error`. Empty → `EmptyState` (`substitutionsPage.emptyTitle/emptyExplanation`); with filters active its outline action is **New** "ফিল্টার মুছুন", with none it has no action (the header primary is the action). | D28, D29 |
| 8 | Dialog fields | 7 fields (class, section, slot, date, cancelled, teacher, reason) → 6: তারিখ (`DatePicker`, default today), শ্রেণি ও শাখা (one `Select`, only sections that have periods in the current routine), পিরিয়ড (`Select` of that section's periods **on the chosen date's weekday**, "পিরিয়ড ৩ · সকাল ৯:৩০ · বাংলা · আনিকা রহমান"), checkbox row "পিরিয়ডটি বাতিল, কেউ পড়াবেন না", বদলি শিক্ষক (`Select`, hidden when cancelled, the period's own teachers left out), কারণ (ঐচ্ছিক) Textarea. `DialogContent size="md"`, Cancel outline. | D21 (≤ 6 fields stays a Dialog), D25, D37 |
| 9 | Dialog guidance | No period that day → help text "রবিবার শাখাটির কোনো পিরিয়ড নেই।" under the period field. No routine for the year → the period field shows `substitutionDialog.noRoutine`. | One obvious next step |
| 10 | Dialog error | Server text verbatim (`Routine slot "<uuid>" does not occur on 2026-02-09`) → translated: 422 → `substitutionDialog.notOnDateError`, anything else → `substitutionDialog.errorToast`; shown as `role="alert"` above the footer. | D9 |

## Mobile behaviour
- Header: title, subtitle, full-width primary "বদলি শিক্ষক যোগ করুন".
- Filters: one outline "ফিল্টার (n)" button (no search field on this page) opening the kit sheet; chips under it.
- Rows are cards: title = date + StatusBadge, subtitle "বৃহস্পতিবার · পিরিয়ড ২ · সকাল ৮:৪৫", `dl` শ্রেণি ও শাখা · বিষয় · অনুপস্থিত শিক্ষক · বদলি শিক্ষক · কারণ (full width). No action row (no row actions exist).
- Dialog: full width, footer buttons stacked, primary on top.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where the class/period/teacher comes from | ask the server to include `routine_slot` · join on the client | Client join with the current year's routine | No API change (D1); everything needed is already cached by the routine pages. `ponytail:` records on an older year's routine show "—"; upgrade = include `routine_slot` in `SubstitutionsService.list` |
| Dialog: Dialog or full-page | full-page (7 fields, D21) · merge class + section | Merge into one "শ্রেণি ও শাখা" select → 6 fields → Dialog `md` | Class and section pick one thing; a small form over the list keeps the user in place |
| Field order in the dialog | slot then date (today) · date then period | Date first, then periods of that weekday | Removes most "does not occur on that date" refusals before they happen |
| Section options | every section of every class · sections with periods in the routine | Sections with periods | A section without periods can't have a substitute |
| Row actions | edit / delete · none | None | No edit or delete endpoint exists; adding them is new behaviour (D1) |
| Status tones | danger for cancelled · neutral | neutral "পিরিয়ড বাতিল", info "বদলি হয়েছে" | Kit table: cancelled = neutral |

## Files
- `client-admin/src/routes/_staff/routines/substitutions.tsx` — header, FilterBar, `class_id`, join, DataTable, states
- `client-admin/src/routes/_staff/routines/substitutions.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-substitution-dialog.tsx` — 6 fields, kit controls, translated errors
- `client-admin/src/routes/_staff/routines/-substitution-dialog.test.tsx` — updated
- `ui/src/i18n/locales/en/routines.json`, `ui/src/i18n/locales/bn/routines.json` — keys below (also changed by routines-1a, 1b, 2, 3a, run earlier)

`client-admin/src/routes/_staff/routines/-subject-name.ts` (routines-1a) is only imported.

## Steps
1. **Locale keys** (en / bn). The glossary (31.3.4b) already renamed `title`, `addAction`, `emptyTitle`, `coveringTeacherLabel`, `coveredForTeacherLabel`, `substitutionDialog.title` — do not touch those. Change:
   - `substitutionsPage.fromLabel` → "From" / "থেকে"; `toLabel` → "To" / "পর্যন্ত"; `anyTeacher` → "All teachers" / "সব শিক্ষক"; `anyClass` → "All classes" / "সব শ্রেণি"; `anySection` → "All sections" / "সব শাখা"; `cancelledLabel` → "Period cancelled" / "পিরিয়ড বাতিল".
   - `substitutionDialog.description` → "Pick the date and the period. The weekly routine itself doesn't change." / "তারিখ আর পিরিয়ড বাছুন। সাপ্তাহিক রুটিন নিজে বদলায় না।"; `sectionLabel` → "Class and section" / "শ্রেণি ও শাখা"; `slotLabel` → "Period" / "পিরিয়ড"; `cancelledLabel` → "Cancel the period — nobody teaches it" / "পিরিয়ডটি বাতিল, কেউ পড়াবেন না"; `substituteTeacherLabel` → "Substitute teacher" / "বদলি শিক্ষক"; `reasonLabel` → "Reason (optional)" / "কারণ (ঐচ্ছিক)"; `cancel` → "Cancel" / "বাতিল করুন".
   Add:
   - `substitutionsPage.subtitle` "Who took whose period on which day, and which periods were cancelled." / "কোন দিন কে কার পিরিয়ড নিলেন, আর কোন পিরিয়ড বাতিল হলো।"; `substitutionsPage.dateLabel` "Date" / "তারিখ"; `substitutionsPage.pickClassFirst` "Pick a class first" / "আগে শ্রেণি বাছুন"; `substitutionsPage.caption` "Substitute teachers" / "বদলি শিক্ষকের তালিকা"; `substitutionsPage.columns.date` "Date" / "তারিখ"; `.period` "Period" / "পিরিয়ড"; `.section` "Class and section" / "শ্রেণি ও শাখা"; `.absent` "Absent teacher" / "অনুপস্থিত শিক্ষক"; `.substitute` "Substitute teacher" / "বদলি শিক্ষক"; `.status` "Status" / "অবস্থা"; `.reason` "Reason" / "কারণ"; `substitutionsPage.periodCell` "{{period}} · {{time}}" (both); `substitutionsPage.sectionName` "{{className}} – {{sectionName}}" (both); `substitutionsPage.statusCovered` "Covered" / "বদলি হয়েছে"; `substitutionsPage.error` "Couldn't load substitute teachers. Check your connection and try again." / "বদলি শিক্ষকের তালিকা আনা যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।"; `substitutionsPage.clearFilters` "Clear filters" / "ফিল্টার মুছুন".
   - `substitutionDialog.slotOption` "{{period}} · {{time}} · {{subject}} · {{teachers}}" (both); `substitutionDialog.noSlotsOnDay` "This section has no period on {{weekday}}." / "{{weekday}} শাখাটির কোনো পিরিয়ড নেই।"; `substitutionDialog.pickDateFirst` "Pick a date first." / "আগে তারিখ বাছুন।"; `substitutionDialog.noRoutine` "There is no routine for this academic year yet." / "এই শিক্ষাবর্ষের এখনো কোনো রুটিন নেই।"; `substitutionDialog.notOnDateError` "This period doesn't happen on the date you picked (it may run every other week or once a month). Pick another date." / "বেছে নেওয়া তারিখে এই পিরিয়ডটি হয় না (এটি হয়তো দুই সপ্তাহে বা মাসে একবার হয়)। অন্য তারিখ বাছুন।"
   Delete (after `rg` shows no other use): `substitutionsPage.coveredByLabel`, `substitutionsPage.unknownTeacher`, `substitutionDialog.classLabel`, `selectClass`, `selectSection`, `selectSlot`, `selectTeacher` (Selects use the `common` placeholder "বাছুন").
2. **Shared join hook, local to this lane** — export it from `-substitution-dialog.tsx` (a helper file; route files should export only `Route`) as `useCurrentRoutineSlots()`, and import it in `substitutions.tsx`: `currentYearId = useAcademicYears({}).data?.data.find((y) => y.is_current)?.id`; `routine = useRoutines().data?.find((r) => r.academic_year_id === currentYearId)`; `slotsQuery = useRoutineSlots(routine?.id)`; return `{ routine, slotsById: Map<id, RoutineSlotWithWarnings>, isPending }`. Add `// ponytail: current-year routine only; older records show "—" — include routine_slot in SubstitutionsService.list if that matters`.
3. **`substitutions.tsx` — search.** Add `class_id: z.string().uuid().optional().catch(undefined)` to `searchSchema`; `const { class_id, ...filters } = search; useSubstitutions(filters)`; `useClassSections(class_id)`; delete the `classId` `useState`. Changing `class_id` navigates with `section_id: undefined`.
4. **`substitutions.tsx` — frame.** `PageContainer` → `PageHeader title={t('substitutionsPage.title')} subtitle={t('substitutionsPage.subtitle')} actions={[{ id: 'add', priority: 'primary', icon: <Plus />, label: t('substitutionsPage.addAction'), onClick: () => setDialogOpen(true) }]}` → `FilterBar` → `DataTable`.
5. **FilterBar fields** (labels visible, values in the URL as today): date range `dateLabel` with `from`/`to` (ISO in the URL; chip text via `formatDateRange`); select `substitute_teacher_id` (`coveringTeacherLabel`, options teachers by `user.full_name`, empty option `anyTeacher`); select `covered_for_teacher_id` (`coveredForTeacherLabel`, same options); select `class_id` (`classLabel`, `anyClass`); select `section_id` (`sectionLabel`, options from `useClassSections(class_id)` by `section_name`, `anySection`; disabled with placeholder `pickClassFirst` while `class_id` is empty). Chips show names, never ids (section chip: `t('substitutionsPage.sectionName', lookup[section_id])`).
6. **Rows.** For each substitution: `entry = slotsById.get(routine_slot_id)`, `period = periodLookup[entry?.slot.period_slot_id]`. Columns:
   - date: `formatDate(date, config)` (`font-medium whitespace-nowrap`) + caption `formatWeekday(date, config)`.
   - period: `t('substitutionsPage.periodCell', { period: t('agenda.periodLabel', { sequence: formatNumber(period.sequence, config) }), time: formatTime(period.starts_at, config) })` + caption `subjectName(subject, i18n.language)`; no entry/period → "—".
   - section: `t('substitutionsPage.sectionName', sectionLookup[entry.slot.section_id])` or "—".
   - absent: `entry.teacher_ids` → names joined ", " or "—".
   - substitute: `is_cancelled` → "—", else teacher name or "—".
   - status: `<StatusBadge tone={is_cancelled ? 'neutral' : 'info'} label={is_cancelled ? t('substitutionsPage.cancelledLabel') : t('substitutionsPage.statusCovered')} />`.
   - reason: `reason ?? '—'`, `text-text-secondary`; long reasons wrap (no width class).
   Keep server order (date desc); within a date sort by period sequence. `DataTable caption={t('substitutionsPage.caption')} loading={substitutionsQuery.isPending}`; phone card: title date + badge, subtitle `${weekday} · ${periodCell}`, fields section / subject / absent / substitute / reason (reason full width). Error → `ErrorState message={t('substitutionsPage.error')} onRetry={() => substitutionsQuery.refetch()}`. `emptyState` per Change 7 (`hasFilters = Object.values(search).some(Boolean)`; action navigates with `search: {}`).
7. **`-substitution-dialog.tsx`.** State: `date: Date | undefined` (default `new Date()` on open), `sectionId`, `slotId`, `isCancelled`, `substituteTeacherId`, `reason`, `errorKey: 'notOnDateError' | 'errorToast' | null`. Data: `useCurrentRoutineSlots()` (same file), `useSectionLookup()`, `usePeriodSlotLookup()`, `useSubjects({})`, `useTeachers({})`. Delete `currentRoutineForYear`, `useClasses`, `useClassSections`.
   - Section options: unique `slot.section_id` of all slots, label `substitutionsPage.sectionName`, sorted.
   - Period options: slots with `section_id === sectionId && weekday === date.getDay()`, sorted by period sequence; label `substitutionDialog.slotOption` (`period` = `agenda.periodLabel`, `time` = `formatTime(starts_at)`, `subject` = `subjectName()`, `teachers` = names or "—"). Changing date or section clears `slotId`.
   - Field order and controls: `FormField` + `DatePicker` (`dateLabel`, required); `FormField` + `Select` (`sectionLabel`, required); `FormField` + `Select` (`slotLabel`, required) with help text: no date → `pickDateFirst`; no routine → `noRoutine`; section chosen and no options → `noSlotsOnDay` (`weekday` = `formatWeekday(date)`); kit `Checkbox` row (`cancelledLabel`); when not cancelled `FormField` + `Select` (`substituteTeacherLabel`, required, options = teachers minus the chosen slot's `teacher_ids`); `FormField` + `Textarea` (`reasonLabel`, `maxLength={280}`).
   - Submit: `date: toIsoDate(date)`; on error `setErrorKey(error instanceof ApiError && error.statusCode === 422 ? 'notOnDateError' : 'errorToast')`; render `p role="alert" className="flex items-center gap-1 text-caption text-destructive"` with `CircleAlert` + `t(\`substitutionDialog.${errorKey}\`)`. Never render `error.message`. Update the file docblock: the 422 is translated, not shown verbatim.
   - `DialogContent size="md"`; footer Cancel `variant="outline"` + primary `save` (disabled rule unchanged).
8. Logical classes only; no `<select>`, no `type="date"`, no `text-sm` left in these two files.

## Tests
- `substitutions.test.tsx`: no `select` / `input[type=date]` in the DOM; each filter has a visible label; a covered row shows "8th October, 2026", "Thursday", "Period 2 · 8:45 AM", "Class 6 – B", the absent and substitute teacher names and the "Covered" badge; a cancelled row shows "Period cancelled" and "—" as substitute; a record whose slot is not in the current routine shows "—" and never the slot id; choosing a class writes `class_id` to the URL but the request params (mock `apiClient.get`) have no `class_id`; changing the class clears `section_id`; empty + filters shows "Clear filters"; error shows the translated sentence with Retry.
- `-substitution-dialog.test.tsx`: section options are only sections with slots; period options are only that weekday's slots and update when the date changes; a weekday without slots shows the `noSlotsOnDay` help; ticking cancelled hides the substitute select; substitute options exclude the slot's own teachers; a mocked 422 shows `notOnDateError` and not the server message; save stays disabled until date, section, period and (unless cancelled) teacher are set; no `<select>` in the DOM.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (page header; dialog footer).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6, times D7.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Every row names its day, period, class and section, subject, absent teacher and status badge.
- [ ] Reloading the page keeps the class and section filters.
- [ ] The dialog has 6 fields and only offers periods that fall on the chosen date's weekday.
- [ ] A refused save shows a Bangla sentence, never the server's English text.

## Out of scope
- Shared request filed (in routines-3a): a sidebar item for this page — today it is reachable only by URL.
- Editing or deleting a recorded substitute (no endpoint; new behaviour).
- Records on an older year's routine show "—" for period/section (client join limit, `ponytail:` comment).
- A server-side `routine_slot` in the list response (would remove the client join) — `server/**` is outside page territory.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| sidebar items review + substitutions | Accepted | 31.3.1 | academics.routineReview -> /routines/review (ROUTINE_READ, icon clipboard-check), academics.routineSubstitutions -> /routines/substitutions (ROUTINE_MANAGE, icon replace — not user-round-check, too close to staff attendance's user-check); labels nav:items.routineReview / routineSubstitutions ("বদলি শিক্ষক") |

Wave: 9   Lane: routines   Decisions: D1, D5, D6, D7, D9, D15, D16, D19, D21, D24, D25, D27, D28, D29, D37   Depends on: 31.3.8b, 31.4.routines-3a
