# [31.4.students-1] Students list — labelled filters, icon actions, one primary

## Goal
`/students` matches the "after" screenshots: one header with a single filled "Add student", labelled filters (sheet on phone), icon row actions, class and section in one column, a visible total and 25 rows per page.

## What and why
The page is where staff find a student and act on them (open, edit, collect fees, print ID cards, message guardians). Today the header has three outline buttons plus the primary and spills off a phone screen, filters have no labels (status shows raw `ACTIVE`, gender is a free-text box, dates are typed as `YYYY-MM-DD`), row actions are underlined text links, and the pager never says how many students there are. The redesign keeps every existing capability but puts it into the kit patterns: PageHeader with More, FilterBar with labels and a phone sheet, DataTable with RowActions and TableCount.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students/mobile.webp?raw=true" width="260"> |

The "after" shots show the page with the class filter "সপ্তম" and section "ক" applied and two rows selected, so the chips, the "print whole section" button and the selection bar are all visible.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Breadcrumb | Gone on this page (one-crumb trail). | C7: it repeated the h1. |
| 2 | Header | `PageHeader` title "শিক্ষার্থী". Desktop: outline "শিক্ষার্থী আমদানি", outline "পুরো {class}-{section}-এর আইডি কার্ড প্রিন্ট" (only when class AND section are filtered, as today), filled "শিক্ষার্থী যোগ করুন", then More (`ellipsis`) holding "ছবি আপলোড". Phone: primary full width + More (import, print whole section, photo upload move into More). | D16/D29: one primary, nothing spills off the phone. |
| 3 | Filters | `FilterBar` with a visible label on every field: খুঁজুন (search, 4 cols), শ্রেণি, শাখা, অবস্থা, লিঙ্গ (2 cols each), শিফট / ভার্সন (unchanged rule: only with 2+ entries), জন্ম তারিখ range (two DatePicker triggers). Active filters as chips + "সব মুছুন". | D24/D25. |
| 4 | Status filter | Options show `সক্রিয় / নিষ্ক্রিয় / স্থানান্তরিত / উত্তীর্ণ` (from `common:status.enrollment.*`), never `ACTIVE`. | D9. |
| 5 | Gender filter | A select (সকল লিঙ্গ / পুরুষ / নারী / অন্যান্য, values `MALE`/`FEMALE`/`OTHER`) instead of a free-text box. **New** options. | D25; admission already writes these values (`applicant-review.service.ts:237`). |
| 6 | Table columns | Class and section merged into one "শ্রেণি" column (`সপ্তম · ক`); the separate "শাখা" column is removed. Roll right-aligned. Header "কার্যক্রম" → "কাজ". | Kit DataTable; D32. |
| 7 | Hidden columns | Date of birth via `formatDate`; gender and preferred contact show translated labels, never `MALE` / `SMS`. | D5, D9. |
| 8 | Row actions | `RowActions`: দেখুন (`view`, link to detail), সম্পাদনা (`edit`, link to `/students/$id/edit`, **New**, needs `STUDENT_UPDATE`), ফি আদায় (`pay`, link to `/payments/record?student_id=`, needs `FEE_COLLECT`). Phone cards show the same three with labels. | D19, C12. |
| 9 | Phone cards | Title = name + status badge; subtitle `{class} · শাখা {section} · রোল {roll}`; fields রেজিস্ট্রেশন নম্বর, অভিভাবক; selection checkbox at the card's top-left (44 px target); selected card gets `border-primary`. | Kit DataTable card mode. |
| 10 | Selection bar | "২ জন নির্বাচিত" + outline রিমাইন্ডার পাঠান, outline আইডি কার্ড প্রিন্ট (n), outline সিএসভি এক্সপোর্ট, ghost "নির্বাচন বাতিল" (was "মুছুন", which reads as "delete"). Today two of these are filled. | D29, D32. |
| 11 | Footer | `TableCount` "১–২৫ দেখানো হচ্ছে, মোট ৪৮" + rows-per-page + pager; default 25 rows. | D19, B23. |
| 12 | Empty / error | `EmptyState` (title = `list.emptyMessage`, one sentence, outline "শিক্ষার্থী যোগ করুন" when allowed); the migrate-whole-school sentence + link sits under it as today. `ErrorState` with Retry for `list.errorMessage`. | D28. |

## Mobile behaviour
- Header: title, then one row — primary "শিক্ষার্থী যোগ করুন" (`flex-1`) + More. No outline buttons inline.
- Filters: search field + outline "ফিল্টার (n)" opening the `FilterSheet` (all non-search fields, full width, footer "সব মুছুন" + "n টি ফলাফল দেখুন"). Chips stay visible under the search.
- A row above the cards: "এই পাতার সব" checkbox (tri-state) on the left, the existing sort menu ("সাজান: {column}") on the right.
- Table becomes cards (DataTable card mode); selection bar buttons wrap.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where "print whole section" lives | More menu always · inline outline when it applies | Inline outline on desktop when class+section are filtered, in More on phone | It is the reason a teacher filters to a section; keeps `e2e/journeys/print-id-cards.spec.ts` working unchanged (button found by name). 1 primary + 2 outline is the PageHeader maximum. |
| Photo upload | Inline outline · More | More | Rare bulk task; keeps the header to the maximum. |
| Edit row action | Leave out · add | Add (**New**, link only) | The edit route exists; three actions is the RowActions limit with no More. |
| Class + section | Two columns · one | One `সপ্তম · ক` | Same as the kit; frees width for guardian. |
| Gender filter values | Free text · select of 3 | Select `MALE/FEMALE/OTHER` | Server filters by exact match; admission writes these values; students-2 makes the form write them too. Legacy free-text values remain findable by search only. |

## Files
- `client-admin/src/routes/_staff/students/index.tsx` — header actions, filters, columns, RowActions, selection-bar buttons, page size, empty state
- `client-admin/src/routes/_staff/students/index.test.tsx` — update assertions
- `client-admin/src/routes/_staff/students/-student-form-schema.ts` — add the exported `GENDER_VALUES` constant only
- `ui/src/i18n/locales/bn/students.json` — `list.*` keys below
- `ui/src/i18n/locales/en/students.json` — same keys

## Steps
1. **Page size.** Delete `{ limit: 10 }` from `useListShellState(...)` and change `limit: search.limit ?? 10` in `loaderDeps` to the shared default exported by 31.2.4 (`DEFAULT_PAGE_SIZE` from `@biddaloy/ui/shells`; if it is not exported, use `25`). Pass no `pageSizeOptions`.
2. **Header.** Replace the `primaryAction` `<div>` with the `PageHeader` actions API used by `ListShell` (patterns.md "PageHeader"): `actions = [ { id:'import', label:t('list.importStudents'), icon:<UploadIcon/>, priority:'secondary', allowed:canBulkImport, onClick: navigate('/students/import') }, { id:'print-section', label:t('list.printWholeClass',{name}), icon:<IdCardIcon/>, priority:'secondary', allowed: canPrint && wholeClass!==undefined, onClick: printPreview(...) }, { id:'add', label:t('list.addStudent'), icon:<PlusIcon/>, priority:'primary', allowed:canAddStudent, onClick: navigate('/students/new') }, { id:'photos', label:t('bulkPhotos.action'), icon:<ImageUpIcon/>, priority:'tertiary', allowed:canUpdateStudent, onClick: ()=>setPhotosDialogOpen(true) } ]`. Tertiary goes into More; PageHeader moves secondary into More on phone by itself. No subtitle.
3. **Filters.** In `filterFields`:
   - `enrollment_status` options: `label: t(\`status.enrollment.${status}\`, { ns: 'common' })`.
   - Replace the `gender` text field with `{ kind:'select', key:'gender', label:t('list.genderFilterLabel'), allLabel:t('list.allGenders'), options: GENDER_VALUES.map(v => ({ value:v, label:t(\`form.fields.genderOptions.${v}\`) })) }` importing `GENDER_VALUES` from `./-student-form-schema` — add it there now: `export const GENDER_VALUES = ['MALE', 'FEMALE', 'OTHER'] as const;` (students-2 reuses it for the form).
   - Keep the order search, class, section, status, gender, shift, version, date of birth. Labels are already visible by the FilterBar foundation change; drop the duplicated `placeholder` on search (`placeholder: t('list.searchPlaceholder')` = "নাম, রোল বা রেজিস্ট্রেশন নম্বর").
4. **Columns.**
   - `roll`: `align: 'end'`, value `formatNumber(row.roll_number, regionConfig)`.
   - `class`: value `` `${row.class_section.class.name} · ${row.class_section.section_name}` ``, `card: 'subtitle'` rendered through `t('list.cardSubtitle', { class, section, roll })` — if `DataTable` card subtitle only takes the column value, keep the column value as `class · section` and put roll in the `dl`.
   - Delete the `section` column (also from the CSV export? **no** — `exportSelectedToCsv` keeps its own Section column).
   - `dateOfBirth`: `row.date_of_birth ? formatDate(row.date_of_birth, regionConfig) : t('list.emptyValue')`.
   - `gender`: `genderLabel(row.gender)` — a local helper: known `MALE/FEMALE/OTHER` → `t('form.fields.genderOptions.X')`, any other non-empty string → shown as typed (human free text), empty → `—`.
   - `preferredCommunication`: `t(\`form.preferredCommunicationOptions.${row.preferred_communication}\`)`.
   - Remove the hand-built `actions` column; pass `rowActions={(row) => [ { intent:'view', label:t('list.view'), to: detail link (keep the `openPerformance` → `?tab=performance` search) }, { intent:'edit', label:t('list.edit'), to:'/students/$studentId/edit', allowed:canUpdateStudent }, { intent:'pay', label:t('list.collectFees'), to:'/payments/record?student_id=…', allowed:canCollectFees } ]}`. Keep `data-focus-anchor={row.id}` on the view action (see Out of scope if RowAction cannot carry it).
5. **Selection bar.** In `bulkActions`, make "রিমাইন্ডার পাঠান" and "আইডি কার্ড প্রিন্ট" `variant="outline"` (drop `size="sm"` — the shared Button sizes are `h-11 md:h-8`), add icons `SendIcon`, `IdCardIcon`, `DownloadIcon`, `XIcon`; the clear button stays `variant="ghost"`.
6. **Empty state.** Replace `emptyMessage` with `emptyState={{ title: t('list.emptyMessage'), explanation: t('list.emptyExplanation'), action: canAddStudent ? { label: t('list.addStudent'), onClick: navigate('/students/new') } : undefined }}`. Keep the migrate sentence below it, unchanged.
7. **i18n** (`students.json`, bn / en):
   - change `list.columnActions`: "কাজ" / "Actions"
   - change `list.clearSelection`: "নির্বাচন বাতিল" / "Clear selection"
   - add `list.edit`: "সম্পাদনা" / "Edit"
   - add `list.allGenders`: "সকল লিঙ্গ" / "All genders"
   - add `list.searchPlaceholder`: "নাম, রোল বা রেজিস্ট্রেশন নম্বর" / "Name, roll or registration number"
   - change `list.searchLabel`: "খুঁজুন" / "Search" (it is now the visible label; `e2e` uses the key, not the text)
   - add `list.cardSubtitle`: "{{class}} · শাখা {{section}} · রোল {{roll}}" / "{{class}} · Section {{section}} · Roll {{roll}}"
   - add `list.emptyExplanation`: "প্রথম শিক্ষার্থী যোগ করলে তালিকা এখানে দেখা যাবে।" / "Add your first student and the list will show up here."
   - add `form.fields.genderOptions.MALE/FEMALE/OTHER`: "পুরুষ"/"নারী"/"অন্যান্য" — "Male"/"Female"/"Other" (added here; students-2 reuses them).
8. Remove every raw `className` with `text-sm`/`underline` from this file — nothing inline-styled remains.

## Tests
- `client-admin/src/routes/_staff/students/index.test.tsx`: status filter options read "সক্রিয়" (not `ACTIVE`); gender filter is a select with 3 options; row actions render buttons/links named "দেখুন", "সম্পাদনা", "ফি আদায়" and hide edit/pay without the permission; "শাখা" column header is gone and the class cell reads `সপ্তম · ক`; header has exactly one primary button; "ছবি আপলোড" is inside the More menu; bulk buttons are not `variant=default`; default request uses `limit=25`.
- E2E: `e2e/journeys/list-transitions.spec.ts`, `url-state.spec.ts`, `student-admission.spec.ts` use `students.list.view` / `searchLabel` keys — accessible names are kept, so no edit expected. `url-state.spec.ts` seeds 11 students for "page 2"; with 25 per page that spec is owned by 31.2.4 (page-size foundation) — do not edit it here. `print-id-cards.spec.ts` finds the print-whole-class button by name on desktop — unchanged.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No breadcrumb row above "শিক্ষার্থী".
- [ ] Status and gender filters show Bangla labels; every filter has a visible label; phone shows search + "ফিল্টার (n)".
- [ ] Row actions are three coloured icons with tooltips on desktop, labelled on phone cards.
- [ ] Table footer shows "১–২৫ দেখানো হচ্ছে, মোট N"; default 25 rows.
- [ ] Selection bar has no filled button and says "নির্বাচন বাতিল".

## Out of scope
- `data-focus-anchor` on the view action depends on `RowActions` forwarding extra attributes — filed in shared-requests.md.
- Guardian phone in the table (the kit's sample shows it) — the list API row has guardians but adding a column is a new feature; left out.
- Legacy free-text gender values cannot be picked in the new filter (still found by search).
- `url-state.spec.ts` / `list-transitions.spec.ts` page-size assumptions — 31.2.4 (filed).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| RowActions item carries data-focus-anchor | Accepted | 31.2.4a (type 31.1.2a) | { intent: 'view', label, to, 'data-focus-anchor': row.id } |
| url-state / list-transitions specs assume 10 rows | Accepted | 31.3.8a | specs open /students?limit=25 and seed 26 / 50; students-1 may drop limit: 10 freely |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: students   Decisions: D5, D6, D9, D16, D19, D24, D25, D27, D28, D29, D32   Depends on: 31.3.8b
