# [31.4.students-2] Add / edit student — full-page form, labelled guardian picker

## Goal
`/students/new` and `/students/$studentId/edit` open as a `FullPageShell` (title + Close on top, Cancel + save in the footer) holding the same form as four section cards, with every field labelled, a gender select, and a guardian picker with no raw ids, no placeholder-only fields and no second filled button.

## What and why
The form creates or corrects one student and links their guardians. Today it is a narrow page under the app chrome with the crumb "items.new", the date is a typed `YYYY-MM-DD` box, gender is free text, the roll is a browser number spinner, the guardian picker's fields are labelled only by placeholders and can show a raw id or a backend error string, and the draft banner and the inline "add guardian" each add another filled button. D23 lists add/edit student as a full-page modal; the redesign moves the existing form into `FullPageShell` and fixes those details without changing what is saved.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_new/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_new/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_new/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_new/mobile.webp?raw=true" width="260"> |

Edit (`/students/$studentId/edit`) is the same screen with title "শিক্ষার্থী সম্পাদনা" and footer primary "পরিবর্তন সংরক্ষণ করুন"; it is not mocked separately.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | `FullPageShell size="form"`: title "শিক্ষার্থী যোগ করুন" / "শিক্ষার্থী সম্পাদনা", Close "বন্ধ করুন"; footer secondary "বাতিল করুন", primary = submit label. No app chrome, no breadcrumb (fixes "items.new"). | D22, D23. |
| 2 | Sections | Each `FormSection` is a Card with an `h2` and a two-column grid on desktop: পরিচিতি · শ্রেণি বিন্যাস · অভিভাবক · পছন্দসমূহ. | Kit Form. |
| 3 | Required marks | পূর্ণ নাম, শ্রেণি, শাখা get the required mark. | D25 (these are the schema's required fields). |
| 4 | Date of birth | `DatePicker` button showing `১২ই মার্চ, ২০১৩`, placeholder "তারিখ বাছুন". | D5, D25 (component change is foundation; this page only passes `placeholder` default). |
| 5 | Gender | `Select` with দেওয়া নেই / পুরুষ / নারী / অন্যান্য (values `''`, `MALE`, `FEMALE`, `OTHER`); an existing non-listed value (old free text) shows as one extra option so editing never loses it. **New** options. | D25; same values admission writes. |
| 6 | Blood group | Empty value shows placeholder "বাছুন" (not "দেওয়া নেই" as if chosen); "দেওয়া নেই" stays as the first item to clear it. | D25. |
| 7 | Roll | Text input with `inputMode="numeric"`, placeholder "যেমন ১২", help "ফাঁকা রাখলে শাখার পরের রোল নম্বর নিজে থেকে বসবে।" (**New** help). | No native number spinner; says what blank does (`buildCreatePayload`). |
| 8 | Guardians card | Description line (**New**). Linked guardians = one bordered list: avatar dot, name · relationship, `formatPhone(phone)` caption, red `circle-minus` icon button "{name}-কে সরান". | D8, D19 intent colours. |
| 9 | Guardian search | Visible label "অভিভাবক খুঁজুন"; results are whole-row checkbox targets (44 px phone) showing name · `formatPhone(phone)`. | D24/D25, B22 (`-guardian-picker.tsx:186`). |
| 10 | Inline new guardian | Fields get visible labels (name required-marked, relationship, phone, email); "অভিভাবক যোগ করুন" becomes outline, "বাতিল" ghost; failure shows a translated sentence. | D25, D29, D9. |
| 11 | No raw ids | A linked guardian whose details are not loaded yet shows a skeleton bar, never the id. | D9 (`-guardian-picker.tsx:144,153`). |
| 12 | Draft banner | `rounded-lg border border-border-subtle bg-secondary p-3`; "খসড়া পুনরুদ্ধার করুন" outline, "খসড়া ফেলে দিন" ghost. | D29: it was a second filled button. |
| 13 | Leave without saving | The existing blocker dialog becomes `ConfirmDialog tone="danger"` (same texts). | D29, kit ConfirmDialog. |

## Mobile behaviour
- One column; every control `h-11`; header title `text-h2` truncates beside Close.
- Footer: "বাতিল করুন" left, primary right, both `h-11` (in the app the footer is sticky).
- "নতুন অভিভাবক যোগ করুন" is full width.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Who renders `FullPageShell` | each route · `StudentForm` | `StudentForm` (new prop `title`, `onClose`) | The footer primary must call the form's submit; keeping shell + form together avoids lifting react-hook-form state into two routes. |
| Unsaved-changes prompt | FullPageShell `dirty` prompt · existing route blocker | Existing `useBlocker` (do **not** pass `dirty`) | One prompt, and it also covers browser Back; Close/Esc just navigate and the blocker asks. |
| Where Close goes | history back · explicit parent | explicit: new → `/students`, edit → `/students/$studentId` | Deep links have no history to go back to. |
| Gender storage | free text · enum select | Select writing `MALE/FEMALE/OTHER`, schema stays `z.string()` | Matches admission data; legacy text still saves unchanged. |
| Error summary | keep · drop | keep `FormShell`'s summary inside the body | Existing a11y behaviour. |

## Files
- `client-admin/src/routes/_staff/students/new.tsx` — drop the `max-w-xl` wrapper and h1; pass `title`, `onClose`
- `client-admin/src/routes/_staff/students/$studentId_.edit.tsx` — same; loading / error states rendered inside `FullPageShell`
- `client-admin/src/routes/_staff/students/-student-form.tsx` — FullPageShell, sections, gender select, roll input, draft banner, ConfirmDialog
- `client-admin/src/routes/_staff/students/-student-form-schema.ts` — nothing new beyond `GENDER_VALUES` (added by students-1); keep `gender: z.string().trim()`
- `client-admin/src/routes/_staff/students/-guardian-picker.tsx` — labels, rows, phone format, no ids, outline save, translated error
- `client-admin/src/routes/_staff/students/new.test.tsx`
- `client-admin/src/routes/_staff/students/$studentId_.edit.test.tsx`
- `client-admin/src/routes/_staff/students/-guardian-picker.test.tsx`
- `client-admin/src/routes/_staff/students/-student-form-schema.spec.ts` — only if gender handling changes a case
- `ui/src/i18n/locales/bn/students.json`, `ui/src/i18n/locales/en/students.json`

## Steps
1. **`StudentForm` props.** Add `title: string` and `onClose: () => void`. Wrap the returned tree in `<FullPageShell title={title} onClose={onClose} size="form" primary={{ label: submitLabel, onClick: () => void form.handleSubmit(handleSubmit)(), busy: mutation.isPending }} secondary={{ label: t('form.cancelAction'), onClick: onClose }}>`. Do not pass `dirty` (the `useBlocker` below already prompts). Delete the in-form `<div className="flex items-center gap-2"><Button type="submit">` block; keep `MutationErrorMessage` as the last child of `FormShell`. Keep `FormShell`'s `onSubmit` so Enter still submits.
2. **`new.tsx`.** Remove the `<div className="mx-auto max-w-xl p-6">` and the `<h1>`; render `<StudentForm title={t('new.title')} onClose={() => void navigate({ to: '/students' })} … />`.
3. **`$studentId_.edit.tsx`.** Same wrapper removal. Pending: `<FullPageShell title={t('edit.title')} onClose={toDetail} primary={{ label: t('edit.submitAction'), onClick: noop, disabled: true }}>` with a form-shaped `Skeleton` (two cards of `h-11` bars). Error: same shell, body = `ErrorState` (unchanged messages + Retry). Success: `<StudentForm title={t('edit.title')} onClose={toDetail} …/>`.
4. **Sections.** Keep the four `FormSection`s (foundation renders them as Cards with `h2`). In the guardians section render `<p className="text-text-secondary">{t('form.sections.guardiansHelp')}</p>` first.
5. **Required marks.** Pass the required flag the foundation `FormLabel` exposes (patterns.md "FormField": required mark + sr-only "(আবশ্যক)") on `full_name`, `classId`, `class_section_id`.
6. **Gender.** Replace the `<Input>` with a `Select` like blood group: items `GENDER_NOT_SET` sentinel (`'__not_set__'`, label `t('form.bloodGroupNotSet')` "দেওয়া নেই"), then `GENDER_VALUES` with `t(\`form.fields.genderOptions.${v}\`)`, plus — only when `field.value` is non-empty and not in `GENDER_VALUES` — one `SelectItem` whose value and label are `field.value`. Placeholder = the common select placeholder (D25) when `field.value === ''`.
7. **Blood group.** `SelectValue placeholder` = common select placeholder; map `''` to `undefined` value so the placeholder shows (keep the sentinel item to clear).
8. **Roll.** `<Input type="text" inputMode="numeric" placeholder={t('form.fields.rollNumberPlaceholder')} aria-describedby={fieldId('roll_number')+'-help'}/>` + `<FormDescription id=…>{t('form.fields.rollNumberHelp')}</FormDescription>`. Schema already accepts a numeric string.
9. **Draft banner.** Classes `flex flex-col gap-3 rounded-lg border border-border-subtle bg-secondary p-3 md:flex-row md:items-center md:justify-between`; restore = `variant="outline"`, discard = `variant="ghost"`, both without `size="sm"`.
10. **Leave dialog.** Replace the hand-built `Dialog` with `<ConfirmDialog open={blocker.status==='blocked'} onOpenChange={(o)=>!o && blocker.reset?.()} title={t('form.unsavedChangesDialog.title')} description={t('form.unsavedChangesDialog.description')} cancelLabel={t('form.unsavedChangesDialog.stayAction')} confirmLabel={t('form.unsavedChangesDialog.leaveAction')} tone="danger" onConfirm={() => blocker.proceed?.()} />`.
11. **Guardian picker** (`-guardian-picker.tsx`):
    - Selected list: `<p id="g-linked" className="text-label">{t('form.guardians.selectedLabel')}</p>` + `<ul aria-labelledby="g-linked" className="divide-y divide-border-subtle rounded-md border border-border-subtle">`; row `flex items-center gap-3 py-1 pr-1 pl-3`: `size-9 rounded-full bg-secondary text-secondary-foreground` icon well (`UserRoundIcon size-4`), name `font-medium` + ` · {relationship}` in `text-text-secondary`, caption `formatPhone(guardian.phone, config)` when present, then icon button (`size-11 md:size-8 text-destructive`, `CircleMinusIcon`, `aria-label={t('form.guardians.removeAction',{name})}`). If `knownGuardians[id]` is missing render `<span className="h-3 w-24 rounded-sm bg-muted" aria-hidden />` and use `t('form.guardians.unknownName')` in the aria-label — never `id`.
    - Search: `<Label htmlFor="student-form-guardian-search">{t('form.guardians.searchLabel')}</Label>` above the input (search icon inside, `pl-10`), placeholder stays.
    - Results: `<ul className="rounded-md border border-border-subtle p-1">`; each row is one `<label>` wrapping the `Checkbox`: `flex min-h-11 w-full items-center gap-3 rounded-md px-2 hover:bg-muted md:min-h-8`; text `{full_name}` + `<span className="text-text-secondary"> · {formatPhone(phone, config)}</span>`. No-results line `text-text-secondary`.
    - "নতুন অভিভাবক যোগ করুন": `variant="outline"`, `UserPlusIcon`, `className="w-full md:w-auto"`, no `size="sm"`.
    - Inline form: `rounded-md border border-border-subtle p-3 grid gap-4 md:grid-cols-2`; each input gets a visible `Label` (`nameLabel` required-marked, `relationshipLabel`, `phoneLabel`, `emailLabel`) and no placeholder-as-label. Buttons: save `variant="outline"`, cancel `variant="ghost"`.
    - `onError`: `setDraftError(t('form.guardians.newGuardian.createError'))` — never `error.message`.
12. **i18n** (`students.json`, bn / en):
    - add `form.cancelAction`: "বাতিল করুন" / "Cancel"
    - add `form.sections.guardiansHelp`: "যিনি আগে থেকে আছেন তাঁকে খুঁজে যুক্ত করুন, না পেলে নতুন যোগ করুন।" / "Find a guardian who is already on record, or add a new one."
    - add `form.fields.rollNumberPlaceholder`: "যেমন ১২" / "e.g. 12"
    - add `form.fields.rollNumberHelp`: "ফাঁকা রাখলে শাখার পরের রোল নম্বর নিজে থেকে বসবে।" / "Leave blank to use the next roll number in the section."
    - change `form.discardDraftAction`: "খসড়া ফেলে দিন" / "Discard draft"
    - add `form.guardians.unknownName`: "অভিভাবক" / "Guardian"
    - add `form.guardians.newGuardian.createError`: "অভিভাবক যোগ করা যায়নি। তথ্য দেখে আবার চেষ্টা করুন।" / "The guardian could not be added. Check the details and try again."
    - `form.fields.genderOptions.*` already added by students-1.

## Tests
- `new.test.tsx`: renders a heading "শিক্ষার্থী যোগ করুন" and a "বন্ধ করুন" button; exactly one primary button (footer); clicking it with an empty name shows `form.errors.fullNameRequired`; Close navigates to `/students`; gender is a combobox with 4 options.
- `$studentId_.edit.test.tsx`: loading and error states render inside the full-page frame; a student with `gender: 'Male (legacy)'` shows that value selected and saves it unchanged.
- `-guardian-picker.test.tsx`: search input is found by its label; results show `01711-000004` (formatted); a create failure shows the translated sentence, not the mocked server message; a selected id with no loaded guardian never renders the id text.
- E2E: `e2e/journeys/student-admission.spec.ts` and `office-staff-role.spec.ts` click the submit by `students.new.submitAction` / `edit.submitAction` and pick class/section by label — names unchanged, footer button keeps the label; run them, no edit expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No app top bar, sidebar or bottom bar on either route; Close returns to the list (new) or the detail page (edit).
- [ ] Leaving with unsaved changes asks once (danger confirm).
- [ ] Gender is a select; roll has no spinner and shows the help line.
- [ ] Guardian rows show formatted phones; the inline add form has visible labels and no filled button.

## Out of scope
- `FormShell` still carries `max-w-xl` on its `<form>` (`ui/src/shells/form-shell.tsx:67`), which would narrow the cards inside the `max-w-3xl` body — filed in shared-requests.md.
- Relationship stays free text (no enum exists server-side).
- Enrollment status stays out of the form (owned by the detail page's status dialog).
- Palette actions for add/import student already exist (`action-registry.ts:244,251`).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| FormShell drops max-w-xl | Accepted | 31.2.5a | nothing to pass; width comes from PageContainer narrow / FullPageShell |

Wave: 9   Lane: students   Decisions: D5, D8, D9, D21, D22, D23, D25, D29   Depends on: 31.3.8b, 31.4.students-1
