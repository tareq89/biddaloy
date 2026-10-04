# [31.4.admissions-3] Admission rounds — class names, date ranges, kit form

## Goal
`/admissions/intakes` shows class and section names (never an id), one date-range column, number-formatted seats, StatusBadges and icon row actions; the create dialog and `/admissions/intakes/$intakeId` use the kit form (labels, required marks, `DatePicker`, Cancel + Save) inside a narrow page with crumbs.

## What and why
The admin uses these pages to open admissions for a class: how many seats, from when to when, which documents guardians must upload. Today the list shows the class section as a UUID (B12), dates as `2025-10-04`, the title as an underlined link, and the form uses browser date inputs, a placeholder "একটি শ্রেণি ও শাখা নির্বাচন করুন", no required marks and a full-width Save with no Cancel on a `max-w-xl` page with no crumbs. The redesign keeps the same fields and data and moves them onto the kit list and form, and links each round to its applicants.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_intakes/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_intakes/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_intakes/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_intakes/mobile.webp?raw=true" width="260"> |
| Before — round | _not captured_ | _not captured_ |
| After — round | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_intakes_intakeId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_intakes_intakeId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | List header | `actions=[{ priority: 'primary', label: "ভর্তি পর্ব যোগ করুন", icon: plus }]` (replaces deprecated `primaryAction`); **New** subtitle "কোন শ্রেণিতে কত আসনে, কবে থেকে কবে পর্যন্ত অনলাইনে আবেদন নেওয়া হবে।". | D16 |
| 2 | List class/section | `${row.class_name} · ${row.section_name}` from the list response (31.3.7); `—` if null. Delete the `sectionLabel` id fallback. | B12, D9 |
| 3 | List dates | Two columns "শুরু"/"শেষ" → one **New** column "আবেদনের সময়" = `formatDateRange(open_date, close_date)`. | D5; fewer columns |
| 4 | List seats | `formatNumber(row.seat_count)`, right-aligned. | D6 |
| 5 | List status | `StatusBadge`: চলমান (success), বন্ধ (neutral). | D27 |
| 6 | List row actions | Title becomes plain `font-medium` text. `view` "আবেদনকারী দেখুন" → `/admissions/applicants?intakeId=<id>` (**New** link to the existing filter), `edit` "সম্পাদনা" → `/admissions/intakes/<id>`. | D19, D29 |
| 7 | List empty | `emptyState`: `door-open` icon, "এখনো কোনো ভর্তি পর্ব নেই", "একটি পর্ব যোগ করলে অভিভাবকেরা অনলাইনে আবেদন করতে পারবেন।", outline action "ভর্তি পর্ব যোগ করুন". | D28 |
| 8 | `IntakeForm` (dialog + page) | Kit form: `Label` + required mark on all 5 inputs; `শিরোনাম` full width; select placeholder "বাছুন"; seat count `inputMode="numeric"`; `DatePicker` for শুরুর / শেষের তারিখ (no `type="date"`), help "এই দুই তারিখের মধ্যে অভিভাবকেরা অনলাইনে আবেদন করতে পারবেন।"; documents are a `fieldset` with legend "প্রয়োজনীয় নথি", help "আবেদনের সময় অভিভাবককে এগুলো আপলোড করতে হবে।" and 44 px checkbox rows. Date-range error moves under the close date as field error text. | D25, D17 |
| 9 | Create dialog | `DialogContent size="md"`, kit header/footer (Cancel outline, then "তৈরি করুন"). 6 fields → stays a Dialog. | D21 |
| 10 | Round page | `FormShell` (narrow `PageContainer`) with crumbs ভর্তি পর্ব › <title>; h1 = title + `StatusBadge`; **New** subtitle "nটি আবেদন জমা পড়েছে" (from `useApplicants({ intakeId }).data.length`; hidden while loading); outline header action "আবেদনকারী দেখুন" → the filtered applicants list. One Card "পর্বের তথ্য" holds the form; footer Cancel (outline, back to `/admissions/intakes`) + "সংরক্ষণ করুন". **New** success toast "সংরক্ষণ হয়েছে". | D15, D16, D29; the page had no crumbs, no cancel and no save feedback |

## Mobile behaviour
- List: primary full width under the title; cards = title, badge, class · section, fields আসন + আবেদনের সময় (full row), labelled actions "আবেদনকারী দেখুন" and "সম্পাদনা".
- Round page: crumbs, title + badge, "আবেদনকারী দেখুন" outline full width, form one column; footer Save on top of Cancel, both full width.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Edit as page or dialog | keep the route as a page / move edit into a dialog | keep the page | D1/D3 — no route changes; it now looks like a form page |
| Date columns | two / one range | one range column | Reads as one window; `formatDateRange` exists |
| Applicant count on list rows | add column / skip | skip | No count in the list API (see `useIntakes.ts` note); one request per row is wasteful. The round page shows it from one existing query. |
| Seat input digits | tenant numerals / as typed | as typed (Latin) | Number inputs parse Latin digits; display elsewhere uses `formatNumber` |
| Cancel on the round page | reset form / go back | navigate to `/admissions/intakes` | Matches "closing returns to where the user came from" |

## Files
- `client-admin/src/features/admission/IntakeList.tsx` — header actions, columns, row actions, empty state, dialog size
- `client-admin/src/features/admission/IntakeForm.tsx` — kit fields, `DatePicker`, fieldset, error placement
- `client-admin/src/features/admission/hooks/useIntakes.ts` — add `class_name`, `section_name` to the list row type
- `client-admin/src/routes/_staff/admissions/intakes/$intakeId.tsx` — `FormShell`, header, subtitle, footer, toast
- `client-admin/src/routes/_staff/admissions/intakes/index.test.tsx`
- `ui/src/i18n/locales/{en,bn}/admission-staff-intakes.json` — keys below

## Steps
1. **Locale (`admission-staff-intakes.json`, en + bn).** Change `form.classSectionPlaceholder` → "Select" / "বাছুন"; `form.requiredDocumentsLabel` "Required documents" / "প্রয়োজনীয় ডকুমেন্ট" → "প্রয়োজনীয় নথি". Add `list.subtitle` "Which class, how many seats, and when guardians can apply online." / "কোন শ্রেণিতে কত আসনে, কবে থেকে কবে পর্যন্ত অনলাইনে আবেদন নেওয়া হবে।"; `list.columnWindow` "Application window" / "আবেদনের সময়"; `list.viewApplicants` "View applicants" / "আবেদনকারী দেখুন"; `list.edit` "Edit" / "সম্পাদনা"; `list.emptyTitle` "No admission rounds yet" / "এখনো কোনো ভর্তি পর্ব নেই"; `list.emptyText` "Add a round so guardians can apply online." / "একটি পর্ব যোগ করলে অভিভাবকেরা অনলাইনে আবেদন করতে পারবেন।"; `form.datesHelp` "Guardians can apply online between these two dates." / "এই দুই তারিখের মধ্যে অভিভাবকেরা অনলাইনে আবেদন করতে পারবেন।"; `form.documentsHelp` "Guardians must upload these when applying." / "আবেদনের সময় অভিভাবককে এগুলো আপলোড করতে হবে।"; `detail.sectionTitle` "Round details" / "পর্বের তথ্য"; `detail.applicantCount_one` "{{count}} application received" / "{{count}}টি আবেদন জমা পড়েছে", `detail.applicantCount_other` same pattern; `detail.saved` "Saved" / "সংরক্ষণ হয়েছে". `list.columnOpenDate` / `list.columnCloseDate` become unused — delete them.
2. **`useIntakes.ts`.** `export type IntakeListRow = AdmissionIntake & { class_name: string | null; section_name: string | null }`; `intakesQueryOptions` returns `IntakeListRow[]`. Keep the `applicant_count` comment.
3. **`IntakeList.tsx`.** `useRegionConfig()`. Remove `useClassSectionOptions` and `sectionLabel` from this file. Columns: `title` → `row.title`, `card: 'title'`, `font-medium`; `classSection` → `row.class_name && row.section_name ? `${row.class_name} · ${row.section_name}` : '—'`, `card: 'subtitle'`; `seatCount` → `formatNumber(row.seat_count, regionConfig)`, `align: 'end'`; **New** `window` → `formatDateRange(row.open_date, row.close_date, regionConfig)`; `status` → `<StatusBadge tone={row.status === 'OPEN' ? 'success' : 'neutral'} label={t(row.status === 'OPEN' ? 'list.statusOpen' : 'list.statusClosed')} />`, `card: 'badge'`. `rowActions={(row) => [{ intent: 'view', label: t('list.viewApplicants'), to: `/admissions/applicants?intakeId=${row.id}` }, { intent: 'edit', label: t('list.edit'), to: `/admissions/intakes/${row.id}` }]}`. `subtitle`, `actions` (primary, `icon: <Plus />`, opens the dialog), `emptyState` with `action: { label: t('list.addIntake'), onClick: open }`. `useListShellState()` (default 25). Dialog: `DialogContent size="md"`.
4. **`IntakeForm.tsx`.** Root `grid gap-4 md:grid-cols-2`. Title field `md:col-span-2`. Every field = `FormItem`-style `flex flex-col gap-1.5` with `Label` + `<span className="text-destructive" aria-hidden="true">*</span><span className="sr-only">` required mark (use the `FormLabel required` prop if the foundation added one). Dates: `<DatePicker value={value.open_date ? parseServerDate(value.open_date) : undefined} onValueChange={(d) => onChange({ ...value, open_date: d ? toIsoDate(d) : '' })} config={regionConfig} />` (same for close; `min` on close = open date). Help `p.text-caption.text-text-secondary.md:col-span-2` `form.datesHelp`. Range error: under the close date as `flex items-center gap-1 text-caption text-destructive` with `CircleAlert`, and `aria-invalid` on that picker. Documents: `<fieldset className="flex flex-col gap-1.5 md:col-span-2">` → `legend` (`text-label`), help, then each `Checkbox` wrapped in `label className="flex min-h-11 items-center gap-3 md:min-h-8"`.
5. **`$intakeId.tsx`.** Render `<FormShell title={intake.title} subtitle={count === undefined ? undefined : t('detail.applicantCount', { count })} …>` — if `FormShell` cannot take a badge next to the title, render `PageContainer size="narrow"` + `PageHeader` directly and place the `StatusBadge` in the same `flex flex-wrap items-center gap-x-3` row as the h1 (`PATTERN: DetailHeader`). `const applicants = useApplicants({ intakeId })`; `count = applicants.data?.length`. Header action `{ id: 'applicants', label: t('list.viewApplicants'), priority: 'secondary', icon: <Users />, onClick: () => navigate({ to: '/admissions/applicants', search: { intakeId } }) }`. Body: `Card padded` with `h2 text-h2` `detail.sectionTitle`, `IntakeForm`, then the kit footer `mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:justify-end`: Cancel (outline, `navigate({ to: '/admissions/intakes' })`) + submit. `onSuccess: () => toast.success(t('detail.saved'))`. Drop the bare `h1`, `max-w-xl` and `flex flex-col gap-4` wrapper. Crumbs come from the layout (`items.admissionIntakes` → `items.admissionIntakeDetail`).
6. Run `yarn workspace @biddaloy/ui check:i18n`, the test file, then `graphify update .`.

## Tests
- `intakes/index.test.tsx`:
  - "creates an intake…": pick dates through the `DatePicker` (open trigger by its label, click a day) instead of typing into `type="date"`; the new row shows "প্রথম শ্রেণি · ক"-style names from a mocked list response carrying `class_name`/`section_name`, never the id.
  - "editing an intake saves the change": Save posts the same body; a success toast "সংরক্ষণ হয়েছে" appears; mock `GET /admission/applicants?intakeId=…` (the page now reads the count) and assert "৩টি আবেদন জমা পড়েছে"-style subtitle; Cancel navigates to `/admissions/intakes`.
  - "disables Create when close date is before open date": the error text sits under the close-date picker.
  - **New**: list row has links "আবেদনকারী দেখুন" (`/admissions/applicants?intakeId=<id>`) and "সম্পাদনা"; seats and dates render in Bangla digits / long form; empty list shows the empty state with an outline "ভর্তি পর্ব যোগ করুন".
- No e2e selector changes (`e2e/admission.spec.ts` seeds intakes over the API); run `e2e/keyboard/*` once to confirm the h1 still equals the nav label "ভর্তি পর্ব".

## Acceptance
- [ ] Desktop at 1440 px matches both "after" screenshots.
- [ ] Mobile at 390 px matches both "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The class/section column never shows a UUID (B12).
- [ ] No `<input type="date">` in the create dialog or the round page; both dates use `DatePicker`.
- [ ] Every form field has a visible label and required mark; the select shows "বাছুন" when empty.
- [ ] Round page shows crumbs, title + status badge, "আবেদনকারী দেখুন", and Cancel + Save; saving shows a toast.

## Out of scope
- Applicant count per row on the list — needs a server count field; not requested (D1).
- Last crumb on the round page shows the generic "ভর্তি পর্ব" until the intake resolver lands — shared request filed.
- Sidebar label still reads from `nav.json` (renamed to "ভর্তি পর্ব" by 31.3.4a).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| crumb resolver: intake title | Accepted | 31.3.5 | resolver key admissionIntakeDetail reads the intakeQueryOptions(id) cache -> title; keep using useIntake(id) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: admissions   Decisions: D5, D6, D9, D15, D16, D19, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.3.7, 31.4.admissions-2
