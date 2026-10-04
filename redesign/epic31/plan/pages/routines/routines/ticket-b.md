# [31.4.routines-1b] Class routine — kit cell picker and fill dialog

## Goal
The two builder dialogs (assign a period, fill empty periods) follow the kit Dialog: real labels, 44 px rows on phone, no browser `<select>` or bare radio, Bangla subject names, translated errors, and each proposed period names its day **and** period. b runs after `routines-1a`.

## What and why
On `/routines/$sectionId` a click on a cell opens the cell picker (subject, teachers, how often it repeats) and the header's primary opens "fill empty periods", a preview of proposed periods to confirm. Today the picker uses two raw `<select>`s and bare radio inputs with 28 px targets, shows English subject names on a Bangla screen, and its Cancel is a ghost button; the fill dialog lists "রবি · Math · …" without saying which period, and its error toast joins the server's English sentences. The redesign moves both onto the kit Dialog, `RadioGroup` and `Select`, and reuses 1a's subject-name helper and translated conflict codes.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — `/routines/$sectionId` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_sectionId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_sectionId/before-mobile.webp?raw=true" width="260"> |
| After — `/routines/$sectionId` (page; the dialogs open over it) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_sectionId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_sectionId/mobile.webp?raw=true" width="260"> |

No separate mockup: both dialogs are the kit `PATTERN: Dialog (md)` / `lg` with the fields listed below.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Cell picker frame | `DialogContent size="md" closeLabel={t('cellPicker.cancel')}`; **New** description line names the cell: "সোম · পিরিয়ড ৩ · সকাল ৯:২০" (`cellPicker.cellLabel`). | D21; the user could not see which cell they were editing |
| 2 | Subject list | Kit Field: Label + Input filter + list; options are `button`s `flex h-11 w-full items-center justify-between rounded-md px-3 text-start md:h-8`, selected `bg-secondary font-semibold text-secondary-foreground` + `check`; text = `subjectName()` (Bangla name when set). List `max-h-48 overflow-y-auto rounded-md border border-border-functional p-1`. | D25, D9/D38, 44 px |
| 3 | Teacher list | Same frame; rows = kit checkbox row `flex min-h-11 items-center gap-3 md:min-h-8` (whole row is the target). | D25 |
| 4 | Repeats | `<fieldset>` + bare radios → `RadioGroup` (rows `min-h-11 md:min-h-8`); the "which week / which occurrence" control → kit `Select` with a visible Label (`cellPicker.recurrenceOffsetLabel`), shown under the group only for biweekly / monthly. | D25, D37 (no raw `<select>`) |
| 5 | Picker footer | Cancel `variant="outline"`, then the primary "সংরক্ষণ করুন"; violations (`ConflictList`, translated by 1a) stay above the footer. | D29 |
| 6 | Fill dialog frame | `DialogContent size="lg"`; proposals as rows `flex items-start gap-3 py-2` in `ul.divide-y.divide-border-subtle` inside `max-h-80 overflow-y-auto`: **New** "সোম · পিরিয়ড ৩" (`font-medium`) then "বাংলা · আনিকা রহমান" (`text-text-secondary`). | Each row now says which period |
| 7 | Fill dialog empty / loading | Empty → `EmptyState`-style line kept short (`fillAssist.empty`, `text-text-secondary`); loading → 3 skeleton rows `h-10`. | D28 |
| 8 | Fill dialog error | Toast text = the translated `conflictList.codes.<code>` of the first violation (deduped), else `builder.saveErrorToast`; never `v.message`. | D9 |
| 9 | Fill dialog footer | Cancel `outline`; primary keeps `fillAssist.confirm` with the count in tenant numerals. | D29, D6 |

## Mobile behaviour
- Both dialogs are full width with 20 px padding; footer buttons stack full width, primary on top (kit Dialog).
- Every subject, teacher and repeat row is ≥ 44 px.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Fill dialog: Dialog or full-page modal | `FullPageShell` (D21: holds a list/preview) · Dialog `lg` | Dialog `lg` | D23's explicit full-page list does not name it; it is a read-only confirm step with one button, opened over the table the user is looking at |
| Cell picker: Dialog or full-page | full-page (holds two lists) · Dialog `md` | Dialog `md` | 4 fields; the lists are pickers, not content; keyboard flow Enter → pick → save must stay a few keys |
| Period name in fill rows | pass labels from the page · `usePeriodSlotLookup()` inside the dialog | `usePeriodSlotLookup()` | The hook already exists; the dialog's props stay as they are |

## Files
- `client-admin/src/routes/_staff/routines/-cell-picker.tsx` — Dialog size, lists, RadioGroup, Select, labels
- `client-admin/src/routes/_staff/routines/-cell-picker.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-fill-assist-dialog.tsx` — size, rows with period, translated error
- `client-admin/src/routes/_staff/routines/-fill-assist-dialog.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/$sectionId.tsx` — pass `dayLabel` / `periodLabel` / `timeLabel` to `CellPicker` (also changed by routines-1a, runs earlier)
- `ui/src/i18n/locales/en/routines.json`, `ui/src/i18n/locales/bn/routines.json` — keys below (also changed by routines-1a, runs earlier)

## Steps
1. **Locale keys** (en / bn). Add `cellPicker.cellLabel` "{{day}} · {{period}} · {{time}}" (both); `fillAssist.rowWhen` "{{day}} · {{period}}" (both); `fillAssist.rowWhat` "{{subject}} · {{teachers}}" (both). Change `cellPicker.recurrenceWeekA` / `recurrenceWeekB` → "Week 1" / "Week 2" and "প্রথম সপ্তাহ" / "দ্বিতীয় সপ্তাহ" (A/B letters are not Bangla); `cellPicker.recurrenceOffsetLabel` → "Which week" / "কোন সপ্তাহে".
2. **`-cell-picker.tsx`**: add optional props `dayLabel?: string`, `periodLabel?: string`, `timeLabel?: string` and render `DialogDescription` as `t('cellPicker.cellLabel', …)` when all three are given, else the existing `cellPicker.description`. Subject options → `subjectName(subject, i18n.language)` from `./-subject-name`. Subject filter matches both `name_en` and `name_bn`. Lists use the classes in Change 2/3. Recurrence → `RadioGroup value={recurrence} onValueChange` with three `RadioGroupItem` rows; below it, when `recurrence !== 'WEEKLY'`, a `FormField` (`cellPicker.recurrenceOffsetLabel`) with `Select` (biweekly: 2 options, monthly: 4 options `cellPicker.recurrenceOccurrence` with `n` through `formatNumber`). Cancel `variant="outline"`. Keep `onOpenAutoFocus` focusing the subject filter, keep `canSave`.
3. **`-fill-assist-dialog.tsx`**: `DialogContent size="lg"`; `const periodLookup = usePeriodSlotLookup()`; row = `fillAssist.rowWhen` with `day = weekdayLabels[p.weekday]`, `period = t('agenda.periodLabel', { sequence: periodLookup.data?.[p.period_slot_id]?.sequence })` (missing → omit the period part) and `fillAssist.rowWhat` with `subjectName()` and teacher names (missing → "—", never an id). Error toast: `const v = conflictViolations(error); toast.error(v?.length ? t(\`conflictList.codes.${v[0].code}\`, { defaultValue: t('conflictList.codes.unknown') }) : t('builder.saveErrorToast'))`. Cancel `variant="outline"`.
4. **`$sectionId.tsx`** (one call site): `dayLabel={weekdayLabels[activeCell.weekday]}`, `periodLabel={t('agenda.periodLabel', { sequence: period.sequence })}`, `timeLabel={formatTime(period.starts_at, config)}` where `period = periods.find((p) => p.id === activeCell.periodSlotId)`; omit all three when `period` is undefined.
5. Remove any `text-sm`, `pl-*`, `text-left`, `rounded` (no size) left in these files in favour of kit classes (`text-label`/`text-body`, `ps-*`, `text-start`, `rounded-md`).

## Tests
- `-cell-picker.test.tsx`: subject shows the Bangla name when the language is `bn` and `name_bn` is set; choosing "দ্বি-সাপ্তাহিক" reveals a labelled Select (no `<select>` in the DOM: `container.querySelector('select')` is null); Cancel has the outline variant; Save stays disabled until subject + teacher are chosen.
- `-fill-assist-dialog.test.tsx`: a proposal row shows weekday + "Period 3"; a 409 shows the translated code sentence, never the mocked server message; an unknown teacher id renders "—".
- `$sectionId.test.tsx` (1a's) clicks "Save"/"Cancel" by name — names unchanged, no edit needed.

## Acceptance
- [ ] Desktop at 1440 px: both dialogs match `PATTERN: Dialog` (md / lg) in the kit.
- [ ] Mobile at 390 px: dialogs full width, no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per dialog.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or server string on screen (D9); numbers follow D6.
- [ ] No `<select>` and no bare `<input type="radio">` left in `-cell-picker.tsx`.
- [ ] Each fill-dialog row names the day and the period.

## Out of scope
- A "clear this cell" control in the picker (phone has no Delete key) — new behaviour.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| routine-grid kit look, period label + time range, empty/warning icons, cell aria-label | Accepted | 31.2.3b | no prop change; do NOT add routines.builder.cellAria — the grid uses common.json routine.cellLabel(Empty) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: routines   Decisions: D6, D9, D21, D23, D25, D29, D37, D38   Depends on: 31.3.8b, 31.4.routines-1a
