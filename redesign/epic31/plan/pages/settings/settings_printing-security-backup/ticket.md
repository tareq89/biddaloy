# [31.4.settings-4a] Settings — Printing and Sign-in categories redesigned

## Goal
The Printing category shows printers in a table with icon row actions and a calibration guide in plain words. The printer form stays a dialog: 4 fields on screen, with margins / shift / size under "মাপ ঠিক করা (উন্নত)". The Sign-in category is one `SettingsSection` with a help line.
(Split from settings-4. **4a** = Printing + Sign-in & security. **4b** (`ticket-b.md`, runs after 4a) = Backup.)

## What and why
Printing is where an admin adds the school's card and office printers and calibrates them. Today each printer row has three text buttons. Its details read "অফসেট X 1.5 মিমি, Y -0.5 মিমি" in Latin digits. The guide after a calibration print has a second filled button. Archiving uses a filled primary. The form shows 11 number boxes at once, though most people only need a name, a type and how the printer does two sides. This ticket gives the card a table with RowActions and plain words ("ডানে-বাঁয়ে সরান", not "অফসেট X"). It shows the four everyday fields in the dialog and folds the calibration numbers under an "Advanced" disclosure, which opens by itself from the calibration guide. The one-checkbox Sign-in card gets the kit card and a sentence that says what the switch does.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/before-mobile.webp?raw=true" width="260"> |
| After — Printing | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/mobile.webp?raw=true" width="260"> |
| After — printer dialog | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/printer-form/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/printer-form/mobile.webp?raw=true" width="260"> |

"Before" is the same single-column page as `admin__settings` (the printer and sign-in cards sit in its lower half). The dialog shot is a static picture of the open dialog (Advanced shown open); in the app it floats over the Printing category. Sign-in is not mocked: it is one card in the same `SettingsSection` shape as settings-1b's cards (step 6).

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Printers card | `SettingsSection id="printers-section"` with no Save. Filled "প্রিন্টার যোগ করুন" sits on the title row through the **New** `actions` slot. It is hidden while the list is empty, when the EmptyState's outline button is the only add action. | patterns §9; D29 |
| 2 | Printers list | `<ul>` of text-button rows → `DataTable paginated={false}`: নাম · ধরন · দুই পাশে ছাপা · সরানো (মিমি) · কাজ, footer "মোট ২টি". Phone: DataTable cards. | D19 |
| 3 | Row actions | "ক্যালিব্রেশন পাতা ছাপুন / সম্পাদনা / আর্কাইভ" text buttons → `RowActions`: print "মাপের পাতা ছাপুন", edit, archive. | D19 |
| 4 | Shift value | "অফসেট X 1.5 মিমি, Y -0.5 মিমি" → "ডানে-বাঁয়ে ১.৫ · ওপরে-নিচে −০.৫" through `formatNumber`. | D6, D32 |
| 5 | Calibration guide | Steps in plain words. `bg-muted` box with an `h3`. "সরানোর মাপ বদলান" is outline (was filled) and opens the dialog with Advanced already open. | D29; second filled button |
| 6 | Archive | Custom `Dialog` with a filled primary → `ConfirmDialog`. | D29 |
| 7 | Printer dialog | `size="md"`. Shown: নাম, প্রিন্টারের ধরন (selectable cards), দুই পাশে ছাপা (selectable cards), কাটার ফাঁক (office only). Under **New** "মাপ ঠিক করা (উন্নত)": margins, shift left–right, shift up–down, size, each with a range help. | D21 (≤ 6 visible fields keeps a dialog), D30 |
| 8 | Printer dialog labels | "অফসেট X / Y" → "ডানে-বাঁয়ে / ওপরে-নিচে সরান (মিমি)", "স্কেল" → "আকার", "মার্জিন" → "কাগজের কিনারায় ফাঁকা জায়গা". | D32 |
| 9 | Sign-in card | `SettingsSection id="signin-section"`. "লগ ইন অপশন" → "সাইন-ইনের উপায়" + description (**New**). The checkbox row is 44 px with a help line (**New**). | D32 (category says সাইন-ইন) |

## Mobile behaviour
- The add button is full width under the card description.
- Each printer is a DataTable card: name (title), type (subtitle), "দুই পাশে ছাপা" and "সরানো (মিমি)" fields, then the 3 actions with visible labels.
- The guide's two buttons are full width, one under the other.
- Dialog: one column. The type and duplex cards stack. The 4 margins sit 2 × 2. Footer: Save above Cancel (kit order), both full width.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Printer form: dialog or full page | FullPageShell (11 inputs) · dialog with Advanced | dialog `md`; 4 fields visible, 7 calibration numbers under a collapsed disclosure | D21 counts what the form asks for up front; most people never touch calibration; the guide opens Advanced directly |
| Where the add button sits | footer · inside the list · title row | title row, via a new `actions` prop on `SettingsSection` | the card has no Save, so the add action is the card's one primary; the backup card (4b) needs the same slot |
| Archive tone | danger · default | `ConfirmDialog tone="default"` | archive keeps print history; nothing is deleted |
| Offset words | X / Y · left–right / up–down | "ডানে-বাঁয়ে", "ওপরে-নিচে" | a clerk with a ruler thinks in directions, not axes |
| Type label in the table | add "(A4)" · existing `printers.type.*` | existing labels | the type help already says A4; no new key |
| Sign-in mockup | mock · describe | describe (step 6) | one checkbox in the standard card |

## Files
- `client-admin/src/pages/settings/settings-layout.tsx` — `SettingsSection` gets `actions?: React.ReactNode` (also changed by settings-1a, runs earlier)
- `client-admin/src/pages/settings/settings-layout.test.tsx` — one case for `actions` (also changed by settings-1a)
- `client-admin/src/pages/settings/PrintersSection.tsx`
- `client-admin/src/pages/settings/printer-form-dialog.tsx`
- `client-admin/src/pages/settings/PrintersSection.test.tsx`
- `client-admin/src/pages/settings/PrintersSection.stories.tsx` — keep the stories rendering (empty / list / error)
- `client-admin/src/pages/settings/SignInSection.tsx`
- `client-admin/src/pages/settings/SignInSection.test.tsx`
- `ui/src/i18n/locales/en/settings.json`, `ui/src/i18n/locales/bn/settings.json` (also changed by settings-1a / 1b / 2 / 3, which run earlier)

## Steps
1. **Read first:** `settings-layout.tsx` (settings-1a) and one converted section from settings-1b / settings-3. The mockups are `PLAN/pages/settings/settings_printing-security-backup/mockup.html` and `…/printer-form/mockup.html`. Patterns: §4 DataTable (unpaginated), RowActions; §6; §7 Dialog, ConfirmDialog; §9.

2. **`settings-layout.tsx` — `actions` slot.** Add `actions?: React.ReactNode` to `SettingsSectionProps`. When set, wrap the title block (title row + description) and the actions: `<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6"><div className="min-w-0">{title row}{description}</div><div className="flex shrink-0 flex-col gap-2 md:flex-row">{actions}</div></div>`. Without `actions` the markup stays as it is. Document it in the JSDoc: "a header action for a card with no Save (e.g. Add printer); it is then the card's one primary".

3. **`PrintersSection.tsx`.**
   - Keep `if (!canManage) return null`, `handleCalibrate`, `CR80_MM` / `A4_MM` and `confirmArchive`.
   - Root: `<SettingsSection id="printers-section" title={t('printers.title')} description={t('printers.explainer')} actions={printers.length > 0 ? <Button type="button" className="w-full md:w-auto" onClick={() => openDialog(null)}><PlusIcon />{t('printers.add')}</Button> : undefined}>`.
   - Error: `<ErrorState message={t('printers.loadError')} onRetry={() => void printersQuery.refetch()} />`. Empty (not pending): today's `EmptyState` (its action is outline after the foundation change). Otherwise:
     ```tsx
     <DataTable tableId="printers" caption={t('printers.listCaption')} paginated={false}
       data={printers} getRowId={(p) => p.id} sorting={null} onSortingChange={() => undefined}
       loading={printersQuery.isPending} columns={columns}
       rowActions={(p) => [
         { intent: 'print', label: t('printers.calibrate'), onClick: () => handleCalibrate(p) },
         { intent: 'edit', label: t('printers.edit'), onClick: () => openDialog(p) },
         { intent: 'archive', label: t('printers.archive'), onClick: () => setArchiveTarget(p) },
       ]} />
     ```
     Columns:

     | id | header | value | card |
     |---|---|---|---|
     | `name` | `printers.columns.name` | `p.name` | `title` |
     | `type` | `printers.columns.type` | `t(`printers.type.${p.printer_type}`)` | `subtitle` |
     | `duplex` | `printers.columns.duplex` | `t(`printers.duplex.${p.duplex_order}`)` | `field` |
     | `offset` | `printers.columns.offset` | `t('printers.offsetValue', { x: formatNumber(p.offset_x_mm, rc), y: formatNumber(p.offset_y_mm, rc) })` (`rc = useRegionConfig()`) | `field` |

     Wrap the table in `<div className="mt-4">`.
   - Dialog state: `const [dialog, setDialog] = useState<PrinterRow | null | undefined>()` + `const [dialogAdvanced, setDialogAdvanced] = useState(false)`. `openDialog(p, advanced = false)` sets both.
   - Guide (`guideFor`): `<div role="status" className="mt-4 flex flex-col gap-2 rounded-md bg-muted p-4"><h3 className="text-h3">{t('printers.guide.title', { name })}</h3><ol className="list-decimal space-y-1 ps-5">…3 steps…</ol><div className="flex flex-col gap-2 md:flex-row">`. Inside: `<Button variant="outline" className="w-full md:w-auto" onClick={() => { openDialog(guideFor, true); setGuideFor(undefined); }}><PencilIcon />{t('printers.guide.editOffset')}</Button>` + `<Button variant="ghost" className="w-full md:w-auto">{t('printers.guide.close')}</Button>`.
   - Archive: replace the `Dialog` block with `<ConfirmDialog open={archiveTarget !== undefined} onOpenChange={(o) => !o && setArchiveTarget(undefined)} title={t('printers.archiveTitle')} description={t('printers.archiveConfirm', { name: archiveTarget?.name ?? '' })} confirmLabel={t('printers.archive')} cancelLabel={t('printers.form.cancel')} busy={archive.isPending} onConfirm={confirmArchive} />`.
   - `<PrinterFormDialog … printer={dialog ?? undefined} openAdvanced={dialogAdvanced} />`.

4. **`printer-form-dialog.tsx`.**
   - New prop `openAdvanced?: boolean`. `const advancedFields = ['margin_top_mm','margin_right_mm','margin_bottom_mm','margin_left_mm','offset_x_mm','offset_y_mm','scale'] as const; const hasAdvancedError = advancedFields.some((f) => form.formState.errors[f]);`.
   - `<DialogContent size="md">`. Keep the schema, `defaultsFor`, `handleTypeChange`, `onSubmit` unchanged.
   - `NumberField` gets `help?: string`, rendered as `<p id={`${name}-help`} className="text-caption text-text-secondary">` with `aria-describedby` on the input.
   - Body order inside the `<form className="flex flex-col gap-4" noValidate>`:
     1. `name` (required mark).
     2. `<fieldset><legend className="text-label text-text-primary">{t('printers.form.type')}</legend><RadioGroup className="mt-1.5 grid gap-2 md:grid-cols-2">`. Each option is a `<label htmlFor=…>` card: `flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border-subtle p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary`, with `RadioGroupItem` (`mt-0.5`), the label `font-medium` and the help `text-text-secondary`. Keep the ids `printer-type-${value}`.
     3. The duplex `fieldset` in the same card style (no help line), ids `printer-duplex-${value}`.
     4. `type === 'OFFICE'` → `<div className="grid gap-4 md:grid-cols-2">` with `sheet_gap_mm` (help `printers.form.gapHelp`).
     5. `<details className="group/adv border-t border-border-subtle pt-2" open={openAdvanced || hasAdvancedError || undefined}>`. Summary: same classes as `SettingsSection`'s advanced summary, text `printers.form.advanced`. Inside:
        - help `printers.form.advancedHelp` (`mt-2 text-caption text-text-secondary`);
        - `<fieldset className="mt-4">` legend `printers.form.margins`, grid `mt-1.5 grid grid-cols-2 gap-4 md:grid-cols-4` with the 4 margins;
        - `<div className="mt-4 grid gap-4 md:grid-cols-3">` with `offset_x_mm` (help `printers.form.offsetHelp`), `offset_y_mm` (same help), `scale` (help `printers.form.scaleHelp`).
     6. The save error (`role="alert"`, Error text classes `flex items-center gap-1 text-caption text-destructive` + `CircleAlertIcon size-3.5`).
     7. `DialogFooter`: Cancel (outline), Save (`printers.form.save`; keep `printers.form.saving` while pending).

5. **Phone check.** DataTable cards and `RowActions` come from the foundation. Nothing page-specific is needed beyond `w-full md:w-auto` on the buttons above.

6. **`SignInSection.tsx`.**
   - `<SettingsSection id="signin-section" title={t('signIn.legend')} description={t('signIn.description')} onSubmit={(e) => void form.handleSubmit(handleSave)(e)} saving={updateSettings.isPending} footerStart={<>{updateSettings.isSuccess && <SettingsSaved />}{updateSettings.isError && <MutationErrorMessage error={updateSettings.error} />}</>}>`.
   - Body `mt-4 flex flex-col gap-1`: the checkbox row `<div className="flex min-h-11 items-center gap-3 md:min-h-8">` (Checkbox `id="signin-otpLoginEnabled"` with `aria-describedby="signin-otpLoginEnabled-help"` + `Label`), then `<p id="signin-otpLoginEnabled-help" className="text-caption text-text-secondary">{t('signIn.otpLoginHelp')}</p>`.
   - Remove `FormShell`, `FormSection`, `buildFormShellErrors`. Keep `useFormShellMode()` and `useWarnUnsavedChanges`.

7. **i18n `settings.json`, en + bn.**
   - Change:
     - `printers.explainer` → "Pick the printer here when you print. Each printer prints a millimetre or two off — fix that with the measuring page." / "প্রিন্ট করার সময় এখান থেকে প্রিন্টার বাছবেন। প্রতিটি প্রিন্টার এক-দুই মিলিমিটার এদিক-ওদিক ছাপে — মাপ ঠিক করার পাতা দিয়ে সেটা ঠিক করুন।"
     - `printers.calibrate` → "Print measuring page" / "মাপের পাতা ছাপুন"
     - `printers.offsetValue` → "Left–right {{x}} · up–down {{y}}" / "ডানে-বাঁয়ে {{x}} · ওপরে-নিচে {{y}}"
     - `printers.guide.title` → "{{name}}: fix the measurements" / "{{name}}: মাপ ঠিক করুন"
     - `printers.guide.step1` → "On the printed page, measure from the top-left corner of the paper to the first cross. It should be exactly 20 mm." / "ছাপা পাতায় কাগজের ওপরের বাঁ কোণ থেকে প্রথম ক্রস চিহ্ন পর্যন্ত মাপুন। ঠিক ২০ মিমি হওয়ার কথা।"
     - `printers.guide.step2` → "Enter the difference in the printer's shift. A cross printed 1 mm too far right needs left–right −1." / "যত মিমি কম-বেশি হলো, প্রিন্টারের “সরানোর মাপ”-এ লিখুন। ক্রস ১ মিমি বেশি ডানে ছাপলে ডানে-বাঁয়ে −১ দিন।"
     - `printers.guide.editOffset` → "Change the shift" / "সরানোর মাপ বদলান"
     - `printers.form.margins` → "Blank edge of the paper (mm)" / "কাগজের কিনারায় ফাঁকা জায়গা (মিমি)"
     - `printers.form.offsetX` → "Shift left–right (mm)" / "ডানে-বাঁয়ে সরান (মিমি)"
     - `printers.form.offsetY` → "Shift up–down (mm)" / "ওপরে-নিচে সরান (মিমি)"
     - `printers.form.scale` → "Size" / "আকার"
     - `printers.form.gap` → "Cutting gap between cards (mm)" / "কার্ডের মাঝে কাটার ফাঁক (মিমি)"
     - `printers.form.save` → "Save" / "সংরক্ষণ করুন"
     - `printers.form.errors.offset` → "The shift must be between −10 and 10 mm." / "সরানো −১০ থেকে ১০ মিমির মধ্যে হতে হবে।"
     - `printers.form.errors.scale` → "Size must be between 0.90 and 1.10." / "আকার ০.৯০ থেকে ১.১০ এর মধ্যে হতে হবে।"
     - `signIn.legend` → "Ways to sign in" / "সাইন-ইনের উপায়"
     - `signIn.otpLoginEnabled` → "Allow sign-in with a code sent to the phone" / "ফোনে পাঠানো কোড দিয়ে সাইন-ইন করতে দিন"
   - Add:
     - `printers.listCaption` "Printers" / "প্রিন্টারের তালিকা"
     - `printers.columns.name` "Name" / "নাম"; `.type` "Type" / "ধরন"; `.duplex` "Both sides" / "দুই পাশে ছাপা"; `.offset` "Shift (mm)" / "সরানো (মিমি)"
     - `printers.form.advanced` "Measurements (advanced)" / "মাপ ঠিক করা (উন্নত)"
     - `printers.form.advancedHelp` "Usually left alone. Enter what the measuring page shows." / "সাধারণত বদলাতে হয় না। মাপ ঠিক করার পাতা ছেপে যা পাবেন তা এখানে লিখুন।"
     - `printers.form.offsetHelp` "−10 to 10" / "−১০ থেকে ১০"
     - `printers.form.scaleHelp` "1 = actual size (0.90 to 1.10)" / "১ = আসল মাপ (০.৯০ থেকে ১.১০)"
     - `printers.form.gapHelp` "Office printers only." / "শুধু অফিস প্রিন্টারে।"
     - `signIn.description` "How teachers, staff and guardians of this school sign in." / "এই স্কুলের শিক্ষক, কর্মী ও অভিভাবকেরা কীভাবে সাইন-ইন করবেন।"
     - `signIn.otpLoginHelp` "When on, people can sign in without a password using a code sent to their phone. When off, only the password works." / "চালু থাকলে পাসওয়ার্ড ছাড়াই ফোনে আসা কোড দিয়ে সাইন-ইন করা যায়। বন্ধ থাকলে শুধু পাসওয়ার্ড দিয়ে।"
   - The bn numerals inside the help strings (`−১০`, `১`) are fixed text. Run `yarn workspace @biddaloy/ui check:i18n`.

## Tests
- `settings-layout.test.tsx`: `SettingsSection` with `actions` renders the action next to the `h2`; without it the header has no extra wrapper.
- `PrintersSection.test.tsx`:
  - `:67` matches the new explainer (`/Pick the printer here/`).
  - `:75` the row shows "Left–right 1.5 · up–down -0.5"-style text through `formatNumber` (en). `:76` unchanged.
  - `:84/:107/:132`: with an empty list there is exactly one "Add printer" button (the EmptyState's); use `getByRole`.
  - `:85-92`: margins and "Cutting gap…" are found after opening "Measurements (advanced)" (the gap is outside it, the margins inside).
  - `:109-115`: the shift field is "Shift left–right (mm)"; an out-of-range value shows "The shift must be between −10 and 10 mm." and the disclosure is open.
  - `:151`: the calibrate button is "Print measuring page" (icon button with that accessible name). Add: "Change the shift" opens the dialog with the disclosure open.
  - Add: archive opens `getByRole('alertdialog')`; confirming calls `DELETE`/archive.
- `SignInSection.test.tsx`: `:50-53` unchanged (Save + "Saved"). Add: the help text is linked by `aria-describedby`.
- `client-admin/src/routes/_staff/print-routes.test.tsx:255` (`#printers-section`) must still pass.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots (Printing, dialog).
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per card / dialog (the guide has none; an empty list has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No "অফসেট", "ক্যালিব্রেশন", "স্কেল" or Latin-digit offset on the Printing category.
- [ ] The printer dialog opens with 4 fields; "মাপ ঠিক করা (উন্নত)" is closed for Add / Edit and open from the guide.
- [ ] Archiving asks in a `ConfirmDialog`.
- [ ] The palette action "প্রিন্টার" (`/settings#printers-section`) still lands on the printers card.

## Out of scope
- Number inputs keep Latin digits while typing (shared request filed by settings-1a for a numerals-aware input).
- The `/security` page (personal password, sessions) is not linked from this category; admin-4 owns it.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: settings   Decisions: D6, D19, D21, D25, D27, D29, D30, D32   Depends on: 31.3.8b, 31.4.settings-3
