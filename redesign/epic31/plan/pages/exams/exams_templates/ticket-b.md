# [31.4.exams-3b] Exam structure detail — save in header, one class at a time

## Goal
`/exams/templates/$templateId` opens with a kit detail header (name, an "unsaved" badge when there are changes, facts, Save as the one primary) and an editor that shows one class at a time in line tabs, one Card per subject with labelled part rows, so a long structure stays usable on desktop and phone. Part **b**; runs after `ticket.md` (exams-3a).

## What and why
The admin opens a structure to type, for each class and subject, the parts of the exam and their full and pass marks. Today the page has a tab strip with a single tab, an inline rename form at the top, every class and subject stacked on one endless page, the only Save button at the very bottom (out of sight once the list is long), subject names in English as "BAN — Bangla", a bare number box to add a class, and server text in errors. The redesign moves Save and Discard into the header, shows whether changes are unsaved, splits classes into tabs, puts each subject in a Card with clearly labelled rows (stacked fields on phone), and moves rename into a small dialog.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates_templateId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates_templateId/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates_templateId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates_templateId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `DetailShell` without `tabs`: name `h1`; **New** `StatusBadge tone="warning"` "সংরক্ষণ হয়নি" while the editor has unsaved changes; `facts`: ধরন · শ্রেণি ("৬, ৭, ৮") · মোট বিষয় ("২৮টি") · মোট অংশ ("৬৪টি") — computed from the saved rows. | D16, D27 — state visible; the single "উপাদান" tab added nothing |
| 2 | Header actions | Primary "সংরক্ষণ করুন" (`save`, disabled until there are changes, `busy` while saving) · outline "পরিবর্তন বাতিল" (`rotate-ccw`, only while dirty) · More: "নাম ও ধরন বদলান" (opens `TemplateFormDialog mode="edit"` from exams-3a). Remove the inline rename form and the bottom Save/Discard row. | D16, D29 — the one primary is visible without scrolling |
| 3 | Class tabs | **New** kit line tabs, one per class grade ("শ্রেণি ৬"), selected grade in `?grade=` (default: lowest). A trailing ghost button "শ্রেণি যোগ করুন" (`plus`) in the tab row opens a `Dialog size="sm"` with one field "শ্রেণির নম্বর" (1–99, help "যেমন ৯") → adds the tab and selects it. Replaces the number box at the bottom. | Only the class being edited is on screen; D20 |
| 4 | Panel intro | One line: "শ্রেণি ৬-এর ১০টি বিষয় · প্রতিটি বিষয়ের অংশের পূর্ণমান আর পাস নম্বর দিন। শেষে উপরের “সংরক্ষণ করুন” চাপুন।" | Tells the user where Save is |
| 5 | Subject block | One Card per subject: name `text-h3` in the UI language (`subjectLabel`, exams-2a), caption "কোড BAN · ২টি অংশ · মোট পূর্ণমান ১০০"; ghost destructive "বিষয় সরান" (`circle-minus`) on the right. | D9 — "BAN — Bangla" mixed code and English name |
| 6 | Part rows | Desktop: a header band (অংশের নাম · ধরন · পূর্ণমান · পাস নম্বর · কাজ) and one grid row per part (`md:grid-cols-12`: 4/3/2/2/1); numbers right-aligned; remove = destructive icon button "অংশ সরান" with tooltip. Phone: the same row stacks — name, type full width, full + pass side by side, each with its visible label, then a labelled "অংশ সরান". Under the rows a ghost "অংশ যোগ করুন" (`plus`). Enter in a row's last field still appends a part; Esc still discards. | D19, D25 — the table of bare inputs did not fit a phone |
| 7 | Numbers | Inputs show saved marks in the tenant's digits ("৭০") and accept Bangla or Latin digits; totals use `formatNumber`. | D6 |
| 8 | Add subject | Card "শ্রেণি ৬-এ বিষয় যোগ করুন": `FormField` "বিষয়" + Select (placeholder "বাছুন", subjects not yet in this class, `subjectLabel`) + outline "বিষয় যোগ করুন". | D25 |
| 9 | Errors | Per-field errors as today but with the kit error classes; "fix the highlighted fields" line shows above the first Card of the selected class and the tabs of classes with errors get a `circle-alert` icon; a failed save shows `detail.saveError`, never the server text. | D9; an error in another tab must be findable |
| 10 | States | Loading → header + Card skeleton (`aria-busy`); load error → `ErrorState` with Retry; a structure with no classes → `EmptyState` (`file-stack`) "এখনো কোনো শ্রেণি নেই" + "শ্রেণি যোগ করে বিষয় ও অংশ দিন।" + outline "শ্রেণি যোগ করুন". | D28 |

## Mobile behaviour
- Header: crumbs (last two), name + badge, facts as a 2-column grid, then primary full width + More (Discard moves into More).
- Tab row scrolls sideways; "শ্রেণি যোগ করুন" is its last item.
- Part rows stack with visible labels (no table); every control `h-11`.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where Save lives | bottom of the grid / sticky bar / header | header primary | Visible without scrolling on any length (D16); no fixed bar to fight the phone bottom nav. |
| How the header reaches the grid's draft | lift all state / imperative handle | `ref` with `useImperativeHandle({ save, discard })` + `onStateChange({ dirty })` | Smallest diff to a 500-line component that already owns its draft and validation. |
| Show all classes / one at a time | one long page / tabs per class | tabs per class, `?grade=` | A full structure is 5 classes × 10 subjects × 2–3 parts; one class is what is edited at a time. The draft still spans all classes and Save sends everything. |
| Rename | inline form / dialog | dialog from More (name + type) | Rare action; `PATCH` already accepts `kind`. |
| Digits in inputs | Latin only / tenant digits | tenant digits, both accepted | D6; a Bangla keyboard types ০–৯ and today's regex rejects them. |
| Remove a whole class | add a button / leave as today | leave | Removing all its subjects removes the class on save, as today (D1). |

## Files
- `client-admin/src/routes/_staff/exams/templates/$templateId.tsx` — `validateSearch` for `grade`
- `client-admin/src/routes/_staff/exams/-template-detail.tsx` — header, facts, badge, actions, rename dialog, states
- `client-admin/src/routes/_staff/exams/-template-detail.test.tsx`
- `client-admin/src/routes/_staff/exams/-template-grid.tsx` — tabs, subject Cards, part rows, add-class dialog, imperative handle, digits
- `client-admin/src/routes/_staff/exams/-template-grid.test.tsx`
- `client-admin/src/routes/_staff/exams/-template-grid.stories.tsx` — props follow the new API
- `ui/src/i18n/locales/{en,bn}/examTemplates.json` — keys below (also changed by exams-3a, runs earlier)
- `e2e/keyboard/exam-templates.spec.ts` — grade dialog, header Save

Used, not changed: `-template-form-dialog.tsx` (edit mode from exams-3a), `-detail/subject-label.ts` (exams-2a), `client-admin/src/components/PresetWarningBanner.tsx` (kept above the tabs, same gate).

## Steps
1. **Locale `examTemplates.json` (en + bn).** `detail`: delete `tabComponents`, `nameLabel`, `rename`, `loading`; add `unsaved` "Not saved" / "সংরক্ষণ হয়নি"; `save` "Save" / "সংরক্ষণ করুন"; `discard` "Discard changes" / "পরিবর্তন বাতিল"; `editName` "Change name and type" / "নাম ও ধরন বদলান"; `moreActions` "More actions" / "আরও অ্যাকশন"; `facts.kind` "Type" / "ধরন"; `facts.grades` "Classes" / "শ্রেণি"; `facts.subjects` "Subjects" / "মোট বিষয়"; `facts.parts` "Parts" / "মোট অংশ"; `facts.count` "{{count}}" / "{{count}}টি"; `noGradesTitle` "No classes yet" / "এখনো কোনো শ্রেণি নেই"; `noGradesText` "Add a class, then its subjects and parts." / "শ্রেণি যোগ করে বিষয় ও অংশ দিন।"; `saving` "Saving…" / "সংরক্ষণ হচ্ছে…"; `grid`: `gradeHeading` → "Class {{grade}}" / "শ্রেণি {{grade}}" (tab label); `gradeLabel` → "Class number" / "শ্রেণির নম্বর"; add `gradeHelp` "1 to 99, e.g. 9" / "১ থেকে ৯৯, যেমন ৯"; `addGrade` → "Add class" / "শ্রেণি যোগ করুন"; `addGradeTitle` "Add a class" / "শ্রেণি যোগ করুন"; `gradesLabel` "Classes" / "শ্রেণি" (tablist label); `intro` "{{count}} subjects in class {{grade}} · enter full and pass marks for each part. Press “Save” at the top when done." / "শ্রেণি {{grade}}-এর {{count}}টি বিষয় · প্রতিটি বিষয়ের অংশের পূর্ণমান আর পাস নম্বর দিন। শেষে উপরের “সংরক্ষণ করুন” চাপুন।"; `subjectCaption` "Code {{code}} · {{count}} parts · full marks {{marks}}" / "কোড {{code}} · {{count}}টি অংশ · মোট পূর্ণমান {{marks}}"; `addSubjectTitle` "Add a subject to class {{grade}}" / "শ্রেণি {{grade}}-এ বিষয় যোগ করুন"; `subjectLabel` "Subject" / "বিষয়"; `subjectPlaceholder` → "Select" / "বাছুন"; `columnName` → "Part name" / "অংশের নাম"; `columnKind` → "Type" / "ধরন"; `columnActions` → "Actions" / "কাজ"; `addComponent` → "Add part" / "অংশ যোগ করুন"; `removeRowShort` → "Remove part" / "অংশ সরান"; `removeRow` → "Remove part {{row}} of {{subject}}, class {{grade}}" / "অংশ সরান — {{subject}}, শ্রেণি {{grade}}, সারি {{row}}"; `gradeHasErrors` "Class {{grade}} has errors" / "শ্রেণি {{grade}}-এ ভুল আছে"; delete `empty`, `discard`, `save` (moved to `detail`). `grid.error.*`: wording keeps the "অংশ" swap from exams-3a; `noComponents` → "Add at least one part, or remove this subject." / "অন্তত একটি অংশ যোগ করুন, অথবা এই বিষয়টি সরিয়ে দিন।".
2. **`$templateId.tsx`.** `validateSearch: z.object({ grade: z.coerce.number().int().min(1).max(99).optional().catch(undefined) })`; pass `grade` and `onGradeChange={(g) => navigate({ search: { grade: g }, replace: true })}` to `TemplateDetail`.
3. **`-template-grid.tsx` — API.** Make it `function TemplateGrid({ ref, rows, subjects, selectedGrade, onGradeChange, onStateChange, onSave, saving, error })` (React 19 ref prop). `useImperativeHandle(ref, () => ({ save, discard }))`; `useEffect(() => onStateChange?.({ dirty }), [dirty])`. Remove the bottom Save/Discard row and the bottom grade input. `subjects` items become `{ code, label }` (the caller passes `subjectLabel(s, i18n.language)`).
4. **`-template-grid.tsx` — tabs.** `grades` as today. `const active = grades.includes(selectedGrade) ? selectedGrade : grades[0]`. `Tabs` (kit line variant) `value={String(active)}` with one `TabsTrigger` per grade (label `gradeHeading` with `formatNumber`; when `attempted` and that grade has an invalid block, append `<CircleAlert className="size-4 text-destructive" aria-label={t('grid.gradeHasErrors', { grade })} />`) and, after the list inside the same scrolling row, a ghost button `inline-flex h-11 shrink-0 items-center gap-1.5 px-3 font-medium text-primary hover:bg-muted md:h-10` "শ্রেণি যোগ করুন". It opens `Dialog`/`DialogContent size="sm"` with `FormField` `gradeLabel` + `Input inputMode="numeric"` + help `gradeHelp` + `grid.error.gradeInvalid` under it; confirm adds the grade (existing `addGrade` logic, after digit normalisation) and calls `onGradeChange(n)`. Only the active grade's panel renders. No grades → `EmptyState` per Change 10 whose action opens the same dialog.
5. **`-template-grid.tsx` — panel.** `space-y-6`: intro `p text-text-secondary` (`grid.intro`, counts through `formatNumber`), then one Card per block of the active grade: `section rounded-lg border border-border-subtle bg-surface shadow-e1 overflow-hidden`; head `flex items-start justify-between gap-3 p-4 md:px-5 md:pt-5 md:pb-4` with `h3 text-h3` subject label (fallback `row.subjectName`, then `subjectCode`) + `p text-caption text-text-secondary` `subjectCaption` (marks = sum of valid `full` of the block, `formatNumber`), and the ghost destructive button `inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-label font-medium text-destructive hover:bg-muted md:h-8` "বিষয় সরান" (keep `removeSubject` as its `aria-label`). Desktop header band `hidden h-10 grid-cols-12 items-center gap-4 border-y border-border-subtle bg-muted px-4 text-label text-text-secondary md:grid` (4/3/2/2/1, numbers `text-right`). Rows container `divide-y divide-border-subtle border-t border-border-subtle px-4 md:border-t-0 md:px-0`; each row `grid grid-cols-2 gap-3 py-3 md:grid-cols-12 md:items-center md:gap-4 md:px-4 md:py-2`: name `col-span-2 md:col-span-4`, kind `col-span-2 md:col-span-3`, full `md:col-span-2`, pass `md:col-span-2`, remove `col-span-2 flex justify-end md:col-span-1`. Each field = `FormField` whose label is `text-label md:sr-only` (visible on phone, still the accessible name on desktop — keep `cellLabel` as `aria-label` so the e2e names stay); controls use the Control classes; full/pass add `text-right tabular-nums`. Remove button: `inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-label font-medium text-destructive hover:bg-muted md:size-8 md:px-0` + `CircleMinus` + `<span className="md:sr-only">{t('grid.removeRowShort')}</span>`, tooltip on desktop. Footer `border-t border-border-subtle px-2 py-1 md:px-3` ghost `text-primary` "অংশ যোগ করুন". Errors under the field: kit error text classes, control `border-destructive`. Then the add-subject Card per Change 8 (`grid gap-4 md:grid-cols-12 md:items-end`, field `md:col-span-5`, button outline `w-full md:w-auto`). The `fixErrors` line (`role="alert"`, kit error text) sits above the first Card when `attempted && invalid`; the server error line is gone (the header owns it).
6. **`-template-grid.tsx` — digits.** `const toLatin = (s: string) => s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));` apply in `validateBlock` and `save` before `MARKS_RE` / `Number()`; `toDraft` writes `toTenantDigits(String(c.full))` where `toTenantDigits` maps 0–9 → ০–৯ only when `config.numerals` is Bengali (no grouping, so the regex still matches). One small test in `-template-grid.test.tsx` covers "৭০" → 70.
7. **`-template-detail.tsx`.** `const gridRef = useRef<TemplateGridHandle>(null)`, `const [dirty, setDirty] = useState(false)`, `const [editOpen, setEditOpen] = useState(false)`. `DetailShell` props: `name`, `statusBadge={dirty ? <StatusBadge tone="warning" label={t('detail.unsaved')} /> : undefined}`, `facts` per Change 1 (grades sorted, `formatNumber`; subjects = `rows.length`; parts = sum of `components.length`), `actions`: `{ id: 'discard', label: t('detail.discard'), icon: <RotateCcw />, priority: 'secondary', allowed: dirty, onClick: () => gridRef.current?.discard() }`, `{ id: 'save', label: t('detail.save'), icon: <Save />, priority: 'primary', disabled: !dirty, busy: update.isPending && update.variables?.rows !== undefined, onClick: () => gridRef.current?.save() }` (`disabled` / `busy` on `PageAction` are a shared request; if refused, use `allowed: dirty || isSaving` and show the badge label `detail.saving` "সংরক্ষণ হচ্ছে…" / "Saving…" with tone `info` while saving), `{ id: 'edit', label: t('detail.editName'), priority: 'tertiary', onClick: () => setEditOpen(true) }`. No `tabs`. Body: `PresetWarningBanner` (same gate) then `TemplateGrid` (`subjects` mapped with `subjectLabel(s, i18n.language)`, `selectedGrade`, `onGradeChange`, `onStateChange={({ dirty }) => setDirty(dirty)}`, `error={update.isError && update.variables?.rows ? t('detail.saveError') : null}`), and `TemplateFormDialog mode="edit" initial={{ id, name, kind }}`. Loading: skeleton (`aria-busy="true"`; bars `h-7 w-64`, three `h-3 w-24`, one Card `h-40`). Error: `ErrorState message={t('detail.loadError')} onRetry={() => void query.refetch()}`. Remove the rename state and form.
8. **`-template-grid.stories.tsx`.** Update args to the new props (`subjects` with `label`, `selectedGrade`, `onGradeChange`, `onStateChange`); one story with two grades, one empty.
9. **`e2e/keyboard/exam-templates.spec.ts`.** Replace "type grade in `grid.gradeLabel` + `grid.addGrade`" with: Tab to the button `grid.addGrade`, Enter, type the grade in the dialog field `grid.gradeLabel`, Enter. Subject picker: label `grid.subjectLabel` inside the add-subject Card, button `grid.addSubject`. Save: Tab to the header button `detail.save` (was `grid.save`). Cell names (`grid.cellLabel`) are unchanged.
10. Run `pnpm --filter client-admin test exams/-template`, `yarn workspace @biddaloy/ui check:i18n`, then `graphify update .`.

## Tests
- `-template-detail.test.tsx` — no tab strip; facts show ধরন, শ্রেণি "৬, ৭", মোট বিষয়, মোট অংশ; Save is the only filled button and is disabled until a field changes; after a change the "সংরক্ষণ হয়নি" badge and "পরিবর্তন বাতিল" appear; Save sends the whole row set; More → "নাম ও ধরন বদলান" opens the dialog; a failed save shows `detail.saveError`.
- `-template-grid.test.tsx` — keep the validation tests (`validateBlock`); only the selected grade's subjects render; adding a grade through the dialog selects its tab; an invalid block in another grade marks that tab with the error icon after a save attempt; Enter in the last pass field appends a part; Bangla digits validate.
- `e2e/keyboard/exam-templates.spec.ts` — as in Step 9.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Save is in the header and visible without scrolling; unsaved changes show a badge.
- [ ] One class per tab, selected class in the URL; adding a class opens a small dialog.
- [ ] Subjects show their name in the UI language, not "CODE — English name".
- [ ] On phone every part field has a visible label and nothing scrolls sideways.

## Out of scope
- Warning when leaving the page with unsaved changes (needs a router blocker pattern the kit does not have yet).
- `PageAction` `disabled` / `busy` — filed in `shared-requests.md`; fallback in Step 7.
- Removing a whole class in one click, reordering parts (D1).
- UUID crumb (B16) — 31.3.5.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| PageAction / DetailShellAction disabled + busy | Accepted | 31.2.5a (type 31.1.2a) | actions={[{ id: 'save', label, onClick, priority: 'primary', disabled: !isDirty, busy: save.isPending }]} |

Wave: 9   Lane: exams   Decisions: D6, D9, D16, D19, D20, D25, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.exams-3a
