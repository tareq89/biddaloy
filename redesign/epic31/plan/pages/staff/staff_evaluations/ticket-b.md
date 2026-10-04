# [31.4.staff-4b] New teacher survey — full-page form with four sections

## Goal
"নতুন জরিপ" opens the survey form as a `FullPageShell` on `/staff/evaluations?tab=surveys&publishSurvey=1` that matches the "after" screenshot: four section cards, labelled fields with errors under the field they belong to, DatePickers instead of browser date inputs, Bangla subject names, translated server errors, and "খসড়া হিসেবে সংরক্ষণ" / "সংরক্ষণ ও চালু করুন" in the footer. Part b of staff-4; runs after staff-4a.

## What and why
An admin builds a survey: which teachers and subjects are rated, which questions are asked, who answers, and when it runs. Today this is a long scrolling dialog (`max-w-2xl`, `90dvh`) with repeatable rows, browser-native date inputs, English subject names, ghost-text remove buttons, every error dumped in one list at the bottom, and the raw server message on failure ("Teacher 7c43…-… is not assigned to subject …"). D21/D23 name the survey form as a full-page modal; the redesign gives it one card per question the admin must answer.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — survey form | _not captured_ | _not captured_ |
| After — survey form | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations_publishSurvey/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations_publishSurvey/mobile.webp?raw=true" width="260"> |
| After — evaluations (host page, from 4a) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | `Dialog` → `FullPageShell size="form"` title "নতুন শিক্ষক জরিপ"; overlay on the host route via `?publishSurvey=1` (the param the palette already uses now stays in the URL while the form is open). Back / Close / Esc close it; asks first when anything changed. | D21–D23 |
| 2 | Footer | secondary "খসড়া হিসেবে সংরক্ষণ" (left), primary "সংরক্ষণ ও চালু করুন" (right, busy while saving). Cancel = the header Close. | D22, D29 |
| 3 | Card "জরিপের তথ্য" (**New** title) | শিরোনাম * (full width), কারা উত্তর দেবে (Select, half width), anonymous whole-row checkbox + hint. | D25, D17 |
| 4 | Card "শিক্ষক ও বিষয়" * | **New** help line; each row = labelled "শিক্ষক n" + "বিষয় n" Combobox and a remove button (icon + tooltip on desktop, icon + text on phone); rows divided; outline "আরেকজন শিক্ষক যোগ করুন". | D25, D19 |
| 5 | Card "প্রশ্ন" * | **New** help line; per question: label "প্রশ্ন n", input, whole-row stars checkbox, remove icon button; outline "প্রশ্ন যোগ করুন". | D25 |
| 6 | Card "সময় ও ফলাফল" (**New** title) | শুরুর / শেষের তারিখ = `DatePicker` (placeholder "তারিখ বাছুন"); ন্যূনতম উত্তর * + hint. | D25, D5 |
| 7 | Errors | Per field: title, target row (subject / teacher missing, duplicate pair), question text, at-least-one-question, minimum, dates — each under its control with the kit error style. Server errors → translated sentences, never the server string. | D9, D25 |
| 8 | Names | Subject options `name_bn` (bn) / `name_en` + code; teacher options unchanged (name + employee id). | D9 |

## Mobile behaviour
- Full screen, no app chrome; one column; each teacher row stacks teacher, subject, then "শিক্ষক বাদ দিন" (icon + text, 44 px).
- Footer buttons are 44 px at every width; Close stays top-right.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| URL of the form | new route · new param · reuse `publishSurvey` | reuse `?publishSurvey=1` (kept, no longer consumed) | Palette, Back button and refresh all work with one key; 31.5.1b points `surveys.publish` at this URL with no registry rename. |
| Component file | rename · keep `survey-form-dialog.tsx` | keep the file, export `SurveyFormPage` | `action-registry.test.ts` (31.5.1b) lists this path; renaming it would touch a shared file. |
| Server error text | show `ApiError.message` · map | map the two known 400s, else the generic sentence | D9; the raw message contains UUIDs. Mapping by message text is brittle — marked `ponytail:` (upgrade: an error code from the server). |
| Error placement | one list at the bottom · per field | per field | D25 / kit Form; the admin sees which row is wrong. |

## Files
- `client-admin/src/routes/_staff/staff/-evaluations/survey-form-dialog.tsx` — FullPageShell, cards, DatePickers, per-field errors, error mapping
- `client-admin/src/routes/_staff/staff/evaluations.tsx` — open/close by `publishSurvey` (also changed by staff-4a, runs earlier)
- `client-admin/src/routes/_staff/staff/evaluations.flags.test.tsx` — `publishSurvey` now stays while open
- `client-admin/src/routes/_staff/staff/-evaluations/surveys.test.tsx` — form cases (also changed by staff-4a)
- `ui/src/i18n/locales/{bn,en}/evaluations.json` — keys below (also changed by staff-2c and staff-4a)
- `e2e/keyboard/survey-publish.spec.ts` — only if the dialog name or alert check moves (see step 6)

## Steps
1. **`evaluations.tsx` (host).** Keep `publishSurvey` in `validateSearch`. In the one-shot effect remove everything about `publishSurvey` except: when `search.publishSurvey && !canWrite`, strip it (`replace: true`). Header "নতুন জরিপ" (from 4a) → `navigate({ search: (prev) => ({ ...prev, tab: 'surveys', publishSurvey: 1 }) })`; delete the `surveyOpen` state. Render `{canWrite && search.publishSurvey !== undefined && <SurveyFormPage onDone={closeSurvey} />}` where `const closeSurvey = useCloseFullPage(() => void navigate({ search: ({ publishSurvey: _p, ...rest }) => rest, replace: true }))` (`useCloseFullPage` from `@biddaloy/ui/shells`).
2. **`survey-form-dialog.tsx` frame.** Rename the export `SurveyFormDialog` → `SurveyFormPage({ onDone }: { onDone: () => void })`. Delete the `open`-reset effect (mount = fresh form) and `enabled: open` on `useAllTeachers`. Keep a `initial` snapshot (`React.useRef(JSON.stringify({ title: '', anonymous: true, respondent: 'BOTH', targets: [[null, null]], questions: templateTexts, opensAt: '', closesAt: '', minResponses: '3' }))`) and compute `dirty` by comparing the same shape of current state. Return
   `<FullPageShell title={t('surveys.form.title')} onClose={onDone} dirty={dirty} size="form" secondary={{ label: t('surveys.form.saveDraft'), onClick: () => void submit(false) }} primary={{ label: t('surveys.form.publishNow'), onClick: () => void submit(true), busy }}>` with a `<form noValidate onSubmit={…saveDraft} onKeyDown={…Ctrl/Cmd+Enter as today}>` inside holding four Cards (`space-y-6` comes from the shell body). On success `toast.success(…)` then `onDone()`.
3. **Cards** (Card classes `rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`, title `h2 text-h2`, help `mt-0.5 text-text-secondary`, fields `mt-4 grid gap-4 md:grid-cols-2`; required mark per patterns.md §6):
   - **জরিপের তথ্য** (`surveys.form.sectionInfo`): title `Input` (`md:col-span-2`, required); respondent `Select` with visible `Label`; anonymous = kit checkbox row (`flex min-h-11 items-center gap-3 md:min-h-8`, `md:col-span-2`) + hint `text-caption text-text-secondary` linked by `aria-describedby`.
   - **শিক্ষক ও বিষয়** (`targetsLabel`, required mark, help `surveys.form.targetsHelp`): `ul mt-4 divide-y divide-border-subtle`; each `li flex flex-col gap-4 py-4 first:pt-0 md:flex-row md:items-start`; two Fields `min-w-0 flex-1` with visible `Label` `t('surveys.form.teacherN', { n })` / `subjectN` (numbers via `formatNumber`) and the Combobox (`aria-label` removed — the label names it); remove = `<Button variant="ghost" className="h-11 self-start px-4 text-destructive md:mt-6 md:size-8 md:px-0" aria-label={t('surveys.form.removeTargetN', { n })} disabled={targets.length === 1}><CircleMinusIcon /><span className="md:sr-only">{t('surveys.form.removeTarget')}</span></Button>` with a `Tooltip` on desktop. Add button: outline + `PlusIcon`, `mt-4`.
   - **প্রশ্ন** (`questionsLabel`, required mark, help `surveys.form.questionsHelp`): `ul mt-4 divide-y divide-border-subtle`; each `li flex flex-col gap-2 py-4 first:pt-0`: Label `questionLabel`, `Input`, then `flex items-center justify-between gap-2` with the stars checkbox row and an icon button (`size-11 md:size-8 text-destructive`, `CircleMinusIcon`, `aria-label` `t('surveys.form.removeQuestionN', { n })`, tooltip). Add button outline + `PlusIcon`.
   - **সময় ও ফলাফল** (`surveys.form.sectionSchedule`): `DatePicker` for opens / closes (`value={opensAt ? parseDate(opensAt) : undefined}`, `onValueChange={(d) => setOpensAt(d ? toIsoDate(d) : '')}`, `min` on closes = opens), min-responses Field (Input unchanged, required mark, hint).
4. **Per-field errors.** `validate()` returns `Partial<Record<'title' | 'targets' | 'questions' | 'min' | 'dates', string>>` plus `rowErrors: Record<number /* key */, string>`: an incomplete row → `surveys.form.errorRowSubject` or `errorRowTeacher`; a teacher+subject pair already used by an earlier row → `errorDuplicateTarget`; an empty question → `errorQuestionText` on that question. Render each with the kit error line (`flex items-center gap-1 text-caption text-destructive` + `CircleAlertIcon`), `aria-invalid` + `border-destructive` on the control, `aria-describedby` to the message. Focus the first invalid control after a failed submit. Delete the bottom `ul role="alert"`; keep one visually hidden `role="alert"` summary `p` (`sr-only`) with `t('surveys.form.errorSummary', { count })` so screen readers and the keyboard spec still get an alert.
5. **Server errors.** In `catch`: `// ponytail: matches server message text (surveys.service.ts:96,103); switch to an error code when the API sends one.` `msg.startsWith('Duplicate survey target')` → `errorDuplicateTarget`; `/is not assigned to subject/.test(msg)` → `errorNotAssigned`; else `errorMessage`. Show it in the targets card for the first two, otherwise as a `toast.error`. Never render `e.message`.
6. **Subject options** label `${locale === 'bn' && x.name_bn ? x.name_bn : x.name_en} (${x.code})` (`useLocale`).
7. **Locale keys** (`evaluations.json`, bn / en):
   - add `surveys.form.sectionInfo`: "জরিপের তথ্য" / "Survey details"; `sectionSchedule`: "সময় ও ফলাফল" / "Dates and results"
   - add `surveys.form.targetsHelp`: "যে শিক্ষককে যে বিষয়ের জন্য মূল্যায়ন করা হবে। শিক্ষককে ওই বিষয়ে নিযুক্ত থাকতে হবে।" / "Each teacher is rated for one subject. The teacher must be assigned to that subject."
   - add `surveys.form.questionsHelp`: "তিনটি সাধারণ প্রশ্ন আগে থেকেই দেওয়া আছে — চাইলে বদলান বা নতুন যোগ করুন।" / "Three common questions are filled in — change them or add your own."
   - add `surveys.form.teacherN`: "শিক্ষক {{n}}" / "Teacher {{n}}"; `subjectN`: "বিষয় {{n}}" / "Subject {{n}}"; `removeTargetN`: "শিক্ষক {{n}} বাদ দিন" / "Remove teacher {{n}}"; `removeQuestionN`: "প্রশ্ন {{n}} বাদ দিন" / "Remove question {{n}}"
   - add `surveys.form.errorRowSubject`: "একটি বিষয় বাছুন।" / "Choose a subject."; `errorRowTeacher`: "একজন শিক্ষক বাছুন।" / "Choose a teacher."; `errorDuplicateTarget`: "এই শিক্ষক ও বিষয় আগেই যোগ করা হয়েছে।" / "This teacher and subject are already added."; `errorNotAssigned`: "একজন শিক্ষক বাছাই করা বিষয়ে নিযুক্ত নন। শিক্ষক বা বিষয় বদলান।" / "A teacher is not assigned to the chosen subject. Change the teacher or the subject."; `errorSummary`: "জরিপ সংরক্ষণ হয়নি: {{count}}টি ঘর ঠিক করুন।" / "Not saved: fix {{count}} field(s)."
8. **`survey-publish.spec.ts`.** FullPageShell is a Radix dialog named by its title, so `getByRole('dialog', { name: form.title })`, the `tab=surveys` URL check, the `role="alert"` check (step 4 summary) and Escape on an unchanged form should all still pass — run it; edit only what fails.

## Tests
- `surveys.test.tsx` (form cases): render `SurveyFormPage`; prefill and untraceable-copy cases unchanged; "blocks submit" now asserts the title error under the title field and the row error under "বিষয় ১"; a duplicate teacher+subject row shows `errorDuplicateTarget` without calling the API; a 400 "Teacher … is not assigned …" shows `errorNotAssigned` and no UUID text; dates use the DatePicker (pick via its button, not `type="date"`); create/publish success calls `onDone`; retry-after-failed-publish case unchanged.
- `evaluations.flags.test.tsx`: `?publishSurvey=1` with `ACR_WRITE` keeps the param and shows the full-page form (`dialog` named "নতুন শিক্ষক জরিপ"); without `ACR_WRITE` the param is stripped; `reportIncident` / `startAcr` still consumed.
- e2e: `e2e/keyboard/survey-publish.spec.ts` (step 8).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The form covers the app chrome; the URL shows `publishSurvey=1`; Back closes it; refresh reopens it.
- [ ] No `<input type="date">` and no server error string anywhere in the form.
- [ ] Each error appears under the control it is about.

## Out of scope
- Palette registration of `surveys.publish` as a navigate action — 31.5.1b (URL unchanged, nothing to request).
- Editing a draft survey from its page (no flow exists; D1).
- Limiting the subject list to the teacher's assigned subjects needs teacher→subject data the form does not load — left to the server check + translated error.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server full_name on /acr-assessments and /incidents rows | Deferred | — | use the fallback in the ticket (useUser per row, no name search) |

Wave: 9   Lane: staff   Decisions: D5, D9, D17, D21, D22, D23, D25, D29   Depends on: 31.3.8b, 31.4.staff-4a
