# [31.4.admissions-5] Public admission form and status — guest frame, plain steps

## Goal
The public admission form (`/admission/$slug`), its confirmation screen and the status page (`/admission/$slug/status`) sit in `AuthLayout`. They use only kit controls, say up front what the parent needs, show what is missing next to the field, and show the status as a badge with a plain next step. Done means they match the "after" screenshots.

## What and why
Parents use these pages, with no login and often on a cheap phone, to apply for a seat and later check the result. Today the form uses native selects and a native date box, marks no field as required, and keeps the submit button greyed out without saying why. It never says the closing date or which papers are needed until the end. The status page shows a bare sentence with no colour, and an unknown status leaks the raw code. The redesign groups the form into three short parts. It shows the round's deadline, seats and papers first, and explains every error in easy Bangla next to its field. The status answer comes first, followed by what to do next.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — form | _not captured_ | _not captured_ |
| After — form | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admission_slug/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admission_slug/mobile.webp?raw=true" width="260"> |
| Before — status | _not captured_ | _not captured_ |
| After — status | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admission_slug_status/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admission_slug_status/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Both routes | Replace the hand-made `min-h-screen … max-w-md` wrapper with `AuthLayout`. This adds the language switcher, the logo and one card. | D34 |
| 2 | Form header | `h1` "ভর্তির ফর্ম" + **New** subtitle "নিচের ঘরগুলো পূরণ করে ফর্ম জমা দিন। * চিহ্ন দেওয়া ঘর পূরণ করতেই হবে।" | D16, D25 |
| 3 | Admission round | Native `<select>` → `Select` (still only when 2+ rounds are open; a single round is picked automatically, as today). **New** facts box under it, built from the chosen round's existing fields: আবেদনের শেষ দিন (`formatDate(close_date)`), আসন (`formatNumber(seat_count)`টি), যে কাগজ লাগবে (the document names). With one round, the box starts with "ভর্তি পর্ব: <title>". | D25; parents learn the deadline and papers before filling anything |
| 4 | Grouping **New** | Three parts with `h2` titles divided by a top border, with no nested cards: শিক্ষার্থীর তথ্য, অভিভাবকের তথ্য, কাগজপত্র. Fields sit in `grid gap-4 md:grid-cols-2`, and the name is full width. | Diagnose: one long column with no landmarks |
| 5 | Date of birth | Native `type="date"` → `DatePicker` with `max` = today and placeholder "তারিখ বাছুন". | D25, D5 |
| 6 | Gender | Native `<select>` → `Select` with placeholder "বাছুন". | D25 |
| 7 | Required marks | `*` + sr-only "(আবশ্যক)" on every required label. Optional labels keep their "(না দিলেও চলবে)". | D25 |
| 8 | Phone help **New** | Under the guardian phone: "এই নম্বর দিয়েই পরে আবেদনের অবস্থা দেখবেন।" | Parents don't know the phone is their password for the status page |
| 9 | Documents | `h2` + help "ছবি (JPG, PNG) বা PDF ফাইল দিন, প্রতিটির জন্য একটি।". The button reads "ফাইল বাছুন". A chosen file shows as a row (file icon, name, red `x` icon button "<name> সরান") drawn by the page. | D9: FileUpload's own list prints English "Done" / "Remove" |
| 10 | Submit and errors | The submit button is always enabled. Pressing it validates, puts a translated error under each bad field (`aria-invalid`, `border-destructive`), and focuses the first one. **New** keys hold the messages. | Diagnose: a greyed-out button that never says why |
| 11 | Status link **New** | A ghost link under the form, "আগে আবেদন করেছেন? অবস্থা দেখুন" → `/admission/$slug/status`. | The route exists but nothing links to it from the form |
| 12 | Loading / error / no rounds | The `h1` stays. Underneath: a skeleton shaped like the form, `ErrorState` with Retry, or `EmptyState` ("এই স্কুলে এখন নতুন ভর্তি নেওয়া হচ্ছে না।"). | D28 |
| 13 | Confirmation | Success icon well, `h1`, explanation, the reference number in a `bg-muted` box (`text-h1`, Latin digits per D6), an outline "নম্বরটি কপি করুন" button (full width), and a ghost link "আবেদনের অবস্থা দেখুন". | D29: no underlined standalone link, no filled button needed |
| 14 | Status form | Kit fields with `*`. **New** help under the reference field: "নম্বরটি এমন দেখতে: ADM-2026-000123". The phone field gets `inputMode="tel"` and `autocomplete="tel"`. Errors show as error text under the button. | D25 |
| 15 | Status result | `StatusBadge` (tone from `APPLICANT_STATUS`) with a **New** short label, then `h2` = the existing sentence (`status.statuses.*`), a `dl` with শিক্ষার্থী and ভর্তি পর্ব, then a **New** next-step line per status. An unknown status shows a neutral badge and a translated sentence, never the code. | D27, D9 |
| 16 | Status footer **New** | A ghost link "নতুন আবেদন করুন" → `/admission/$slug`. | A way back |

## Mobile behaviour
- One column. Every control is `h-11` at every width (AuthLayout uses comfortable density).
- The facts box keeps 2 columns (deadline, seats), and the papers line goes full width.
- "ফাইল বাছুন" is full width on phone and `md:w-auto` on desktop.
- The submit button is full width at every size and is the last thing in the card. There is no sticky bar.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Card width | `max-w-md` like other guest pages / wider for the form | form `max-w-2xl` (shared request), status `max-w-md` | The brief allows a wider form. Two columns halve its length on desktop. |
| Validation | disabled button (today) / validate on submit | validate on submit, errors next to fields, focus the first | A parent can see what is wrong. Disabled buttons are invisible to screen readers. |
| Gender control | radio group / `Select` | `Select` | The kit has no radio pattern. Three options fit a select. |
| Selected-file display | FileUpload's built-in list / page row | page row, `items={[]}` passed to FileUpload | The built-in list has hard-coded English (shared file). The page row is in territory. |
| Status tone source | new map / `APPLICANT_STATUS` from admissions-1 | reuse `APPLICANT_STATUS[s].tone` | Staff and parents see the same colour for the same state. |
| Easy Bangla | rewrite all strings / keep the already-plain ones | keep existing keys; new keys in the same plain voice | Existing public copy was written plain in Epic 27 (no "ইনটেক", no "টোকেন"). |

## Files
- `client-admin/src/routes/admission/$slug/index.tsx` — `AuthLayout` wrapper
- `client-admin/src/routes/admission/$slug/status.tsx` — `AuthLayout`, kit form, result block
- `client-admin/src/features/admission/PublicAdmissionForm.tsx` — sections, facts box, kit controls, validation, file rows, states
- `client-admin/src/features/admission/AdmissionConfirmation.tsx` — kit layout
- `client-admin/src/features/admission/applicantStatus.ts` (also changed by admissions-1, runs earlier) — import only
- `client-admin/src/routes/admission/$slug/index.test.tsx` — kit controls and validation
- `client-admin/src/routes/admission/$slug/status.test.tsx` — badge, next step, unknown status
- `ui/src/i18n/locales/en/admission-public.json`, `ui/src/i18n/locales/bn/admission-public.json` — keys below
- `e2e/admission.spec.ts` (also changed by admissions-1 / admissions-2, run earlier) — the public form steps use the new controls

## Steps
1. **Locale** (`admission-public.json`). Keep every existing key. Add (en / bn):
   - `form.subtitle`: "Fill in the boxes below and submit the form. Boxes marked * must be filled." / "নিচের ঘরগুলো পূরণ করে ফর্ম জমা দিন। * চিহ্ন দেওয়া ঘর পূরণ করতেই হবে।"
   - `form.required`: "(required)" / "(আবশ্যক)"
   - `form.intakeFacts.round` "Admission round" / "ভর্তি পর্ব"; `closeDate` "Last day to apply" / "আবেদনের শেষ দিন"; `seats` "Seats" / "আসন"; `seatsValue` "{{count}} seats" / "{{count}}টি"; `documents` "Papers you need" / "যে কাগজ লাগবে"; `noDocuments` "No papers needed" / "কোনো কাগজ লাগবে না"
   - `form.sections.student` "Student's details" / "শিক্ষার্থীর তথ্য"; `sections.guardian` "Parent/guardian's details" / "অভিভাবকের তথ্য"; `sections.documents` "Papers" / "কাগজপত্র"; `sections.documentsHelp` "Upload a photo (JPG, PNG) or a PDF, one file for each." / "ছবি (JPG, PNG) বা PDF ফাইল দিন, প্রতিটির জন্য একটি।"
   - `form.fields.dateOfBirthPlaceholder` "Pick a date" / "তারিখ বাছুন"; `fields.guardianPhoneHelp` "You will use this number later to check your status." / "এই নম্বর দিয়েই পরে আবেদনের অবস্থা দেখবেন।"
   - `form.documents.choose` "Choose file" / "ফাইল বাছুন"; `documents.remove` "Remove {{name}}" / "{{name}} সরান"
   - `form.errors.required` "Please fill this in." / "এই ঘরটি পূরণ করুন।"; `errors.choose` "Please choose one." / "একটি বেছে নিন।"; `errors.phone` "Enter a correct mobile number, like 01711-000004." / "সঠিক মোবাইল নম্বর দিন, যেমন 01711-000004।"; `errors.document` "Please add this file." / "এই ফাইলটি দিন।"
   - `form.statusLink` "Applied before? Check your status" / "আগে আবেদন করেছেন? অবস্থা দেখুন"
   - `status.subtitle` "Enter the reference number you got after submitting, and the parent/guardian's mobile number." / "ফর্ম জমা দেওয়ার পর পাওয়া রেফারেন্স নম্বর আর অভিভাবকের মোবাইল নম্বর দিন।"
   - `status.fields.referenceNumberHelp` "It looks like this: ADM-2026-000123" / "নম্বরটি এমন দেখতে: ADM-2026-000123"
   - `status.badges.PENDING` "Being reviewed" / "যাচাই চলছে"; `SHORTLISTED` "Shortlisted" / "তালিকায় আছে"; `ADMITTED` "Admitted" / "ভর্তি হয়েছে"; `REJECTED` "Not accepted" / "গৃহীত হয়নি"; `unknown` "Unknown" / "জানা নেই"
   - `status.next.PENDING` "The school is still looking at your application. Check again in a few days." / "স্কুল এখনো আপনার আবেদন দেখছে। কয়েক দিন পর আবার দেখুন।"; `SHORTLISTED` "The school will contact you soon. Keep your phone close." / "স্কুল শিগগির আপনার সাথে যোগাযোগ করবে। মোবাইল ফোন কাছে রাখুন।"; `ADMITTED` "Please contact the school to finish the admission." / "ভর্তির বাকি কাজের জন্য স্কুলে যোগাযোগ করুন।"; `REJECTED` "If you have any questions, please contact the school." / "কোনো প্রশ্ন থাকলে স্কুলে যোগাযোগ করুন।"
   - `status.unknown` "We could not read this application's status. Please contact the school." / "আবেদনের অবস্থা বোঝা যায়নি। স্কুলে যোগাযোগ করুন।"
   - `status.studentLabel` "Student" / "শিক্ষার্থী"; `status.roundLabel` "Admission round" / "ভর্তি পর্ব"; `status.newApplication` "Start a new application" / "নতুন আবেদন করুন"
2. **Routes.** In `index.tsx`, render `<AuthLayout>{submitted ? <AdmissionConfirmation …/> : <PublicAdmissionForm …/>}</AuthLayout>` and delete the wrapper divs. In `status.tsx`, put the same `AuthLayout` around the card content and drop `Card`, because AuthLayout draws the card. `AuthLayout` comes from `@biddaloy/ui/components`; it reads no auth state, so the file-header rule still holds. If the `AuthLayout` width request is accepted, pass the wide size on `index.tsx` only.
3. **Form header and states** (`PublicAdmissionForm.tsx`). Always render `<div><h1 className="text-h1">{t('form.title')}</h1><p className="mt-0.5 text-text-secondary">{t('form.subtitle')}</p></div>` first. Below it:
   - **Pending:** a skeleton (`aria-busy="true"`; three groups of `h-3 w-24 rounded-sm bg-muted` label bar + `h-11 rounded-md bg-muted` control bar, `mt-5 space-y-4`).
   - **Error:** `<ErrorState message={…existing key…} onRetry={() => intakesQuery.refetch()} />`.
   - **No rounds:** `<EmptyState title={t('form.noOpenIntakes')} />`, which keeps the `role="status"` text the unit test looks for.
4. **Form body.** Use `<form noValidate onSubmit={handleSubmit} className="mt-5 space-y-6">` with:
   - **Round** (`section.space-y-3`):
     - If `intakes.length > 1`, show `FormField`-style Field markup (Label + `Select` + error). The `SelectTrigger` has `id="intake"` and `aria-invalid`. The placeholder is `t('form.fields.intakePlaceholder')`.
     - Then, when `selectedIntake`, the facts box: `div.rounded-md.bg-muted.p-3 > dl.grid.grid-cols-2.gap-x-4.gap-y-2`. Each item is `dt.text-caption.text-text-secondary` + `dd.font-medium`.
     - The items, in order: `round` (only when there is a single intake, `col-span-2`), `closeDate` → `formatDate(close_date, regionConfig)`, `seats` → `t('form.intakeFacts.seatsValue', { count: formatNumber(seat_count, regionConfig) })`, and `documents` (`col-span-2`) → the translated names joined by `, `, or `noDocuments`.
   - **Student / Guardian / Documents** sections: `section.space-y-4.border-t.border-border-subtle.pt-5` + `h2.text-h2` + `div.grid.gap-4.md:grid-cols-2`.
     - Student: name (`md:col-span-2`); `DatePicker` (`id="date-of-birth"`, `aria-label={t('form.fields.dateOfBirth')}`, `value={dateOfBirth ? new Date(\`${dateOfBirth}T00:00:00\`) : undefined}`, `onValueChange={(d) => setDateOfBirth(d ? toIsoDate(d) : '')}`, `max={new Date()}`, `placeholder={t('form.fields.dateOfBirthPlaceholder')}`, `config={regionConfig}`); gender `Select` (`id="gender"`, placeholder `genderPlaceholder`).
     - Guardian: name, `PhoneInput` (unchanged props, `aria-describedby` → help id), email, address.
     - Documents: `h2` + `p.mt-1.text-text-secondary` help, then one Field per `required_document_types`:
       - The label is a `span` with an id, because the control is a button.
       - With no file: `FileUpload` with `chooseLabel={t('form.documents.choose')}`, `items={[]}`, and `className` (if supported) or a wrapper giving the button `w-full md:w-auto`.
       - With a file: `div.flex.items-center.gap-2.rounded-md.border.border-border-subtle.p-1.ps-3` holding `FileImage`/`FileText` icon (`text-text-secondary`), `span.min-w-0.flex-1.truncate` with the name, and an icon `Button` (`size-11`, `text-destructive`, `aria-label={t('form.documents.remove', { name })}`, `X` icon) that removes it.
   - Labels of required fields append `<span className="text-destructive" aria-hidden="true">*</span><span className="sr-only">{t('form.required')}</span>`. Required fields: intake, applicant name, DOB, gender, guardian name, guardian phone, every document.
   - Keep the honeypot block exactly as it is.
   - `submitError` stays a `role="alert"` paragraph with the kit error-text classes (`flex items-center gap-1 text-caption text-destructive` + `CircleAlert`), placed above the button.
   - Submit: `<Button type="submit" className="w-full" loading={submitMutation.isPending}>`. Remove `disabled={!canSubmit}`.
   - After the form: `<div className="mt-2 flex justify-center"><Link to="/admission/$slug/status" params={{ slug }} className="inline-flex h-11 items-center rounded-md px-3 font-medium text-primary hover:bg-muted">{t('form.statusLink')}</Link></div>`.
5. **Validation.**
   - Add `const [errors, setErrors] = useState<Record<string, string>>({})`. `validate()` returns field-id → message: `intake`/`gender` → `errors.choose`; empty text/DOB → `errors.required`; `!guardianPhoneValid` → `errors.phone` (or `required` when empty); each missing document → `errors.document`.
   - In `handleSubmit`, set the errors. If there are any, `document.getElementById(firstKey)?.focus()` and return. Otherwise mutate as today.
   - Clear a field's error in its change handler.
   - Render each error under its control: `<p id="<id>-error" className="flex items-center gap-1 text-caption text-destructive"><CircleAlert className="size-3.5" aria-hidden />{msg}</p>`. On the control set `aria-invalid` and `aria-describedby="<id>-error"`; `border-destructive` comes from the kit control styles via `aria-invalid`.
   - Delete `canSubmit`. Keep `missingDocuments` for `validate()`.
6. **Confirmation** (`AdmissionConfirmation.tsx`). Drop `Card`. Use `div.flex.flex-col.items-center.gap-3.text-center` with:
   - icon well `span.flex.size-12.items-center.justify-center.rounded-full.bg-status-paid-bg.text-status-paid-fg` + `CircleCheck`;
   - `h1.text-h1`;
   - `p.text-text-secondary` explanation;
   - the number `p.w-full.rounded-md.bg-muted.px-4.py-3.text-h1.tracking-wide` (keep `data-testid="reference-number"`);
   - `Button variant="outline" className="w-full"` with `Copy` icon, or `Check` + `copied`;
   - the status `Link` with the ghost-link classes from step 4 (no underline), keeping `search={{ referenceNumber }}`.
7. **Status page** (`status.tsx`).
   - Add `h1.text-h1` + `p.mt-0.5.text-text-secondary` (`status.subtitle`). The form is `mt-5 flex flex-col gap-4`.
   - Fields use the Field markup with `*`. The reference input gets `autoComplete="off"` + help `p#reference-number-help.text-caption.text-text-secondary` linked by `aria-describedby`. The phone input gets `inputMode="tel" autoComplete="tel"`.
   - Submit `Button className="w-full"`. Error `p role="alert"` gets the error-text classes.
   - On success, show `div role="status" className="mt-5 border-t border-border-subtle pt-5"` with:
     - `const s = statusMutation.data.status; const known = s in APPLICANT_STATUS;`
     - `<StatusBadge tone={known ? APPLICANT_STATUS[s].tone : 'neutral'} label={t(known ? \`status.badges.${s}\` : 'status.badges.unknown')} />`
     - `h2.mt-2.text-h2` = `known ? t(\`status.statuses.${s}\`) : t('status.unknown')`. Remove the raw `defaultValue: status`.
     - `dl.mt-3.grid.grid-cols-2.gap-x-4.gap-y-2` with `studentLabel` → `applicant_name` and `roundLabel` → `intake_title`.
     - `p.mt-3.text-text-secondary` = `t(\`status.next.${s}\`)`, only when `known`.
   - Footer: ghost `Link` to `/admission/$slug` with `status.newApplication`.

## Tests
- `routes/admission/$slug/index.test.tsx`:
  - The happy path picks gender through the `Select` (click the combobox "Student's gender", then the option "Girl"). DOB: click the trigger, then the day button with `data-date` = the 1st of the current month. Submit, and the reference number shows.
  - **New:** submitting an empty form shows "Please fill this in." under the name and moves focus to the first invalid field. No request is sent.
  - **New:** the facts box shows "Last day to apply" with the long-form close date and "Papers you need" with the document names.
  - The not-found and no-rounds cases keep passing.
- `routes/admission/$slug/status.test.tsx`:
  - PENDING shows the badge "Being reviewed" plus the next-step sentence.
  - **New:** an unknown status (`"WAITLIST"`) shows "Unknown" and the `status.unknown` sentence, and never the text `WAITLIST`.
  - The not-found and generic-error cases are unchanged.
- `e2e/admission.spec.ts`: replace `selectOption` on the round and gender with a combobox click + option click. Replace the DOB `.fill('2018-06-01')` with trigger click + `[data-date="<YYYY-MM-01 of today>"]`. The labels stay the same `t(...)` keys. The status steps are unchanged.

## Acceptance
- [ ] Desktop at 1440 px matches both "after" screenshots.
- [ ] Mobile at 390 px matches both "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (form: submit; status: check; confirmation: none).
- [ ] Every control is ≥ 44 px tall at every width, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route files (D15/D34 — the width comes from `AuthLayout`).
- [ ] No native `<select>` or `<input type="date">` remains in the three files.
- [ ] The facts box shows the deadline, seats and needed papers before the first field.
- [ ] Submitting with gaps shows a translated error under each bad field and focuses the first.
- [ ] A chosen file shows its name and a "… সরান" button; no English "Done" / "Remove".
- [ ] The status answer is a coloured badge plus a sentence plus a next step; an unknown status never shows its code.
- [ ] The form links to the status page and the status page links back.

## Out of scope
- School name on the form: the public endpoint returns none. Shared request filed; until then the form shows no school name.
- Wider card for the form: needs an `AuthLayout` size prop. Shared request filed; if refused, keep `max-w-md` and drop the `md:grid-cols-2` grids.
- Jumping to a year in the DOB calendar: needs a `DatePicker` change. Shared request filed; until then parents step back month by month (with `max` = today).
- The FileUpload screen-reader announcement ("1 file selected") is hard-coded English in `ui`. Shared request filed.
- Per-field server errors (e.g. "date of birth too old") are not mapped; the generic `submitError` stays.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| AuthLayout size='wide' (max-w-2xl) for the public form | Accepted | 31.2.12 | <AuthLayout size="wide"> (prop typed in 31.1.2a); keep the md:grid-cols-2 grids |
| DatePicker: jump to a year/month for a date of birth | Accepted | 31.2.2 | no prop: click the month label in the DatePicker popover → month grid with year prev/next; pass max={today} |
| FileUpload: translate Choose file(s) / Done / Remove {name} / n files selected | Accepted | 31.2.14c | default labels now come from common.json fileUpload.*; chooseLabel still overrides; the standard file row is fine to keep |
| server school display name on GET /public/admission/:slug | Deferred | — | use the fallback in the ticket (no school name subtitle) |

Wave: 9   Lane: admissions   Decisions: D5, D6, D9, D16, D25, D27, D28, D29, D34   Depends on: 31.3.8b, 31.4.admissions-4
