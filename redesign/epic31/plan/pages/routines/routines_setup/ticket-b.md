# [31.4.routines-4b] Routine setup — shifts card and period-times editor

## Goal
On the "শিফট ও পিরিয়ড" tab, shifts are a kit table with an add dialog and a confirmed delete, and the period-times card has a shift Select, kit Select/TimeInput controls, per-row checks that mirror the server's rules, break names that actually save, a labelled timeline, translated errors and one primary. b runs after `routines-4a`.

## What and why
Before any routine can be built, the admin names the shifts and types the start and end of every period and break. Today the shift is "picked" by clicking an underlined name in a table (nothing says that this changes the table below), times show as `08:00:00`, the kind is a browser `<select>`, times are browser time inputs, a bad row is only reported after Save as an English sentence (`Slot 3: overlaps the previous slot…`), a break cannot be named although the routine table shows break names (the panel forces `name: null` for breaks and lets you name lessons, whose names are never shown), and Save on a shift already used by a routine fails with an English 409. The redesign gives the shift choice its own labelled Select, checks rows as you type, and says in Bangla why a save was refused.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_setup/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_setup/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_setup/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_setup/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Shifts card | `Card` (`padded={false}`, `overflow-hidden`): header `h2` "শিফট" + **New** subtitle + outline "শিফট যোগ করুন" (`plus`); `DataTable paginated={false}`: নাম (`font-medium`), দিন শুরু, দিন শেষ (`formatTime`), row action `delete`. Total "মোট ২টি". The name is no longer a selection button. | D19, D7, D29 |
| 2 | Add shift | Inline form row → **New** `Dialog size="sm"`: নাম (required), দিন শুরু, দিন শেষ (`TimeInput`, `stepMinutes={15}`, defaults 08:00 / 16:00); inline error **New** `shiftsPanel.endBeforeStart` when end ≤ start; Cancel outline + primary. | D21, D25, D37 |
| 3 | Delete shift | `ConfirmDialog tone="danger"`; 409 (shift still has periods) → toast **New** `shiftsPanel.inUseError`; other → `shiftsPanel.deleteError`. | D29, D9 |
| 4 | Shift choice | **New** `FormField` + `Select` "শিফট" (`md:w-64`) in the period card's header; title "পিরিয়ডের সময়" (shift name leaves the title). Selection state stays in `setup.tsx`. | Control next to what it changes |
| 5 | Period rows (desktop) | Table inside the card: সারি (`formatNumber(index + 1)`), ধরন (`Select` পাঠদান / বিরতি), নাম (`Input`, placeholder "ঐচ্ছিক"), শুরু, শেষ (`TimeInput stepMinutes={5}`, `aria-label` "শুরু, সারি ৩"), remove (`circle-minus`, `text-destructive`, "সারি ৩ সরান"). Break rows `bg-muted`. Rows `h-12`. | D25, D37, D19 |
| 6 | Break names | The name field is enabled for both kinds and is no longer cleared when the kind changes. | Breaks show their name in the routine table (`routine-grid.tsx:188`); the panel made that impossible |
| 7 | Row checks | **New**, computed as you type, mirroring `PeriodSlotsService.validateSlots`: end ≤ start → `periodSlotsPanel.errors.endBeforeStart`; outside the shift's day → `.outsideShift` (with the shift's formatted window); starts before the previous row ends → `.overlapsPrevious`. Shown under the row (`text-caption text-destructive` + `circle-alert`); the offending control gets `border-destructive` + `aria-invalid`. Save is disabled while any row has an error. | Errors next to what caused them, before Save |
| 8 | Changeover | The "Enter in the last row's end field adds a row" shortcut goes (a `TimeInput` uses Enter to pick a time). "পিরিয়ড যোগ করুন" keeps D7's rule (start = previous end + changeover gap); **New** hint line "নতুন পিরিয়ড আগেরটি শেষ হওয়ার ৫ মিনিট পরে শুরু হয়।" (desktop). | Keeps the behaviour, makes it visible |
| 9 | Timeline | Strip keeps its proportional blocks; tokens `bg-primary opacity-60` (lesson) / `bg-text-secondary opacity-40` (break), `gap-px`; **New** visible label "দিনের সময়রেখা", start/end time captions and a two-item legend; `aria-label` describes the day ("সকাল ৮:০০ থেকে দুপুর ১:০০: ৬টি পিরিয়ড, ১টি বিরতি"); block `title` uses `formatTime`. | D7, D9; the bar had no scale |
| 10 | Footer | Card foot: hint (left), outline "পিরিয়ড যোগ করুন" + primary "সংরক্ষণ করুন" (right). Success → toast `save.success`. 409 → toast **New** `periodSlotsPanel.inUseError`; 400 → `.invalidError`; else `.saveError`. `MutationErrorMessage` and the `role="status"` line go. | D29, D9 |
| 11 | Empty states | No shift → **New** `EmptyState` (`clock`) in the period card "আগে একটি শিফট যোগ করুন". Shift without rows → **New** short line `periodSlotsPanel.noRows` above the footer. | D28 |
| 12 | Unsaved rows | **New** `useWarnUnsavedChanges(dirty)` (`dirty` = rows differ from the loaded set). | Switching shift, tab or page dropped typed rows silently |

## Mobile behaviour
- Shifts: compact two-line rows ("সকাল শিফট" / "সকাল ৮:০০ – দুপুর ১:০০") with a 44 px delete icon; "শিফট যোগ করুন" full width under the card title.
- Period rows become blocks (`divide-y`): heading "পিরিয়ড ১ · সারি ১" (break: "বিরতি · সারি ৪") + remove icon, then a 2-column grid: শুরু, শেষ, ধরন, নাম — each with a visible label. Row errors sit at the bottom of the block.
- Timeline full width under the rows; footer buttons stacked full width, Save on top. No hint line.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Shift selection | click the name in the shifts table (today) · Tabs per shift · Select in the period card | Select in the period card | Visible label next to the table it changes; scales past 3 shifts |
| Validation | server only (today) · client mirror + server | Client mirror, server stays the authority | Errors appear on the row while typing; same three rules as `validateSlots` |
| Enter-to-add shortcut | keep · drop | Drop | `TimeInput` (kit) owns Enter; the add button applies the same changeover rule |
| Time step | 30 (TimeInput default) · 5 | 5 for periods, 15 for shift windows | Periods start at times like 8:45 |
| Lesson names | remove · keep optional | Keep optional for both kinds | No data loss; removing a field is out of a restyle's scope |

## Files
- `client-admin/src/routes/_staff/routines/-setup/shifts-panel.tsx` — Card + DataTable + dialogs; selection props removed
- `client-admin/src/routes/_staff/routines/-setup/shifts-panel.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-setup/period-slots-panel.tsx` — shift Select, kit controls, row checks, timeline, footer, states
- `client-admin/src/routes/_staff/routines/-setup/period-slots-panel.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-setup/period-slots-panel.stories.tsx` — new props, an "invalid row" story
- `client-admin/src/routes/_staff/routines/setup.tsx` — pass `shifts` / `onSelectShift` to `PeriodSlotsPanel` (also changed by routines-4a, runs earlier)
- `ui/src/i18n/locales/en/routines.json`, `ui/src/i18n/locales/bn/routines.json` — keys below (also changed by routines-1a … 4a, run earlier)

## Steps
1. **Locale keys** (en / bn). The glossary already set `periodSlotsPanel.kindClass` to "Lesson" / "পাঠদান". Change: `periodSlotsPanel.legend` → "Period times" / "পিরিয়ডের সময়" (drop `{{shiftName}}`); `periodSlotsPanel.sequence` → "Row" / "সারি"; `periodSlotsPanel.startsAt` → "Starts" / "শুরু"; `periodSlotsPanel.endsAt` → "Ends" / "শেষ"; `periodSlotsPanel.selectShift` → "Add a shift first, then set its period times." / "আগে একটি শিফট যোগ করুন, তারপর তার পিরিয়ডের সময় দিন।"; `periodSlotsPanel.timelineLabel` → "Day timeline" / "দিনের সময়রেখা"; `shiftsPanel.legend` stays.
   Add: `shiftsPanel.subtitle` "When the school day starts and ends in each shift." / "প্রতিটি শিফটে স্কুলের দিন কখন শুরু আর কখন শেষ হয়।"; `shiftsPanel.caption` "Shifts" / "শিফট"; `shiftsPanel.dialogTitle` "Add shift" / "শিফট যোগ করুন"; `shiftsPanel.dialogConfirm` "Add" / "যোগ করুন"; `shiftsPanel.cancel` "Cancel" / "বাতিল করুন"; `shiftsPanel.timeRange` "{{start}} – {{end}}" (both); `shiftsPanel.endBeforeStart` "The day must end after it starts." / "দিন শেষের সময় শুরুর পরে হতে হবে।"; `shiftsPanel.deleteTitle` "Delete {{name}}?" / "{{name}} মুছবেন?"; `shiftsPanel.deleteDescription` "The shift is removed. This can't be undone." / "শিফটটি মুছে যাবে। এটি আর ফেরানো যাবে না।"; `shiftsPanel.deleteConfirm` "Delete" / "মুছে ফেলুন"; `shiftsPanel.inUseError` "This shift still has period times, so it can't be deleted. Remove its rows under Period times first." / "এই শিফটে এখনো পিরিয়ডের সময় দেওয়া আছে, তাই মোছা যাবে না। আগে পিরিয়ডের সময় থেকে সারিগুলো সরান।"; `shiftsPanel.deleteError` "Couldn't delete the shift. Try again." / "শিফটটি মোছা যায়নি। আবার চেষ্টা করুন।"; `shiftsPanel.saveError` "Couldn't add the shift. Try again." / "শিফটটি যোগ করা যায়নি। আবার চেষ্টা করুন।";
   `periodSlotsPanel.subtitle` "Pick a shift, then give every period and break its time." / "একটি শিফট বাছুন, তারপর তার প্রতিটি পিরিয়ড আর বিরতির সময় দিন।"; `periodSlotsPanel.shiftLabel` "Shift" / "শিফট"; `periodSlotsPanel.caption` "Periods of {{shiftName}}" / "{{shiftName}}-এর পিরিয়ড"; `periodSlotsPanel.namePlaceholder` "Optional" / "ঐচ্ছিক"; `periodSlotsPanel.rowLabel` "Row {{n}}" / "সারি {{n}}"; `periodSlotsPanel.rowHeading` "{{what}} · row {{n}}" / "{{what}} · সারি {{n}}"; `periodSlotsPanel.fieldInRow` "{{field}}, row {{n}}" / "{{field}}, সারি {{n}}"; `periodSlotsPanel.removeRow` "Remove row {{n}}" / "সারি {{n}} সরান"; `periodSlotsPanel.errors.endBeforeStart` "Ends before it starts." / "শেষের সময় শুরুর পরে হতে হবে।"; `periodSlotsPanel.errors.outsideShift` "Keep it inside the shift ({{start}} – {{end}})." / "শিফটের সময়ের ({{start}} – {{end}}) মধ্যে রাখুন।"; `periodSlotsPanel.errors.overlapsPrevious` "Starts before the row above ends." / "উপরের সারি শেষ হওয়ার আগেই শুরু হচ্ছে।"; `periodSlotsPanel.changeoverHint` "A new period starts {{minutes}} minutes after the one before it ends." / "নতুন পিরিয়ড আগেরটি শেষ হওয়ার {{minutes}} মিনিট পরে শুরু হয়।"; `periodSlotsPanel.timelineAria` "{{start}} to {{end}}: {{lessons}} periods, {{breaks}} breaks" / "{{start}} থেকে {{end}}: {{lessons}}টি পিরিয়ড, {{breaks}}টি বিরতি"; `periodSlotsPanel.noRows` "This shift has no periods yet. Press Add period." / "এই শিফটে এখনো কোনো পিরিয়ড নেই। “পিরিয়ড যোগ করুন” চাপুন।"; `periodSlotsPanel.noShiftTitle` "Add a shift first" / "আগে একটি শিফট যোগ করুন"; `periodSlotsPanel.inUseError` "Periods of this shift are already placed in a routine, so their times can't be replaced. Remove those periods from the class routine first." / "রুটিনে এই শিফটের পিরিয়ড বসানো আছে, তাই সময় বদলানো যাবে না। আগে শ্রেণির রুটিন থেকে সেই পিরিয়ডগুলো সরান।"; `periodSlotsPanel.invalidError` "Some rows have a time problem. Fix the red notes and save again." / "কিছু সারির সময় ঠিক নেই। লাল লেখা দেখে ঠিক করে আবার সংরক্ষণ করুন।"; `periodSlotsPanel.saveError` "Couldn't save the period times. Try again." / "পিরিয়ডের সময় সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।".
   Delete `periodSlotsPanel.breakNoName` (check with `rg`).
2. **`setup.tsx`** (one call site): `<ShiftsPanel />` (no props) and `<PeriodSlotsPanel shifts={shifts} shift={selectedShift} onSelectShift={setSelectedShiftId} changeoverGapMinutes={changeoverGapMinutes} />`.
3. **`shifts-panel.tsx`**: drop `ShiftsPanelProps`. Layout as rooms in 4a: `Card padded={false} className="overflow-hidden"`, header `flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between md:p-5` with `h2.text-h2` `shiftsPanel.legend` + `p.mt-1.text-text-secondary` `shiftsPanel.subtitle` and outline `Button` (`Plus`) `shiftsPanel.addAction`. `DataTable paginated={false} caption={t('shiftsPanel.caption')} data={shifts} loading={shiftsQuery.isPending}` columns name (`font-medium`; phone second line `shiftsPanel.timeRange` with formatted times), start, end (`formatTime(value, config)`), `rowActions={(s) => [{ intent: 'delete', label: t('delete.action'), onClick: () => setDeleting(s) }]}`. Add dialog: `DialogContent size="sm"`, `FormField` + `Input` (`shift-name`, required), two `FormField` + `TimeInput stepMinutes={15}`; `endBeforeStart` error under the end field when `timeToMinutes(end) <= timeToMinutes(start)`; submit as today (`sequence: shifts.length`), close on success, inline `role="alert"` `shiftsPanel.saveError` on error. Delete: `ConfirmDialog tone="danger"` with `deleteTitle`/`deleteDescription`/`deleteConfirm`; 409 → `toast.error(t('shiftsPanel.inUseError'))`, else `deleteError`. Remove `MutationErrorMessage`.
4. **`period-slots-panel.tsx`** — props `{ shifts: Shift[]; shift: Shift | undefined; onSelectShift: (id: string) => void; changeoverGapMinutes: number }`. Keep the row-loading effect, `ready`, `appendRow`, `removeRow`, `timeToMinutes`, `minutesToTime`. Delete `handleEndsAtKeyDown`. In `updateRow` for a kind change keep `row.name` (do not set `null`).
   - Card: `Card padded={false} className="overflow-hidden"`; header `flex flex-col gap-4 p-4 md:flex-row md:items-end md:justify-between md:p-5`: `h2.text-h2` `legend` + `p.mt-1.text-text-secondary` `subtitle`; `FormField label={t('periodSlotsPanel.shiftLabel')}` in `div.md:w-64` with `Select value={shift?.id} onValueChange={onSelectShift}` (options `shifts`).
   - No shift: `EmptyState icon={<Clock />} title={t('periodSlotsPanel.noShiftTitle')} explanation={t('periodSlotsPanel.selectShift')}` inside the card body.
   - Row errors: `const rowErrors = rows.map((row, i) => …)` returning the first matching key of Change 7 (`outsideShift` compares with `shift.day_starts_at` / `day_ends_at`; `overlapsPrevious` compares with `rows[i - 1].ends_at`). `hasErrors = rowErrors.some(Boolean)`.
   - Desktop (`div.hidden.md:block`): `table` with `caption.sr-only` `caption`, `thead.border-y.border-border-subtle.bg-muted.text-label.text-text-secondary`, columns `w-16` সারি / `w-40` ধরন / নাম / `w-44` শুরু / `w-44` শেষ / `w-20 text-end` (sr-only label `delete.action`). Row `tr` (`bg-muted` for BREAK) with `td.h-12.px-2.py-1` cells: `Select` (`kindClass` / `kindBreak`, `aria-label` `fieldInRow`), `Input` (`namePlaceholder`), two `TimeInput stepMinutes={5}` (`min`/`max` = shift window), `Button variant="ghost" size="icon"` `CircleMinus` `text-destructive` `aria-label={t('periodSlotsPanel.removeRow', { n })}`. When the row has an error, a second `tr` with one `td colSpan={6}` `px-4 pb-2` holding the error text.
   - Phone (`ul.divide-y.divide-border-subtle.border-t.border-border-subtle.md:hidden`): `li.space-y-3.p-4` (`bg-muted` for BREAK): heading `rowHeading` (`what` = `agenda.periodLabel` with the lesson count so far, or `kindBreak`) + remove icon (`-me-2`); `grid grid-cols-2 gap-3` of four `FormField`s (শুরু, শেষ, ধরন, নাম) with visible labels; error line at the end.
   - `n` everywhere = `formatNumber(index + 1, config)`.
   - Timeline (`div.space-y-2.border-t.border-border-subtle.p-4.md:px-5`): `p.text-label` `timelineLabel`; strip `relative flex h-6 w-full gap-px overflow-hidden rounded-md border border-border-subtle bg-muted` keeping today's absolute blocks and inline `left`/`width` percentages, block classes `absolute h-6 bg-primary opacity-60` / `bg-text-secondary opacity-40`, `title` = `formatTime` range; `role="img" aria-label={t('periodSlotsPanel.timelineAria', { start, end, lessons, breaks })}`; caption row `flex items-center justify-between text-caption text-text-secondary` = formatted day start · legend (two `size-2 rounded-full` dots + `kindClass` / `kindBreak`) · formatted day end.
   - Footer (`flex flex-col gap-3 border-t border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:px-5`): `p.hidden.text-caption.text-text-secondary.md:block` `changeoverHint` (`minutes` via `formatNumber`); `div.flex.flex-col-reverse.gap-2.md:flex-row` with outline `Button` (`Plus`) `addRowAction` and primary `save.action` (`disabled={!ready || hasErrors}`, `loading={replaceSlots.isPending}`). `rows.length === 0` → `p.px-4.text-text-secondary.md:px-5` `noRows` above the footer.
   - Save: `replaceSlots.mutate(rows, { onSuccess: () => toast.success(t('save.success')), onError: (e) => toast.error(t(e instanceof ApiError && e.statusCode === 409 ? 'periodSlotsPanel.inUseError' : e instanceof ApiError && e.statusCode === 400 ? 'periodSlotsPanel.invalidError' : 'periodSlotsPanel.saveError')) })`. Remove `MutationErrorMessage` and the `role="status"` line.
   - `useWarnUnsavedChanges(dirty)` with `dirty = loadedShiftId.current === shift?.id && JSON.stringify(rows) !== JSON.stringify(loadedRows)` (keep the loaded rows in a ref next to `loadedShiftId`).
   - Update the file docblock: Enter shortcut removed (the add button applies the changeover gap); breaks may be named.
5. **`period-slots-panel.stories.tsx`**: pass `shifts`, `onSelectShift`; add a story whose rows overlap so the row error shows.
6. Logical classes only (`text-end`, `-me-2`); no `<select>`, no `type="time"`, no `text-sm` left.

## Tests
- `shifts-panel.test.tsx`: times show as "8:00 AM", never `08:00:00`; "Add shift" opens a dialog with two time pickers and submits `{ name, day_starts_at, day_ends_at, sequence }`; end ≤ start shows the error and blocks submit; delete asks first; a mocked 409 shows `shiftsPanel.inUseError`, never the server text.
- `period-slots-panel.test.tsx`: the shift Select lists shifts and calls `onSelectShift`; no `select` or `input[type=time]` in the DOM; changing a row to Break keeps its name and the saved payload carries it; a row ending before it starts / outside the shift / overlapping the row above shows the matching message and disables Save; "Add period" appends a row starting at previous end + gap (keep the existing D7 test, now via the button); a mocked 409 on save shows `inUseError`; no shift → EmptyState; switching shift still clears rows until the new shift loads (keep the existing 21.8.1 test).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button on the tab ("সংরক্ষণ করুন").
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); times follow D7, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The shift for the period table is chosen with a labelled Select.
- [ ] A bad row shows its problem under the row before Save, and Save is disabled.
- [ ] A break's name ("টিফিন") saves and shows in the routine table.
- [ ] Deleting a shift asks first; refused saves/deletes give a Bangla sentence.

## Out of scope
- Editing a shift's name or window after creation (no edit UI today; `useUpdateShift` exists but wiring it is new behaviour).
- "Suggest period times" (`ChangeoverSuggestion` in the hooks) — not exposed today; not added.

Wave: 9   Lane: routines   Decisions: D6, D7, D9, D15, D17, D19, D21, D25, D28, D29, D37   Depends on: 31.3.8b, 31.4.routines-4a
