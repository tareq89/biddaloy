# [31.4.admissions-1] Admission applicants — labelled filters, status badges, readable dates

## Goal
`/admissions/applicants` matches the kit list: subtitle, labelled filters, an admission-round column, `StatusBadge` statuses, long dates, `01711-000004` phones, an icon "দেখুন" row action and a real empty state.

## What and why
Office staff use this page to find an application that came in through the public admission form and open it to decide on it. Today the filters have no labels, the reference number is an underlined link, statuses are plain pills (the "শর্টলিস্টেড" pill has no colour at all because `bg-status-pending-bg` is not a token), dates show as `2026-10-04` and phones as `01711000004`, and you cannot tell which admission round an applicant applied to. The redesign keeps the same data and filters and moves them onto the kit patterns.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_applicants/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_applicants/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_applicants/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_applicants/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `ListShell` gets **New** subtitle "অনলাইনে জমা পড়া ভর্তির আবেদন — খুলে যাচাই করুন ও সিদ্ধান্ত নিন।". No action (applications come from the public form). | D16 |
| 2 | Filters | Same two selects ("ভর্তি পর্ব", "অবস্থা") with visible labels from the kit `FilterBar` (4 + 3 columns). Phone: one "ফিল্টার (n)" button → sheet. | D24 |
| 3 | Reference number | Plain text (no underline link). Opening a row moves to a `view` row action "দেখুন". | D19, D29 |
| 4 | **New** column "ভর্তি পর্ব" | The round title, looked up from the already-loaded `useIntakes()` by `row.intake_id`; while intakes load show `—`, never the id. | Today you cannot tell rounds apart when "সব ভর্তি পর্ব" is selected; D9 |
| 5 | Phone column | `formatPhone(row.guardian_phone, regionConfig)` → `01711-000004`. | D8, B22 (`ApplicantList.tsx:87`) |
| 6 | Date column | Header "জমা দেওয়া হয়েছে" → "আবেদনের তারিখ"; value `formatDate(row.created_at, regionConfig)` instead of `created_at.slice(0, 10)`. | D5, B25 |
| 7 | Status | `StatusBadge tone label`: অপেক্ষমাণ (warning), বাছাই তালিকায় (info), ভর্তি হয়েছে (success), প্রত্যাখ্যাত (danger). Labels "মুলতুবি"/"শর্টলিস্টেড" become plain Bangla. The mapping lives in a **New** shared file used by admissions-2 too. | D27, D32; the hand-made pill used a missing token |
| 8 | Empty state | `emptyState`: `user-plus` icon, "এখনো কোনো আবেদন আসেনি", "অভিভাবকেরা অনলাইনে আবেদন করলে এখানে দেখা যাবে।" (no action). | D28 |

## Mobile behaviour
- Cards: title = applicant name, StatusBadge right; subtitle = admission round; fields রেফারেন্স নম্বর, আবেদনের তারিখ, অভিভাবকের ফোন; one labelled "দেখুন" action.
- Filters: "ফিল্টার (n)" button opens the kit sheet with both selects; active filters show as chips.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| How a row opens | underlined reference link / whole row click / `view` row action | `view` row action (a link via `to`) | D19/D29; the e2e helper clicks the row's first link, which is now this one |
| Search box | add client-side search on name / reference / phone / none | none | D1 (no new feature); the server has no search param. Noted under Out of scope. |
| Status wording | keep "মুলতুবি", "শর্টলিস্টেড" / plain words | "অপেক্ষমাণ", "বাছাই তালিকায়" | D32 plain wording; "অপেক্ষমাণ" is the kit's waiting word |
| Where tone/label mapping lives | inline in both files / one small module | `features/admission/applicantStatus.ts` | List and detail (admissions-2) show the same badge |

## Files
- `client-admin/src/features/admission/ApplicantList.tsx` — subtitle, columns, row action, badge, formatters, empty state
- `client-admin/src/features/admission/applicantStatus.ts` (**New**) — status → `{ tone, labelKey }`
- `client-admin/src/routes/_staff/admissions/applicants/index.test.tsx` — list cases (detail cases change in admissions-2, runs later)
- `ui/src/i18n/locales/{en,bn}/admission-staff-applicants.json` — keys below
- `e2e/admission.spec.ts` — open the row through the "দেখুন" link

## Steps
1. **Locale (`admission-staff-applicants.json`, en + bn).** Change `list.statusPending` "Pending" → "Awaiting review" / "মুলতুবি" → "অপেক্ষমাণ"; `list.statusShortlisted` "Shortlisted" (same) / "শর্টলিস্টেড" → "বাছাই তালিকায়"; `list.columnSubmittedDate` "Submitted" → "Applied on" / "জমা দেওয়া হয়েছে" → "আবেদনের তারিখ". Add `list.subtitle` "Applications sent through the online form — open one to review and decide." / "অনলাইনে জমা পড়া ভর্তির আবেদন — খুলে যাচাই করুন ও সিদ্ধান্ত নিন।"; `list.columnIntake` "Admission round" / "ভর্তি পর্ব"; `list.view` "View" / "দেখুন"; `list.emptyTitle` "No applications yet" / "এখনো কোনো আবেদন আসেনি"; `list.emptyText` "Applications appear here when guardians apply online." / "অভিভাবকেরা অনলাইনে আবেদন করলে এখানে দেখা যাবে।". (`list.filterIntake` is already "ভর্তি পর্ব" from 31.3.4b.)
2. **`applicantStatus.ts`.** `export const APPLICANT_STATUS: Record<AdmissionApplicantStatus, { tone: StatusBadgeTone; labelKey: string }> = { PENDING: { tone: 'warning', labelKey: 'list.statusPending' }, SHORTLISTED: { tone: 'info', labelKey: 'list.statusShortlisted' }, ADMITTED: { tone: 'success', labelKey: 'list.statusAdmitted' }, REJECTED: { tone: 'danger', labelKey: 'list.statusRejected' } }` (`StatusBadgeTone` type from `@biddaloy/ui/components`; if it is not exported, write the union inline).
3. **`ApplicantList.tsx`.** Delete `STATUS_BADGE_CLASS` and the local `statusLabel` record; build filter options from `APPLICANT_STATUS` (`label: t(labelKey)`). `const regionConfig = useRegionConfig()` (as in `routes/_staff/invoices/index.tsx:125`). `const intakeTitle = new Map((intakesQuery.data ?? []).map((i) => [i.id, i.title]))`.
   Columns, in order: `referenceNumber` → `row.reference_number` (plain text, `card: 'field'`); `applicantName` → `row.applicant_name`, `card: 'title'`, name cell `font-medium`; **New** `intake` header `t('list.columnIntake')` → `intakeTitle.get(row.intake_id) ?? '—'`, `card: 'subtitle'`; `guardianPhone` → `formatPhone(row.guardian_phone, regionConfig)`; `submittedDate` → `formatDate(row.created_at, regionConfig)`; `status` → `<StatusBadge tone={APPLICANT_STATUS[row.status].tone} label={t(APPLICANT_STATUS[row.status].labelKey)} />`, `card: 'badge'` (use the card-role names `DataTable` already has).
4. **Row action / header / empty.** `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/admissions/applicants/${row.id}` }]}`; `subtitle={t('list.subtitle')}`; replace `emptyMessage` with `emptyState={{ icon: <UserPlus />, title: t('list.emptyTitle'), explanation: t('list.emptyText') }}`. Keep `useListShellState({ limit: 25 })` → `useListShellState()` (25 is now the default, B23).
5. Run `yarn workspace @biddaloy/ui check:i18n`, the test file below, then `graphify update .`.

## Tests
- `applicants/index.test.tsx` → "lists applicants and links to the detail screen": the row has a link named "দেখুন"/"View" to `/admissions/applicants/<id>`; the reference number is not a link; phone renders `01711-000001`; date renders long form (no `2026-` ISO text); the admission-round cell shows the intake title from the mocked `/admission-intakes`; status renders "অপেক্ষমাণ" in a badge. Add: empty response shows "এখনো কোনো আবেদন আসেনি" and no pager.
- `e2e/admission.spec.ts` — `new ListShellPage(page, { titleKey: 'admission-staff-applicants.list.title', openLabelKey: 'admission-staff-applicants.list.view' })`.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (this page has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Both filters show a visible label; phone shows the "ফিল্টার" button and sheet.
- [ ] Every status is a coloured `StatusBadge` with an icon, including "বাছাই তালিকায়".
- [ ] The "ভর্তি পর্ব" column shows a round title, never an id.
- [ ] No underlined link in the table; "দেখুন" is an eye icon with a tooltip (desktop) / labelled button (phone).

## Out of scope
- A search box (name / reference / phone) — new feature, D1; add with a server `q` param if staff ask.
- Sidebar label and crumb wording come from `nav.json` (31.3.4a) — not changed here.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: admissions   Decisions: D5, D6, D8, D9, D16, D19, D24, D27, D28, D29, D32   Depends on: 31.3.8b
