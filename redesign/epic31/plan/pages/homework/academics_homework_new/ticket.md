# [31.4.homework-2] New and import homework — two full-page modals

## Goal
`/academics/homework/new` and `/academics/homework/import` open as `FullPageShell` full-page modals: the new-homework form reads as two numbered cards ("কী কাজ", "কাকে, কবে") with the submit in the footer, and the import page follows the same template → upload → preview flow as student import, with its confirm button in the footer.

## What and why
These two pages are where a teacher gives homework — one by one, or many from a spreadsheet. Today the new form is ten unlabelled-looking controls in one column inside the app chrome (selects shrink to an arrow when empty, dates show `২০২৬-১০-০৪`, the crumb reads "items.new", one generic error for every missing field); the import page puts a six-row raw header table (`assigned_date`) before the upload button, shows preview dates as ISO strings and hides the confirm button inside the preview. D23 lists both as full-page modals; the redesign keeps every request and validation rule and only regroups, relabels and moves the primary into the footer.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — new | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_new/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_new/before-mobile.webp?raw=true" width="260"> |
| After — new | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_new/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_new/mobile.webp?raw=true" width="260"> |
| Before — import | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_import/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_import/before-mobile.webp?raw=true" width="260"> |
| After — import (preview state) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_import/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_import/mobile.webp?raw=true" width="260"> |

The "new" screenshot shows the student target picked with no student chosen yet, so the per-field error is visible.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | New — frame | `FullPageShell size="form"` (`max-w-3xl`), title "বাড়ির কাজ তৈরি করুন", Close → `useCloseFullPage` (fallback `/academics/homework`), `dirty` while anything is typed/picked. Footer: "বাতিল করুন" left, primary **New** "বাড়ির কাজ দিন" right (busy while creating/assigning). | D22, D23; removes the "items.new" crumb. |
| 2 | New — card 1 "১. কী কাজ" (**New** heading + sentence) | শ্রেণি, বিষয় (2 columns), শিরোনাম, বিবরণ (full width), মূল্যায়ন পদ্ধতি (full width) with **New** help text that explains the picked mode. Required marks on class, subject, title, grading mode. | D25; the grading modes are not self-explanatory. |
| 3 | New — card 2 "২. কাকে, কবে" (**New** heading + sentence) | Target option cards, শাখা + শিক্ষার্থী (2 columns), দেওয়ার তারিখ + শেষ তারিখ (2 columns, long dates). (Field look comes from homework-1.) | Groups "what" and "who/when". |
| 4 | New — errors | Missing class / subject / title shows its own message under the field (**New** keys); a server failure shows `form.genericError` (never `ApiError.message`); the "created but not assigned" banner stays as a `role="alert"` Card at the top of the body with its link. | D9, D25. |
| 5 | Import — frame | `FullPageShell size="wide"` (`max-w-5xl`, it holds a table), title "বাড়ির কাজ আমদানি করুন", Close → `useCloseFullPage` (fallback `/academics/homework`). Remove the route's own `mx-auto max-w-4xl` wrapper. | D15, D22, D23. |
| 6 | Import — step 1 card | Title + shorter explanation, outline "টেমপ্লেট ডাউনলোড করুন" (`download`) on the right (full width on phone). Column guide becomes a closed `<details>` "কোন কলামে কী লিখবেন · ৬টি কলাম": each row = **New** human label, "আবশ্যক" (warning badge) / "ঐচ্ছিক" (neutral badge), the "what to write" text, and the header name as `code` in a caption. | Same shape as student import; the header names stay because the file must use them exactly. |
| 7 | Import — step 2 card | Explanation in tenant digits ("সর্বোচ্চ ৫ মেগাবাইট"); `BulkUploadPreview` renders the file row, status and errors. | D6. |
| 8 | Import — preview | Its own Card "প্রিভিউ" (**New** keys) with the table শ্রেণি · শাখা · বিষয় / দেওয়ার তারিখ / শেষ তারিখ; dates through `formatDate` (phone: one line with `formatDateRange`); footer "{{total}}টির মধ্যে প্রথম {{shown}}টি দেখানো হচ্ছে". | D5, B25, D19 total. |
| 9 | Import — footer primary | **New** "{{count}}টি বাড়ির কাজ আমদানি করুন", enabled only in the preview state with no hard errors; replaces BulkUploadPreview's in-card Confirm. Done state: primary "বাড়ির কাজে ফিরে যান" (existing `import.result.backToList`) → list; secondary "বন্ধ করুন". | D22: one primary, in the footer. |
| 10 | Import — done | Result Card with a success (or warning when some rows failed) `StatusBadge` + the existing summary sentence and ghost "আরেকটি ফাইল আমদানি করুন". The underlined "back" link goes away (the footer has it). | D27, D29. |

## Mobile behaviour
- Both: no app top bar / sidebar / bottom bar; header = title + "বন্ধ করুন" (44 px); footer buttons 44 px, Cancel left, primary right.
- New: every field one column; target option cards stay side by side (2 columns).
- Import: download button full width under the explanation; the file row's "আরেকটি ফাইল আপলোড করুন" goes full width under the file name; preview rows are compact two-line rows ("Class 6 · A · Mathematics" over "১লা – ৫ই অক্টোবর").

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| New-homework primary label | "সংরক্ষণ করুন" · "বাড়ির কাজ দিন" | "বাড়ির কাজ দিন" | The submit creates **and** assigns; it matches the list button that opened the page. |
| Grading mode control | Select · three radio cards | Select + help text for the picked mode | Kit pattern; help text answers "what does this mean". |
| Where the import confirm lives | in-card (BulkUploadPreview) · footer | footer | D22; Addendum 7: `BulkUploadPreview` lets the host own Confirm. |
| Column guide | always-open table · closed disclosure | closed `<details>` | Not needed until something fails; upload is visible without scrolling (same as student import). |
| Header names in the guide | hide · show as code | show as `code` in a caption | The file must use them exactly; they are file identifiers, not UI text (D9 is about values shown as data). |
| Attachment upload in the new form | add `FileUploadWidget` · leave out | leave out | No upload wiring exists (#1012); D1. |

## Files
- `client-admin/src/routes/_staff/academics/homework/new.tsx` — FullPageShell, footer submit, dirty, close
- `client-admin/src/routes/_staff/academics/homework/new.test.tsx` — updated assertions
- `client-admin/src/routes/_staff/academics/homework/-assign-homework-form.tsx` — create-mode cards, field errors, `formId`/`onDirtyChange` props (also changed by homework-1, runs earlier)
- `client-admin/src/routes/_staff/academics/homework/import.tsx` — FullPageShell, step cards, column guide, preview card, footer-owned confirm, done state
- `client-admin/src/routes/_staff/academics/homework/import.test.tsx` — updated assertions
- `ui/src/i18n/locales/en/homework.json`, `ui/src/i18n/locales/bn/homework.json` — keys below (also changed by homework-1, runs earlier)
- `e2e/keyboard/homework.spec.ts` — submit button name
- `e2e/keyboard/homework-import.spec.ts` — heading/button selectors if they change

## Steps
1. **Form props** (`-assign-homework-form.tsx`). Add `formId?: string` (put on `<form id>`), `onDirtyChange?: (dirty: boolean) => void` (call from an effect when `classId || subjectId || title || description || sectionId || studentId` becomes non-empty / empty), and `hideFooter?: boolean`. In create mode `new.tsx` passes `hideFooter`; the dialog (assign mode) keeps homework-1's footer.
2. **Create-mode layout.** Wrap the create-only fields in `<Card padded aria-labelledby="hw-what">` with `<h2 id="hw-what" className="text-h2">{t('form.sectionWhat')}</h2><p className="mt-1 text-text-secondary">{t('form.sectionWhatHint')}</p>` then `<div className="mt-4 grid gap-4 md:grid-cols-2">`: class, subject; title, description and grading mode with `md:col-span-2`. Wrap target/section/student/dates in a second Card (`form.sectionWho` / `form.sectionWhoHint`) with the same grid (target `md:col-span-2`, its option grid `md:max-w-sm`). The `<form>` itself is `flex flex-col gap-6` (24 px between cards, D17). In assign mode render the second card's fields without a Card (inside the dialog body).
3. **Grading-mode help.** Under the select: `<p className="text-caption text-text-secondary">{t(`form.gradingModeHelp.${gradingMode}`)}</p>`, linked with `aria-describedby`.
4. **Field errors.** Replace the single `form.errorRequired` for create fields with per-field messages under class / subject / title (`form.errorClass`, `form.errorSubject`, `form.errorTitle`), same markup as homework-1's section/student errors; focus the first invalid control on submit.
5. **`new.tsx`.**
   ```tsx
   const close = useCloseFullPage(() => void navigate({ to: '/academics/homework' }));
   const formRef = React.useRef<HTMLFormElement>(null);  // or document.getElementById(FORM_ID)
   <FullPageShell title={t('form.createTitle')} onClose={close} dirty={dirty} size="form"
     secondary={{ label: t('actions.cancel', { ns: 'common' }), onClick: close }}
     primary={{ label: t('form.submitCreate'), busy: createHomework.isPending || assignHomework.isPending,
                onClick: () => formRef.current?.requestSubmit() }}>
   ```
   Pass `formId`, `hideFooter`, `onDirtyChange={setDirty}` to `AssignHomeworkForm`. Remove the bare `<h1>` and the outer `div`. `setErrorMessage` always uses `t('form.genericError')` (drop `ApiError.message`). The "created but not assigned" alert becomes `<Card padded role="alert">` with `CircleAlert` in `text-destructive`, the sentence and the existing link (link inside a sentence stays underlined, D29). Keep the create-once/assign-retry logic and the search-param prefill unchanged.
6. **`import.tsx` frame.** `<FullPageShell title={t('import.title')} size="wide" onClose={close} dirty={state === 'preview'} secondary={…} primary={…}>` around the two step Cards + preview Card; delete `<div className="mx-auto flex max-w-4xl …">` and the bare `h1`.
7. **Step 1 card.** `Card padded`: `flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6` with `h2 text-h2` `import.template.title` + explanation, and the outline download `Button` (`Download` icon, `w-full md:w-auto`). Under it `<details className="group mt-4 border-t border-border-subtle pt-2">`; `summary` `flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md font-medium md:min-h-8` with `t('import.reference.caption')` and on the right `t('import.reference.count', { count: TEMPLATE_HEADERS.length })` + `ChevronDown size-4 group-open:rotate-180`. Body `ul divide-y divide-border-subtle`, one `li` per header: `flex flex-col gap-1 py-3 md:grid md:grid-cols-12 md:items-start md:gap-4`; left `md:col-span-4` = label `t(`import.reference.labels.${header}`)` (`font-medium`) + `StatusBadge tone="warning" label={requiredYes}` or `tone="neutral" label={requiredNo}`; right `md:col-span-8` = `t(`import.reference.columns.${header}`)` + `<span className="text-caption text-text-secondary">{t('import.reference.headerName')} <code className="rounded-sm bg-muted px-1 font-mono">{header}</code></span>`.
8. **Step 2 card.** `Card padded`, `h2` `import.upload.title`, explanation (changed text below), `<BulkUploadPreview … />` with the option that hides its own Confirm and with the host controller (Addendum 7 — use the prop names `bulk-upload-preview.tsx` has after the foundation; the student-import ticket uses the same).
9. **Preview card.** `ImportPreviewSummary` renders a separate `Card` (not nested in step 2; `overflow-hidden`, no padding): `h2` `import.preview.title` (`px-4 pt-4 md:px-5`), sentence `import.preview.subtitle` with `{ count: PREVIEW_ROW_LIMIT }`, then a table: desktop columns `import.preview.columns.where` (`{class} · {section} · {subject}`, `font-medium`), `assignedDate`, `dueDate` — both `formatDate(row.assigned_date, regionConfig)`; phone rows (`md:hidden` second line) `formatDateRange(row.assigned_date, row.due_date, regionConfig)`. Footer `border-t border-border-subtle px-4 py-3 text-text-secondary` `import.preview.shown` `{ total: rows_to_create, shown: previewRows.length }`. Above the table keep the "will create" line as `StatusBadge tone="success" label={t('import.preview.noProblems')}` + `import.preview.willCreate`.
10. **Footer state** (from the BulkUploadPreview controller):
    - idle / uploading / failed / has hard errors: primary `{ label: t('import.confirmIdle'), disabled: true }`, secondary Cancel → close.
    - preview OK: primary `{ label: t('import.confirm', { count: rows_to_create }), onClick: confirm, busy: committing }`.
    - done: primary `{ label: t('import.result.backToList'), onClick: () => navigate({ to: '/academics/homework' }) }`, secondary `{ label: t('actions.close', { ns: 'common' }), onClick: close }`.
11. **Done card.** `ImportDoneSummary`: `Card padded` with `h2` `import.result.title`, `StatusBadge tone={error_count > 0 ? 'warning' : 'success'}` + the existing sentence, ghost `Button` `RotateCcw` `import.result.importAnother`. Delete the underlined `Link`. Keep the `notifyOutcome` effect.
12. **i18n** (`homework.json`, en + bn):
    | key | en | bn |
    |---|---|---|
    | `form.submitCreate` | Give homework | বাড়ির কাজ দিন |
    | `form.sectionWhat` | 1. What to do | ১. কী কাজ |
    | `form.sectionWhatHint` | Pick the class and subject, then write the task. | শ্রেণি আর বিষয় বেছে নিয়ে কাজটি লিখুন। |
    | `form.sectionWho` | 2. Who and when | ২. কাকে, কবে |
    | `form.sectionWhoHint` | Give it to a whole section or to one student. | পুরো শাখাকে বা একজন শিক্ষার্থীকে দিন। |
    | `form.gradingModeHelp.TICK` | You mark each student done or not done. | প্রত্যেক শিক্ষার্থীর পাশে শুধু সম্পন্ন বা অসম্পন্ন চিহ্ন দেবেন। |
    | `form.gradingModeHelp.PARTIAL` | You mark each student not done, partly done or done. | প্রত্যেক শিক্ষার্থীর জন্য অসম্পন্ন, আংশিক বা সম্পন্ন বেছে নেবেন। |
    | `form.gradingModeHelp.MARKS` | You give each student a mark. | প্রত্যেক শিক্ষার্থীকে নম্বর দেবেন। |
    | `form.errorClass` | Pick a class. | একটি শ্রেণি বাছুন। |
    | `form.errorSubject` | Pick a subject. | একটি বিষয় বাছুন। |
    | `form.errorTitle` | Write a title. | একটি শিরোনাম লিখুন। |
    | `import.reference.count_one/_other` | {{count}} column / {{count}} columns | {{count}}টি কলাম |
    | `import.reference.headerName` | Column header: | কলামের শিরোনাম: |
    | `import.reference.labels.class` / `section` / `subject` / `assigned_date` / `due_date` / `description` | Class / Section / Subject / Date given / Due date / Description | শ্রেণি / শাখা / বিষয় / দেওয়ার তারিখ / শেষ তারিখ / বিবরণ |
    | `import.preview.title` | Preview | প্রিভিউ |
    | `import.preview.subtitle_one/_other` | The first {{count}} rows of your file will be added like this. | ফাইলের প্রথম {{count}}টি সারি এভাবে যুক্ত হবে। |
    | `import.preview.noProblems` | No problems | কোনো সমস্যা নেই |
    | `import.preview.columns.where` | Class · Section · Subject | শ্রেণি · শাখা · বিষয় |
    | `import.preview.shown` | Showing the first {{shown}} of {{total}} | {{total}}টির মধ্যে প্রথম {{shown}}টি দেখানো হচ্ছে |
    | `import.confirm_one/_other` | Import {{count}} homework | {{count}}টি বাড়ির কাজ আমদানি করুন |
    | `import.confirmIdle` | Import | আমদানি করুন |
    Changed values: `import.template.explanation` → en "Write one homework per row. Do not change the header row, and delete example row 2." / bn "প্রতি সারিতে একটি বাড়ির কাজ লিখুন। প্রথম সারির শিরোনাম বদলাবেন না, আর ২ নম্বর উদাহরণ সারিটি মুছে ফেলুন।"; `import.upload.explanation` → en "CSV or XLSX, up to 5 MB." / bn "CSV বা XLSX, সর্বোচ্চ ৫ মেগাবাইট।"; `import.reference.columns.class` bn "চলতি শিক্ষাবর্ষে আছে এমন একটি শ্রেণির নাম, যেমন Class 5।"; `assigned_date` bn "বছর-মাস-দিন ক্রমে, যেমন 2026-10-01।"; `due_date` bn "বছর-মাস-দিন ক্রমে, যেমন 2026-10-05। দেওয়ার তারিখের আগে হতে পারবে না।"; `description` bn "কাজ সম্পর্কে ছোট নোট। খালি রাখতে পারেন।" (en: same meaning, plain words). Remove `form.errorRequired` and `import.preview.previewCaption` when nothing reads them.

## Tests
- `new.test.tsx`: happy path still creates then assigns with `section_id`; student target still sends `student_id`; the primary is found by `form.submitCreate` (footer button) and submits the form; missing title shows `form.errorTitle` under the title and sends no request; assign 400 after create shows the alert Card and a retry does not re-create; prefill from search params still works; Close with typed text asks before leaving (FullPageShell `dirty`).
- `import.test.tsx`: validate → preview shows long dates (no `2026-10-01` text on screen); the footer primary reads "২টি বাড়ির কাজ আমদানি করুন" (count from the fixture) and commits; with row errors the footer primary is disabled and commit is never called; the template still downloads with the six headers; the column guide is closed until its summary is clicked.
- `e2e/keyboard/homework.spec.ts`: the submit step looks for `t('homework.form.submitCreate')` instead of `form.submit`; the page heading is still `form.createTitle`.
- `e2e/keyboard/homework-import.spec.ts`: heading `import.title` unchanged; the download button is still reachable by Tab — adjust only if the order changes.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view, in the FullPageShell footer.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route files (D15).
- [ ] No app top bar, sidebar or bottom bar on either page; Close (X + "বন্ধ করুন") top right; Esc asks before discarding a dirty form.
- [ ] New form: two numbered cards; required marks; an empty select keeps full width with "বাছুন"; each missing field shows its own message.
- [ ] Import: upload card visible without opening the guide; preview dates in long form; confirm only in the footer.

## Out of scope
- Attachments on new homework (#1012).
- The CSV header names and the `YYYY-MM-DD` file format are the server parser's contract (`homework-bulk-upload.parser.ts`); unchanged.
- Palette registration of "Assign homework" is 31.5.1b's job.
- No shared requests filed for this ticket.

Wave: 9   Lane: homework   Decisions: D5, D6, D9, D15, D17, D22, D23, D25, D27, D29   Depends on: 31.3.8b, 31.4.homework-1
