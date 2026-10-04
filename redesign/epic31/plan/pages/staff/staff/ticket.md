# [31.4.staff-1] Staff list — labelled filters, icon actions, one status column

## Goal
`/staff` and its "Add staff member" dialog match the "after" screenshots: one filled "কর্মী যোগ করুন", labelled filters (sheet on phone), name + email in one cell, user status and invitation in one "অবস্থা" column, three icon row actions, a visible total and 25 rows per page.

## What and why
The page is where an admin finds a person who can sign in to the school and opens, edits, removes or prints an ID card for them. Today the filters have no labels and dates are typed as `YYYY-MM-DD`, every row repeats two green badges ("সক্রিয়" + "সক্রিয় করা হয়েছে"), row actions are an underlined link plus a text button, the selection bar has a filled button next to the page's filled button, and nothing says how many people there are. The redesign keeps every capability and moves it into the kit: PageHeader, FilterBar, DataTable with RowActions and TableCount, and a kit Dialog for "Add staff member".

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff/mobile.webp?raw=true" width="260"> |

The "after" shots show the status filter "সক্রিয়" applied and two rows selected, so the chip and the selection bar are visible. The tooltip on row 4 shows what every icon gets on hover.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Breadcrumb | None on this page (one-crumb trail, rendered by the layout). | D16 |
| 2 | Header | `PageHeader` title "কর্মী", subtitle **New** "এই স্কুলে যাঁরা সাইন ইন করতে পারেন". Actions: outline "শিক্ষক প্রোফাইল দিন" (was "শিক্ষক হিসেবে উন্নীত করুন"), filled "কর্মী যোগ করুন" (was "ব্যবহারকারী যোগ করুন"). Phone: primary full width + More (holds the outline action). | D16, D29, D32 |
| 3 | Filters | `FilterBar`, every field labelled: খুঁজুন (4 cols, placeholder "নাম বা ইমেইল"), ভূমিকা, অবস্থা, আমন্ত্রণ, পদবি (2 cols each), যোগদানের তারিখ (two DatePicker triggers, 4 cols, second row). Chips + "সব মুছুন". | D24, D25 |
| 4 | Name column | Name (`font-medium`) with the email under it in `text-caption text-text-secondary`; the separate "ইমেইল" column is removed. Sorting by name stays. | Frees width; one person = one cell |
| 5 | Status column | One "অবস্থা" column: the user-status badge, plus the invitation badge **only when** `invitation_status !== 'ACTIVATED'`. The separate "আমন্ত্রণ" column is removed (the filter stays). | Every row repeated two green badges; the invitation only matters while it is open |
| 6 | Joined | `formatDate` (already) — header "যোগদান", sortable. | D5 |
| 7 | Row actions | `RowActions`: দেখুন (`view`, link to `/staff/$userId`), সম্পাদনা (`edit`, **New** — opens the existing `EditUserDialog` for that row, needs `USER_UPDATE`), স্কুল থেকে সরান (`remove`, opens `RemoveMemberDialog`, needs `MEMBER_REMOVE`). Phone cards show the three with labels. | D19 |
| 8 | Phone cards | Title = name + user-status badge; email on the line under the name; invitation badge beside the status badge when not activated; `dl` ভূমিকা, ফোন, যোগদান. Selection checkbox top-start (44 px). | Kit DataTable card mode |
| 9 | Selection bar | "২ জন নির্বাচিত" + outline "আইডি কার্ড প্রিন্ট (২)" + ghost "নির্বাচন বাতিল" (was filled + "নির্বাচন মুছুন"). | D29, D32 |
| 10 | Footer | `TableCount` "১–২৫ দেখানো হচ্ছে, মোট ৩৪" + rows-per-page + pager; default 25 rows. | D19, B23 |
| 11 | Empty / error | `EmptyState` (title `list.emptyMessage`, sentence **New** `list.emptyExplanation`, outline "কর্মী যোগ করুন" when allowed). Error stays `list.errorMessage` through `ErrorState` with Retry. | D28 |
| 12 | Add dialog | `DialogContent size="md"`; title "কর্মী যোগ করুন"; four `FormField`s (পূর্ণ নাম *required*, ইমেইল, ফোন, ভূমিকা *required*) with real labels; role Select placeholder "বাছুন", each option shows the role + its one-line description; validation errors sit under their own field (name / role) instead of one alert at the bottom; duplicate-email (409) error sits under the email field; footer Cancel (outline) + "কর্মী যোগ করুন" (primary, busy state "যোগ করা হচ্ছে…"). | D21, D25 |

## Mobile behaviour
- Header: title, subtitle, then one row — "কর্মী যোগ করুন" (`flex-1`) + More ("শিক্ষক প্রোফাইল দিন").
- Filters: search + "ফিল্টার (n)" opening the `FilterSheet` (role, status, invitation, designation, joined from / to). Chips stay visible.
- A row above the cards: "এই পাতার সব" checkbox + "সাজান: নাম" sort menu (DataTable card mode provides both).
- Selection bar buttons wrap; the Add dialog's footer stacks (primary on top), as the kit Dialog does by itself.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Invitation column | Keep · drop · merge into status | Merge: invitation badge next to the status badge only when not activated | 95% of rows showed "সক্রিয় করা হয়েছে"; an open invitation is the only time it needs attention. The filter still finds them. |
| Email column | Keep · under the name | Under the name | The table had 9 columns and wrapped on 1440 px. |
| Primary label | "ব্যবহারকারী যোগ করুন" · "কর্মী যোগ করুন" | "কর্মী যোগ করুন" | D32: the page is "কর্মী"; the dialog creates any staff role. |
| Promote label | "শিক্ষক হিসেবে উন্নীত করুন" · "শিক্ষক প্রোফাইল দিন" | "শিক্ষক প্রোফাইল দিন" | "উন্নীত" reads like a job promotion; the dialog gives an existing member a teacher profile. |
| Edit row action | Leave out · add | Add (opens existing `EditUserDialog`) | The dialog takes a `StaffUser`, which the row already is; saves a trip to the detail page. |
| Add dialog | Dialog · FullPageShell | Dialog `md` | 4 fields, no steps (D21). |

## Files
- `client-admin/src/routes/_staff/staff/index.tsx` — header actions, filters, columns, RowActions, bulk bar, page size, empty state
- `client-admin/src/routes/_staff/staff/index.test.tsx` — update assertions
- `client-admin/src/routes/_staff/staff/-add-user-dialog.tsx` — kit dialog form, per-field errors
- `client-admin/src/routes/_staff/staff/-promote-teacher-dialog.tsx` — title/button text keys only (new labels, step 7)
- `ui/src/i18n/locales/bn/staff.json` — keys below
- `ui/src/i18n/locales/en/staff.json` — same keys

## Steps
1. **Page size.** Delete `{ limit: 10 }` in `useListShellState(...)` and replace `limit: search.limit ?? 10` in `loaderDeps` with the shared default from 31.2.4 (`DEFAULT_PAGE_SIZE` from `@biddaloy/ui/shells`; if not exported, `25`). No `pageSizeOptions`.
2. **Header.** Drop the `primaryAction` `<div>`; pass `subtitle={t('list.subtitle')}` and `actions={[ { id:'promote', label:t('list.promoteTeacher'), icon:<UserRoundCheckIcon/>, priority:'secondary', allowed:canCreate, onClick:()=>setPromoteOpen(true) }, { id:'add', label:t('list.addUser'), icon:<PlusIcon/>, priority:'primary', allowed:canCreate, onClick:()=>setAddUserOpen(true) } ]}` (PageHeader pattern; it moves the secondary into More on phone by itself).
3. **Filters.** Keep the six `filterFields` and their order. Search: `label: t('list.searchLabel')` (now "খুঁজুন"), `placeholder: t('list.searchPlaceholder')`. The date range keeps its keys; the FilterBar foundation renders DatePickers (no typed `YYYY-MM-DD`). Do not change filter keys — they are URL params.
4. **Columns** (in this order):
   - `name`: `accessorFn: (row) => <><span className="font-medium">{row.full_name}</span>{row.email && <span className="block text-caption text-text-secondary">{row.email}</span>}</>`, `sortable: true`, `card: 'title'` (the card title then carries the email line under the name — same look as the mockup's subtitle). Delete the separate `email` column. Keep `SORT_FIELD_BY_COLUMN.email` (harmless) or remove it — the column no longer exists.
   - `phone`: unchanged (`formatStaffPhone`, D8 format comes from the foundation `formatPhone`).
   - `role`: unchanged.
   - `status`: `accessorFn: (row) => <div className="flex flex-wrap gap-1"><StatusBadge domain="user" status={row.status}/>{row.invitation_status !== 'ACTIVATED' && <StatusBadge domain="invitation" status={row.invitation_status}/>}</div>`, `sortable: true`, `card: 'badge'` (card mode shows both badges in the badge slot; DataTable uses only one badge cell per card).
   - Delete the `invitation_status` column.
   - `joined`: unchanged.
   - Delete the hand-built `actions` column; pass `rowActions={(row) => [ { intent:'view', label:t('list.view'), to:`/staff/${row.id}` }, { intent:'edit', label:t('list.edit'), allowed:canUpdate, onClick:()=>setEditTarget(row) }, { intent:'remove', label:t('detail.actions.remove'), allowed:canRemove, onClick:()=>setRemoveTarget(row) } ]}` with `const canUpdate = useHasPermission(Permission.USER_UPDATE)` and `const [editTarget, setEditTarget] = React.useState<StaffUser | null>(null)`; render `{editTarget && <EditUserDialog open onOpenChange={(o) => !o && setEditTarget(null)} user={editTarget} />}` (import from `./-edit-user-dialog`). Keep `data-focus-anchor={row.id}` on the view action (see Out of scope).
5. **Bulk bar.** In `bulkActions`: print button `variant="outline"`, `IdCardIcon`, drop `size="sm"`; clear button stays `variant="ghost"` with `XIcon`.
6. **Empty state.** Replace `emptyMessage` with `emptyState={{ title: t('list.emptyMessage'), explanation: t('list.emptyExplanation'), action: canCreate ? { label: t('list.addUser'), onClick: () => setAddUserOpen(true) } : undefined }}`.
7. **Add dialog** (`-add-user-dialog.tsx`):
   - `<DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>`.
   - Wrap each field in `FormField` (`label`, `htmlFor`, `required` on name and role, `error` for its message). Replace `validationError: string | null` with `errors: { name?: string; role?: string }`; set `errors.name = t('addUser.errorNameRequired')` / `errors.role = t('addUser.errorRoleRequired')` and render them on their fields. A 409 renders `t('addUser.errorDuplicateEmail')` as the email field's `error`; any other failure keeps the `role="alert"` line `t('addUser.errorMessage')` above the footer.
   - Role `SelectTrigger` gets `id="add-user-role"` (the FormField label's `htmlFor`), drop its `aria-label`; `SelectValue placeholder={t('form.selectPlaceholder', { ns: 'common' })}` ("বাছুন"). Option description `className="text-caption text-text-secondary"` (was `text-xs text-muted-foreground`). Remove every `text-sm` class.
   - Footer: Cancel `variant="outline"` then submit (primary, `loading`).
   - Promote dialog: no layout change here; it only picks up the renamed keys (`teacherForm.promoteTitle`, `teacherForm.promoteSave`).
8. **i18n** (`staff.json`, bn / en):
   - change `list.searchLabel`: "খুঁজুন" / "Search"
   - add `list.searchPlaceholder`: "নাম বা ইমেইল" / "Name or email"
   - add `list.subtitle`: "এই স্কুলে যাঁরা সাইন ইন করতে পারেন" / "Everyone who can sign in to this school"
   - change `list.roleFilterLabel`: "ভূমিকা" / "Role"
   - change `list.addUser`: "কর্মী যোগ করুন" / "Add staff member"
   - change `list.promoteTeacher`: "শিক্ষক প্রোফাইল দিন" / "Give teacher profile"
   - change `list.columnActions`: "কাজ" / "Actions"
   - change `list.clearSelection`: "নির্বাচন বাতিল" / "Clear selection"
   - add `list.edit`: "সম্পাদনা" / "Edit"
   - add `list.emptyExplanation`: "কাউকে যোগ করলে তিনি এখানে দেখা যাবেন।" / "Add someone and they will show up here."
   - change `addUser.title` and `addUser.save`: "কর্মী যোগ করুন" / "Add staff member"
   - change `teacherForm.promoteTitle`: "শিক্ষক প্রোফাইল দিন" / "Give a teacher profile"; `teacherForm.promoteSave`: "শিক্ষক প্রোফাইল দিন" / "Give teacher profile"
9. Remove every inline `text-sm` / `underline` / `text-muted-foreground` class from `index.tsx`.

## Tests
- `client-admin/src/routes/_staff/staff/index.test.tsx`: no "ইমেইল" or "আমন্ত্রণ" column header; a row with `invitation_status: 'PENDING'` shows "আমন্ত্রণ মুলতুবি" in its status cell and an `ACTIVATED` row shows only "সক্রিয়"; row actions are buttons/links named "দেখুন", "সম্পাদনা", "স্কুল থেকে সরান" and edit/remove are hidden without `USER_UPDATE` / `MEMBER_REMOVE`; clicking "সম্পাদনা" opens the edit dialog with the row's name; header has exactly one primary button ("কর্মী যোগ করুন"); bulk print button is not `variant=default`; the first request uses `limit=25`.
- Add an `-add-user-dialog.test.tsx` case set (new file, next to the dialog): empty submit shows the name error under the name field and the role error under the role field; a 409 shows the duplicate-email message under the email field.
- E2E: `rg -n "staff.list|staff.addUser|teacherForm.promote" e2e` — specs read labels through `t()`, so the renamed values need no edit; if a spec matches the old literal text, switch it to `t()`.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Every filter has a visible label; joined date uses two date pickers; phone shows search + "ফিল্টার (n)".
- [ ] Table has 7 columns (select, name+email, phone, role, status, joined, actions); invitation badge appears only for non-activated rows.
- [ ] Row actions are three coloured icons with tooltips on desktop, labelled on phone cards.
- [ ] Footer shows "১–২৫ দেখানো হচ্ছে, মোট N"; default 25 rows.
- [ ] Add dialog is 560 px wide, required fields marked, errors under their own field.

## Out of scope
- `data-focus-anchor` on a `RowAction` with `to` — already filed by the students lane (shared-requests.md, students); until then focus restore after Back lands on the h1.
- The list also shows members whose role is শিক্ষার্থী / অভিভাবক (server `GET /users` returns every member). Filtering them out server-side is an API change (D1) — left alone.
- Palette registration of "কর্মী যোগ করুন" — 31.5.1b.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server GET /users excludes PARENT/STUDENT by default | Deferred | — | use the fallback in the ticket (role filter hides them) |

Wave: 9   Lane: staff   Decisions: D5, D8, D9, D16, D19, D21, D24, D25, D27, D28, D29, D32   Depends on: 31.3.8b
