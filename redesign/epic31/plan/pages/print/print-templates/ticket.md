# [31.4.print-1] Print designs — badges, icon actions, plain words

## Goal
`/print-templates` shows the school's designs in one unpaginated table with status and "default" as badges, icon row actions, a "নতুন নকশা" primary, translated errors, and the word "নকশা" used everywhere the sidebar already says it.

## What and why
An admin comes here to add a card design, open one in the editor, choose which design is the default for a document type, or archive an old one. Today the header button says "নতুন টেমপ্লেট" while the sidebar says "প্রিন্টের নকশা", status is plain text, "ডিফল্ট" sits in its own column, the batch size shows Latin "50", the date is ISO-like, row actions are text links, a list of 2–5 rows has a 10-row pager, and a failed archive shows the server's English sentence ("Choose another default first"). The redesign keeps the same table but makes it read like the kit and says everything in Bangla.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print-templates/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print-templates/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print-templates/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print-templates/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `ListShell` title (already "প্রিন্টের নকশা" via 31.3.4b), **New** subtitle "পরিচয়পত্র ও এসিআর পাতার নকশা।", primary "নতুন নকশা" (`plus`) via `actions`. | D16, D32 |
| 2 | Table | `paginated={false}`, footer "মোট nটি"; drop page / pageSize state. | D19 — a handful of rows |
| 3 | Name cell | Name (`font-medium`) + `StatusBadge tone="info" label="ডিফল্ট"` when `is_default`; the separate ডিফল্ট column goes. | One column less; the default is a fact about the row's name |
| 4 | Status | `StatusBadge`: published → `success` "প্রকাশিত"; draft only → `neutral` "শুধু খসড়া". | D27 |
| 5 | Numbers / dates | প্রতি দফায় কার্ড via `formatNumber`, right-aligned; সর্বশেষ বদল via `formatDate` (date only). | D5, D6 |
| 6 | Row actions | `RowActions`: edit (`নকশা সম্পাদনা`), **icon override** `star` "ডিফল্ট করুন" (intent `approve` with `icon={<Star/>}` and neutral colour, only published, not default, `PRINT_TEMPLATE_MANAGE`), archive (`আর্কাইভ করুন`, `PRINT_TEMPLATE_MANAGE`). | D19 |
| 7 | Archive confirm | `ConfirmDialog tone="default"` — title `archive.title`, description `archive.explain`, confirm "আর্কাইভ করুন". 409 → toast `archive.failedIsDefault`; other errors → `archive.failed`. | D9 (no server English), D29 |
| 8 | Make default | Icon opens a small `ConfirmDialog` (**New**); any error → toast `makeDefaultFailed` (drop `messageOf`). | D9; gives the per-row mutation a home and stops a misclick changing every print |
| 9 | Empty library | Card with `h2` "একটি নকশা দিয়ে শুরু করুন" + help + suggestion grid `grid grid-cols-2 gap-3 md:grid-cols-4`; header and primary stay as on the list. | D28; the header used to be hand-written |
| 10 | New design dialog | `DialogContent size="lg"`; kind switch = kit `Tabs` (line) instead of filled/outline buttons; name field with Field/Label classes; 409 on create → `new_dialog.nameTaken`; `SuggestionCard` selected look `border-primary bg-secondary`, hover `hover:bg-muted`. | D21, D29 (no second filled button), D9 |
| 11 | Filter | Unchanged single "নথির ধরন" select (kit FilterBar look comes from the foundation). | — |

## Mobile behaviour
- Primary full width under the title; "ফিল্টার" button opens the sheet.
- Table rows become compact two-line rows (`PATTERN: DataTable (unpaginated)`): name + default badge (+ draft badge when draft), caption = document type; actions stay icons on the right.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| "Template" word | keep "টেমপ্লেট" / "নকশা" | "নকশা" | The sidebar (31.3.4a) says "প্রিন্টের নকশা"; one word per thing (D32). |
| New-design form | Dialog / FullPageShell (it holds a grid of design thumbnails) | Dialog `lg` | Three inputs; the thumbnails are a radio choice, not a list to review. D23 does not list it. |
| Default column | own column / badge in the name cell | badge | Fewer columns; the default reads with the name. |
| Archive confirm tone | danger / default | default | Archived designs stay in old print records; nothing is deleted. |
| Pager | keep / unpaginated | unpaginated | A school has a few designs; client-side rows. |

## Files
- `client-admin/src/components/print/library/print-template-library.tsx` — header, table, badges, actions, errors, empty state
- `client-admin/src/components/print/library/print-template-library.test.tsx`
- `client-admin/src/components/print/library/print-template-library.stories.tsx`
- `client-admin/src/components/print/library/new-template-dialog.tsx` — size, tabs, field, 409
- `client-admin/src/components/print/library/new-template-dialog.test.tsx`
- `client-admin/src/components/print/library/suggestion-card.tsx` — selected/hover tokens
- `ui/src/i18n/locales/{en,bn}/printTemplates.json`

## Steps
1. **Locale `printTemplates.json`** (en / bn). Change: `new` → "New design" / "নতুন নকশা"; `new_dialog.title` → same; `caption` → "Your school's print designs" / "আপনার বিদ্যালয়ের প্রিন্টের নকশা"; `loadError` → "Couldn't load the designs." / "নকশা আনা যায়নি।"; `actions.edit` → "Edit design" / "নকশা সম্পাদনা"; `actions.archive` → "Archive" / "আর্কাইভ করুন"; `archive.confirm` → "Archive" / "আর্কাইভ করুন"; `archive.failed` → "Couldn't archive the design." / "নকশাটি আর্কাইভ করা যায়নি।"; `new_dialog.createFailed` → "Couldn't create the design." / "নকশা তৈরি করা যায়নি।"; After this no bn value in the file contains "টেমপ্লেট". Add: `subtitle` "ID card and ACR page designs." / "পরিচয়পত্র ও এসিআর পাতার নকশা।"; `archive.failedIsDefault` "This is the default design. Make another design the default first." / "এটি এখন ডিফল্ট নকশা। আগে অন্য একটি নকশাকে ডিফল্ট করুন।"; `new_dialog.nameTaken` "A design with this name already exists." / "এই নামে আগেই একটি নকশা আছে।". Delete `columns.default`.
2. **Header.** `ListShell title={t('title')} subtitle={t('subtitle')} actions={canManage ? [{ id: 'new', label: t('new'), icon: <Plus />, priority: 'primary', onClick: () => openNew() }] : []}`; drop `primaryAction`.
3. **Table.** Remove `page`, `pageSize`, `PAGE_SIZE_DEFAULT`, `paged`; pass `data={rows}`, `paginated={false}`. Columns: `name` (`card: 'title'`) renders `<span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium">{row.name}</span>{row.is_default && <StatusBadge tone="info" label={t('default')} />}</span>`; `type`; `status` = `<StatusBadge tone={row.current_version_id ? 'success' : 'neutral'} label={…} />` (`card: 'badge'`); `batch` = `formatNumber(row.batch_size, region)`, `align: 'end'`; `updated` = `formatDate(row.updated_at, region)`. Delete the `default` and `actions` columns.
4. **Row actions.** Replace `TemplateRowActions` with `rowActions={(row) => [...]}` — edit (`onClick: () => onEdit(row.id)`), make-default (`intent: 'approve'`, `icon: <Star />`, label `actions.makeDefault`, `allowed: canManage && row.current_version_id !== null && !row.is_default`), archive (`intent: 'archive'`, `allowed: canManage`). The two mutation hooks take the id at hook time (`useSetDefaultPrintTemplate(id)`, `useArchivePrintTemplate(id)`), so each action opens a small confirm component that owns its hook: page state `archiveRow` / `defaultRow` (`PrintTemplateRow | undefined`); the actions only set that state. `ArchiveConfirm({ template, onClose })` renders `ConfirmDialog` (Change 7) and calls `useArchivePrintTemplate(template.id)`; `DefaultConfirm({ template, onClose })` renders `ConfirmDialog tone="default"` with **New** `makeDefaultConfirm.title` "Make {{name}} the default?" / "{{name}} ডিফল্ট করবেন?", `makeDefaultConfirm.explain` "It will be picked first when printing this document type." / "এই ধরনের নথি প্রিন্টের সময় এটি আগে থেকে বাছাই করা থাকবে।", confirm `actions.makeDefault`, and calls `useSetDefaultPrintTemplate(template.id)`. Both close on success.
5. **Errors.** Archive: `onError: (e) => toast.error(e instanceof ApiError && e.statusCode === 409 ? t('archive.failedIsDefault') : t('archive.failed'))` (`ApiError` from `@biddaloy/ui/api`). Make default: `toast.error(t('makeDefaultFailed'))`. Delete `messageOf`.
6. **Empty library.** Keep the `noTemplatesAtAll` branch but render it through the same `ListShell`-less header: `PageHeader title subtitle actions` + a Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`) holding `h2 text-h2` `empty.heading`, `p mt-1 text-text-secondary` `empty.explanation`, grid `mt-4 grid grid-cols-2 gap-3 md:grid-cols-4` of `SuggestionCard`.
7. **`new-template-dialog.tsx`.** `<DialogContent size="lg">`; kind switch → `Tabs` / `TabsList` / `TabsTrigger` from `@biddaloy/ui` (line variant) with `value={kind}`; designs `fieldset` legend `text-label`; name field = `Field` classes (`flex flex-col gap-1.5`, label `text-label`), help `text-caption text-text-secondary`; `create.isError` text = `create.error instanceof ApiError && create.error.statusCode === 409 ? t('new_dialog.nameTaken') : t('new_dialog.createFailed')`.
8. **`suggestion-card.tsx`.** Classes: base `flex flex-col gap-2 rounded-lg border p-2 text-start`; selected `border-primary bg-secondary`; else `border-border-subtle hover:bg-muted`. Text `text-label font-medium`; ACR help `text-caption text-text-secondary`.
9. Run `yarn test:frontend run components/print/library`, then `graphify update .`.

## Tests
- `print-template-library.test.tsx`: header button "New design" opens the dialog; no pager, footer "Total 2"; default row shows a "Default" badge in the name cell and no make-default action; published/draft badges; make-default icon button opens a confirm and its confirm calls the endpoint; archiving the default answers 409 → toast "This is the default design…" (never the server sentence); batch size under `locale: 'bn'` shows `৫০`. Update the existing archive test to the `ConfirmDialog` button name "Archive".
- `new-template-dialog.test.tsx`: kind is a tab list (`getByRole('tab', { name: 'Staff ID card' })`); 409 shows "A design with this name already exists."; still exactly one filled button.
- `e2e/keyboard/print-templates.spec.ts`: no change expected (all names go through `t()`; a newly created design is not the default, so its name cell has no badge) — run it to confirm.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The word "টেমপ্লেট" no longer appears on this page or in its dialogs.
- [ ] Archive / make-default failures show a Bangla sentence, never the server's English.
- [ ] Table shows "মোট nটি" and no pager.

## Out of scope
- The template editor (`/print-templates/$templateId/edit`) is not redesigned (D2).
- Showing the published version number / publish date needs fields the API does not return (noted in the component header) — not requested.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: print   Decisions: D5, D6, D9, D15, D16, D19, D21, D27, D28, D29, D32   Depends on: 31.3.8b
