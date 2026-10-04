# [31.4.calendar-2] Import calendar — full-page modal with clear review step

## Goal
`/calendar/import` is a `FullPageShell` with a visible Close, a two-step flow (upload → review) whose review shows a status summary, a kit table with errors first and translated problems, and the commit action in the sticky footer.

## What and why
The page lets an admin load a year's events from a spreadsheet (or review a clone staged from the calendar page) and commit them in one go. Today it is a narrow column inside the app shell with a raw `items.import` breadcrumb, the upload starts the moment a file is picked, the review table shows only a row number and the server's English error text, the summary is four plain spans, and the commit button sits mid-page under the table. The redesign makes it a full-page modal (D23 lists "import calendar"), adds an explicit "check file" step, uses StatusBadges for the summary and rows, translates every problem, and puts Back / Commit in the footer.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar-import/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar-import/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar-import/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar-import/mobile.webp?raw=true" width="260"> |

The "after" shots show step 2 (review), the richest state; step 1 and the done state are specified in Steps.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | `FullPageShell` `size="wide"` (table), title "ক্যালেন্ডার আমদানি করুন", Close "বন্ধ করুন" → back to `/calendar`; asks before discarding when a preview is open. No app chrome, no breadcrumb. | D22, D23 |
| 2 | Step label | **New** line above each step title: "ধাপ ১ / ২" / "ধাপ ২ / ২" (`text-label text-text-secondary`), then the step title as `h2`. | Can see where I am |
| 3 | Step 1 | Card: description, outline "টেমপ্লেট ডাউনলোড করুন" (`download`), `FileUpload` dropzone. Picking a file no longer uploads at once; footer primary **New** "ফাইল যাচাই করুন" (disabled until a valid file is chosen), secondary "বাতিল করুন". | One obvious action; no surprise upload |
| 4 | Upload errors | Wrong type / too large stay client-side translated; a failed validate shows `step1.uploadFailed`, never `error.message`. | D9 |
| 5 | Step 2 summary | Four `StatusBadge`s: success "n টি নতুন", info "n টি হালনাগাদ", neutral "n টি অপরিবর্তিত", danger "n টি ত্রুটিসহ" (zero counts hidden). File name under the title. | D27, D6 |
| 6 | Step 2 table | Kit DataTable (unpaginated, "মোট n টি"): সারি ("সারি ৪", tenant numerals), অবস্থা (StatusBadge per status), সমস্যা. Error rows sorted first. Problem text = "কলাম: <translated column> — <translated sentence>", never the server `message`. | D9, D19, D27 |
| 7 | Rules card | Card "আমদানির নিয়ম": checkbox rows "সঠিক সারিগুলো আমদানি করুন" (only when errors) and "সাথে সাথে প্রকাশ করুন", each with its hint as help text. | D25 |
| 8 | Step 2 footer | Secondary "অন্য ফাইল বেছে নিন" (`file-up`), primary "আমদানি নিশ্চিত করুন" (busy "আমদানি হচ্ছে…"; disabled while errors exist and partial import is off). Commit failure = `step3.commitFailed` alert above the table. | D22 |
| 9 | Done | `EmptyState`-shaped success card (icon well `bg-status-paid-bg text-status-paid-fg`, `circle-check`), title "আমদানি সম্পন্ন হয়েছে", the published/draft sentence, outline "আরেকটি ফাইল আমদানি করুন"; footer primary "ক্যালেন্ডারে দেখুন". | D28, D29 |

## Mobile behaviour
- Header: title truncates, "বন্ধ করুন" stays 44 px on the right.
- Summary badges wrap onto two lines.
- Table becomes compact two-line rows in one Card: "সারি n" + problem text, badge on the right.
- Footer: secondary left, primary right, both 44 px; no bottom bar.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Step count shown | 3 (upload, review, confirm) / 2 | 2 | "Confirm" was already merged into review in the code; the done screen is a result, not a step. |
| Auto-upload on file pick | keep / explicit "ফাইল যাচাই করুন" | explicit | The footer needs one primary; a wrong pick no longer fires a request. |
| Problem text | server message / column + generic translated sentence | translated | Server messages are English (D9); a per-code message needs a server `code` (shared request filed). |
| Name / dates columns | add now / wait | wait | The preview DTO returns only `row`, `status`, `errors`; keys `step2.columnName` / `columnDates` stay for when the shared request lands. |
| Row order | file order / errors first | errors first | The rows that need action are the ones to see without scrolling. |

## Files
- `client-admin/src/routes/_staff/calendar/import.tsx` — FullPageShell, step state, footer actions, translated errors
- `client-admin/src/routes/_staff/calendar/-import-dropzone.tsx` — Card layout, no auto-submit (reports the chosen file up)
- `client-admin/src/routes/_staff/calendar/-import-preview-table.tsx` — summary badges, kit table, sorting, translated problems, rules card
- `client-admin/src/routes/_staff/calendar/-import-preview.stories.tsx` — errors + clean variants
- `ui/src/i18n/locales/bn/calendarImport.json`, `ui/src/i18n/locales/en/calendarImport.json` — keys below
- `client-admin/src/routes/_staff/calendar/import.test.tsx` — update

## Steps
1. **Frame** (`import.tsx`): render `FullPageShell` for every state with `title={t('pageTitle')}`, `size="wide"`, `onClose={() => navigate({ to: '/calendar' })}`, `dirty={state.step === 'preview'}`. Remove the three `mx-auto max-w-*` wrappers and the `<h1>`s (the shell's title is the h1). Keep `setPendingClonePreview` / `getPendingClonePreview` exactly as they are (the calendar page imports `setPendingClonePreview`).
2. **State.** Add `selectedFile: File | undefined` to the upload step. `ImportDropzone` gets `onFileChange(file | undefined)` instead of `onFileSelected` and no longer calls validate; its own type/size checks stay and report `undefined` for a rejected file. Footer for `upload`: `secondary={{ label: t('clone.cancel'), onClick: close }}`, `primary={{ label: t('step1.check'), onClick: () => validate(selectedFile), disabled: !selectedFile, busy: validateMutation.isPending }}`. While pending show `t('step1.validating')` as help text under the dropzone. `onError` → `setUploadError(t('step1.uploadFailed'))` (delete the `error instanceof Error ? error.message` branch).
3. **Step heading** (each step): `<div><p className="text-label text-text-secondary">{t('stepOf', { current, total: 2 })}</p><h2 className="text-h2">{title}</h2>{fileName && <p className="mt-0.5 text-text-secondary">{t('step2.fileName', { name: fileName })}</p>}</div>`. Keep the chosen file's name in state for the review step; for a clone preview (no file) omit the line.
4. **Dropzone layout** (`-import-dropzone.tsx`): one Card (`p-4 md:p-5`): description `text-text-secondary`, outline download button (`DownloadIcon`, `mt-3`), then `FileUpload` (`mt-4`).
5. **Preview** (`-import-preview-table.tsx`):
   - Summary: `<div className="flex flex-wrap gap-2">` of `StatusBadge`s — `tone="success"` `step2.summaryNew`, `info` `summaryUpdated`, `neutral` `summaryUnchanged`, `danger` `summaryError`; skip a badge whose count is 0. `{{count}}` renders in tenant numerals (31.2.1 formatter).
   - Rows: `const sorted = [...rows].sort((a, b) => Number(b.status === 'ERROR') - Number(a.status === 'ERROR') || a.row - b.row)`.
   - Replace the raw `Table` with `DataTable` `paginated={false}`, `tableId="calendar-import-preview"`, caption `t('step2.caption')`. Columns: `row` → `t('step2.rowLabel', { row: formatNumber(r.row, regionConfig) })` `font-medium`; `status` → `StatusBadge` with `STATUS_TONE = { NEW: 'success', UPDATED: 'info', UNCHANGED: 'neutral', ERROR: 'danger' }` and label `t(`step2.status.${r.status}`)` (delete `PILL_STYLES`); `problem` → `r.errors.length === 0 ? '—' : r.errors.map(problemText).join(' ')`, where `problemText(e) = t('step2.problem', { column: e.column ? t(`columns.${e.column}`, { defaultValue: t('step2.wholeRow') }) : t('step2.wholeRow') })`. Never render `e.message`.
   - Rules card below the table: Card `p-4 md:p-5`, `h2 text-h3` `t('step2.rulesTitle')`, then the two checkbox rows (move the "publish immediately" checkbox from `import.tsx` into this card via props `publishImmediately` / `onPublishImmediatelyChange`); each row `flex min-h-11 items-center gap-3 md:min-h-8` with its hint as `text-caption text-text-secondary` help text linked by `aria-describedby`.
6. **Review footer:** `secondary={{ label: t('step2.back'), onClick: () => setState({ step: 'upload' }) }}`, `primary={{ label: commitMutation.isPending ? t('step3.committing') : t('step3.commit'), onClick: handleCommit, disabled: !canCommit, busy: commitMutation.isPending }}`. Commit failure: `<p role="alert">` with the kit error-text style above the summary.
7. **Done:** body = Card `flex flex-col items-center gap-2 px-4 py-10 text-center` with the success icon well, `h2 text-h3` `success.title`, the published/draft sentence, outline `success.importAnother` (`mt-2`). Footer: `primary={{ label: t('success.viewOnCalendar'), onClick: () => navigate({ to: '/calendar' }) }}`, no secondary.
8. **i18n** (`calendarImport.json`):

    | Key | bn | en |
    |---|---|---|
    | `stepOf` (**New**) | ধাপ {{current}} / {{total}} | Step {{current}} of {{total}} |
    | `step1.check` (**New**) | ফাইল যাচাই করুন | Check file |
    | `step2.fileName` (**New**) | ফাইল: {{name}} | File: {{name}} |
    | `step2.caption` (**New**) | ফাইলের প্রতিটি সারি — ত্রুটি আগে | Every row of the file — errors first |
    | `step2.rowLabel` (**New**) | সারি {{row}} | Row {{row}} |
    | `step2.problem` (**New**) | কলাম: {{column}} — এই ঘরটি ঠিক নেই। ফাইলে ঠিক করে আবার আপলোড করুন। | Column: {{column}} — this cell is not valid. Fix it in the file and upload again. |
    | `step2.wholeRow` (**New**) | পুরো সারি | Whole row |
    | `step2.rulesTitle` (**New**) | আমদানির নিয়ম | Import options |
    | `columns.type` … `columns.description` (**New**, one per `CALENDAR_IMPORT_COLUMNS` entry in `server/src/modules/calendar/import/calendar-import-rows.util.ts:9-20`) | ধরন, নাম, শুরুর তারিখ, শেষের তারিখ, শুরুর সময়, শেষের সময়, কর্মদিবস, কার জন্য, শ্রেণি, বিবরণ | Type, Name, Start date, End date, Start time, End time, Working day, Audience, Classes, Description |

    Remove unused: `step3.title`, `step1.title` stays.

## Tests
- `import.test.tsx`: page renders inside the full-page frame with "বন্ধ করুন"; picking a file does not call validate until "ফাইল যাচাই করুন" is pressed; validate failure shows `step1.uploadFailed` and never the thrown message; review sorts error rows first; a row error with `column: 'start_date'` shows "কলাম: শুরুর তারিখ — …" and not the server message; commit is disabled with errors until "সঠিক সারিগুলো আমদানি করুন" is ticked; Close on the review step asks before leaving; a clone preview opens straight on step 2 without a file line.
- `-import-preview.stories.tsx`: "with errors" and "all clean" stories.
- `e2e/journeys/calendar-import.spec.ts`: API-only today — no change; re-run.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No app sidebar, top bar, bottom bar or breadcrumb on this page; Close returns to `/calendar`.
- [ ] Step label "ধাপ n / ২" above each step title.
- [ ] Summary is four (or fewer) StatusBadges; table rows show a StatusBadge, errors first.
- [ ] No English server sentence anywhere on the page.

## Out of scope
- Row name / dates and per-error codes in the preview — shared request filed (`calendar-import | server CalendarImportRowResponseDto`).
- Preview expiry handling (`expired.*` keys exist, the page never reads `expires_at`) — behaviour change beyond a redesign; noted.
- "Publish all now" on the done screen (`success.publishAllNow`, unused) — not wired today (D1).
- Breadcrumb `items.import` raw key (B15) — gone here because the full-page modal has no crumbs; the key fix is 31.3.4.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server preview row name/dates + error code | Deferred | — | use the fallback in the ticket (row n, status, one translated sentence; never the server message) |

Wave: 9   Lane: calendar   Decisions: D6, D9, D19, D22, D23, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.calendar-1b (shares `calendarImport.json`)
