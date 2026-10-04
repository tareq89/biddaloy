# [31.4.fees-2] Fee structures — labelled filters, year column, icon actions

## Goal
`/fee-structures` matches the "after" screenshots (header with subtitle and one filled "ফি কাঠামো যোগ করুন", labelled filters with a phone sheet, an academic-year column, icon row actions, a visible total, 25 rows per page), the add/edit dialog follows the kit form, and delete uses `ConfirmDialog`.

## What and why
This is where an admin sets how much each class pays for each fee, so fee bills come out right. Today nothing on the list says which academic year a structure belongs to (every structure is year-bound), filters have no visible labels, edit/delete are underlined text links, the add/edit dialog stacks six full-width fields with one shared error line, and the pager never says how many structures exist. The redesign keeps every capability but puts it into the kit: PageHeader, FilterBar with labels, DataTable with RowActions and TableCount, a two-column `md` Dialog with per-field errors, and `ConfirmDialog` for delete.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fee-structures/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fee-structures/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fee-structures/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fees/fee-structures/mobile.webp?raw=true" width="260"> |

The "after" shots show the academic-year filter "২০২৬" applied. The audit shot is from the admin role (`admin__fee-structures`). The add/edit dialog and the delete confirm are not in the screenshots: they are exactly `PATTERN: Dialog (md)` + `PATTERN: Form` and `PATTERN: ConfirmDialog` in `kit/patterns.html`.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Breadcrumb | Gone on this page (one-crumb trail). | C7. |
| 2 | Header | `PageHeader` title "ফি কাঠামো", subtitle "কোন শ্রেণির কোন ফি কত টাকা — এখানে ঠিক করা থাকে।" (**New**), primary "ফি কাঠামো যোগ করুন" (`plus`). | D16. |
| 3 | Filters | Every field labelled: খুঁজুন, শিক্ষাবর্ষ, শ্রেণি, শাখা, ফির ধরন; chips + "সব মুছুন". | D24. |
| 4 | Columns | নাম (`font-medium`, sortable), ধরন, শিক্ষাবর্ষ (**New** column, from the `academic_year` the list already returns), শ্রেণি · শাখা (`সপ্তম · ক`; "পুরো বিদ্যালয়" muted), পরিমাণ (right, sortable). | You could not tell which year a structure belongs to; D19. |
| 5 | Row actions | `RowActions`: সম্পাদনা (`edit`), মুছুন (`delete`), each behind its permission. | D19; today underlined text links. |
| 6 | Phone cards | Title = name; subtitle = class · section (or "পুরো বিদ্যালয়"); fields ধরন, পরিমাণ, শিক্ষাবর্ষ; labelled actions. | Kit DataTable card mode. |
| 7 | Footer | `TableCount` "১–৮ দেখানো হচ্ছে, মোট ৮" + rows per page; default 25. | D19, B23. |
| 8 | Empty / error | `EmptyState` title "কোনো ফি কাঠামো পাওয়া যায়নি" + sentence (**New**) + outline "ফি কাঠামো যোগ করুন" when allowed; `ErrorState` with Retry. | D28. |
| 9 | Add / edit dialog | `DialogContent size="md"`; fields in `grid gap-4 md:grid-cols-2`: নাম (full row), ফির ধরন + পরিমাণ, শিক্ষাবর্ষ (full row), শ্রেণি + শাখা. Visible `Label`s tied to each control (no `aria-label`), required marks on নাম, ফির ধরন, পরিমাণ, শিক্ষাবর্ষ; শিক্ষাবর্ষ empty shows "বাছুন"; in edit mode it is disabled with help "শিক্ষাবর্ষ পরে বদলানো যায় না।" (**New**); শাখা is disabled while শ্রেণি is "পুরো বিদ্যালয়". Each validation error sits under its own field; the server error stays above the footer. Save label "সংরক্ষণ করুন". | D21 (6 fields → dialog), D25, D17. |
| 10 | Delete | `ConfirmDialog tone="danger"`: title "ফি কাঠামো মুছুন", description = the existing question + side-effect sentence, confirm "মুছুন". A 409 or other failure closes the dialog and shows the existing message as an error toast. | D29: the only red filled button lives in `ConfirmDialog`. |

## Mobile behaviour
- Header: title, subtitle, then the primary full width.
- Filters: search + outline "ফিল্টার (n)" opening the `FilterSheet`; chips stay under the search.
- Sort menu "সাজান: নাম" above the cards; table becomes cards (DataTable card mode).
- Dialog fields stack in one column; footer buttons full width, primary on top (kit Dialog).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Academic-year column | leave out · add | add (**New**) | Structures are per year; the API already joins `academic_year` (`fees.service.ts:199`), so no server work. |
| Add/edit as dialog or full page | Dialog · FullPageShell | Dialog `md` | Exactly 6 fields, no steps, no table (D21). |
| Delete failure (409) | keep a custom dialog with an inline error · ConfirmDialog + toast | ConfirmDialog + toast | `ConfirmDialog` has no error slot; one shared confirm look everywhere; the toast keeps the existing translated message. |
| Section while "whole school" | enabled with one option · disabled · hidden | disabled | Shows it exists, avoids a layout jump. |
| Default year filter | none · current year | none (unchanged) | A default would hide last year's structures; not asked for (D1). |

## Files
- `client-admin/src/routes/_staff/fee-structures/index.tsx` — header, filters, columns, RowActions, page size, empty state
- `client-admin/src/routes/_staff/fee-structures/-structure-form-dialog.tsx` — kit dialog layout, labels, per-field errors
- `client-admin/src/routes/_staff/fee-structures/-delete-structure-dialog.tsx` — becomes a `ConfirmDialog` wrapper
- `client-admin/src/routes/_staff/fee-structures/index.test.tsx` — update assertions
- `ui/src/i18n/locales/bn/feeStructures.json` — keys below
- `ui/src/i18n/locales/en/feeStructures.json` — same keys

## Steps
1. **Page size (B23).** Delete `{ limit: 10 }` from `useListShellState(...)` (`:132`) and change `limit: search.limit ?? 10` (`:91`) to `DEFAULT_PAGE_SIZE` from `@biddaloy/ui/shells` (or `25`).
2. **Header.** Replace `primaryAction` with `subtitle={t('list.subtitle')}` and `actions={[{ id: 'add', label: t('list.addStructure'), icon: <PlusIcon />, priority: 'primary', allowed: canCreate, onClick: () => setCreateOpen(true) }]}` (PageHeader API).
3. **Filters.** Keep the descriptors and order; labels are visible via the FilterBar foundation change. Only the label strings change (step 8).
4. **Columns.**
   - `name`: unchanged (`card: 'title'`; DataTable gives the title cell `font-medium`).
   - `feeType`: unchanged.
   - **New** `academicYear` after `feeType`: header `t('list.columnAcademicYear')`, value `row.academic_year?.name ?? t('list.emptyValue')`.
   - `class`: header `list.columnClass` (new text, step 8); value `row.class === null ? <span className="text-text-secondary">{t('list.wholeSchool')}</span> : row.section ? \`${row.class.name} · ${row.section.section_name}\` : row.class.name`; `card: 'subtitle'`.
   - `amount`: move it last before actions; unchanged otherwise (`align: 'end'`, sortable).
   - Remove the hand-built `actions` column (`:263-294`); pass `rowActions={(row) => [{ intent: 'edit', label: t('list.edit'), allowed: canUpdate, onClick: () => setEditing(row) }, { intent: 'delete', label: t('list.delete'), allowed: canDelete, onClick: () => setDeleting(row) }]}`.
5. **Empty state.** Replace `emptyMessage` with `emptyState={{ title: t('list.emptyMessage'), explanation: t('list.emptyExplanation'), action: canCreate ? { label: t('list.addStructure'), onClick: () => setCreateOpen(true) } : undefined }}`.
6. **Form dialog** (`-structure-form-dialog.tsx`).
   - `<DialogContent size="md">`. Body: `<div className="grid gap-4 md:grid-cols-2">`; নাম and শিক্ষাবর্ষ fields get `md:col-span-2`.
   - Every field = `<div className="flex flex-col gap-1.5">` + `<Label htmlFor={id}>` (from `@biddaloy/ui/components`) + control with that `id`. Give the selects ids (`structure-form-type`, `-year`, `-class`, `-section`) on `SelectTrigger` and drop their `aria-label`s. Required mark after the label text for name, type, amount, year (create only): `<span className="text-destructive" aria-hidden="true">*</span><span className="sr-only">{t('form.required', { ns: 'common' })}</span>`.
   - Academic year: `SelectValue` with no `placeholder` prop (foundation default "বাছুন"); when `isEdit`, render `<p className="text-caption text-text-secondary">{t('form.academicYearLocked')}</p>` under it.
   - Section: `disabled={classId === ''}` on `Select` and `SelectTrigger`.
   - Errors: replace `validationError: string | null` with `errors: { name?: string; amount?: string; academicYear?: string }`; `handleSubmit` collects all three at once (no early returns), returns if any. Under the control render `<p id={`${id}-error`} className="flex items-center gap-1 text-caption text-destructive"><CircleAlertIcon className="size-3.5" aria-hidden="true" />{msg}</p>` and set `aria-invalid` + `aria-describedby` on the control (`border-destructive` comes from `aria-invalid` styling). Focus the first invalid field.
   - Server error (`mutation.isError`) stays one `role="alert"` line above the footer with the Error text classes.
   - Remove all `text-sm` / `font-medium` classNames on labels. Footer unchanged (Cancel outline, primary submit).
7. **Delete** (`-delete-structure-dialog.tsx`): keep the export name and props. Body becomes `<ConfirmDialog open onOpenChange tone="danger" title={t('deleteDialog.title')} description={`${t('deleteDialog.description', { name })} ${t('deleteDialog.sideEffect')}`} confirmLabel={t('deleteDialog.confirm')} busy={deleteStructure.isPending} onConfirm={() => deleteStructure.mutate(id, { onSuccess: onDeleted, onError: (error) => { onOpenChange(false); toast.error(error instanceof ApiError && error.statusCode === 409 ? t('deleteDialog.conflictMessage') : t('deleteDialog.errorMessage')); } })} />` (`ConfirmDialog`, `toast` from `@biddaloy/ui/components`). Keep the reset-on-open effect and the header comment's explanation of the real side effect.
8. **i18n** (`feeStructures.json`, bn / en):
   - add `list.subtitle`: "কোন শ্রেণির কোন ফি কত টাকা — এখানে ঠিক করা থাকে।" / "What each class pays for each fee."
   - add `list.columnAcademicYear`: "শিক্ষাবর্ষ" / "Academic year"
   - add `list.emptyExplanation`: "প্রথম ফি কাঠামো যোগ করলে তালিকা এখানে দেখা যাবে।" / "Add your first fee structure and it will show up here."
   - add `form.academicYearLocked`: "শিক্ষাবর্ষ পরে বদলানো যায় না।" / "The academic year can't be changed later."
   - change `list.columnClass`: "শ্রেণি · শাখা" / "Class · Section"
   - change `list.searchLabel`: "খুঁজুন" / "Search" (`e2e` uses the key)
   - change `list.feeTypeLabel`: "ফির ধরন" / "Fee type"; `list.allFeeTypes`: "সব ধরন" / "All types"; `form.feeTypeLabel`: "ফির ধরন" / "Fee type"
   - change `form.save`: "সংরক্ষণ করুন" / "Save"
   - delete `list.columnActions` (the actions header comes from `common:table.actions`).

## Tests
- `client-admin/src/routes/_staff/fee-structures/index.test.tsx`:
  - "renders every column…": headers include "শিক্ষাবর্ষ" and "শ্রেণি · শাখা"; the year cell shows the factory's year name; the actions header is `common:table.actions`.
  - "lets an ACCOUNTANT create and edit but not delete": edit is a button named "সম্পাদনা", no button named "মুছুন".
  - "refuses to submit the create form without a name": the error text sits under the name field (`toHaveAccessibleDescription`), and an empty amount shows its own error at the same time.
  - "disables only the academic year on edit…": also asserts the "শিক্ষাবর্ষ পরে বদলানো যায় না।" help text.
  - "names the real side effect in the delete dialog…": dialog role is `alertdialog`; description contains the side-effect sentence.
  - "explains a 409 on delete and leaves the row in place": the dialog closes and the conflict message appears (toast); the row is still listed.
  - Header has exactly one filled button; default request uses `limit=25` (update the "rows per page" case to pick 50).
- E2E: `e2e/a11y/overlay-openers.ts` opens the create dialog by `feeStructures.list.addStructure` — the header button keeps that label; `e2e/route-transitions.spec.ts:155` looks for heading "ফি কাঠামো" — unchanged. No e2e edit expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No breadcrumb row above "ফি কাঠামো".
- [ ] Every row shows its academic year.
- [ ] Edit / delete are coloured icons with tooltips on desktop, labelled on phone cards.
- [ ] Footer shows "১–N দেখানো হচ্ছে, মোট N"; default 25 rows.
- [ ] Add/edit dialog is two columns at `md`, every field has a visible label, errors sit under their field.
- [ ] Delete confirm has the red filled "মুছুন" and names the structure.

## Out of scope
- A default academic-year filter (current year) — not asked for; would change what the page shows by default.
- Archived (soft-deleted) structures (`include_deleted`) — the API supports it but the page never showed them; a new feature (D1).
- The delete-confirm a11y state in `e2e/a11y/overlay-openers.ts` (its own comment notes the gap) — foundation-owned file.

Wave: 9   Lane: fees   Decisions: D9, D16, D17, D19, D21, D24, D25, D28, D29, D32   Depends on: 31.3.8b, 31.4.fees-1
