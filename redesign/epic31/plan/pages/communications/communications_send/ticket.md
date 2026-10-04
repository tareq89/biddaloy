# [31.4.communications-1] Send message — two clear cards, plain labels, translated errors

## Goal
`/communications/send` matches the "after" screenshots: a standard page header, a "প্রাপক" card and a "বার্তা" card, labels that follow the channel, tenant numerals in the counter, and no backend text on screen.

## What and why
The page sends one message to one person by SMS, WhatsApp or email, after a confirm step. Today it builds its own narrow column with a bigger title than every other page, the channel select is a tiny auto-width box, the address field is called "ঠিকানা" even for a phone number, the counter mixes Latin digits into Bangla ("0 অক্ষর"), and a 400 from the server is shown word for word. The redesign puts the page in the standard frame, groups the fields into "who" and "what", and translates everything the user sees.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_send/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_send/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_send/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_send/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | `send.tsx` frame (form and success state) | Drop `mx-auto flex max-w-2xl … p-4` and the `text-2xl` `h1`; wrap in `PageContainer size="narrow"` + `PageHeader title={t('send.title')} subtitle={t('send.description')}` (no actions). | D15, D16 — same width and title size as every form page |
| 2 | Recipient fields | One Card "প্রাপক" (**New** heading + one-line help): student picker → guardian choice → name + number in a 2-column grid. | Each control next to what it changes |
| 3 | Selected student | **New** `SelectedStudentRow`: name + registration number on a `bg-muted` strip, ghost "বদলান" button on the right (was "শিক্ষার্থী মুছুন", which reads like "delete the student"). | Clear current state; plain wording |
| 4 | Student search results | Result buttons become full-width rows `h-11` (were `size="sm"` ghost buttons). | 44 px targets |
| 5 | Guardian choice | Radio rows `min-h-11` inside a bordered list, each with name (relationship) and the contact under it via `formatPhone` / email. | D8; bigger targets; current state visible |
| 6 | Address field | Label follows the channel: "মোবাইল নম্বর" for SMS/WhatsApp, "ইমেইল ঠিকানা" for email; help "যেমন 01711-000004" under the phone field. | "প্রাপকের ঠিকানা" is jargon for a phone number |
| 7 | Message fields | Second Card "বার্তা": "কীভাবে পাঠাবেন" Select at full column width, subject (email), message, counter, WhatsApp fields; form footer with the one primary "যাচাই করে পাঠান" (`send` icon). | D25 (no half-width select), D29 |
| 8 | SMS counter | `chars` passed through `formatNumber`; text "৯৮ অক্ষর · ২টি এসএমএস" ("সেগমেন্ট" dropped). | D6; jargon |
| 9 | Confirm dialog | `DialogContent size="md"`; recipient line shows `formatPhone` for phones; a 400 shows `send.errorInvalid` instead of `error.message`. | D21, D8, D9 |
| 10 | Success state | Same PageHeader; result Card with `StatusBadge`; "আরেকটি বার্তা পাঠান" stays the primary. Title "বার্তা পাঠানো শুরু হয়েছে" (was "সারিবদ্ধ"). | D16; jargon |

## Mobile behaviour
- One column: name and number stack; the primary button is full width at the end of the "বার্তা" card.
- Every input, select, radio row and button is `h-11`/`min-h-11`.
- No header actions, so the header is title + subtitle only.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Width | wide two-column / narrow | `PageContainer size="narrow"` | D15 says forms are narrow; the "odd column" today is the hand-made `max-w-2xl`, not the width itself |
| Channel control | segmented radio / Select | full-width Select | Kit has no segmented control; D25 asks for full width |
| Where the primary sits | page header / form footer | form footer | Kit Form pattern; it is reached after filling the form |
| Address key | rename key / keep key, change text | keep `send.recipientAddressLabel`, new text "মোবাইল নম্বর"; new `send.recipientEmailLabel` for email | `e2e/a11y/overlay-openers.ts` (foundation-owned) finds the field by that key in SMS mode |
| 400 errors | show server text / one translated sentence | translated sentence | D9 |

## Files
- `client-admin/src/routes/_staff/communications/send.tsx` — frame, cards, labels, dialog, errors, success state
- `client-admin/src/routes/_staff/communications/send.test.tsx` — updated assertions
- `client-admin/src/routes/_staff/communications/-shared/selected-student-row.tsx` — **New**; also used by communications-2a
- `client-admin/src/routes/_staff/communications/-shared/student-search.tsx` — `h-11` result rows
- `client-admin/src/routes/_staff/communications/-shared/sms-segment-counter.tsx` — `formatNumber` for `chars`
- `ui/src/i18n/locales/en/communications.json`, `ui/src/i18n/locales/bn/communications.json` — keys below

## Steps
1. **Frame.** In `SendMessageForm`, replace both outer `div`s (form state `:211`, success state `:183`) with `<PageContainer size="narrow">` and replace the hand-made `<header>`/`<h1>` with `<PageHeader title={t('send.title')} subtitle={t('send.description')} />` (both from `@biddaloy/ui`). No `max-w-*`, `mx-auto` or `p-4` stays in the file.
2. **Form layout.** `<form onSubmit={handleSubmit} className="space-y-6">` holding two `Card padded` sections (`aria-labelledby` their `h2`):
   - Card 1: `<h2 className="text-h2">{t('send.recipientSectionTitle')}</h2>`, `<p className="mt-1 text-text-secondary">{t('send.recipientSectionHelp')}</p>`, then `<div className="mt-4 grid gap-4 md:grid-cols-2">` with: student block (`md:col-span-2`), guardian fieldset (`md:col-span-2`, only when a student with guardians is picked), recipient name, recipient number/email.
   - Card 2: `<h2>{t('send.messageSectionTitle')}</h2>`, then `mt-4 grid gap-4 md:grid-cols-2` with: medium Select (one column), subject (email only, one column), message Textarea (`md:col-span-2`) + counter, `WhatsappTemplateFields` (`md:col-span-2`). Then the kit form footer `mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:justify-end` with `<Button type="submit"><Send aria-hidden /> {t('send.submit')}</Button>`.
   - Field = `flex flex-col gap-1.5`; required fields (name, number, message, medium) carry the kit required mark.
3. **Student block.** Label `t('send.linkStudentTitle')` ("শিক্ষার্থী (ঐচ্ছিক)"). No student → `StudentSearch` (unchanged props). Student picked → `<SelectedStudentRow name={student.full_name} registrationNumber={student.registration_number} changeLabel={t('send.clearStudent')} onChange={…existing clear handler} />`.
4. **`-shared/selected-student-row.tsx` (New).** Props `{ name: string; registrationNumber: string; changeLabel: string; onChange: () => void }`. Markup: `div.flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted py-1 ps-3 pe-1` → left `div.min-w-0` with `p.truncate font-medium` (name) and `p.text-caption text-text-secondary` (registration, Latin digits per D6); right `<Button variant="ghost" className="shrink-0 text-primary"><Repeat aria-hidden />{changeLabel}</Button>`.
5. **`student-search.tsx`.** Result `Button`: drop `size="sm"`, add `className="h-11 w-full justify-start md:h-8"`; the list keeps `max-h-48 overflow-y-auto`. Use the Input's own visible label: pass `aria-label` stays (the block label above is the visible one).
6. **Guardian choice.** `<fieldset>` + `<legend className="text-label text-text-primary mb-1.5">{t('send.guardianPickLabel')}</legend>`; `RadioGroup` with `className="divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle"`. Each item is a `<label>` row `flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted` containing `RadioGroupItem` and two lines: `t('send.guardianOptionLabel', {name, relationship})` and, in `text-caption text-text-secondary`, the address: `medium === 'EMAIL' ? guardian.email : formatPhone(guardian.phone, config)`, or `t('send.guardianNoAddress')` when null. `config = useTenantRegionConfig()` (wrap the page in `RegionConfigProvider` the way `reminders.tsx:102` does, then `useRegionConfig()` inside).
7. **Name and address.** Name keeps `send.recipientNameLabel`. Address label: `medium === 'EMAIL' ? t('send.recipientEmailLabel') : t('send.recipientAddressLabel')`; under the phone field `<p className="text-caption text-text-secondary">{t('send.phoneHelp')}</p>` wired with `aria-describedby`. Input value is still the raw string the user types (no formatting inside the input).
8. **Medium Select.** `SelectTrigger className="w-full"`; label `t('send.mediumLabel')` ("কীভাবে পাঠাবেন").
9. **`sms-segment-counter.tsx`.** Call `t('smsCounter.count', { count, chars: formatNumber(chars, config) })` with `config = useRegionConfig()`; render with `text-caption text-text-secondary`.
10. **Confirm dialog.** `<DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>`. Recipient `dd`: `{recipientName.trim()} · {medium === 'EMAIL' ? address : formatPhone(address, config)}`. Error `p`: `400 → t('send.errorInvalid')`, else `t('send.errorMessage')` — delete the `sendMessage.error.message` branch and its comment. Keep the `role="alert"` and kit error-text classes (`flex items-center gap-1 text-caption text-destructive` + `CircleAlert`).
11. **Success state.** PageHeader as step 1; one `Card padded` with `h2.text-h2` `t('send.resultTitle')`, `p.mt-1.text-text-secondary` description, a `dl` row "ডেলিভারির অবস্থা" + `StatusBadge domain="communication"`, footer `mt-5 flex justify-end border-t border-border-subtle pt-4` with the primary `t('send.sendAnother')`.
12. **Locale keys** (edit en + bn together):

| Key | en | bn |
|---|---|---|
| `send.description` (changed) | You'll see the recipient and message once more before it goes out. | পাঠানোর আগে প্রাপক ও বার্তা আরেকবার দেখানো হবে। |
| `send.recipientSectionTitle` (new) | Recipient | প্রাপক |
| `send.recipientSectionHelp` (new) | Find a student and pick a guardian, or type the name and number yourself. | শিক্ষার্থী খুঁজে অভিভাবক বাছুন, অথবা নিচে নাম ও নম্বর নিজে লিখুন। |
| `send.messageSectionTitle` (new) | Message | বার্তা |
| `send.linkStudentTitle` (changed) | Student (optional) | শিক্ষার্থী (ঐচ্ছিক) |
| `send.guardianPickLabel` (new) | Which guardian to send to | কোন অভিভাবককে পাঠাবেন |
| `send.clearStudent` (changed) | Change | বদলান |
| `send.mediumLabel` (changed) | Send by | কীভাবে পাঠাবেন |
| `send.recipientAddressLabel` (changed) | Mobile number | মোবাইল নম্বর |
| `send.recipientEmailLabel` (new) | Email address | ইমেইল ঠিকানা |
| `send.phoneHelp` (new) | e.g. 01711-000004 | যেমন 01711-000004 |
| `send.errorInvalid` (new) | Something in the number, email or message isn't right. Check it and try again. | নম্বর, ইমেইল বা বার্তায় কিছু ঠিক নেই। যাচাই করে আবার চেষ্টা করুন। |
| `send.resultTitle` (changed) | Message on its way | বার্তা পাঠানো শুরু হয়েছে |
| `send.resultDescription` (changed) | The message to {{name}} is being sent. | {{name}}-এর কাছে বার্তাটি পাঠানো হচ্ছে। |
| `smsCounter.count_one` / `_other` (changed) | {{chars}} characters · {{count}} SMS | {{chars}} অক্ষর · {{count}}টি এসএমএস |

## Tests
- `send.test.tsx`: heading level 1 "Send message" rendered once; the address field is found by "Mobile number" in SMS mode and by "Email address" after switching to Email; picking a guardian shows the phone as `01711-000004`-style text in the radio row; a 400 from `POST /communications/send` shows "Something in the number, email or message isn't right…" and never the server's message string; "Change" clears the picked student.
- Add one test for `sms-segment-counter` behaviour inside `send.test.tsx`: with a `bn` region config the counter text has no Latin digits.
- E2E: none to change (`e2e/a11y/overlay-openers.ts` keeps working because `send.recipientAddressLabel`, `recipientNameLabel`, `messageLabel` and `submit` keep their keys).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Title size and left edge match other form pages (PageHeader + narrow PageContainer).
- [ ] Two cards titled "প্রাপক" and "বার্তা"; the channel select spans its column.
- [ ] Address label reads "মোবাইল নম্বর" for SMS/WhatsApp and "ইমেইল ঠিকানা" for email.
- [ ] Counter shows "৯৮ অক্ষর · ২টি এসএমএস" style text in bn, all digits Bangla.
- [ ] Guardian rows show phones as `01711-000004`.
- [ ] A rejected send shows the translated sentence, not server English.

## Out of scope
- The layout's single-crumb row above the title on 1-level pages — owned by 31.3.5 / 31.2.9.
- `guardian.relationship` is free text typed by staff, not an enum — shown as typed.
- No shared requests filed for this ticket.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: communications   Decisions: D5, D6, D8, D9, D15, D16, D17, D21, D25, D29   Depends on: 31.3.8b
