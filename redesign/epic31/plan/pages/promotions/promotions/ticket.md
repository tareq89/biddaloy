# [31.4.promotions-1] Promotion lists + new list — status badges, full-page form

## Goal
`/promotions` and `/promotions/new` match the "after" screenshots: the list has a subtitle, status badges, names instead of ids, an eye action and a total; "নতুন প্রমোশন তালিকা" opens as a `FullPageShell` with three labelled section cards and the one primary in the footer.

## What and why
After results are published, an admin makes a promotion list for a class (who goes up, who stays, who leaves school), checks it and finalises it. Today the list's first column is an underlined link, status is plain text, a class or year that is not on the first page of classes shows its UUID, and the pager hides the total. The "new" form is a narrow page under the app chrome whose empty selects collapse to a tiny chevron with no placeholder, whose radio labels pack the explanation into brackets, and whose disabled primary looks like grey text. The redesign uses the kit list (badges, RowActions, TableCount) and turns the form into a full-page modal (D23 lists "new promotion run") with one card per question.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions/mobile.webp?raw=true" width="260"> |
| Before — new list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions_new/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions_new/before-mobile.webp?raw=true" width="260"> |
| After — new list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions_new/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions_new/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | List header | `PageHeader` title "প্রমোশন" + subtitle "ফলাফল দেখে শিক্ষার্থীদের পরের শ্রেণিতে তুলুন।" (**New**); primary "নতুন প্রমোশন তালিকা" (`plus`). | D16 |
| 2 | List columns | "শ্রেণি → নতুন শ্রেণি" (one key, plain bold text, no underline link), "নতুন শিক্ষাবর্ষ", "অবস্থা" = StatusBadge (খসড়া neutral, চূড়ান্ত success), "বিন্যাস পদ্ধতি" short label (ব্লক / স্নেক), "নিজে বদলানো" (end-aligned), "চূড়ান্ত করার তারিখ" (`formatDate`, `—` for drafts), "কাজ". | D9, D19, D27, D32 |
| 3 | Names, never ids | Class names from `useAllClasses()` (all pages), years from `useAcademicYears({ limit: 100 })`; while either is loading the cell shows `Skeleton className="h-4 w-24"`, an unknown id shows `—`. | D9 (`index.tsx:62-79` fell back to the UUID) |
| 4 | Row action | RowActions `view` → `/promotions/$runId`. | D19 |
| 5 | List footer | TableCount + 25 rows default (client-side slicing stays). | D19, B23 |
| 6 | List empty/error | `EmptyState` (title `list.empty`, sentence **New**, outline "নতুন প্রমোশন তালিকা"); `ErrorState` with Retry. | D28 |
| 7 | New list frame | `FullPageShell size="form"` title "নতুন প্রমোশন তালিকা"; footer বাতিল করুন (left) / তালিকা তৈরি করুন (right, disabled until valid, busy while saving). Close/Cancel return to where the user came from; asks before discarding a changed form. | D21–D23 |
| 8 | Card 1 "কোন শ্রেণি থেকে কোথায়" | **New** card title + help. Fields "বর্তমান শ্রেণি" *, "নতুন শিক্ষাবর্ষ" *, "নতুন শ্রেণি" (labels renamed); each select full width with "বাছুন" placeholder; the two suggested fields get the help "প্রস্তাবিত — চাইলে বদলাতে পারেন।" (**New**). Graduate case: the read-only sentence under the "নতুন শ্রেণি" label. Blocking reason: an alert box inside this card with the "…শ্রেণিগুলো খুলুন" link. | D25, D9 |
| 9 | Card 2 "গড় করার পরীক্ষাসমূহ" | Fieldset legend as card title + help (**New**); each exam a whole-row checkbox (44 px phone), rows divided; "অন্তত একটি…" error under the list. | D25 |
| 10 | Card 3 "শাখায় বিন্যাস পদ্ধতি" | Two option cards side by side (stacked on phone): bold name "ব্লক"/"স্নেক" + one plain sentence each (**New** help keys), selected = `border-primary bg-secondary`. | Explanation out of brackets |

## Mobile behaviour
- List: title, subtitle, full-width primary; rows become cards (name + badge, "নতুন শিক্ষাবর্ষ ২০২৭" subtitle, `dl` of method / changed / finalised date, "দেখুন" action).
- New list: full screen, no app chrome, one column; option cards stack; footer buttons 44 px.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Paginate the list | unpaginated · 25 per page | keep paginated (client-side slice, 25) | One list per class per year adds up past ~20 rows; the server returns all, slicing already exists. |
| Algorithm labels | keep "ব্লক (ক্রমানুসারে শাখা পূরণ)" · name + help | change `newRunForm.algorithmBlock/Snake` to the bare names, explanation in new `*Help` keys | The list and the run page need the short name; the form shows both. |
| Source of class names | `useClasses({})` (first 10) · `useAllClasses()` | `useAllClasses()` | Same 10-row trap as B13; the hook already exists in `ui/src/hooks/classes.ts:163`. |
| Form frame | page · FullPageShell | FullPageShell on its own route | D23 names "new promotion run"; the route already exists, so the URL is the route. |

## Files
- `client-admin/src/routes/_staff/promotions/index.tsx` — header, columns, badges, names, RowActions, page size, empty/error
- `client-admin/src/routes/_staff/promotions/index.test.tsx` — update assertions
- `client-admin/src/routes/_staff/promotions/new.tsx` — FullPageShell, three cards, labels, placeholders, help, alert
- `client-admin/src/routes/_staff/promotions/new.test.tsx` — update assertions
- `e2e/keyboard/promotion.spec.ts` — only if step 9 is needed (one line)
- `ui/src/i18n/locales/bn/promotions.json`, `ui/src/i18n/locales/en/promotions.json` — keys below

## Steps
1. **List data.** `useClasses({})` → `useAllClasses()`; `useAcademicYears()` → `useAcademicYears({ limit: 100 })`. Helper inside the component: `const nameOr = (map, id, loading) => map.get(id) ?? (loading ? <Skeleton className="h-4 w-24" /> : t('list.emptyValue'))`. Never render a raw id.
2. **List header.** `ListShell` `title={t('list.title')}`, `subtitle={t('list.subtitle')}`, `actions={[{ id: 'new', label: t('list.newRun'), icon: <PlusIcon />, priority: 'primary', onClick: () => navigate({ to: '/promotions/new' }) }]}` (drop the `Button asChild` + `Link`).
3. **List columns.**
   - `sourceTarget`: header `t('list.columnSourceTarget')`, value `` `${source} → ${target}` `` as plain text (`card: 'title'`), target = `t('outcome.graduate')` when `target_class_id === null`.
   - `targetYear`: header `list.columnTargetYear`, `card: 'subtitle'` rendered as `t('list.cardSubtitle', { year })`.
   - `status`: `<StatusBadge tone={row.status === 'DRAFT' ? 'neutral' : 'success'} label={t(row.status === 'DRAFT' ? 'list.statusDraft' : 'list.statusCommitted')} />`, `card: 'badge'`.
   - `algorithm`: `t(row.algorithm === 'BLOCK' ? 'newRunForm.algorithmBlock' : 'newRunForm.algorithmSnake')`.
   - `overrides`: `align: 'end'`, `formatNumber`.
   - `committedAt`: `row.committed_at ? formatDate(row.committed_at, config) : t('list.emptyValue')` (no `new Date`).
   - `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/promotions/${row.id}` }]}`.
4. **List paging/empty.** `useListShellState()` (no `limit: 10`); keep the slice. `emptyMessage` → `emptyState={{ title: t('list.empty'), explanation: t('list.emptyExplanation'), action: { label: t('list.newRun'), onClick: () => navigate({ to: '/promotions/new' }) } }}`.
5. **New list frame** (`new.tsx`). Delete the `mx-auto max-w-xl p-6` wrapper, the `h1` and the in-form button row. `const close = useCloseFullPage(() => void navigate({ to: '/promotions' }));` Return `<FullPageShell title={t('newRunForm.title')} onClose={close} size="form" dirty={dirty} secondary={{ label: t('newRunForm.cancel'), onClick: close }} primary={{ label: t('newRunForm.create'), onClick: () => formRef.current?.requestSubmit(), disabled: submitDisabled, busy: mutation.isPending }}>` around `<form ref={formRef} onSubmit={handleSubmit} className="space-y-6">`. `dirty = sourceClassId !== classId || targetYearOverride !== undefined || targetClassOverride !== undefined || deselectedExamIds.size > 0 || algorithm !== PlacementAlgorithm.BLOCK`. All state logic (`changeSource`, overrides, blocking reasons, `submitDisabled`, `handleSubmit`) stays as it is.
6. **Card 1.** Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`), `h2 text-h2` `newRunForm.classesTitle`, `p mt-0.5 text-text-secondary` `newRunForm.classesHelp`, then `mt-4 grid gap-4 md:grid-cols-2` with three `FormField`s (`Label htmlFor` + `SelectTrigger id` — keep each trigger's `aria-label` text equal to its label so the e2e `pick()` still finds it). Source and year are `required`. Year and class get help `newRunForm.suggestedHelp`. Use `useAllClasses()` for the source options (keep the "name (year)" text) and `useClasses({ academic_year_id, limit: 100 })` for target classes. Graduate case: `<p className="text-text-secondary">{t('newRunForm.graduateOption')}</p>` under the label instead of the Select. Blocking reason block moves to the end of this card: `<div role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-status-overdue-bg p-3 text-status-overdue-fg">` + `TriangleAlertIcon` + the sentence + the existing `/classes` link (`font-medium underline underline-offset-2`, it is navigation inside text). `MutationErrorMessage` stays under it.
7. **Card 2.** Card containing `<fieldset>` with `<legend className="text-h2">` `examsLabel`, help `examsHelp`, then `mt-3 divide-y divide-border-subtle` of rows `<label className="flex min-h-11 items-center gap-3">` + `Checkbox` + exam name. `noPublishedExams` and `examsRequired` stay, styled `text-text-secondary` / error text.
8. **Card 3.** Card with fieldset legend `algorithmLabel` + help `algorithmHelp`; `RadioGroup className="mt-4 grid gap-3 md:grid-cols-2"`; each option is a `<label>` wrapping `RadioGroupItem`: `flex min-h-11 items-start gap-3 rounded-md border border-border-subtle p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary`, text = `font-medium` name + `text-text-secondary` help (`algorithmBlockHelp` / `algorithmSnakeHelp`). Remove the per-item `aria-label` (the label wraps it).
9. **E2E.** Run `e2e/keyboard/promotion.spec.ts`. If `:154` (`heading level 1 toBeFocused` after the palette opens the form) fails because the full-page modal focuses its first control, change that one line to `toBeVisible()`; the rest of the flow (`pick()` by combobox name, the create button by name) needs no edit.
10. **i18n** (`promotions.json`, bn / en):
    - add `list.subtitle`: "ফলাফল দেখে শিক্ষার্থীদের পরের শ্রেণিতে তুলুন।" / "Move students up to the next class based on their results."
    - add `list.columnSourceTarget`: "শ্রেণি → নতুন শ্রেণি" / "Class → next class" (replaces the header built from `columnSourceClass` + `columnTargetClass`; delete those two)
    - change `list.columnTargetYear`: "নতুন শিক্ষাবর্ষ" / "Next academic year"
    - change `list.columnOverrides`: "নিজে বদলানো" / "Changed by hand"
    - change `list.columnCommittedAt`: "চূড়ান্ত করার তারিখ" / "Finalised on"
    - add `list.cardSubtitle`: "নতুন শিক্ষাবর্ষ {{year}}" / "Next academic year {{year}}"
    - add `list.view`: "দেখুন" / "View"; `list.emptyValue`: "—" / "—"
    - add `list.emptyExplanation`: "কোনো শ্রেণির পরীক্ষার ফল প্রকাশ হলে এখান থেকে প্রমোশন তালিকা তৈরি করুন।" / "Once a class's exam results are published, make its promotion list here."
    - change `newRunForm.sourceClassLabel`: "বর্তমান শ্রেণি" / "Current class"; `targetYearLabel`: "নতুন শিক্ষাবর্ষ" / "Next academic year"; `targetClassLabel`: "নতুন শ্রেণি" / "Next class"
    - add `newRunForm.classesTitle`: "কোন শ্রেণি থেকে কোথায়" / "From which class to where"; `classesHelp`: "শ্রেণি বাছলে পরের শিক্ষাবর্ষ আর পরের শ্রেণি নিজে থেকে বসে যাবে।" / "Pick a class and the next year and class fill in by themselves."; `suggestedHelp`: "প্রস্তাবিত — চাইলে বদলাতে পারেন।" / "Suggested — you can change it."
    - add `newRunForm.examsHelp`: "মেধাক্রম ঠিক হবে বাছাই করা পরীক্ষাগুলোর গড় জিপিএ থেকে।" / "Merit order comes from the average GPA of the exams you tick."
    - change `newRunForm.algorithmLabel`: "শাখায় বিন্যাস পদ্ধতি" / "How students are placed in sections"; add `algorithmHelp`: "উত্তীর্ণ শিক্ষার্থীরা নতুন শ্রেণির শাখাগুলোতে কীভাবে বসবে।" / "How promoted students are spread over the next class's sections."
    - change `newRunForm.algorithmBlock`: "ব্লক" / "Block"; `algorithmSnake`: "স্নেক" / "Snake"; add `algorithmBlockHelp`: "মেধাক্রম অনুযায়ী আগে ক শাখা ভরবে, তারপর খ।" / "Fills section A in merit order first, then B."; `algorithmSnakeHelp`: "মেধাক্রম অনুযায়ী শাখাগুলোতে পালা করে বসবে, সব শাখা সমান থাকবে।" / "Takes turns across sections in merit order, so all sections stay even."
    - change `newRunForm.cancel`: "বাতিল করুন" / "Cancel"

## Tests
- `index.test.tsx`: status cell is a badge reading "খসড়া"/"চূড়ান্ত"; a run whose class is missing from the classes response shows "—" and never the id; row has a link named "দেখুন" to `/promotions/<id>`; footer shows the total; header has one filled button; empty response renders the EmptyState with an outline action.
- `new.test.tsx`: the page renders an `h1` "নতুন প্রমোশন তালিকা" and a "বন্ধ করুন" button; each select has a visible label and shows "বাছুন" when empty; the footer primary "তালিকা তৈরি করুন" is disabled until class, year and one exam are set, then submitting navigates to `/promotions/<id>` (existing assertion); a `TARGET_SECTIONS_MISSING` suggestion shows the alert with the classes link; Close with a changed form asks before leaving.
- E2E: `e2e/keyboard/promotion.spec.ts` — see step 9.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] List status is a badge; no underlined link in the table; footer shows the total.
- [ ] `/promotions/new` has no sidebar/top bar/bottom bar; Close and Cancel go back.
- [ ] Empty selects are full width with "বাছুন"; every field and option has a visible label.

## Out of scope
- Deleting a draft from the list (RowActions `delete`) — the run page owns delete (promotions-2).
- The sidebar label "প্রমোশন" comes from `nav.json` (31.3.4a); the mockup shows it already renamed.

Wave: 9   Lane: promotions   Decisions: D9, D16, D19, D21, D22, D23, D25, D27, D28, D29, D32   Depends on: 31.3.8b
