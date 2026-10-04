# [31.4.homework-1] Homework list and detail — kit table, facts header, tidy assign dialog

## Goal
`/academics/homework` shows homework in the kit table (labelled filters, total, icon "view" action, phone cards) and `/academics/homework/$homeworkId` shows one homework as a detail header with facts, a description card and a clean "assign" dialog — every subject name in the UI language.

## What and why
The list is where a teacher finds homework they gave and starts a new one; the detail page shows one homework and lets them give it to another section or student. Today the list's title cell is an underlined link (the only way in), subjects show their English name on a Bangla page, filters have no visible labels, the page size is 10, and on a phone two header buttons wrap. The detail page wraps four facts in a lone "সারসংক্ষেপ" tab, the confirmation after assigning is a small blue line, and a failed assign can show a backend error string. The redesign uses the kit list and detail patterns; no API change, no new feature.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework/mobile.webp?raw=true" width="260"> |
| Before — detail | _not captured_ | _not captured_ |
| After — detail (with the assign dialog shown open below the page) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_homeworkId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_homework_homeworkId/mobile.webp?raw=true" width="260"> |

The dimmed panel in the detail screenshots is a static picture of the dialog that the primary button opens; in the app it floats over the page.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | List header | `ListShell` `actions` (not `primaryAction`): outline "বাড়ির কাজ আমদানি করুন" (`upload` icon, `HOMEWORK_IMPORT`) + primary "বাড়ির কাজ দিন" (`plus`, `HOMEWORK_ASSIGN`); `subtitle` = existing `list.caption`. Phone: import moves into More. | D16, D29; no wrapped buttons on phone. |
| 2 | List filters | Same four select fields; FilterBar now shows each label (foundation). Phone: one full-width "ফিল্টার" button opens the sheet. | D24. |
| 3 | List table | Title cell is plain `font-medium` text (no link). **New** `rowActions`: one `view` action "দেখুন" → `/academics/homework/$homeworkId`. | D19: no text links in a table; row actions are icons. |
| 4 | List + detail + form | Subject shows `name_bn` on a Bangla page (falls back to `name_en`) via **New** `-subject-name.ts`. | D32 one language per screen. |
| 5 | List paging | Drop `useListShellState({ limit: 10 })`'s `limit` → default 25 with 25/50/100; total shown by `TableCount`. | B23, D19. |
| 6 | List empty | `emptyState` (icon `notebook-pen`, **New** `list.emptyTitle` + `list.emptyExplanation`, outline action "বাড়ির কাজ দিন" when `canAssign`) replaces `emptyMessage`. | D28. |
| 7 | Detail header | `DetailShell` with no `tabs`; `facts` = বিষয়, শ্রেণি, মূল্যায়ন পদ্ধতি, তৈরি হয়েছে (`formatDate`). Removes the single "সারসংক্ষেপ" tab and `identifiers`. Crumb "বাড়ির কাজ › {title}" comes from 31.3.5. | D16, D20 (a tab row with one tab is noise). |
| 8 | Detail body | One Card "বিবরণ" (`h2`) with the description in `whitespace-pre-line`; **New** `detail.noDescription` when empty. | Content in Cards (patterns §4 Tabs/DetailShell). |
| 9 | Detail primary | "শাখা বা শিক্ষার্থীকে দিন" with `send` icon, still gated by `HOMEWORK_ASSIGN`. | D16. |
| 10 | Assign dialog | `DialogContent size="md"`, title + **New** description "{title} · {class}"; target as two option cards (radio), section/student selects with placeholder "বাছুন", two DatePickers side by side on desktop, required marks; footer "বাতিল করুন" (outline) + **New** "দিন" (primary). | D21, D25. |
| 11 | Assign result | On success: close the dialog and raise a success notification (`notifyOutcome`) with the existing `detail.assigned` text, instead of the inline `<p role="status">`. On failure: always `form.genericError`, never `ApiError.message`. | D9; the confirmation is noticed. |

## Mobile behaviour
- List: header = title, subtitle, then primary (`flex-1`) + More (holds the import action). Filters behind one full-width "ফিল্টার" button. Rows are cards: title `text-h3`, "{subject} · {class}" subtitle, grading mode + created date in a two-column `dl`, a labelled "দেখুন" action row.
- Detail: facts in a 2-column grid; the primary is full width under the facts.
- Dialog: fields stack; dates one per row; footer buttons full width, primary on top.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Way into a homework from the list | keep underlined title link · row click · `view` row action | `view` row action | D19; one pattern for every table. |
| Detail tabs | keep one "সারসংক্ষেপ" tab · no tabs | no tabs (`DetailShell` without `tabs`) | Addendum 7: tabs are optional; one tab adds nothing. |
| Assign confirmation | inline status line · toast | toast via `notifyOutcome` | Same as the import page; the inline line was easy to miss. |
| Assign dialog vs full page | Dialog · FullPageShell | Dialog `md` | ≤ 5 fields, no table (D21). |
| Show assignments on the detail page | add a list · leave out | leave out | No `GET /homework/:id/assignments` endpoint (D1: no new feature). |
| Class name suffix | "ষষ্ঠ শ্রেণি" · class name as stored | class name as stored | Class names are tenant data ("Class 6", "ষষ্ঠ"); adding "শ্রেণি" would double it. |

## Files
- `client-admin/src/routes/_staff/academics/homework/index.tsx` — header actions, subtitle, row action, subject name, page size, empty state
- `client-admin/src/routes/_staff/academics/homework/index.test.tsx` — updated assertions
- `client-admin/src/routes/_staff/academics/homework/$homeworkId.tsx` — facts header, description card, dialog, notification, error text
- `client-admin/src/routes/_staff/academics/homework/$homeworkId.test.tsx` — updated assertions
- `client-admin/src/routes/_staff/academics/homework/-assign-homework-form.tsx` — shared-field look (target cards, labels, required marks, placeholders, assign-mode footer); also changed by homework-2, which runs later
- `client-admin/src/routes/_staff/academics/homework/-subject-name.ts` — **New** one helper
- `client-admin/src/routes/_staff/academics/homework/-subject-name.test.ts` — **New**
- `ui/src/i18n/locales/en/homework.json`, `ui/src/i18n/locales/bn/homework.json` — new keys below

## Steps
1. **`-subject-name.ts` (New).**
   ```ts
   /** Subject label in the UI language; falls back to the other name, then '—'. */
   export function subjectName(subject: { name_en: string; name_bn?: string | null } | undefined, language: string): string {
     if (!subject) return '—';
     return (language.startsWith('bn') ? subject.name_bn || subject.name_en : subject.name_en || subject.name_bn) ?? '—';
   }
   ```
   Callers get `language` from `useTranslation().i18n.language`. Use it for every subject label in `index.tsx` (column + filter options), `$homeworkId.tsx` (fact) and `-assign-homework-form.tsx` (subject select items, `cs.subject`).
2. **List header** (`index.tsx`). Replace `primaryAction` with
   `actions={[{ id: 'import', label: t('list.importHomework'), icon: <Upload />, priority: 'secondary', allowed: canImport, onClick: () => navigate({ to: '/academics/homework/import' }) }, { id: 'assign', label: t('list.assignHomework'), icon: <Plus />, priority: 'primary', allowed: canAssign, onClick: () => navigate({ to: '/academics/homework/new' }) }]}`
   and add `subtitle={t('list.caption')}`. (`PageHeader` from 31.2.5a puts the outline action into More on phone.)
3. **List table.** Title column: `accessorFn: (row) => row.title`, keep `card: 'title'`; add a `card: 'subtitle'` column or render the card subtitle as `` `${subjectName(...)} · ${className}` `` if `DataTable` card roles allow only one subtitle column (use the existing card role names in `data-table.tsx`). Add `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/academics/homework/${row.id}` }]}` (**New** key `list.view`). Keep the `created` column with `formatDate(parseServerDate(row.created_at), regionConfig)`.
4. **Page size.** `useListShellState()` with no `limit` option (default 25, B23). Keep the client-side slice and its `ponytail:` comment.
5. **Empty state.** Replace `emptyMessage` with `emptyState={{ icon: <NotebookPen />, title: t('list.emptyTitle'), explanation: t('list.emptyExplanation'), ...(canAssign ? { action: { label: t('list.assignHomework'), onClick: () => navigate({ to: '/academics/homework/new' }) } } : {}) }}` (EmptyState's action renders outline, D28/D29). Keep `list.emptyMessage` only if a test still needs it; otherwise delete it from both locale files.
6. **Detail header** (`$homeworkId.tsx`). `DetailShell` props: `name={homework.title}`, `facts={[{ label: t('detail.subjectLabel'), value: subjectName(subject, language) }, { label: t('detail.classLabel'), value: classQuery.data?.name ?? '—' }, { label: t('detail.gradingModeLabel'), value: t(`form.gradingMode.${homework.grading_mode}`) }, { label: t('detail.createdLabel'), value: formatDate(parseServerDate(homework.created_at), regionConfig) }]}`, `actions=[{ id: 'assign', label: t('detail.assignAgain'), icon: <Send />, priority: 'primary', allowed: canAssign, onClick }]`. Remove `identifiers`, `tabs`, `activeTab`, `onTabChange`. Delete `detail.tabSummary` from both locale files.
7. **Detail body.** As `DetailShell` children (or directly after it, inside the same fragment): `<Card padded><h2 className="text-h2">{t('detail.descriptionLabel')}</h2><p className="mt-2 whitespace-pre-line">{homework.description ?? t('detail.noDescription')}</p></Card>` (empty → `text-text-secondary`).
8. **Dialog.** `<DialogContent size="md" closeLabel={tCommon('actions.close')}>`, `DialogHeader` → `DialogTitle` `t('detail.assignAgain')` + `DialogDescription` `t('detail.assignDescription', { title: homework.title, className: classQuery.data?.name ?? '—' })`. Error prop: `assignHomework.isError ? t('form.genericError') : undefined` (drop the `ApiError.message` branch, D9).
9. **Success.** In `onSuccess`: `setAssignOpen(false)`; `notifyOutcome({ tenantId: captureNotificationTenant(), variant: 'success', message: t('detail.assigned', { date: formatDate(parseServerDate(assignment.due_date), regionConfig) }) })` (both from `@biddaloy/ui/api`, as `import.tsx` does). Remove `assignedMessage` state and its `<p role="status">`.
10. **Form — shared fields** (`-assign-homework-form.tsx`, both modes):
    - Labels `text-label text-text-primary`; required mark (`<span className="text-destructive" aria-hidden="true">*</span><span className="sr-only">` + `t('form.required')` + `</span>`, **New** key) on শাখা, শিক্ষার্থী, দেওয়ার তারিখ, শেষ তারিখ.
    - Target `RadioGroup` (`role="radiogroup"` with `aria-labelledby` on the visible "কাকে দেওয়া হবে" label) `className="grid grid-cols-2 gap-2"`; each option is a `<label>` wrapping its `RadioGroupItem` + text, classes `flex h-11 cursor-pointer items-center gap-3 rounded-md border border-border-functional bg-surface px-3 md:h-8 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[[data-state=checked]]:font-medium has-[[data-state=checked]]:text-secondary-foreground`. Drop the per-item `aria-label`s (the label text names them).
    - Every `SelectValue` gets `placeholder={t('form.selectPlaceholder', { ns: 'common' })}`; every `DatePicker` keeps its label via `id` + `<label htmlFor>` instead of `aria-label`.
    - Dates: `<div className="grid gap-4 md:grid-cols-2">` (not `flex`).
    - Validation: show the message **under the field** that is wrong (`flex items-center gap-1 text-caption text-destructive` + `CircleAlert size-3.5`, `aria-invalid` + `aria-describedby` on the control) — **New** keys `form.errorSection`, `form.errorStudent`, `form.errorDate`; keep `form.dueBeforeAssigned` under the due date. Keep one `role="alert"` block only for the caller's `error`.
    - Assign-mode footer (dialog): `flex flex-col-reverse gap-2 md:flex-row md:justify-end` with `DialogClose asChild` → outline `Button` `t('actions.cancel', { ns: 'common' })` and primary `Button type="submit" loading={isPending}` `t('form.assignSubmit')`. Create mode keeps its current footer — homework-2 replaces it.
11. **i18n** (`homework.json`, add en + bn):
    | key | en | bn |
    |---|---|---|
    | `list.view` | View | দেখুন |
    | `list.emptyTitle` | No homework yet | এখনো কোনো বাড়ির কাজ নেই |
    | `list.emptyExplanation` | Homework you give to a section or a student shows up here. | কোনো শাখা বা শিক্ষার্থীকে বাড়ির কাজ দিলে তা এখানে দেখা যাবে। |
    | `detail.noDescription` | No description. | কোনো বিবরণ নেই। |
    | `detail.assignDescription` | {{title}} · {{className}} | {{title}} · {{className}} |
    | `form.assignSubmit` | Assign | দিন |
    | `form.required` | (required) | (আবশ্যক) |
    | `form.errorSection` | Pick a section. | একটি শাখা বাছুন। |
    | `form.errorStudent` | Pick a student. | একজন শিক্ষার্থী বাছুন। |
    | `form.errorDate` | Pick a date. | একটি তারিখ বাছুন। |
    Remove `detail.tabSummary` (and `list.emptyMessage` if unused).

## Tests
- `-subject-name.test.ts`: bn with `name_bn` → bn name; bn without → en name; en → en name; `undefined` → `—`.
- `index.test.tsx`: subject cell shows the bn name when the fixture has `name_bn`; the title is not a link and the row has a "দেখুন" link to the detail route; empty array renders the EmptyState title `list.emptyTitle` (an `h2`, not `h1`); TEACHER sees the "বাড়ির কাজ দিন" button; class filter still sends `class_id`.
- `$homeworkId.test.tsx`: facts show subject/class/grading mode/created date (long form); no `tablist` on the page; assign dialog submits, closes and calls `notifyOutcome` with variant `success` (spy via `vi.mock('@biddaloy/ui/api', …)` keeping the real exports); a 400 on assign shows `form.genericError`, not the server message; "there is no Reassign button" stays.
- No e2e spec opens these two routes by selector (`e2e/keyboard/homework.spec.ts` covers `/new`, owned by homework-2).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (page; dialog).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] List: no underlined link in the table; one eye icon per row with a tooltip; total shown; 25 rows per page by default.
- [ ] Subjects read in Bangla on a Bangla page wherever `name_bn` exists.
- [ ] Detail has no tab row; four facts under the title; description in its own card.
- [ ] Assign dialog: option cards for "কাকে দেওয়া হবে", "বাছুন" placeholders, Cancel + "দিন"; success closes it and shows a toast.

## Out of scope
- Assignment list / reassign / deactivate on the detail page — no server endpoint (Epic 22 follow-up #1013).
- Attachments (`FileUploadWidget` is unused today) — #1012.
- `-submission-grid.tsx` is not wired to any route; left as is.
- The "অবস্থা" filter filters assignments, not homework, and the row has no status to show; kept as is (no API change).
- Detail crumb name comes from 31.3.5 (`homeworkDetail` resolver) — not touched here.
- No shared requests filed for this ticket.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: homework   Decisions: D5, D9, D16, D19, D20, D21, D24, D25, D28, D29, D32   Depends on: 31.3.8b
