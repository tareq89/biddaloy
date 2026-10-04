# [31.4.settings-2] Settings — Academics and Finance categories redesigned

## Goal
The Academics category (attendance policy, evaluations, ACR criteria, ready-made curriculum link) and the Finance category (fee rules) use `SettingsSection` and kit controls. The 25 ACR criteria become one compact table, the late-fee list shows fee names instead of `MONTHLY_TUITION`, and no text points to settings "above" that now live in another category.

## What and why
These two categories hold the school's rules for attendance, staff evaluations and fees. Today the ACR criteria alone fill ~5 000 px as one bordered box per criterion. The late-fee list shows enum constants (`MONTHLY_TUITION`, `EXAM_FEE`). Turning on auto-absent messages asks for confirmation inline. The evaluations text says "the SMS settings above", but after settings-1a SMS lives in Communication. This ticket gives each category kit cards, turns long lists into tables, translates every label and links across categories.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_academics-finance/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_academics-finance/before-mobile.webp?raw=true" width="260"> |
| After — Academics | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_academics-finance/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_academics-finance/mobile.webp?raw=true" width="260"> |
| After — Finance | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_academics-finance/finance/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_academics-finance/finance/mobile.webp?raw=true" width="260"> |

"Before" is the same single-column page as `admin__settings` (these sections sit in its lower half); if no separate crop is produced, use that page's shots.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Attendance | `SettingsSection id="attendance-section"`. Weekly off days as one row of checkboxes (2 columns on phone). Late / absent / send-by → `TimeInput` ("সকাল ৮:১৫"). Help under correction window and low-attendance threshold (**New**). Percentage basis → `Select`. | D7, D25; native time inputs showed `08:15 AM` |
| 2 | Attendance — auto-absent | A sub-heading "অনুপস্থিতির স্বয়ংক্রিয় বার্তা". Turning it on opens a `ConfirmDialog` (was an inline box with a filled button). | D29: one filled button per card |
| 3 | Evaluations | Provider state as a `StatusBadge` (success "এসএমএস প্রোভাইডার ঠিক করা আছে" **New** / warning "…ঠিক করা নেই") + a link "যোগাযোগ › এসএমএস ঠিক করুন" → `?section=communication` (**New**). Texts that said "above" are fixed. | D27; SMS is in another category now |
| 4 | ACR criteria | One table: কোড · অংশ (Select) · নাম (বাংলা) · নাম (ইংরেজি) · কাজ (up / down / remove icons with tooltips), footer "মোট ২৫টি". The version shows as an info `StatusBadge` next to the title. "মানদণ্ড যোগ করুন" (outline) and "মানদণ্ড সংরক্ষণ করুন" (primary) sit in the card footer. Phone: one bordered block per criterion with labelled actions. | D19, D27; ~5 000 px today |
| 5 | Ready-made curriculum link | A kit Card: `h2` + state + outline "খুলুন →" button-link (was an underlined text link). The applied preset shows its name, not its id. | D9, D29 |
| 6 | Fees | One card "ফির নিয়ম" (**New** title + description) with 3 sub-headings: অতিরিক্ত অনুমোদন (Select + help **New**), পরিবারকে জানান (2 checkboxes), বিলম্ব ফি. | patterns §9 |
| 7 | Fees — late fees | A table: ফির ধরন (checkbox + translated name) · রেয়াত দিন · ধরন · মান. The inputs show only on checked rows; other rows show "—". Phone: a checkbox row per fee; a checked fee shows ধরন (full width) + রেয়াত দিন + মান under it. | D9 (raw `MONTHLY_TUITION`); less noise |

## Mobile behaviour
- Weekly off days in a 2-column checkbox grid; every field full width.
- ACR criteria: a block per criterion (code + part on one row, the two names under), actions with visible labels (উপরে নিন · নিচে নিন · সরান), "মোট ২৫টি" under the list. Add (outline) and Save (primary) are full width.
- Late fees: unchecked fees are single 44 px checkbox rows; a checked fee expands with its 3 fields.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| ACR editing | a dialog per criterion · inline table | inline table on desktop, blocks on phone | no new strings in `evaluations` (staff lane owns it); same data model (whole list PUT) |
| Late fees for unchecked types | disabled inputs · hidden inputs | hidden, "—" in the cell | shows only what applies; RHF keeps the values (`shouldUnregister` stays false) |
| Fee type labels | add `common:feeType.*` · read `feeStructures:feeTypes.*` | `t(`feeTypes.${type}`, { ns: 'feeStructures' })` and load that namespace on the route | the labels already exist; no shared-file change |
| Fees: one card or three | three cards with own Save · one card | one card, three sub-headings | it is one form and one PATCH today |
| Preset name | show id · look it up | `usePresetList()` + `usePickText()` from `pages/curriculum-preset/use-presets.ts` (read only) | D9 |
| Auto-absent confirm | inline box · `ConfirmDialog` | `ConfirmDialog tone="default"` | D29 |

## Files
- `client-admin/src/pages/settings/AttendanceSection.tsx`
- `client-admin/src/pages/settings/AttendanceSection.test.tsx`
- `client-admin/src/pages/settings/EvaluationsSection.tsx`
- `client-admin/src/pages/settings/EvaluationsSection.test.tsx`
- `client-admin/src/pages/settings/AcrCriteriaSection.tsx`
- `client-admin/src/pages/settings/AcrCriteriaSection.test.tsx`
- `client-admin/src/pages/settings/PresetLinkCard.tsx`
- `client-admin/src/pages/settings/FeesSection.tsx`
- `client-admin/src/pages/settings/FeesSection.test.tsx`
- `client-admin/src/pages/SchoolSettingsPage.tsx` — `academics` case: drop the `<div id="attendance-section">` wrapper (also changed by settings-1a / 1b, run earlier)
- `client-admin/src/pages/SchoolSettingsPage.test.tsx` — preset tests (also changed by settings-1a)
- `client-admin/src/routes/_staff/settings.tsx` — add `'feeStructures'` to `loadRouteNamespaces` (also changed by settings-1a)
- `ui/src/i18n/locales/en/settings.json`, `ui/src/i18n/locales/bn/settings.json` (also changed by settings-1a / 1b)

## Steps
1. **Read first:** `client-admin/src/pages/settings/settings-layout.tsx` (built by 1a: `SettingsSection`, `SettingsSaved`) and how 1b converted `RegionalSection.tsx` — follow the same shape. The mockups are `PLAN/pages/settings/settings_academics-finance/mockup.html` and `…/finance/mockup.html`. Also read patterns.md §4 (DataTable look, TableCount, RowActions colours), §6, §7 (ConfirmDialog).

2. **`AttendanceSection.tsx`.**
   - `SettingsSection id="attendance-section" title={t('attendance.legend')} description={t('attendance.description')} onSubmit saving footerStart` (1b's pattern). Remove `FormShell`, `FormSection` and `buildFormShellErrors`.
   - Weekly off: `<fieldset className="mt-4"><legend className="text-label text-text-primary">` + `<div className="mt-1.5 grid grid-cols-2 gap-x-4 md:flex md:flex-wrap md:gap-x-6">`. Each day is a Checkbox row (`flex min-h-11 items-center gap-3 md:min-h-8`, the whole row is the label).
   - `lateAfter`, `absentAfter`, `autoAbsentCutoffTime`: `<TimeInput value={field.value} onValueChange={field.onChange} />` (`@biddaloy/ui`). Keep the ids on the trigger.
   - `correctionWindowDays` and `lowAttendanceThresholdPercent` keep `Input`, with `inputMode="numeric"` and help `attendance.correctionWindowHelp` / `attendance.lowAttendanceHelp` (`aria-describedby`).
   - `percentageDenominator` → `Select` (`md:col-span-2`). The 3 checkboxes go full width (`md:col-span-2`).
   - Sub-heading `<h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">{t('attendance.autoAbsentLegend')}</h3>`, then the auto-absent checkbox and the cutoff `TimeInput`.
   - Replace the inline confirm (`:410-430`) with `<ConfirmDialog open={confirmingAutoAbsent} onOpenChange={setConfirmingAutoAbsent} title={t('attendance.confirmEnableNotificationTitle')} description={t('attendance.confirmEnableNotificationDescription')} confirmLabel={t('attendance.confirmEnableNotificationConfirm')} cancelLabel={t('attendance.confirmEnableNotificationCancel')} onConfirm={() => handleConfirmAutoAbsent(field.onChange)} />`. Keep `handleAutoAbsentChange` / `handleConfirmAutoAbsent` as they are.

3. **`EvaluationsSection.tsx`.**
   - `SettingsSection title={t('evaluations.legend')} description={t('evaluations.description')}`; body `mt-4 flex flex-col gap-3`: the checkbox row, help `incidentSmsHint` + `pushAlwaysOn` in one `text-caption text-text-secondary` paragraph.
   - Then `<div className="flex flex-col gap-2 rounded-md bg-muted p-3 md:flex-row md:items-center md:justify-between">` with `<StatusBadge tone={smsConfigured ? 'success' : 'warning'} label={t(smsConfigured ? 'evaluations.providerReady' : 'evaluations.providerNotConfigured')} />`. When `!smsConfigured`, add `<Link to="/settings" search={{ section: 'communication' }} className="inline-flex h-11 items-center gap-1 rounded-md px-2 font-medium text-primary hover:bg-surface md:h-8"><ArrowRightIcon className="size-4" />{t('evaluations.openSmsSettings')}</Link>`.
   - When the toggle is on and `!smsConfigured`, keep today's `role="alert"` line (`providerMissingWarning`) under the box with the Error text classes (`flex items-center gap-1 text-caption text-destructive` + `CircleAlertIcon size-3.5`).
   - Drop the old `providerConfigured` sentence render; leave the key in place.

4. **`AcrCriteriaSection.tsx`** (namespace `evaluations` — use only the existing keys listed here).
   - The outer `section` + `h2` (`:61-64`) becomes `SettingsSection title={t('acr.criteriaSettings.title')} description={t('acr.criteriaSettings.description')} badge={<StatusBadge tone="info" label={t('acr.criteriaSettings.version', { version })} />} onSubmit saving saveLabel={t('acr.criteriaSettings.save')} footerStart={…}`.
   - `footerStart` = the outline add button (`PlusIcon` + `acr.criteriaSettings.add`, `w-full md:w-auto`) + the saved / error lines.
   - The load error and loading branches render inside the card (`ErrorState`; skeleton rows `h-10`).
   - `appliesToNewOnly`: `<p className="mt-3 flex items-start gap-2 text-caption text-text-secondary"><InfoIcon className="mt-0.5 size-4 shrink-0" />…</p>`.
   - **Desktop** (`hidden md:block`): a bordered table in the DataTable look (`overflow-hidden rounded-lg border border-border-subtle`; `thead border-b border-border-subtle bg-muted text-label text-text-secondary`; `th h-10 px-4 font-medium text-start`; `tbody divide-y divide-border-subtle`; `td px-4 py-1.5`).
     - Columns: code `Input w-16` (`th w-24`); part `Select` (`th w-56`, options `block2` / `block3`); `labelBn` `Input`; `labelEn` `Input`; actions (`th w-32 text-end`, header = the common actions key DataTable uses for "কাজ").
     - Every input/select has an `sr-only` `<label>` with the column name. Keep the ids the current inputs use.
     - Actions: `Button variant="ghost" size="icon"` + `Tooltip` — `ArrowUpIcon` (`moveUp`, `text-text-secondary`, disabled on the first row), `ArrowDownIcon` (`moveDown`, disabled on the last), `CircleMinusIcon` (`remove`, `text-destructive`). `aria-label` = label + ": " + code.
     - Footer `border-t border-border-subtle px-4 py-3` with `<TableCount total={rows.length} />`.
   - **Phone** (`md:hidden`): `<ul className="mt-4 space-y-3">`. Each `<li className="rounded-lg border border-border-subtle">` holds `grid grid-cols-3 gap-4 p-4`: code (1 col), part (`col-span-2`), `labelBn` (`col-span-3`), `labelEn` (`col-span-3`), each with a visible Label. Then the action row `flex items-center border-t border-border-subtle px-1` with the 3 actions as `inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-label font-medium hover:bg-muted` + colour, label visible. Then `TableCount` under the list.
   - Validation and the unsaved-changes blocker stay as they are; the validation error shows as the Error text line above the footer.

5. **`PresetLinkCard.tsx`.**
   - `<section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">` (or `Card padded` + those layout classes). `<h2 className="text-h2">{t('settingsLink.title')}</h2>`, state `mt-0.5 text-text-secondary`.
   - The link becomes `<Link to="/curriculum-preset" className={buttonVariants({ variant: 'outline' })}>` with the text `settingsLink.open` + `ArrowRightIcon size-4`. If `buttonVariants` is not exported, use the Button outline class string from patterns.md §1.
   - Name: `const { data: presets } = usePresetList(); const pick = usePickText(); const name = data?.preset ? (presets?.find((p) => p.id === data.preset!.id)?.name) : undefined;` then `t('settingsLink.applied', { id: name ? pick(name) : data.preset.id, name: name ? pick(name) : data.preset.id, version: data.preset.version })`. Passing both `id` and `name` keeps it right before and after the admin lane changes that string (shared request).

6. **`FeesSection.tsx`.**
   - `SettingsSection title={t('fees.title')} description={t('fees.description')} onSubmit saving footerStart`.
   - Sub-heading `fees.approvalLegend` (`mt-4 text-h3`, no border), then `mt-4 grid gap-4 md:grid-cols-2` holding the `approvalMode` `Select` + help `fees.approvalModeHelp`.
   - Sub-heading `fees.notifyLegend` (`mt-6 border-t … pt-4`), then the 2 checkbox rows in `mt-2 flex flex-col`.
   - Sub-heading `fees.lateFeeLegend`, then `<p className="mt-1 text-text-secondary">{t('fees.lateFeeIntro')} {t('fees.lateFeeAppliesFromTomorrow')}</p>`.
   - Fee name everywhere: `t(`feeTypes.${type}`, { ns: 'feeStructures' })` — replaces `t(`feeType.${type}`, { ns: 'common', defaultValue: type })` (`:239`).
   - **Desktop** table (`hidden md:block`, same table classes as step 4). Columns: `fees.lateFeeType` (Checkbox row with the fee name), `lateFeeGraceDays` (`Input w-20`, `th w-32`), `lateFeeKind` (`Select`, `th w-56`), `lateFeeValue` (`Input w-24`, `th w-36`). When `watch(`lateFees.${type}.enabled`)` is false the three cells render `<span className="text-text-secondary">—</span>` instead of the controls. `sr-only` labels "<fee name>: <column>".
   - **Phone** (`md:hidden`): `<ul className="mt-2 divide-y divide-border-subtle">`. Each `<li className="flex flex-col">` has the checkbox row; when enabled, add `<div className="grid grid-cols-2 gap-3 pb-3">`: kind `Select` (`col-span-2`), grace `Input`, value `Input`, each with a visible Label.

7. **`SchoolSettingsPage.tsx`.** In the `academics` case render `<AttendanceSection …/>` without the wrapper `div` (it now carries `id="attendance-section"`).

8. **`routes/_staff/settings.tsx`.** `loadRouteNamespaces('settings', 'backup', 'bulkImport', 'evaluations', 'feeStructures')` and extend the comment by one line (why `feeStructures`).

9. **i18n `settings.json`, en + bn.**
   - Change:
     - `attendance.autoAbsentLegend` → "Automatic absence message" / "অনুপস্থিতির স্বয়ংক্রিয় বার্তা"
     - `evaluations.incidentSmsHint` → "The SMS says only that a new report exists, never what it says." / "এসএমএসে শুধু জানানো হয় যে একটি নতুন প্রতিবেদন আছে, প্রতিবেদনে কী লেখা আছে তা কখনও নয়।"
     - `evaluations.providerMissingWarning` → "Incident SMS will not be sent until an SMS provider is set up in Communication." / "যোগাযোগ বিভাগে এসএমএস প্রোভাইডার ঠিক না করা পর্যন্ত ঘটনার এসএমএস যাবে না।"
     - bn `fees.lateFeeAppliesFromTomorrow` → "পরিবর্তন আগামীকালের ফি বিল থেকে কার্যকর হবে।" (en already fixed by 31.3.4b)
   - Add:
     - `attendance.description` "When a student counts as late or absent, and how the attendance rate is worked out." / "কখন দেরি বা অনুপস্থিত ধরা হবে, আর উপস্থিতির হার কীভাবে গোনা হবে।"
     - `attendance.correctionWindowHelp` "Past attendance can be corrected for this many days." / "এত দিন পর্যন্ত আগের উপস্থিতি ঠিক করা যায়।"
     - `attendance.lowAttendanceHelp` "Below this a student is shown as low attendance." / "এর নিচে নামলে শিক্ষার্থীকে কম উপস্থিতি হিসেবে দেখানো হয়।"
     - `attendance.confirmEnableNotificationTitle` "Turn on automatic absence messages?" / "অনুপস্থিতির স্বয়ংক্রিয় বার্তা চালু করবেন?"
     - `evaluations.description` "Who is told, and how, when a new incident report is filed." / "নতুন ঘটনার প্রতিবেদন জমা হলে কাকে কীভাবে জানানো হবে।"
     - `evaluations.providerReady` "SMS provider is set up" / "এসএমএস প্রোভাইডার ঠিক করা আছে"
     - `evaluations.openSmsSettings` "Communication › set up SMS" / "যোগাযোগ › এসএমএস ঠিক করুন"
     - `fees.title` "Fee rules" / "ফির নিয়ম"
     - `fees.description` "Approval, telling families and late fees — for every fee bill." / "অনুমোদন, পরিবারকে জানানো আর বিলম্ব ফি — সব ফি বিলে প্রযোজ্য।"
     - `fees.approvalModeHelp` "How an admin confirms once more before sensitive changes, such as changing late fees." / "স্পর্শকাতর কাজের আগে (যেমন বিলম্ব ফি বদলানো) আরেকবার নিশ্চিত করার পদ্ধতি।"
     - `fees.lateFeeIntro` "Tick the fees that get a late fee." / "যে ফিতে বিলম্ব ফি লাগবে সেটি বেছে নিন।"
     - `fees.lateFeeType` "Fee type" / "ফির ধরন"

## Tests
- `AttendanceSection.test.tsx:97`: enabling auto-absent opens `getByRole('alertdialog')`; confirming checks the box; cancelling leaves it unchecked. `:42` "renders the current values": the late-after trigger shows "8:15 AM" (en).
- `EvaluationsSection.test.tsx:30`: without a provider a warning badge "No SMS provider is set up." and a link to `/settings?section=communication` render; with a provider the "SMS provider is set up" badge renders; the `role="alert"` text is the new copy.
- `AcrCriteriaSection.test.tsx`: the version badge text "Version 1"; a "Total 25"-style count for the fixture; move-up on the first row is disabled; the save payload is unchanged.
- `FeesSection.test.tsx:35`: the row reads "Monthly tuition" (not `MONTHLY_TUITION`); an unchecked row has no grace-days input; checking it shows one; the `:59` payload test stays green (it must check the row first if it fills inputs).
- `SchoolSettingsPage.test.tsx:216` "shows the preset id and version when APPLIED" → "shows the preset name…": mock `GET /presets` with the applied id and assert the name.

## Acceptance
- [ ] Desktop at 1440 px matches both "after" screenshots (Academics, Finance).
- [ ] Mobile at 390 px matches both "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per card.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No `MONTHLY_TUITION`-style text and no preset id anywhere on the two categories.
- [ ] Times read "সকাল ৮:১৫" (D7); no native time input remains.
- [ ] The ACR list on desktop is a table with a total; the page is far shorter than today's ~5 000 px.
- [ ] No text says "above"; the evaluations link opens Communication.

## Out of scope
- Typed numbers inside inputs stay in Latin digits (needs a numerals-aware number input — shared request).
- `curriculumPreset:settingsLink.applied` still has an `{{id}}` slot — wording fix filed as a shared request to the admin lane.
- The ACR unsaved-changes dialog keeps its look (already a dialog).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| curriculumPreset.json settingsLink.applied without {{id}} | Accepted | 31.3.4b | value becomes "প্রয়োগ করা হয়েছে: {{name}} · {{version}}"; pass name (id may still be passed, unused) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: settings   Decisions: D6, D7, D9, D19, D25, D27, D29, D30   Depends on: 31.3.8b, 31.4.settings-1b
