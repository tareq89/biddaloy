# [31.4.programs-2b] Enrol and Record — full-page modals, kit pickers

## Goal
"শিক্ষার্থী তালিকাভুক্ত করুন" and "অর্জন রেকর্ড করুন" open as `FullPageShell` full-page modals driven by the existing `?enrol=1` / `?record=1` search params, with labelled selects, a kit `DatePicker` (no native `<input type="date">`), a kit checkbox list of students and the primary in the sticky footer.

Runs after part a (`ticket.md`).

## What and why
These two forms are how students join a program and how achievements are recorded — the page's main jobs. Each holds a scrollable list of students plus 4–7 fields, which by D21 makes it a full-page modal; today both are small dialogs with a native date input (D25, D37 lint), selects that have only an `aria-label`, an underlined "select all" link, and a default date taken from the UTC day (`new Date().toISOString().slice(0, 10)` — wrong between midnight and 6 AM in Dhaka). The redesign moves them into `FullPageShell` with the kit form layout and fixes the date.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/programs/programs_programId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/programs/programs_programId/mobile.webp?raw=true" width="260"> |

(The screenshots show the host page; the full-page modal itself follows `PATTERN: Form` inside `starter-fullpage.html` / `patterns.md` "FullPageShell" with no page-specific layout beyond the steps below.)

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Enrol | `Dialog` → `FullPageShell` (`size="form"`), title "শিক্ষার্থী তালিকাভুক্ত করুন", secondary Cancel, primary "তালিকাভুক্ত করুন" (busy while saving). | D21, D22, D23 |
| 2 | Record | Same, title "অর্জন রেকর্ড করুন", primary "সংরক্ষণ করুন". | D21, D22, D23 |
| 3 | Fields | Every select is a `FormField` with a visible label and placeholder "বাছুন"; program (only when opened without a program), milestone / class / section required-marked. | D25 |
| 4 | Dates | `DatePicker` for "শুরুর তারিখ" / "অর্জনের তারিখ"; default = today in the tenant zone; sent with `toIsoDate`. | D25, D37; UTC-day bug |
| 5 | Student list | A Card with a header row (label + count "৩/৪০ জন বাছাই করা" + ghost "সব বাছুন" / "সব বাদ দিন") and kit Checkbox rows (`min-h-11 md:min-h-8`) with name + roll; no inner `max-h-48` scroll box — the page scrolls. | D25, D29 |
| 6 | Messages | Skipped-students note becomes an info line (`text-text-secondary` with `info` icon) above the footer; errors use the kit Error text. | D28 |
| 7 | Row record | Students-tab row "record" sets `?record=1&enrollment=<id>` instead of local state, so the modal is in the URL. **New** search key `enrollment` on the detail route. | D22 |
| 8 | Dirty close | `dirty` = any field changed or any student ticked; Esc / Close asks before discarding (FullPageShell does this). | D22 |

## Mobile behaviour
- Full-page modal covers the shell; header title truncates, Close (X + "বন্ধ করুন") 44 px.
- Fields one column; student rows full width, 44 px; footer Cancel left, primary right, both `h-11`.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Dialog vs full page | keep dialog / FullPageShell | FullPageShell | D21: both hold a list and more than 4 fields; on a phone the inner 192 px scroll box was unusable. |
| URL | new routes / existing search params | existing `?enrol=1` / `?record=1` | The command palette already lands on these (34.4.2); no route changes (D1). |
| Select-all wording | "এই পাতায় সব বাছুন" (common) / "সব বাছুন" | "সব বাছুন" / "সব বাদ দিন" (**New**, programs ns) | There are no pages here; the toggle needs both states. |

## Files
- `client-admin/src/routes/_staff/programs/-enrol-dialog.tsx` — FullPageShell, labels, DatePicker, checkbox list
- `client-admin/src/routes/_staff/programs/-record-dialog.tsx` — same
- `client-admin/src/routes/_staff/programs/$programId.tsx` — `enrollment` search key, pass it to `RecordDialog` (also changed by programs-2a, runs earlier)
- `client-admin/src/routes/_staff/programs/-students-tab.tsx` — row record navigates instead of local state (also changed by programs-2a, runs earlier)
- `ui/src/i18n/locales/bn/programs.json`, `ui/src/i18n/locales/en/programs.json` — keys below (also changed by programs-1 / 2a)
- `client-admin/src/routes/_staff/programs/-enrol-dialog.test.tsx`, `-record-dialog.test.tsx` — update
- `e2e/journeys/programs.spec.ts` — enrol flow selectors

## Steps
1. **Both components** keep their names, props and export (`EnrolDialog`, `RecordDialog`; `open`, `onOpenChange`, … unchanged) so `index.tsx` and `$programId.tsx` callers keep working. Render `open ? <FullPageShell …> : null` instead of `<Dialog>`. `onClose={() => onOpenChange(false)}`; `primary={{ label, onClick: submit, busy: mutation.isPending, disabled: !canSubmit }}`; `secondary={{ label: tCommon('actions.cancel'), onClick: () => onOpenChange(false) }}`; `dirty` per change 8. Body is a `<form id=…>` with `space-y-6`; one Card (`patterns.md` §6 Sections) for the fields (`grid gap-4 md:grid-cols-2`) and one for the student list.
2. **Selects.** Each `Select` inside `FormField label=… required` (program, class, milestone; section optional); `SelectValue placeholder={t('dialogs.selectPlaceholder')}`; remove the trigger `aria-label`s. Program label = `t('dialogs.program')` (**New**) — the e2e combobox name changes from `programs.list.title` to this key.
3. **Dates.** Replace the native `<input type="date">` with `DatePicker` (`value: Date`). Initial value `new Date()` (local day). On submit send `toIsoDate(date)`; delete both `new Date().toISOString().slice(0, 10)` lines.
4. **Student list Card.** Header `flex items-center justify-between gap-3`: `<h2 className="text-h3">` label + caption `t('dialogs.selectedCount', { selected, total })`; ghost button `t(allSelected ? 'dialogs.clearAll' : 'dialogs.selectAll')`. Rows `ul divide-y divide-border-subtle` of `<label className="flex min-h-11 items-center gap-3 md:min-h-8">` + `Checkbox` + name `font-medium` + roll `text-text-secondary` (tenant digits like 2a step 5). Empty: `text-text-secondary` sentence `t('dialogs.enrol.pickClassFirst')` (enrol, before a class is chosen) / `t('dialogs.record.noStudents')` (record).
5. **Messages.** Skipped note `flex items-center gap-1.5 text-text-secondary` + `InfoIcon size-4`; error = kit Error text with `CircleAlertIcon`; keep the existing keys.
6. **Row record in URL.** `$programId.tsx`: add `enrollment: z.coerce.string().optional().catch(undefined)` to the search schema; pass `enrollmentIdPrefill={search.enrollment}` to the `?record=1` `RecordDialog`; clear `enrollment` in `closeDialogSearch`. `-students-tab.tsx`: replace `recordFor` state and its `RecordDialog` with a new prop `onRecordFor(enrollmentId)` that the page wires to `navigate({ search: { ...search, record: '1', enrollment: id } })`.
7. **i18n** (`programs.json`, en + bn):

   | Key | bn | en |
   |---|---|---|
   | `dialogs.program` (**New**) | প্রোগ্রাম | Program |
   | `dialogs.selectPlaceholder` (**New**) | বাছুন | Select |
   | `dialogs.selectedCount` (**New**) | {{selected}}/{{total}} জন বাছাই করা | {{selected}} of {{total}} selected |
   | `dialogs.selectAll` / `dialogs.clearAll` (**New**) | সব বাছুন / সব বাদ দিন | Select all / Clear all |
   | `dialogs.enrol.pickClassFirst` (**New**) | শিক্ষার্থী দেখতে আগে শ্রেণি বাছুন। | Choose a class to see its students. |
   | `dialogs.record.noStudents` (**New**) | এই প্রোগ্রামে কোনো সক্রিয় শিক্ষার্থী নেই। | No active students in this program. |

## Tests
- `-enrol-dialog.test.tsx` / `-record-dialog.test.tsx`: renders a full-page modal with the title as `h1`; no `input[type=date]` in the DOM; date sent equals the local day via `toIsoDate` (mock clock at 2026-10-04 01:00 Asia/Dhaka → `2026-10-04`); select-all toggles to clear-all; Close with a ticked student asks to discard.
- `e2e/journeys/programs.spec.ts` (lines ~101–117): replace `page.getByRole('dialog')` with the full-page modal's `main` region; combobox name `t('programs.dialogs.program')`; submit button name `t('programs.students.enrol')` is now in the footer. `e2e/keyboard/programs.spec.ts`: re-run.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (host page unchanged by this part).
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Enrol and Record cover the app chrome, show Close (X + "বন্ধ করুন"), and the URL carries `?enrol=1` / `?record=1`.
- [ ] No native date input on either form; the default date is today in Dhaka even at 1 AM.
- [ ] Every select has a visible label.

## Out of scope
- `students/-detail/programs-panel.tsx` (students lane) also mounts `EnrolDialog` / `RecordDialog` from local state. Props stay the same, so it keeps working and shows the full-page modal, but without a URL param — shared request filed to the students lane.
- Score / grade stay free text (no grading-scale lookup) — D1.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| milestone-checklist rows 44/32px, kit checkbox look, ghost Undo, kit tokens | Accepted | 31.2.14b | pass achievedOn already formatted with formatDate; no other change |
| student-route search params for Enrol/Record (students-lane file) | Accepted | 31.5.0 | URLs: /students/<id>?enrolProgram=1 and ?recordMilestone=<enrollmentId>; EnrolDialog/RecordDialog props unchanged |

Wave: 9   Lane: programs   Decisions: D21, D22, D23, D25, D28, D37   Depends on: 31.3.8b, 31.4.programs-2a
