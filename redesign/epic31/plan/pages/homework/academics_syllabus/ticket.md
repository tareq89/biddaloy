# [31.4.homework-3] Syllabus — topic list with progress and icon actions

## Goal
`/academics/syllabus` shows the class + subject choice as two labelled pickers kept in the URL, then the topics of that pair in one card with a progress line, a numbered table with up/down and icon edit/delete actions, a total, phone rows with labelled buttons, and kit empty / error / loading states.

## What and why
The page is where a teacher lists a subject's topics for one class in teaching order and marks how far they got. Today the choice is two half-width selects that forget themselves on reload, the "pick first" hint and the empty/error/loading messages are bare grey lines, edit and delete are underlined text links next to the arrow buttons, delete uses a red button in a plain dialog, the description takes a whole column, and nothing says how much of the syllabus is done. The redesign keeps every request (list, create, update, delete, two-row reorder) and only changes layout, wording and states.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_syllabus/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_syllabus/before-mobile.webp?raw=true" width="260"> |
| After (class and subject picked) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_syllabus/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/homework/academics_syllabus/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title "সিলেবাস", **New** subtitle, primary "বিষয়বস্তু যোগ করুন" (`plus`) when `canManage` and both picks are made. Route wraps itself once in `PageContainer` (it has no shell). | D15, D16. |
| 2 | Pickers | শ্রেণি and বিষয় as labelled Selects in `grid gap-4 md:grid-cols-12` (`md:col-span-4` each), placeholder "বাছুন"; values live in the URL (**New** `class_id`, `subject_id` search params) so reload and Back keep them. Subject label in the UI language (`subjectName` from homework-1). | D25, D32; the page's state is visible and shareable. |
| 3 | Nothing picked | `EmptyState` (icon `book-open`, **New** title "শ্রেণি ও বিষয় বেছে নিন", the existing `pickToStart` sentence, no action). | D28. |
| 4 | Topic card header | Card title "{subject} · {class}" (`h2`) + **New** progress line "৮টির মধ্যে ৩টি বিষয়বস্তু সম্পন্ন" counted from the loaded topics (`status === DONE`). | Shows the current state at a glance. |
| 5 | Table (desktop) | Columns **New** "ক্রম" (1…n, end-aligned, tenant digits), "বিষয়বস্তু" (name `font-medium`, description under it in `text-caption text-text-secondary`, only when present), "অবস্থা" (`StatusBadge domain="syllabusTopic"`), **New** "সাজান" (up/down icon buttons), "কাজ" (`RowActions`: edit, delete). Footer `TableCount` "মোট ৮টি". | D19: icons with tooltips, total shown; the description no longer needs its own column. |
| 6 | Rows (phone) | One list inside the same Card: number badge, name + status badge, description, then a row of four labelled buttons "উপরে", "নিচে", "সম্পাদনা", "মুছুন" (**New** short labels). | Phone: icon + visible label (patterns §4 RowActions). |
| 7 | States after picking | Loading → table-shaped `Skeleton` (`aria-busy`); error → `ErrorState` with Retry (`refetch`); no topics → `EmptyState` (**New** title + sentence, outline "বিষয়বস্তু যোগ করুন" when `canManage`). | D28. |
| 8 | Delete | `ConfirmDialog tone="danger"` with the existing title/body/action keys. | D29: red filled only in a confirm dialog. |
| 9 | Topic form dialog | `DialogContent size="md"`, required mark on নাম, error under the field, Select placeholder, footer Cancel ("বাতিল করুন") + primary. | D21, D25. |
| 10 | Reorder failure | Error notification (`notifyOutcome`, existing `list.reorderFailed`) instead of a red line under the table. | The message appears where the user is looking. |

## Mobile behaviour
- Header: title, subtitle, full-width primary (only after both picks).
- Pickers stack, full width, 44 px.
- The topic table becomes the row list in Change 6; the card header and the "মোট n টি" footer stay.
- Up on the first row and down on the last row are disabled (`cursor-not-allowed opacity-50`).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Pickers as FilterBar or plain fields | FilterBar (with "all" option and phone sheet) · two plain labelled Selects | plain Selects, always visible | Both are required to show anything; an "all" option is meaningless and hiding them behind a sheet would hide the main choice. |
| Keep the choice in the URL | component state · search params | search params `class_id`, `subject_id` | Reload/Back keep the list; same as every other list page. |
| Up/down buttons | RowAction intents · own "সাজান" column | own column of icon buttons | `RowActionIntent` has no move intent; keeps RowActions to edit + delete (no shared change needed). |
| DataTable or hand-built table | `DataTable paginated={false}` · `Table` primitives + phone list | `Table` primitives (desktop) + a `ul` (phone) | The phone row needs four labelled buttons incl. reorder, which DataTable card mode cannot lay out; RowActions is still used for edit/delete on desktop. |
| Progress line | none · "x of n done" | "x of n done", client-side | Answers "how far are we" with data already loaded; no API change. |
| Subjects in the picker | all subjects · only the class's subjects | all subjects (unchanged) | Filtering by class subjects needs the academic year and can leave the list empty when a class has no subjects set up; not a layout change. |

## Files
- `client-admin/src/routes/_staff/academics/syllabus/index.tsx` — header, URL-kept pickers, states, card + table + phone rows, ConfirmDialog, notification
- `client-admin/src/routes/_staff/academics/syllabus/index.test.tsx` — updated assertions
- `client-admin/src/routes/_staff/academics/syllabus/-syllabus-topic-form.tsx` — dialog size, required mark, field error, placeholder, footer
- `ui/src/i18n/locales/en/syllabus.json`, `ui/src/i18n/locales/bn/syllabus.json` — keys below
- `e2e/keyboard/syllabus.spec.ts` — only if a selector changes (see Tests)
- reads, does not change: `client-admin/src/routes/_staff/academics/homework/-subject-name.ts` (created by homework-1, runs earlier)

## Steps
1. **Search params.** Add `validateSearch: z.object({ class_id: z.string().optional().catch(undefined), subject_id: z.string().optional().catch(undefined) })`. Read with `Route.useSearch()`; set with `navigate({ search: (prev) => ({ ...prev, class_id: value }), replace: true })`. Delete the two `useState`s. Keep `hasSelection` and the query exactly as today.
2. **Frame.** Return `<PageContainer>` (wide) → `<PageHeader title={t('list.title')} subtitle={t('list.subtitle')} actions={[{ id: 'add', label: t('list.addTopic'), icon: <Plus />, priority: 'primary', allowed: canManage && hasSelection, onClick: () => setCreateOpen(true) }]} />` → pickers → content.
3. **Pickers.** `<section aria-label={t('list.pickersLabel')} className="grid gap-4 md:grid-cols-12">`, each `<div className="flex flex-col gap-1.5 md:col-span-4">` with `<label htmlFor>` (`text-label text-text-primary`) + required mark + `Select` whose `SelectValue` has `placeholder={t('form.selectPlaceholder', { ns: 'common' })}`. Subject items: `subjectName(subject, i18n.language)` imported from `../homework/-subject-name`. Drop the per-trigger `aria-label` (the `<label>` names it).
4. **Content switch** (in this order):
   - `!hasSelection` → `<EmptyState icon={<BookOpen />} title={t('list.pickTitle')} explanation={t('list.pickToStart')} />`.
   - `topicsQuery.isLoading` → `<Skeleton>` bars shaped like a header band + 5 rows of `h-10`, inside a Card with `aria-busy="true"`.
   - `topicsQuery.isError` → `<ErrorState message={t('list.errorMessage')} onRetry={() => void topicsQuery.refetch()} retryLabel={t('actions.retry', { ns: 'common' })} />`.
   - no topics → `<EmptyState icon={<ListOrdered />} title={t('list.emptyTitle')} explanation={t('list.emptyExplanation')} {...(canManage ? { action: { label: t('list.addTopic'), onClick: () => setCreateOpen(true) } } : {})} />`.
   - else the topic Card (steps 5–7).
5. **Topic Card.** `<Card className="overflow-hidden">` (no padding) with header `p-4 md:px-5`: `<h2 className="text-h2">{`${subjectLabel} · ${className}`}</h2>` and `<p className="mt-1 text-text-secondary">{t('list.progress', { done, total })}</p>` where `done = sortedTopics.filter((x) => x.status === SyllabusTopicStatus.DONE).length` (counts pass through the i18n number formatter, D6).
6. **Desktop table** (`<div className="hidden md:block">`, existing `Table` primitives): `thead` `border-y border-border-subtle bg-muted text-label text-text-secondary`, `th` `h-10 px-4 font-medium`. Columns: `list.columnSequence` (`w-16 text-end`, cell `formatNumber(index + 1, regionConfig)` `tabular-nums`), `list.columnName` (cell `<p className="font-medium">{name}</p>{description && <p className="text-caption text-text-secondary">{description}</p>}`, `px-4 py-2`), `list.columnStatus` (StatusBadge), `list.columnOrder` (only when `canManage`: two ghost icon `Button`s `ArrowUp` / `ArrowDown`, `text-text-secondary`, existing `moveUp`/`moveDown` aria-labels + tooltips, disabled at the ends or while `reorderTopics.isPending`), `table.actions` from common (only when `canManage`: `<RowActions actions={[{ intent: 'edit', label: t('list.edit', { name }), onClick: () => setEditing(topic) }, { intent: 'delete', label: t('list.delete', { name }), onClick: () => setDeleting(topic) }]} />`). Rows `hover:bg-muted`, body `divide-y divide-border-subtle`.
7. **Phone list** (`<ul className="divide-y divide-border-subtle border-t border-border-subtle md:hidden">`): each `li` = `flex items-start gap-3 px-4 pt-3` with a number badge (`flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-label text-text-secondary`), then name (`font-medium`) + StatusBadge in `flex items-start justify-between gap-2`, description caption; when `canManage`, an action row `flex items-center px-1 py-1` of four buttons with kit phone classes `inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-label font-medium hover:bg-muted` + colour (`text-text-secondary` move, `text-primary` edit, `text-destructive` delete), icon + `list.moveUpShort` / `moveDownShort` / `editShort` / `deleteShort`, full `aria-label`s as on desktop. Footer for both layouts: `<TableCount total={sortedTopics.length} />` in `border-t border-border-subtle px-4 py-3`.
8. **Delete.** Replace the hand-made `Dialog` with `<ConfirmDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} title={t('list.deleteConfirmTitle')} description={t('list.deleteConfirmBody', { name: deleting.name })} confirmLabel={t('list.deleteConfirmAction')} cancelLabel={t('actions.cancel', { ns: 'common' })} tone="danger" busy={deleteTopic.isPending} onConfirm={handleDelete} />`.
9. **Reorder error.** `reorderTopics.mutate(…, { onError: () => notifyOutcome({ tenantId: captureNotificationTenant(), variant: 'error', message: t('list.reorderFailed') }) })`; delete the inline `<p role="alert">`.
10. **Topic form** (`-syllabus-topic-form.tsx`): `<DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>`; labels `text-label text-text-primary`; required mark on নাম; the empty-name message goes under the name input (`flex items-center gap-1 text-caption text-destructive` + `CircleAlert`, `aria-invalid`, `aria-describedby`); status `SelectTrigger` gets an `id` + `<label htmlFor>` instead of `aria-label`; footer `DialogFooter` = outline Cancel (`actions.cancel` from common) then primary submit. Keep the `genericError` block as `role="alert"` above the footer.
11. **i18n** (`syllabus.json`, en + bn):
    | key | en | bn |
    |---|---|---|
    | `list.subtitle` | Pick a class and a subject, then put the topics in teaching order. | শ্রেণি ও বিষয় বেছে নিয়ে পাঠের বিষয়বস্তু ক্রম অনুযায়ী সাজান |
    | `list.pickersLabel` | Class and subject | শ্রেণি ও বিষয় |
    | `list.pickTitle` | Pick a class and a subject | শ্রেণি ও বিষয় বেছে নিন |
    | `list.emptyTitle` | No topics yet | এখনো কোনো বিষয়বস্তু নেই |
    | `list.emptyExplanation` | Add the first topic and it shows up here in order. | প্রথম বিষয়বস্তু যোগ করলে এখানে ক্রম অনুযায়ী দেখা যাবে। |
    | `list.progress` | {{done}} of {{total}} topics done | {{total}}টির মধ্যে {{done}}টি বিষয়বস্তু সম্পন্ন |
    | `list.columnSequence` | No. | ক্রম |
    | `list.columnOrder` | Reorder | সাজান |
    | `list.moveUpShort` | Up | উপরে |
    | `list.moveDownShort` | Down | নিচে |
    | `list.editShort` | Edit | সম্পাদনা |
    | `list.deleteShort` | Delete | মুছুন |
    Remove `list.columnDescription`, `list.columnActions` ("কার্যক্রম" — common `table.actions` "কাজ" replaces it), `list.selectClass`, `list.selectSubject`, `form.cancel`, `list.emptyMessage` once nothing reads them.

## Tests
- `index.test.tsx`: before picking, the EmptyState title `list.pickTitle` is shown (an `h2`); picking class + subject puts `class_id`/`subject_id` in the URL and lists topics in sequence order with numbers ১, ২…; the progress line counts DONE topics; empty list shows `list.emptyTitle`; moving a topic down still sends both rows' swapped sequence; editing status still PATCHes; delete goes through the ConfirmDialog (`role="alertdialog"`) and calls the delete endpoint; a role without `SYLLABUS_READ` is still refused; a reorder failure calls `notifyOutcome` with variant `error`.
- `e2e/keyboard/syllabus.spec.ts`: `getByLabel(classLabel/subjectLabel)` keeps working (visible `<label htmlFor>`); `getByRole('cell', { name: 'First topic', exact: true })` keeps working as long as the seeded topics have no description (the description line renders only when present) — if they have one, switch to `getByRole('row').filter({ hasText: 'First topic' })`. Row order check via `getByRole('row')` is unchanged (desktop table).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Reloading the page keeps the picked class and subject.
- [ ] No underlined text link in the table; edit/delete are icons with tooltips; up/down disabled at the ends.
- [ ] Progress line and "মোট n টি" match the loaded topics.
- [ ] Delete asks in a ConfirmDialog; no red filled button anywhere else.

## Out of scope
- Drag-and-drop reordering (buttons stay; the file header explains why).
- Filtering the subject picker to the class's subjects (see Decisions).
- `/portal/syllabus` is the portal lane's page.
- No shared requests filed for this ticket.

Wave: 9   Lane: homework   Decisions: D6, D9, D15, D16, D19, D21, D25, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.homework-2
