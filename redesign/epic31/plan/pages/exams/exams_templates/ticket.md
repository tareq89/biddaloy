# [31.4.exams-3a] Exam structures list — kit table, icon actions, one word

## Goal
`/exams/templates` is a kit list page titled "পরীক্ষার কাঠামো": one primary to add a structure, a table with name · type · classes · subject count, icon actions (edit, delete behind a `ConfirmDialog`), the total, a real empty state, and every string uses "কাঠামো" and "অংশ" instead of "টেমপ্লেট" and "উপাদান". This is part **a** of a ticket that was too big for one afternoon; part **b** (`ticket-b.md`, runs after a) redesigns the detail page and its editor.

## What and why
An admin comes here to set up, once, which parts (written, MCQ, practical…) and marks each subject of each class has, so a new exam can be created from it in one step. Today the page shows a test-looking table with an underlined name link, an outline "মুছুন" text button in a "কার্যক্রম" column, a meaningless "বিষয়ের সারি" column, a pager that can never page, and server error text inside dialogs; the word "টেমপ্লেট" and "উপাদান" also clash with the sidebar label (now "পরীক্ষার কাঠামো") and with the exam detail page (which says "অংশ"). The redesign keeps the same data and makes it a kit list: clear title and subtitle, labelled columns with names and counts in Bangla digits, icon actions, a confirm dialog, and one vocabulary.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before (list) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates/before-mobile.webp?raw=true" width="260"> |
| After (list) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates/mobile.webp?raw=true" width="260"> |
| Before (detail, part b) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates_templateId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates_templateId/before-mobile.webp?raw=true" width="260"> |
| After (detail, part b) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates_templateId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/exams/exams_templates_templateId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title `list.title` ("পরীক্ষার কাঠামো", already set by 31.3.4b), **New** subtitle "প্রতিটি শ্রেণি ও বিষয়ের অংশ আর নম্বর একবার ঠিক করুন; পরীক্ষা তৈরির সময় কাঠামো বেছে নিন।", one primary "কাঠামো যোগ করুন" (`plus`). | D16; the page never said what a template is for |
| 2 | Name cell | Plain link `font-medium hover:text-primary` (no underline) to `/exams/templates/$templateId`. | D29 |
| 3 | Columns | নাম · ধরন · শ্রেণি (`classGrades` sorted, each through `formatNumber`, joined with ", ") · **মোট বিষয়** (was "বিষয়ের সারি"; `rowCount` through `formatNumber`, align end) · কাজ. | D6, D32 — "subject rows" is a database word |
| 4 | Row actions | `RowActions`: edit "সম্পাদনা" (`to` the detail; the detail is the editor) · delete "মুছুন". Replaces the outline text button. | D19 |
| 5 | Delete | `ConfirmDialog tone="danger"`, title "কাঠামোটি মুছবেন?", description names the structure; a failed delete shows `delete.errorMessage`, never the server text. | D29, D9 |
| 6 | Footer | `DataTable paginated={false}` → "মোট ৪টি"; the fake pager and page-size select go away (the API returns every row). | D19 |
| 7 | Empty | `EmptyState` (`file-stack`): "এখনো কোনো পরীক্ষার কাঠামো নেই" + "তৈরি শিক্ষাক্রম ব্যবহার করুন অথবা নতুন একটি যোগ করুন।" + outline "কাঠামো যোগ করুন". Error → `ErrorState` with Retry. | D28 |
| 8 | Add dialog | `DialogContent size="sm"`; title "পরীক্ষার কাঠামো যোগ করুন"; নাম (required mark) + ধরন (`FormField` labels); a 409 shows **New** "এই নামে আর একটি কাঠামো আছে।", any other failure `form.errorMessage`. The same dialog gets a **New** `mode="edit"` (name + type, `PATCH`) used by part b. | D21, D25, D9 |
| 9 | Wording | Every "টেমপ্লেট" → "কাঠামো" and "উপাদান" → "অংশ" in `examTemplates.json` and `examsTemplateField.json` (bn), "template" → "exam structure" / "component" → "part" (en). This also fixes the exam form's "টেমপ্লেট থেকে শুরু করুন" field and its toasts. | D32 — one word per thing; matches the sidebar and exams-2b |

## Mobile behaviour
- Header: title, subtitle, primary full width.
- Short list → compact two-line rows inside one Card (`PATTERN: DataTable (unpaginated)`): name on line 1 (44 px link), "টার্ম · শ্রেণি ৬, ৭, ৮ · ২৮টি বিষয়" as caption; edit + delete as 44 px icon buttons on the right.
- Footer "মোট ৪টি" stays.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Name of the thing | টেমপ্লেট / কাঠামো | কাঠামো | The glossary already renamed the nav item to "পরীক্ষার কাঠামো" (31.3.4a); the page and its dialogs must use the same word (D32). |
| Component word | উপাদান / অংশ | অংশ | exams-2b uses "অংশ" for the same entity on the exam page. |
| Paging | keep fake pager / unpaginated | unpaginated | `GET /exam-templates` returns all rows; a school has a handful. |
| Row action icons | view + edit + delete / edit + delete | edit + delete | The detail page is the editor; two icons saying the same thing would be noise. |
| 409 duplicate name | show server text / translated sentence | translated sentence | D9 — never a backend string. |

## Files
- `client-admin/src/routes/_staff/exams/templates/index.tsx` — name cell, drop `renderName` underline
- `client-admin/src/routes/_staff/exams/-templates-list.tsx` — header, columns, row actions, confirm, empty/error, unpaginated
- `client-admin/src/routes/_staff/exams/-templates-list.test.tsx`
- `client-admin/src/routes/_staff/exams/-template-form-dialog.tsx` — size, labels, required mark, translated errors, **New** edit mode (also used by exams-3b)
- `client-admin/src/routes/_staff/exams/-template-form-dialog.test.tsx` — **New**
- `ui/src/i18n/locales/{en,bn}/examTemplates.json` — keys below (also changed by exams-3b, runs later)
- `ui/src/i18n/locales/{en,bn}/examsTemplateField.json` — wording only

Used, not changed: `use-exam-templates.ts`. `-exam-form-dialog.tsx` reads `examsTemplateField` (exams-1 changes that file, runs earlier; only the json values change here).

## Steps
1. **Locale `examTemplates.json` (en + bn).** Change: `form.title` → "Add exam structure" / "পরীক্ষার কাঠামো যোগ করুন"; `form.description` → "An exam structure holds the parts (written, MCQ, viva…) and marks for each class and subject. Add them after creating it." / "কাঠামোতে প্রতিটি শ্রেণি ও বিষয়ের অংশ (লিখিত, এমসিকিউ, মৌখিক…) আর নম্বর থাকে। তৈরির পরে সেগুলো যোগ করুন।"; `form.kindLabel` → "Type" / "ধরন"; `form.errorMessage` → "Couldn't save the exam structure." / "কাঠামো সংরক্ষণ করা যায়নি।"; `list.caption` → "Exam structures" / "পরীক্ষার কাঠামোর তালিকা"; `list.add` → "Add exam structure" / "কাঠামো যোগ করুন"; `list.columnKind` → "Type" / "ধরন"; `list.columnRows` → "Subjects" / "মোট বিষয়"; `list.columnGrades` → "Classes" / "শ্রেণি"; `list.columnActions` → "Actions" / "কাজ"; `list.deleteRow` → "Delete {{name}}" / "মুছুন — {{name}}"; `list.errorMessage` → "Couldn't load the exam structures." / "পরীক্ষার কাঠামোর তালিকা লোড করা যায়নি।"; `list.announceResults` → "{{total}} exam structures" / "মোট {{total}}টি কাঠামো"; `delete.title` → "Delete this exam structure?" / "কাঠামোটি মুছবেন?"; `delete.description` → "“{{name}}” and all its parts will be deleted. Exams already created from it do not change." / "„{{name}}“ ও এর সব অংশ মুছে যাবে। এর থেকে আগে তৈরি পরীক্ষাগুলোর কোনো পরিবর্তন হবে না।"; `delete.confirm` → "Delete" / "মুছুন"; `delete.errorMessage` → "Couldn't delete the exam structure." / "কাঠামো মোছা যায়নি।". Add: `list.subtitle` "Set the parts and marks of each class and subject once; pick the structure when you create an exam." / "প্রতিটি শ্রেণি ও বিষয়ের অংশ আর নম্বর একবার ঠিক করুন; পরীক্ষা তৈরির সময় কাঠামো বেছে নিন।"; `list.edit` "Edit" / "সম্পাদনা"; `list.emptyTitle` "No exam structures yet" / "এখনো কোনো পরীক্ষার কাঠামো নেই"; `list.emptyText` "Use a ready-made curriculum or add a new one." / "তৈরি শিক্ষাক্রম ব্যবহার করুন অথবা নতুন একটি যোগ করুন।"; `list.rowCaption` "{{kind}} · class {{grades}} · {{count}} subjects" / "{{kind}} · শ্রেণি {{grades}} · {{count}}টি বিষয়"; `form.errorDuplicate` "Another exam structure already has this name." / "এই নামে আর একটি কাঠামো আছে।"; `form.editTitle` "Change name and type" / "নাম ও ধরন বদলান"; `form.saveEdit` "Save" / "সংরক্ষণ করুন". Delete `list.emptyMessage`, `list.delete` (check `rg -n "examTemplates|list\.delete\b" client-admin e2e` first). Then sweep the rest of the file (`detail.*`, `grid.*`): every remaining "টেমপ্লেট" → "কাঠামো" and "উপাদান" → "অংশ" with grammar (উপাদানের → অংশের, উপাদানসহ → অংশসহ), en "template" → "exam structure", "component" → "part" — part b rewrites those keys again, so a plain term swap is enough here.
2. **Locale `examsTemplateField.json` (en + bn).** `label` → "Start from an exam structure (optional)" / "কাঠামো থেকে শুরু করুন (ঐচ্ছিক)"; `none` → "No exam structure" / "কোনো কাঠামো নয়"; `toast.created_one/_other` → "Exam created with {{count}} part(s)" / "পরীক্ষা তৈরি হয়েছে, {{count}}টি অংশসহ"; `toast.noRows` → "Exam created — the structure had nothing for this class's subjects. Add the parts yourself." / "পরীক্ষা তৈরি হয়েছে — কাঠামোতে এই শ্রেণির বিষয়গুলোর জন্য কিছু ছিল না। অংশগুলো নিজে যোগ করুন।".
3. **`templates/index.tsx`.** `renderName` returns `<Link … className="inline-flex min-h-11 items-center font-medium hover:text-primary md:min-h-0">` (no `text-primary underline`). Nothing else.
4. **`-templates-list.tsx` — shell.** `ListShell` with `title={t('list.title')}`, `subtitle={t('list.subtitle')}`, primary `PageAction` `{ id: 'add', label: t('list.add'), icon: <Plus />, priority: 'primary', onClick: () => setCreateOpen(true) }`. `DataTable` `paginated={false}`; remove `page`, `pageSize`, `onPageChange`, `onPageSizeChange`, `pageSizeLabel`. Phone uses the unpaginated compact rows (`layout` per the kit's DataTable).
5. **`-templates-list.tsx` — columns.** `name` (`renderName`, phone caption `t('list.rowCaption', { kind, grades, count })`), `kind` (`t(\`kind.${row.kind}\`, { ns: 'exams' })`), `grades` (`[...row.classGrades].sort((a, b) => a - b).map((g) => formatNumber(g, config)).join(', ') || '—'`), `rows` (align end, `formatNumber(row.rowCount, config)`). Get `config` from `useTenantRegionConfig()` as other routes do. Drop the hand-made actions column; `rowActions={(row) => [{ intent: 'edit', label: t('list.edit'), to: \`/exams/templates/${row.id}\` }, { intent: 'delete', label: t('list.deleteRow', { name: row.name }), onClick: () => { remove.reset(); setToDelete(row); } }]}`.
6. **`-templates-list.tsx` — delete, states.** Replace the `Dialog` with `ConfirmDialog` (`open={toDelete !== null}`, `title={t('delete.title')}`, `description={t('delete.description', { name })}`, `confirmLabel={t('delete.confirm')}`, `tone="danger"`, `busy={remove.isPending}`, `onConfirm={confirmDelete}`); when `remove.isError`, pass the description plus `t('delete.errorMessage')` (or render it under the description, `role="alert"`). `emptyState={{ icon: <FileStack />, title: t('list.emptyTitle'), explanation: t('list.emptyText'), action: { label: t('list.add'), onClick: () => setCreateOpen(true) } }}`. Error → the DataTable's `error` (renders `ErrorState`) with `onRetry={() => void query.refetch()}`.
7. **`-template-form-dialog.tsx`.** `DialogContent size="sm"`. Props gain `mode?: 'create' | 'edit'` (default create) and `initial?: { id: string; name: string; kind: ExamKind }`. Edit mode: title `form.editTitle`, no description, fields prefilled, submit calls `useUpdateExamTemplate(initial.id).mutate({ name, kind })`, button `form.saveEdit`. Create mode unchanged in behaviour. Fields as `FormField` (label + control, `gap-1.5`; fields `flex flex-col gap-4`); নাম gets the required mark; validation error under the name field with the kit error classes (`border-destructive`, `circle-alert`). Mutation error: `error instanceof ApiError && error.statusCode === 409 ? t('form.errorDuplicate') : t('form.errorMessage')`. Footer per the Dialog pattern (Cancel outline, primary with `loading`).
8. Run `pnpm --filter client-admin test exams/-templates-list exams/-template-form-dialog`, `yarn workspace @biddaloy/ui check:i18n`, then `graphify update .`.

## Tests
- `-templates-list.test.tsx` — header shows `list.title` and the subtitle; columns show "শ্রেণি" values in tenant digits ("৬, ৭, ৮") and the subject count; row has an edit link to `/exams/templates/<id>` and a delete button labelled `মুছুন — <name>`; delete opens an `alertdialog` and calls the mutation only after confirm; no pager / "প্রতি পাতায়" control; footer "মোট ২টি"; empty list shows `list.emptyTitle` with an outline add button.
- `-template-form-dialog.test.tsx` (**New**) — empty name shows `form.errorNameRequired`; a 409 shows `form.errorDuplicate` and not the server text; edit mode is prefilled and sends `PATCH` with `{ name, kind }`.
- `e2e/keyboard/exam-templates.spec.ts` — keys are read through `t()`; `list.add` keeps its key (text changes). Run it; part b updates the detail steps.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No "টেমপ্লেট" or "উপাদান" left in `examTemplates.json` / `examsTemplateField.json` (bn) — `rg -n "টেমপ্লেট|উপাদান" ui/src/i18n/locales/bn/{examTemplates,examsTemplateField}.json` is empty.
- [ ] Row actions are icons with tooltips; delete asks first in a confirm dialog.
- [ ] Footer shows "মোট n টি" and no pager.

## Out of scope
- The detail page and its editor → `ticket-b.md` (exams-3b).
- Sidebar label and crumb ("পরীক্ষার কাঠামো") — 31.3.4a; the UUID crumb on the detail (B16) — 31.3.5.
- Copying a structure (no API).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| PageAction / DetailShellAction disabled + busy | Accepted | 31.2.5a (type 31.1.2a) | actions={[{ id: 'save', label, onClick, priority: 'primary', disabled: !isDirty, busy: save.isPending }]} |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: exams   Decisions: D6, D9, D16, D19, D21, D25, D28, D29, D32   Depends on: 31.3.8b, 31.4.exams-2b
