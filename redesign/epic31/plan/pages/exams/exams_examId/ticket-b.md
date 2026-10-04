# [31.4.exams-2b] Exam detail — marks-breakdown and schedule tabs

## Goal
The exam detail's "নম্বর বিভাজন" (was "সেটআপ") and "সময়সূচি" tabs use kit cards, tables, pickers and confirm dialogs, show names instead of raw values, and the copy tool becomes a full-page modal. Runs after `ticket.md` (exams-2a), which builds the header and tab strip.

## What and why
Before marks can be entered, someone splits each subject's marks into parts (written 70, MCQ 30) and sets the date and time each subject is sat. Today the Setup tab is a bare table with a "sequence" column, an underlined red "মুছুন" that deletes instantly, and a cramped add row; the Schedule tab shows ISO dates and `09:00:00`, edits them with the browser's native date/time inputs, adds every new subject on the UTC "today" at 9–11, and shows the server's English overlap warnings. The redesign gives both tabs the kit's table and form patterns, adds a confirm before deleting a part, shows a running full-marks total, edits schedule cells with `DatePicker` / `TimeInput`, flags time clashes on the row in Bangla, and moves the copy tool (it holds a target list and a preview) into a `FullPageShell` (D21).

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After (header and tabs; panels per Steps) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_examId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_examId/mobile.webp?raw=true" width="260"> |

No separate mockup: both tabs are built only from kit patterns named in each step (`DataTable (unpaginated)`, `Form`, `EmptyState`, `ConfirmDialog`, `DatePicker`, `TimeInput`, `FullPageShell`).

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Wording | In `componentsPanel.*` and `copyDialog.*`: bn "কম্পোনেন্ট" → "অংশ", en "component(s)" → "part(s)"; drop the trailing "…" on the copy button. | D32 — plain word; matches the new tab name |
| 2 | Breakdown — toolbar | Row above the cards: Field "বিষয়" (labelled Select, `w-full md:w-72`, subject names via `subjectLabel`) and, right-aligned, outline "অন্য জায়গা থেকে কপি করুন" (`copy`) when `EXAM_MANAGE`. | D24/D25 visible label; D9 English names on bn screens |
| 3 | Breakdown — table | `PATTERN: DataTable (unpaginated)`: নাম · ধরন · পূর্ণমান · পাস নম্বর · কাজ; rows in `sequence` order; the sequence column is gone; numbers end-aligned via `formatNumber`; derived parts show "স্বয়ংক্রিয়". Footer **New**: "মোট ৩টি অংশ · পূর্ণমান ১০০" (sum of manual parts). | D6, D19; the total lets a teacher see at once that the parts add up |
| 4 | Breakdown — delete | `RowActions` delete (`trash-2`) → `ConfirmDialog tone="danger"` "এই অংশটি মুছবেন?" / "„লিখিত“ বাংলা থেকে মুছে যাবে।" before `useDeleteExamComponent`. | Deleting was one unconfirmed click on a text link (D19, D29) |
| 5 | Breakdown — add | Card "নতুন অংশ যোগ করুন" (`PATTERN: Form`): নাম* · ধরন · পূর্ণমান* · পাস নম্বর, `grid gap-4 md:grid-cols-12` (4/3/2/2 + button), outline "যোগ করুন"; attendance hint as help text; errors under their field; a failed save shows `componentsPanel.errorMessage`, never the server text. | D25, D29 (header owns the one primary), D9 |
| 6 | Breakdown — empty | `EmptyState` "এই বিষয়ে এখনো কোনো অংশ নেই" + "নিচে প্রথম অংশ যোগ করুন, অথবা অন্য বিষয় থেকে কপি করুন।" (no action — the add card sits right below). | D28 |
| 7 | Copy tool | `CopyComponentsDialog` → `FullPageShell size="form"` "অংশ কপি করুন", opened by `?copy=1` on `/exams/$examId`; Cards "কোথা থেকে" (radio rows + source select), "কোন বিষয়ে" (checkbox rows), "পূর্বরূপ" (will be created / skipped with reason); footer secondary "বাতিল", primary "কপি করুন" (disabled when nothing would be created). Close/Esc ask before discarding a started choice. | D21/D22: it holds a list and a preview |
| 8 | Schedule — table | Card table: বিষয় · তারিখ · শুরু · শেষ · স্থান · কাজ. Cells show `formatDate` / `formatTime` / venue or `—`. Each date cell is a `DatePicker` trigger, each time cell a `TimeInput` trigger, venue an inline `Input` (Enter saves, Esc cancels) — still keyboard-editable without a modal; picking a value saves the cell. | D5, D7, D25 (no native date/time inputs), B21-style seconds gone |
| 9 | Schedule — clashes | **New** client-side check: a row whose time overlaps another row on the same date shows `StatusBadge tone="warning"` "সময় মিলে যাচ্ছে" + caption "গণিত-এর সাথে একই সময়ে". The server's English `warnings` strings are no longer shown. | D9; and the clash stays visible, not only right after a save |
| 10 | Schedule — remove | `RowActions` remove (`circle-minus`) "সময়সূচি থেকে সরান" (no confirm: re-adding is one step). | D19 |
| 11 | Schedule — add | Card "সময়সূচিতে বিষয় যোগ করুন": বিষয় (Select of unscheduled subjects) · **New** তারিখ (`DatePicker`, default local today via `toIsoDate(new Date())`) · **New** শুরু / শেষ (`TimeInput`, default 09:00 / 11:00) · outline "যোগ করুন". | The old add always used the UTC day (`toISOString().slice`) and forced an edit right after |
| 12 | Schedule — empty | `EmptyState` "এখনো কোনো সময়সূচি নেই" + "নিচে বিষয় বেছে তারিখ ও সময় দিন।". | D28 |

## Mobile behaviour
- Breakdown: toolbar stacks (subject select full width, copy button full width under it); table → compact rows "লিখিত" + caption "লিখিত · পূর্ণমান ৭০ · পাস ২৩" with the delete icon; add form fields full width, button full width.
- Schedule: one card per subject — title (subject) + clash badge, then `dl grid grid-cols-2` of four 44 px triggers (তারিখ, শুরু, শেষ, স্থান) that open the same pickers / venue input; action row "সময়সূচি থেকে সরান" with its label.
- Copy tool: full-screen on every width; header Close and footer buttons `h-11`.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Copy tool size | Dialog `lg` / FullPageShell | FullPageShell | D21: it holds a target list and a preview. Not on D23's list, but the rule decides. URL via search param `?copy=1` (D22). |
| Schedule editing | per-row dialog / inline pickers | inline pickers | Keeps 19.11.1's "keyboard-editable, not a modal" rule while dropping native inputs. |
| Overlap warnings | show server strings / translate them / compute locally | compute locally from the loaded rows | Server strings are English sentences with `HH:mm:ss` (`exam-schedules.service.ts:131`); all rows are already on the client. |
| Confirm before delete | none / ConfirmDialog | ConfirmDialog for parts, none for schedule rows | A part may already carry marks; a schedule row is three values. |
| Word for "component" | কম্পোনেন্ট / উপাদান / অংশ | অংশ | Shortest plain word. The analysis page (keys in this lane's `exams.json`) says "উপাদান" for the same thing, so those two values change too — one word per thing (D32). |

## Files
- `client-admin/src/routes/_staff/exams/-detail/components-panel.tsx` — toolbar, table, totals, confirm delete, add card, empty state, copy-tool trigger
- `client-admin/src/routes/_staff/exams/-detail/components-panel.test.tsx`
- `client-admin/src/routes/_staff/exams/-detail/schedule-panel.tsx` — table, pickers, clash badge, add card, empty state, phone cards
- `client-admin/src/routes/_staff/exams/-detail/schedule-panel.test.tsx`
- `client-admin/src/routes/_staff/exams/-copy-components-dialog.tsx` — becomes `FullPageShell`
- `client-admin/src/routes/_staff/exams/-copy-components-dialog.test.tsx`
- `client-admin/src/routes/_staff/exams/$examId.tsx` — `validateSearch` for `copy` (also changed by exams-2a, runs earlier)
- `ui/src/i18n/locales/{en,bn}/exams.json` — keys below (also changed by exams-1 and exams-2a, run earlier)

Used, not changed: `-detail/subject-label.ts` (exams-2a).

## Steps
1. **Locale (`exams.json`, en + bn).** Apply Change 1 to every value under `componentsPanel` and `copyDialog` (bn grammar: কম্পোনেন্টের → অংশের, কম্পোনেন্টসমূহ → অংশগুলো). `componentsPanel`: `copyComponents` → "Copy from elsewhere" / "অন্য জায়গা থেকে কপি করুন"; add `addTitle` "Add a part" / "নতুন অংশ যোগ করুন"; `emptyTitle` "No parts for this subject yet" / "এই বিষয়ে এখনো কোনো অংশ নেই"; `emptyText` "Add the first part below, or copy from another subject." / "নিচে প্রথম অংশ যোগ করুন, অথবা অন্য বিষয় থেকে কপি করুন।"; `totals` "{{count}} parts · full marks {{marks}}" / "মোট {{count}}টি অংশ · পূর্ণমান {{marks}}"; `rowCaption` "{{kind}} · full marks {{full}} · pass {{pass}}" / "{{kind}} · পূর্ণমান {{full}} · পাস {{pass}}"; `deleteTitle` "Delete this part?" / "এই অংশটি মুছবেন?"; `deleteDescription` "“{{name}}” will be removed from {{subject}}." / "„{{name}}“ {{subject}} থেকে মুছে যাবে।"; `delete` "Delete" / "মুছুন"; `columnActions` bn → "কাজ"; delete `columnSequence`, `empty`. `copyDialog`: add `sourceCard` "Copy from" / "কোথা থেকে"; `cancel` "Cancel" / "বাতিল"; `skippedTitle` "Skipped" / "বাদ যাবে"; `title` → "Copy parts" / "অংশ কপি করুন". `analysis`: bn `byComponent` → "অংশ অনুযায়ী", `passFailComponent.columnComponent` → "অংশ" (en "By part" / "Part"). `schedulePanel`: add `overlapBadge` "Time clash" / "সময় মিলে যাচ্ছে"; `overlapWith` "Same time as {{subjects}}" / "{{subjects}}-এর সাথে একই সময়ে"; `addTitle` "Add a subject to the schedule" / "সময়সূচিতে বিষয় যোগ করুন"; `emptyTitle` "No schedule yet" / "এখনো কোনো সময়সূচি নেই"; `emptyText` "Pick a subject below and set its date and time." / "নিচে বিষয় বেছে তারিখ ও সময় দিন।"; `editCell` "Change {{column}} — {{subject}}" / "{{column}} বদলান — {{subject}}"; `remove` → "Remove from schedule" / "সময়সূচি থেকে সরান"; `columnActions` bn → "কাজ"; delete `empty`.
2. **`components-panel.tsx` — toolbar and table.** Toolbar `flex flex-col gap-3 md:flex-row md:items-end md:justify-between`: `FormField` "বিষয়" + `Select` (`className="w-full md:w-72"`, items `subjectLabel(s.subject, i18n.language)`); outline `Button` with `Copy` icon → `navigate({ search: (p) => ({ ...p, copy: '1' }) })`. Table per `PATTERN: DataTable (unpaginated)` via `DataTable paginated={false}`: columns `name` (font-medium; phone caption `rowCaption`), `kind`, `full_marks` (align end; derived → `componentsPanel.derived`, else `formatNumber(Number(full_marks), config)`), `pass_marks` (align end, `formatNumber` or `—`); `rowActions` = `[{ intent: 'delete', label: t('componentsPanel.delete'), allowed: canManage, onClick: () => setPendingDelete(row) }]`. Footer text = `totals` with `count` = rows, `marks` = `formatNumber(sum of Number(full_marks) over source === MANUAL)` (replaces the plain "মোট n টি").
3. **`components-panel.tsx` — delete, add, empty.** `ConfirmDialog` `tone="danger"`, `confirmLabel={t('componentsPanel.delete')}`, `busy={deleteComponent.isPending}`, closes on success. Add Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`) as a `<form>`: `h2 text-h2` `addTitle`, then `mt-4 grid gap-4 md:grid-cols-12 md:items-end`: নাম (`md:col-span-4`, required mark), ধরন (`md:col-span-3`), পূর্ণমান (`md:col-span-2`, required mark, `inputMode="decimal"`, hidden for ATTENDANCE), পাস নম্বর (`md:col-span-2`), outline submit "যোগ করুন" (`md:col-span-1`, `w-full`, `loading`). Validation messages render under the field with the kit error classes (`border-destructive` on the control); a failed mutation shows `componentsPanel.errorMessage`. Empty table → `EmptyState` (`list-checks` icon) per Change 6. Loading → table skeleton; error → `ErrorState` (kept). Cards spaced by the tab panel's `space-y-6`.
4. **`-copy-components-dialog.tsx` → full page.** Keep the component name and its preview/copy logic; change the frame to `FullPageShell` (`title={t('copyDialog.title')}`, `size="form"`, `dirty` = a source or target chosen, `onClose` = drop `copy` from the search, `secondary={{ label: t('copyDialog.cancel'), onClick: onClose }}`, `primary={{ label: t('copyDialog.confirm'), onClick: copy, busy: copyMutation.isPending, disabled: preview.created.length === 0 }}`). Body: description `text-text-secondary`, then Cards: "কোথা থেকে" (`RadioGroup`, each option a row `flex min-h-11 items-center gap-3 md:min-h-8`; then the source subject or exam `Select` with label and placeholder "বাছুন"), "কোন বিষয়ে" (`targetsLabel`; `Checkbox` rows, same row classes), "পূর্বরূপ" (`previewCreated` line; skipped items as a `ul divide-y divide-border-subtle` of "name — reason"; `previewNothing` when empty). Subject names via `subjectLabel`. Failed copy shows `copyDialog.errorMessage` only. Props become `{ examId, classId, subjects, onClose }`; `ComponentsPanel` renders it when `Route.useSearch().copy === '1'` (use `useSearch({ from: '/_staff/exams/$examId' })`).
5. **`$examId.tsx`.** Add `validateSearch: z.object({ tab: z.string().optional().catch(undefined), copy: z.coerce.string().optional().catch(undefined) })` — `tab` must be listed or `useDetailShellTab` loses it. No other change.
6. **`schedule-panel.tsx` — table and cells.** Card `overflow-hidden` with the kit table (`thead` `bg-muted`, `td h-10 px-4 py-1`). Cell component `ScheduleCell` per column: `date` → `DatePicker` (`value={parseIsoDate(row.date)}`, trigger text `formatDate(row.date)`, `aria-label={t('schedulePanel.editCell', { column, subject })}`, on change `updateSchedule.mutate({ id, input: { date: toIsoDate(d) } })`); `starts_at` / `ends_at` → `TimeInput` (`value={row.starts_at.slice(0, 5)}`, `stepMinutes={15}`, on change save `HH:mm`); `venue` → button showing the venue or `—` that turns into an `Input` (Enter saves `value || null`, Esc cancels, blur saves — today's logic). Triggers use ghost styling inside the table (`h-11 w-full justify-start px-2 md:h-8`) so the table does not look like a form; `disabled` without `EXAM_MANAGE`. Subject cell: `subjectLabel(row.subject ?? classSubject.subject)`, never `subject_id`. `RowActions` remove per Change 10. Drop the `warnings` state and the alert block.
7. **`schedule-panel.tsx` — clashes.** `const clashes = useMemo(() => map row.id → names of other rows with the same date where a.starts_at < b.ends_at && b.starts_at < a.ends_at)`. When non-empty: `StatusBadge tone="warning" label={t('schedulePanel.overlapBadge')}` beside the subject and `p text-caption text-text-secondary` `overlapWith` (names joined with "، " in bn / ", " in en via `Intl.ListFormat`).
8. **`schedule-panel.tsx` — add, empty, phone.** Add Card `<form>`: `h2 text-h2` `addTitle`; `mt-4 grid gap-4 md:grid-cols-12 md:items-end`: বিষয় (`md:col-span-4`, placeholder "বাছুন"), তারিখ (`md:col-span-3`, `DatePicker`, default `new Date()`), শুরু (`md:col-span-2`, `TimeInput` default "09:00"), শেষ (`md:col-span-2`, default "11:00"), outline "যোগ করুন" (`md:col-span-1 w-full`); submit sends `{ subject_id, date: toIsoDate(date), starts_at, ends_at }`. Hidden when every subject is scheduled. Empty → `EmptyState` (`calendar-clock`) per Change 12. Phone (`md:hidden`): one Card per row per Mobile behaviour, same `ScheduleCell`s with Control classes (`h-11`) inside `dl grid grid-cols-2 gap-x-4 gap-y-3`.
9. Run `pnpm --filter client-admin test exams/-detail/components exams/-detail/schedule exams/-copy`, then `graphify update .`.

## Tests
- `components-panel.test.tsx` — keep "hides the marks field once ATTENDANCE is chosen"; delete asks for confirmation and calls the mutation only after confirm; totals line "মোট ২টি অংশ · পূর্ণমান ১০০" for parts 70 + 30 (+ a derived part not counted); no sequence column; a failed add shows `componentsPanel.errorMessage`, not the server message; the copy button sets `?copy=1`.
- `-copy-components-dialog.test.tsx` — keep "shows what will be created/skipped before confirm"; renders inside `FullPageShell` with a Close button; primary disabled when nothing would be created; Close with a choice made asks before discarding.
- `schedule-panel.test.tsx` — replace "edits the date with a date input and times with a time input" with: the date cell opens a `DatePicker` and choosing a day saves `YYYY-MM-DD`; the time cell opens a `TimeInput` and saves `HH:mm`; dates render long form and times without seconds; replace "shows the warnings the server returns" with: two rows overlapping on one date both show "সময় মিলে যাচ্ছে" and name each other, and server warning text is not rendered; add sends the picked date (mock the clock at 23:30 local on a UTC+6 day boundary and assert the local date); keep sort, venue-null, Escape and empty/error tests (adjusted to the new markup); no `input[type=date]` or `input[type=time]` in the panel.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (header and tabs) and the kit patterns named in Steps.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (the exam header's; the copy tool's footer inside the full page).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No native date/time input anywhere on the exam detail page.
- [ ] Deleting a part asks first; the full-marks total is visible.
- [ ] Overlapping schedule rows show a Bangla clash badge; no English server text.
- [ ] `?copy=1` opens the copy tool full-page; Close returns to the tab.

## Out of scope
- Re-ordering parts (sequence is still set on add as max + 1, as today).
- The word "কম্পোনেন্ট" in other namespaces (`examTemplates`, `examsTemplateField`, `seatPlans`) — exams-3a/3b / exams-4a/4b can apply the same word.
- Server overlap warnings stay English sentences; shared request filed for a structured shape.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server overlap warnings as data | Deferred | — | use the fallback in the ticket (compute clashes client-side, ignore warnings) |

Wave: 9   Lane: exams   Decisions: D5, D6, D7, D9, D19, D21, D22, D25, D28, D29, D32   Depends on: 31.3.8b, 31.4.exams-2a
