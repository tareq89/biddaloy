# [31.4.settings-1b] Settings — School category: plain labels, Advanced fields

## Goal
The four School cards (profile, shift/version/group, language & numbers, calendar) use `SettingsSection` and kit controls. They show plain words instead of `bn-BD`, `0`, `1` and regexes. Technical regional fields sit under "উন্নত সেটিং" (D9, D30).
(b runs after a: `ticket.md` builds `SettingsLayout` / `SettingsSection` and puts these four sections in the School category.)

## What and why
The School category is where an admin sets the school's name, logo and the way numbers, money and dates look. Today the regional form asks the admin to type `bn-BD`, `Asia/Dhaka`, a phone regex, a first weekday as "0" and a start month as "1". It also shows a date-format field that nothing reads. The logo upload has a Save button under it although the logo saves on its own. This ticket turns codes into choices and hides the rare technical fields under "Advanced". It also drops the dead field and makes every card look like the kit.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Profile card | Logo row first: preview (`size-16`), help "PNG, JPEG বা WebP, ৫১২ KB পর্যন্ত। ছবি বাছাই করলেই সংরক্ষিত হয়।" (**New**), outline "লোগো আপলোড করুন", ghost "লোগো সরান". Then the fields in 2 columns; Save in the card footer. | the logo saves on its own; the Save under it misled |
| 2 | Profile — remove logo | The inline red "সরান / বাতিল" → `ConfirmDialog` (`tone="danger"`). | D29: red filled only in a confirm dialog |
| 3 | Profile — labels | "EIIN / নিবন্ধন আইডি" → "EIIN / নিবন্ধন নম্বর". The read-only view shows the phone through `formatPhone` (B22, `school-profile-section.tsx:412`). | D8, D32 |
| 4 | Shift / version / group | 3 columns on desktop. Each value is a row with icon buttons (pencil "নাম পরিবর্তন", `circle-minus` "মুছুন", with tooltips). The add row is an input + outline "যোগ করুন" (was filled ×3). | D19, D29: one filled button per card |
| 5 | Regional card | Title "আঞ্চলিক" → "ভাষা, সংখ্যা ও তারিখ" + one-line description (**New**). | plain words |
| 6 | Regional — main fields | Locale text → Select ("বাংলা (বাংলাদেশ)" / "ইংরেজি (বাংলাদেশ)"). First day of week "0" → weekday Select. Start month "1" → month Select. Decimal places → Select ০–৪. | D9, D25 |
| 7 | Regional — money | A "মুদ্রা" sub-heading. **New** live example line "নমুনা: ৳১২,৩৪,৫৬৭.০০" built from the current form values. | see the effect before saving |
| 8 | Regional — Advanced | Under "উন্নত সেটিং": time zone, currency code, phone country (Select of countries), example phone, display mask, phone check rule, address fields + order, national-ID and student-ID rules — each with a plain label and help. | D30 |
| 9 | Regional — removed fields | `date.format` (no formatter reads it since D5) and `date.calendar` (only `gregory` works) leave the form. Their stored values are sent back unchanged on save. | no dead or one-choice fields |
| 10 | Calendar card | Kit Selects; country help (**New**). The week line drops the raw time zone ("…টাইমজোন Asia/Dhaka"). The two links become ghost link buttons "সপ্তাহের প্রথম দিন বদলান" / "সাপ্তাহিক ছুটি বদলান (একাডেমিক)". | D9 |
| 11 | All four | `SettingsSection` card: `h2` title, own Save; "সংরক্ষিত হয়েছে" with a check icon on the left of the footer; native `<select>` → `Select`. | patterns §9, D25 |

## Mobile behaviour
- Every grid is one column; the 3 organisation lists stack.
- Logo buttons are full width, one under the other.
- The Advanced summary is one line ("উন্নত সেটিং"); what it holds is said in its first help line.
- Save is full width at the bottom of each card.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Date-format field | keep under Advanced · remove | remove from the form, pass the stored value through | D5 fixes one long format; a setting that changes nothing confuses |
| Calendar system (`gregory`) | Select with one option · remove | remove, pass through | only one value works |
| Locale outside the known list | show the raw code · "keep current" option | an extra option "এখনকার মান রাখুন" holding the stored value | D9 |
| Timezone | Select of zones · text under Advanced | text under Advanced with help | every school today is `Asia/Dhaka`; a zone list is speculative |
| Phone country | text · Select | Select from `COUNTRIES` (exported from `CalendarSection.tsx`) | the list already exists |
| Address field keys (`village_or_area…`) | translate · leave under Advanced | leave, Advanced, monospace + "কমা দিয়ে আলাদা করুন" | technical data; translating keys is a feature |
| Organisation row actions on phone | RowActions with labels · icon buttons | icon buttons with `aria-label` + tooltip at both sizes | short value lists inside a card, not table cards; labels would push the name out |

## Files
- `client-admin/src/pages/settings/school-profile-section.tsx`
- `client-admin/src/pages/settings/school-profile-section.test.tsx`
- `client-admin/src/pages/settings/OrganisationSection.tsx`
- `client-admin/src/pages/settings/OrganisationSection.test.tsx`
- `client-admin/src/pages/settings/RegionalSection.tsx`
- `client-admin/src/pages/settings/RegionalSection.test.tsx` — **New**
- `client-admin/src/pages/settings/CalendarSection.tsx` (also changed by settings-1a, runs earlier)
- `client-admin/src/pages/settings/CalendarSection.test.tsx`
- `client-admin/src/pages/SchoolSettingsPage.tsx` — drop the `<div id>` wrappers for organisation/regional, pass `id` to the section instead (also changed by settings-1a, runs earlier)
- `ui/src/i18n/locales/en/settings.json`, `ui/src/i18n/locales/bn/settings.json` (also changed by settings-1a)

## Steps
1. **Read first:** `settings-layout.tsx` and `settings-categories.ts` from 1a; `PLAN/kit/patterns.md` §6 (Form, Select, Checkbox), §7 (ConfirmDialog), §9; `PATTERN: SettingsLayout` and `PATTERN: Form`. The mockup is `PLAN/pages/settings/settings/mockup.html`: copy its structure.

2. **Shared shape for all four sections.** Replace `<FormShell …><FormSection legend>…</FormSection><Button type="submit">…` with `<SettingsSection id? title description onSubmit={(e) => void form.handleSubmit(handleSave)(e)} saving={mutation.isPending} footerStart={…}>`.
   - `footerStart`: `{mutation.isSuccess && <SettingsSaved />}{mutation.isError && <MutationErrorMessage error={mutation.error} />}`.
   - Field groups inside: `<div className="mt-4 grid gap-4 md:grid-cols-2">`.
   - Sub-headings: `<h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">`.
   - Keep `FormField` / `FormItem` / `FormLabel` / `FormControl` / `FormMessage`, `useFormShellMode()`, `useWarnUnsavedChanges` and every `id` (tests and the error links use them).
   - `buildFormShellErrors` is no longer needed — remove its import.
   - Native `<select>` → `<Select value onValueChange={field.onChange}><SelectTrigger id=…><SelectValue /></SelectTrigger><SelectContent>{…<SelectItem>}</SelectContent></Select>`.

3. **`school-profile-section.tsx`.**
   - `SettingsSection id="profile-section" title={t('profile.legend')} description={t('profile.description')}`. The load-error and loading branches also render inside `SettingsSection` (no `onSubmit`): the error as `ErrorState`, loading as a skeleton of 3 field rows.
   - Logo row first: `<div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:gap-4">`. Left: preview `size-16 rounded-md border border-border-subtle object-contain`; when empty, `bg-muted` with `profile.logo.empty` as `aria-label`. Next to it, the label `profile.logo.legend` + help `profile.logo.help`. Right: `flex flex-col gap-2 md:ms-auto md:flex-row` with `FileUpload` (outline, `w-full md:w-auto`) and, when a logo exists, a ghost `Button` `profile.logo.remove`.
   - Uploading and error messages stay under the row (`role="status"` / `role="alert"`).
   - Remove the inline confirm (`confirmingRemove` block, `:362-383`). Use `<ConfirmDialog open={confirmingRemove} onOpenChange={setConfirmingRemove} title={t('profile.logo.removeConfirm')} description={t('profile.logo.removeConfirmDescription')} confirmLabel={t('profile.logo.removeConfirmYes')} cancelLabel={t('profile.logo.removeCancel')} tone="danger" busy={removeLogo.isPending} onConfirm={handleRemove} />`.
   - Fields grid: name (required mark), name_bn, phone, email, registration_id, address (`md:col-span-2`) — in this order, with a `border-t border-border-subtle pt-4` above the grid.
   - `ReadOnlyProfile`: the same card without `onSubmit`, values in `FieldGrid` style (`dl grid gap-4 md:grid-cols-2`, label `text-caption text-text-secondary`, value `font-medium`). The phone goes through `formatPhone(profile.phone, regionConfig)` (`useRegionConfig()`); empty values render `—`.

4. **`OrganisationSection.tsx`.**
   - `SettingsSection id="organisation-section" title={t('organisation.legend')} description={t('organisation.description')} onSubmit` (the save handler is today's `handleSave` on the button; move it to `onSubmit` with `event.preventDefault()`).
   - Body `<div className="mt-4 grid gap-6 md:grid-cols-3">` with the 3 list editors.
   - Each editor: `h3.text-h3` label; `ul.divide-y.divide-border-subtle.border-y.border-border-subtle`; row `flex h-11 items-center justify-between gap-2 md:h-9`.
   - Row buttons: `Button variant="ghost" size="icon"` wrapped in `Tooltip`, `aria-label` = the existing `renameAction` / `removeAction` text + the value. Rename = `PencilIcon text-primary`, remove = `CircleMinusIcon text-destructive`.
   - A row marked for removal keeps today's look (strike-through) plus its undo button.
   - The rename row: input + outline "সংরক্ষণ করুন" + ghost "বাতিল" (was a filled small button).
   - The add row: `flex gap-2` with the input (`min-w-0 flex-1`, `sr-only` label "<list label>: <addPlaceholder>") + `Button variant="outline"` with `PlusIcon` + `addAction`.
   - The server's refusal message stays inline on its row.

5. **`RegionalSection.tsx`.**
   - `SettingsSection id="regional-section" title={t('regional.legend')} description={t('regional.description')} advanced={…} advancedOpen={hasAdvancedError}`, where `hasAdvancedError` = any error under `timezone | currency.code | phone.* | address.* | identifiers.*`.
   - Main grid, in order:
     - `locale` Select with options `[{ value: 'bn-BD', label: t('regional.localeBnBd') }, { value: 'en-BD', label: t('regional.localeEnBd') }]`. When `region.locale` is not one of them, add `{ value: region.locale, label: t('regional.keepCurrent') }`.
     - `numerals` Select.
     - `date.firstDayOfWeek` Select of 0–6 with `t(`calendar.weekday.${WEEKDAY_KEYS[i]}`)`. Export `WEEKDAY_KEYS` from `CalendarSection.tsx`.
     - `academicYear.startMonth` Select of 1–12 with `formatMonthName(m, regionConfig)`.
   - Sub-heading `regional.currencyLegend`, then: `currency.symbol` Input, `currency.position` Select, `currency.decimals` Select 0–4 (labels via `formatNumber`), `currency.grouping` Select. Then **New** `<p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 md:col-span-2">`: `regional.currencyPreview` with `amount = formatCurrency(1234567, { ...regionConfig, numerals: watch('numerals'), currency: { ...watch('currency'), decimals: Number(watch('currency.decimals')) } })`. Wrap it in `try/catch` and render `—` on throw. Value `font-medium tabular-nums`.
   - `advanced`:
     - Help `regional.advancedHelp`.
     - Grid: `timezone` (help `regional.timezoneHelp`), `currency.code` (help `regional.currencyCodeHelp`).
     - Sub-heading `regional.phoneLegend`: `phone.country` Select from `COUNTRIES` (export it from `CalendarSection.tsx`), `phone.example`, `phone.displayFormat` (help `regional.phoneDisplayFormatHelp`), `phone.pattern` (help `regional.phonePatternHelp`).
     - Sub-heading `regional.identifiersLegend`: `address.fields`, `address.order` (help `regional.commaHelp`), `identifiers.national`, `identifiers.student` (placeholder `regional.studentIdPlaceholder`).
     - Technical text inputs get `font-mono`.
   - Remove `date.format` and `date.calendar` from `regionalSchema` and the JSX. In `handleSave` build `date: { format: region.date.format, calendar: region.date.calendar, firstDayOfWeek: Number(values.date.firstDayOfWeek) }`.

6. **`CalendarSection.tsx`.**
   - `SettingsSection id="calendar-section" title={t('calendar.legend')} description={t('calendar.description')}`.
   - `termLabel` and `country` → `Select`; country help `calendar.countryHelp`.
   - The week block: `<div className="flex flex-col gap-2 rounded-md bg-muted p-3 md:col-span-2">` with the label, the value line (call `weekShapeValue` without `timezone`), and the two router links from 1a restyled `inline-flex h-11 items-center gap-1 rounded-md px-2 font-medium text-primary hover:bg-surface md:h-8` with `ArrowUpIcon` / `ArrowRightIcon size-4`.
   - Export `COUNTRIES` and `WEEKDAY_KEYS`.

7. **`SchoolSettingsPage.tsx`.** In the `school` case remove the `<div id="organisation-section">` and `<div id="regional-section">` wrappers — the sections now carry the ids. Keep `'regional-section', 'organisation-section'` in `settings-categories.ts`.

8. **i18n `settings.json`, en + bn.**
   - Change:
     - `profile.registrationId` → "EIIN / registration number" / "EIIN / নিবন্ধন নম্বর"
     - `regional.legend` → "Language, numbers and dates" / "ভাষা, সংখ্যা ও তারিখ"
     - `regional.dateCalendar` unchanged (unused now)
     - `regional.phoneCountry` → "Phone country" / "ফোনের দেশ"
     - `regional.phonePattern` → "Phone number check rule" / "ফোন নম্বর যাচাইয়ের নিয়ম"
     - `regional.phoneExample` → "Example phone number" / "নমুনা ফোন নম্বর"
     - `regional.phoneDisplayFormat` → "How phone numbers are shown" / "ফোন নম্বর দেখানোর ধরন"
     - `regional.phoneLegend` → "Phone numbers" / "ফোন নম্বর"
     - `regional.addressFields` → "Address parts" / "ঠিকানার ঘর"
     - `regional.addressOrder` → "Order of address parts" / "ঠিকানার ঘরের ক্রম"
     - `regional.identifiersLegend` → "Address and ID numbers" / "ঠিকানা ও পরিচয় নম্বর"
     - `regional.identifiersNational` → "National ID check rule" / "জাতীয় পরিচয়পত্র নম্বর যাচাইয়ের নিয়ম"
     - `regional.identifiersStudent` → "Student ID check rule" / "শিক্ষার্থী আইডি যাচাইয়ের নিয়ম"
     - `calendar.weekShapeValue` → "Week starts {{weekStart}}, weekend is {{weekend}}." / "সপ্তাহ শুরু হয় {{weekStart}}, সাপ্তাহিক ছুটি {{weekend}}।"
     - `calendar.changeInRegional` → "Change the first day of the week" / "সপ্তাহের প্রথম দিন বদলান"
     - `calendar.changeInAttendance` → "Change weekly off days (Academics)" / "সাপ্তাহিক ছুটি বদলান (একাডেমিক)"
   - Add:
     - `profile.description` "Shown on receipts, invoices and printouts." / "রসিদ, চালান ও প্রিন্টে এই তথ্য দেখা যায়।"
     - `profile.logo.help` "PNG, JPEG or WebP, up to 512 KB. It saves as soon as you pick it." / "PNG, JPEG বা WebP, ৫১২ KB পর্যন্ত। ছবি বাছাই করলেই সংরক্ষিত হয়।"
     - `profile.logo.removeConfirmDescription` "Receipts and printouts will show no logo. You can upload one again later." / "রসিদ ও প্রিন্টে আর লোগো দেখাবে না। পরে আবার আপলোড করা যাবে।"
     - `organisation.description` "Classes and sections use these names. Press Save after renaming or removing." / "শ্রেণি ও শাখা সাজাতে এই নামগুলো ব্যবহার হয়। মুছলে বা নাম বদলালে সংরক্ষণ করুন চাপুন।"
     - `regional.description` "How numbers, money and dates appear on every page." / "সব পাতায় সংখ্যা, টাকা ও তারিখ যেভাবে দেখাবে।"
     - `regional.localeBnBd` "Bangla (Bangladesh)" / "বাংলা (বাংলাদেশ)"
     - `regional.localeEnBd` "English (Bangladesh)" / "ইংরেজি (বাংলাদেশ)"
     - `regional.keepCurrent` "Keep the current value" / "এখনকার মান রাখুন"
     - `regional.currencyPreview` "Example: {{amount}}" / "নমুনা: {{amount}}"
     - `regional.advancedHelp` "Time zone, phone, address and ID rules. You rarely need to change these; a wrong value can stop phone or ID checks from working." / "সময় অঞ্চল, ফোন, ঠিকানা ও পরিচয় নম্বরের নিয়ম। সাধারণত বদলানোর দরকার হয় না; ভুল মান দিলে ফোন বা পরিচয় নম্বর যাচাই কাজ নাও করতে পারে।"
     - `regional.timezoneHelp` "No need to change this for a school in Bangladesh." / "বাংলাদেশের স্কুলে বদলানোর দরকার নেই।"
     - `regional.currencyCodeHelp` "Three-letter international code." / "তিন অক্ষরের আন্তর্জাতিক কোড।"
     - `regional.phoneDisplayFormatHelp` "Each X is replaced by a digit of the number." / "X-এর জায়গায় নম্বরের অঙ্ক বসে।"
     - `regional.phonePatternHelp` "A regular expression. A phone number that does not match is not accepted." / "রেগুলার এক্সপ্রেশন। এর সাথে না মিললে ফোন নম্বর নেওয়া হয় না।"
     - `regional.commaHelp` "Separate with commas." / "কমা দিয়ে আলাদা করুন।"
     - `regional.studentIdPlaceholder` "Leave empty to accept any ID" / "ফাঁকা রাখলে যেকোনো আইডি চলবে"
     - `calendar.description` "Exams, holidays and terms are arranged with this." / "পরীক্ষা, ছুটি ও টার্ম এই তথ্য দিয়ে সাজানো হয়।"
     - `calendar.countryHelp` "Public holidays come from this country." / "সরকারি ছুটির তালিকা এই দেশ থেকে আসে।"

## Tests
- `RegionalSection.test.tsx` (new):
  - Renders "বাংলা (বাংলাদেশ)" / "Bangla (Bangladesh)" for `bn-BD`, "Sunday" for `firstDayOfWeek: 0`, "January" for `startMonth: 1`; no element shows `bn-BD` or the text `0`.
  - Saving sends `date.format` and `date.calendar` unchanged from the input `region`.
  - An invalid `phone.pattern` (empty) on submit opens the Advanced `<details>`.
  - The example line updates when grouping changes to "Thousand".
- `school-profile-section.test.tsx`: the remove flow now opens a dialog (`getByRole('alertdialog')`) and confirms there (`:149-190`); the read-only view shows the phone as `01711-000000`.
- `OrganisationSection.test.tsx`: buttons are found by their accessible name (unchanged texts); update any query that relied on visible button text.
- `CalendarSection.test.tsx:75`: the week line no longer contains the time zone.
- `e2e/keyboard/organisation-structure.spec.ts` (updated by 1a) must still pass; re-run it.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per card.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Outside "উন্নত সেটিং" no code is visible (`bn-BD`, `Asia/Dhaka`, `BDT`, regexes, `0`/`1` for days/months).
- [ ] The date-format field is gone, and saving keeps the stored `date.format`.
- [ ] Removing the logo asks in a dialog; no red button sits in the card.
- [ ] The organisation card has no filled "যোগ করুন" buttons.

## Out of scope
- Typed numbers in inputs (`5`, `75`) stay in Latin digits — a numerals-aware number input is a shared request.
- Translating the address part keys (`village_or_area`…) — data, kept under Advanced.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| PageHeader title ReactNode or mobileTitle | Refused | — | use the fallback in the ticket (inline PageHeader markup in SchoolSettingsPage.tsx); one page |
| NumberInput / Input numerals mode (type in tenant digits) | Refused | — | use the fallback in the ticket (Latin digits while typing; display stays formatted) — new component; ponytail until a second form needs it |
| palette entries per settings category | Accepted | 31.5.1b | actions settings.communication / settings.finance / settings.backup -> /settings?section=<id> with SETTINGS_CATEGORY_IDS; print.printers keeps #printers-section |

Wave: 9   Lane: settings   Decisions: D5, D8, D9, D19, D25, D29, D30, D32   Depends on: 31.3.8b, 31.4.settings-1a
