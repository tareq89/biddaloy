# [31.4.students-3] Import students — full-page modal, guide folded away

## Goal
`/students/import` opens as a wide `FullPageShell` with two step cards (download template, upload file) and a preview card, the 13-row column guide folded into a disclosure, and the one primary action ("৪৮ জন শিক্ষার্থী আমদানি করুন") in the footer.

## What and why
The page turns a filled spreadsheet into many students at once: download the template, upload it, check the preview, confirm. Today the 13-row column reference with raw header names (`guardian1_phone`) fills the screen before the upload button, which sits below the fold on a phone; the crumb reads "items.import"; the confirm button hides inside the preview card; and numbers mix digits ("২,000"). D23 lists import student as a full-page modal; the redesign keeps the same validate → preview → commit flow and only regroups and relabels it.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_import/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_import/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_import/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_import/mobile.webp?raw=true" width="260"> |

The "after" shots show the **preview** state (file validated, 48 rows, no problems). Other states: idle = step 2 shows the existing `FileUpload` drop zone and the footer primary is disabled; problems = `BulkImportErrorTable` sits between the summary and the preview card and the primary stays disabled; done = see change 8.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | `FullPageShell size="wide"` (`max-w-5xl`, it holds a table), title "শিক্ষার্থী আমদানি", Close "বন্ধ করুন" → `/students`. Footer: "বাতিল করুন" left, primary right. | D22, D23; removes the "items.import" crumb. |
| 2 | Step 1 card | Title + a two-sentence explanation (**shortened** wording) with the outline "টেমপ্লেট ডাউনলোড করুন" on the right (full width on phone). | Next action visible without scrolling. |
| 3 | Column guide | A `<details>` disclosure "কোন কলামে কী লিখবেন · ১৩টি কলাম", closed by default. Each row: human label (**New** keys), "আবশ্যক" (warning badge) / "ঐচ্ছিক" (neutral badge), the existing "what to write" text, and the header name as `code` in a caption ("কলামের শিরোনাম: `guardian1_phone`"). | Not needed until something fails; header names are kept because the file must use them exactly. |
| 4 | Migrate link | Stays as one sentence with an inline link under the guide (unchanged permission gate). | Link inside a sentence is allowed. |
| 5 | Step 2 card | Explanation with consistent digits ("২,০০০"). After validation: a file row (spreadsheet icon, file name, "যাচাই শেষ · ৪৮টি সারি", ghost "আরেকটি ফাইল আপলোড করুন"), then a success badge "কোনো সমস্যা নেই" + "৪৮ জন শিক্ষার্থী তৈরি হবে।" and the expiry line with a `clock` icon. | D6, D27. |
| 6 | Preview card | Its own Card (not nested): title "প্রিভিউ", sentence, table নাম / শ্রেণি / শাখা / অভিভাবকের ফোন (phone via `formatPhone`), footer "৪৮টির মধ্যে প্রথম ৫টি দেখানো হচ্ছে". Phone: compact two-line rows (`DataTable (unpaginated)` pattern). | D8, B22 (`import.tsx:243`), D19 total. |
| 7 | Footer primary | "{{count}} জন শিক্ষার্থী আমদানি করুন" (**New** key), enabled only in the preview state with no hard errors and not expired; busy while committing. Replaces the in-card "নিশ্চিত করুন". | D22: primary in the footer, one per view. |
| 8 | Done state | Card: success badge + "৪৮ জন শিক্ষার্থীর সবাই আমদানি হয়েছে।", the invite-guardians checkbox as a whole-row target (`min-h-11`), ghost "আরেকটি ফাইল আমদানি করুন". Footer primary becomes "শিক্ষার্থী তালিকায় যান" (→ `/students`, **New** key), secondary "বন্ধ করুন". | Clear end of the task. |
| 9 | Wording | Notifications say "আমদানি" instead of "ইম্পোর্ট". | D32 one word per thing. |

## Mobile behaviour
- One column; the download button and the "upload another" button are full width; file row wraps (icon + name on one line, button under).
- Preview table becomes two-line rows: name, then `Class 5 · A · 01712-345678`.
- Footer stays: "বাতিল করুন" + the primary, both `h-11`.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Column guide | always visible · disclosure · separate help page | Disclosure, closed | Shown only when needed; no new route. |
| Header names | hide · show as primary text · show as code caption | Code caption under a human label | The file must use them exactly (they are identifiers a person copies, D6/D9 spirit). |
| Which state to mock | idle · preview · done | Preview | It holds every new piece; idle/done described in Changes. |
| Footer primary owner | keep BulkUploadPreview's Confirm · footer | Footer (needs a shared change, see Out of scope) | One primary per view; same shape the homework and calendar imports will need. |

## Files
- `client-admin/src/routes/_staff/students/import.tsx` — FullPageShell, step cards, disclosure, preview card, done card, footer wiring
- `client-admin/src/routes/_staff/students/-import/template.ts` — export `REQUIRED_COLUMNS` here (moved from `import.tsx`) so the guide and tests share it
- `client-admin/src/routes/_staff/students/-import/import-preview.stories.tsx` — update to the new preview card
- `client-admin/src/routes/_staff/students/import.test.tsx`
- `ui/src/i18n/locales/bn/studentImport.json`, `ui/src/i18n/locales/en/studentImport.json`

## Steps
1. **Frame.** Replace `<div className="mx-auto flex max-w-4xl flex-col gap-6">` and the `<h1>` with `<FullPageShell title={t('title')} size="wide" onClose={() => void navigate({ to: '/students' })} secondary={…} primary={…}>`. No `dirty` (nothing is lost by closing before commit; a staged upload simply expires).
2. **Footer wiring.** With the shared change granted (`BulkUploadPreview` exposes its state and actions and can hide its own buttons — see Out of scope), drive the footer from that controller:
   - `idle` / `uploading` / `failed`: primary `{ label: t('confirmActionIdle'), disabled: true }` ("আমদানি করুন"), secondary "বাতিল করুন" → close.
   - `preview`: primary `{ label: t('confirmAction', { count: result.summary.rows_to_create }), onClick: confirm, disabled: confirmDisabled }` (same rule as today: hard errors, expiry), secondary "বাতিল করুন".
   - `committing`: same primary with `busy: true`.
   - `done`: primary `{ label: t('result.goToList'), onClick: navigate('/students') }`, secondary `{ label: t('close', { ns: 'common' }), onClick: close }`.
   Pass the option that hides `BulkUploadPreview`'s own Confirm button; keep its "আরেকটি ফাইল আপলোড করুন" as the ghost button in the file row.
3. **Step 1 card** (`section` Card `p-4 md:p-5`): header row `flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6` — `h2` `t('template.title')` + `p.mt-1.text-text-secondary` `t('template.explanation')`; outline `Button` with `DownloadIcon` → `downloadTemplate` (`w-full md:w-auto`).
4. **Column guide.** `<details className="group mt-4 border-t border-border-subtle pt-2">`; `summary` `flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md font-medium md:min-h-8` = `t('reference.toggle')` + right side `t('reference.count', { count: TEMPLATE_HEADERS.length })` and `ChevronDownIcon` with `group-open:rotate-180`. Body `ul.divide-y.divide-border-subtle`, row `flex flex-col gap-1 py-3 md:grid md:grid-cols-12 md:gap-4`: left (`md:col-span-4`) `t(\`reference.labels.${header}\`)` in `font-medium` + `StatusBadge tone="warning" label={t('reference.requiredYes')}` or `tone="neutral" label={t('reference.requiredNo')}` (no icon is fine if StatusBadge forces one — keep its default); right (`md:col-span-8`) `t(\`reference.columns.${header}\`)` + caption `t('reference.headerName')` + `<code className="rounded-sm bg-muted px-1 font-mono">{header}</code>`. Delete the old `<table>`. Keep `TEMPLATE_HEADERS` order.
5. **Migrate sentence.** Unchanged markup/permission, but `className="mt-2 text-text-secondary"` and link `font-medium text-primary underline underline-offset-2`.
6. **Step 2 card.** `h2` `t('upload.title')`, explanation, then `<BulkUploadPreview …>` with `renderSummary={(r) => <ImportPreviewSummary result={r} />}`.
7. **`ImportPreviewSummary`.** Render: success line `flex flex-col gap-2 md:flex-row md:items-center md:justify-between` → left `StatusBadge tone="success" label={t('preview.noProblems')}` (only when `hard_error_count === 0 && errors.length === 0`) + `t('preview.willCreate', { count })` in `font-medium`. The preview table moves to a **sibling** Card rendered by the page below step 2 (only in preview state): title `t('preview.title')`, sentence `t('preview.subtitle', { count: PREVIEW_ROW_LIMIT })`, table with the 4 columns, phone column `formatPhone(row.guardian1_phone, config)` (fall back to the raw text if it is not a phone), footer `t('preview.shownOf', { shown: previewRows.length, total: result.summary.rows_to_create })`. Phone layout: `DataTable (unpaginated)` compact rows — hidden `thead` below `md`, name + caption `{class} · {section} · {phone}`.
8. **`ImportDoneSummary`.** Card with `StatusBadge tone="success"` + the existing `result.allImported` / `partialSummary` text (no grey box); invite checkbox as `flex min-h-11 items-center gap-3 md:min-h-8` label row; "আরেকটি ফাইল আমদানি করুন" `variant="ghost"`. Keep `t('result.title')` as the card `h2`.
9. **Move `REQUIRED_COLUMNS`** to `-import/template.ts` and export it.
10. **i18n** (`studentImport.json`, bn / en):
    - change `template.explanation`: "প্রতি সারিতে একজন শিক্ষার্থীর তথ্য দিয়ে টেমপ্লেটটি পূরণ করুন। প্রথম সারির শিরোনাম বদলাবেন না, আর ২ নম্বর উদাহরণ সারিটি মুছে ফেলুন।" / "Fill in the template with one student per row. Keep the header row as it is and delete the example in row 2."
    - change `upload.explanation`: "CSV বা XLSX, সর্বোচ্চ ৫ মেগাবাইট এবং প্রতি ফাইলে ২,০০০ শিক্ষার্থী।" (digits fixed; en unchanged)
    - add `reference.toggle`: "কোন কলামে কী লিখবেন" / "What goes in each column"
    - add `reference.count_one/_other`: "{{count}}টি কলাম" / "{{count}} column" / "{{count}} columns"
    - add `reference.headerName`: "কলামের শিরোনাম:" / "Column header:"
    - add `reference.labels.*` (13): student_name "শিক্ষার্থীর নাম"/"Student name", class "শ্রেণি"/"Class", section "শাখা"/"Section", roll "রোল"/"Roll", registration_number "রেজিস্ট্রেশন নম্বর"/"Registration number", guardian1_name "প্রধান অভিভাবকের নাম"/"Main guardian's name", guardian1_phone "প্রধান অভিভাবকের ফোন"/"Main guardian's phone", guardian1_email "প্রধান অভিভাবকের ইমেইল"/"Main guardian's email", guardian2_name "দ্বিতীয় অভিভাবকের নাম"/"Second guardian's name", guardian2_phone "দ্বিতীয় অভিভাবকের ফোন"/"Second guardian's phone", guardian2_email "দ্বিতীয় অভিভাবকের ইমেইল"/"Second guardian's email", home_address "বাড়ির ঠিকানা"/"Home address", preferred_communication "পছন্দের যোগাযোগ মাধ্যম"/"Preferred contact"
    - add `preview.title`: "প্রিভিউ" / "Preview"; `preview.subtitle`: "ফাইলের প্রথম {{count}}টি সারি এভাবে যুক্ত হবে।" / "The first {{count}} rows of your file will be added like this."; `preview.shownOf`: "{{total}}টির মধ্যে প্রথম {{shown}}টি দেখানো হচ্ছে" / "Showing the first {{shown}} of {{total}}"; `preview.noProblems`: "কোনো সমস্যা নেই" / "No problems"
    - add `confirmAction_one/_other`: "{{count}} জন শিক্ষার্থী আমদানি করুন" / "Import {{count}} student" / "Import {{count}} students"; `confirmActionIdle`: "আমদানি করুন" / "Import"; `cancelAction`: "বাতিল করুন" / "Cancel"
    - add `result.goToList`: "শিক্ষার্থী তালিকায় যান" / "Go to the student list"
    - change `notifications.imported`: "{{total}} জনের মধ্যে {{success}} জন শিক্ষার্থী আমদানি হয়েছে।"; `notifications.partial`: "{{total}} জনের মধ্যে {{success}} জন আমদানি হয়েছে, {{errors}} জন ব্যর্থ হয়েছে।"; `notifications.failed`: "আমদানি ব্যর্থ হয়েছে।" (en unchanged)

## Tests
- `import.test.tsx`: page heading "শিক্ষার্থী আমদানি" and a "বন্ধ করুন" button; the column guide is collapsed by default and lists 13 rows with human labels when opened; after a mocked validate the footer button reads "৪৮ জন শিক্ষার্থী আমদানি করুন" and is enabled, and with a hard error it is disabled; exactly one primary button in every state; preview phone shows `01712-345678`; done state shows "শিক্ষার্থী তালিকায় যান".
- `import-preview.stories.tsx`: stories for preview-clean and preview-with-errors use the new sibling preview card.
- E2E: no spec drives `/students/import` today (checked `e2e/journeys`); nothing to update.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No app chrome; Close and Cancel return to `/students`.
- [ ] The download button and the upload area are visible without scrolling on a 390 px phone (guide closed).
- [ ] The column guide is closed by default and shows human labels with the header name as code.
- [ ] The confirm action lives only in the footer.

## Out of scope
- `BulkUploadPreview` (`ui/src/components/bulk-upload-preview.tsx:231-238`) renders its own filled Confirm inside the card and keeps its state private, so a `FullPageShell` footer cannot own the primary — filed in shared-requests.md (homework and calendar imports have the same need). If refused: keep the in-card Confirm and give `FullPageShell` only the Cancel/Close footer.
- `BulkImportErrorTable` look (shared component) — unchanged.
- `InviteGuardiansDialog` (guardians lane) — reused as is.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| BulkUploadPreview exposes state + confirm, can hide its own Confirm | Accepted | 31.2.14c (type + props 31.1.2a) | <BulkUploadPreview hideConfirm onControllerChange={setUpload} …/>; footer from upload.status / confirm / confirmDisabled / result / commitResult / reset; type BulkUploadPreviewController<S, C> from @biddaloy/ui/components |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: students   Decisions: D6, D8, D9, D19, D21, D22, D23, D27, D29, D32   Depends on: 31.3.8b, 31.4.students-2
