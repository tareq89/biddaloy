# [31.4.platform-1] Schools list + new school — header button, full-page form

## Goal
`/schools` and `/schools/new` match the "after" screenshots: the list has a visible "নতুন স্কুল" button, Bangla status badges, long-form dates, a view action and a total, and the backup table reads as a titled section; "নতুন স্কুল" opens as a `FullPageShell` with a step indicator, a Cancel and the one primary in the footer.

## What and why
The platform operator (SUPER_ADMIN) uses `/schools` to see every school on the platform and to add a new one. Today there is no way to reach `/schools/new` from the page (no button), the status badge says "Active" in English, dates read `10/4/2026`, the name is an underlined link, the pager shows "page 1 of 1" with a page-size select for three rows, and the backup table repeats the school list under a small heading. The create form is a 260 px card with no step indicator and no way to cancel, its validation messages are English, and its success screen prints the raw invitation status (`PENDING`). The redesign uses the kit list and turns the two-step form into a full-page modal (D23 names "new school").

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — schools | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools/before-mobile.webp?raw=true" width="260"> |
| After — schools | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools/mobile.webp?raw=true" width="260"> |
| Before — new school | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools_new/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools_new/before-mobile.webp?raw=true" width="260"> |
| After — new school | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools_new/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools_new/mobile.webp?raw=true" width="260"> |

The "after — new school" shots show step 1 filled in.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | List header | `ListShell` title "স্কুল" + subtitle (existing `schools.caption`); primary "নতুন স্কুল" (`plus`) → `/schools/new`. **New** button. | D16; `/schools/new` was unreachable from the UI |
| 2 | Search | Field with visible label "স্কুল খুঁজুন" (`schools.searchLabel`) and `search` icon, 4 of 12 columns on desktop, full width on phone. | D24 (label was `aria-label` only) |
| 3 | Columns | নাম (plain `font-medium`, no underlined link) · লিংকের নাম · অবস্থা = `StatusBadge` tone + Bangla label (সক্রিয় success, স্থগিত warning) · তৈরি হয়েছে = `formatDate` · কাজ = RowActions `view` → `/schools/$schoolId`. | D9, D19, D27, D5 |
| 4 | List footer | `paginated={false}` → "মোট ৪টি"; the page-size select and "previous/next" go. | D19 (unpaginated, small N) |
| 5 | List empty / error | `EmptyState` when no school matches the search (title `schools.emptyMessage`, sentence **New**, no action); `ErrorState` with Retry. | D28 |
| 6 | Backup section | `h2` "ব্যাকআপের অবস্থা" + one-line subtitle (**New** key); columns স্কুল · কত দিন পরপর · শেষ চেষ্টা = StatusBadge (সম্পন্ন success, ব্যর্থ danger, চলছে / সারিতে info, সরানো neutral, never → neutral "কখনো হয়নি") · শেষ সফল ব্যাকআপ = `formatDateTime` · ব্যবহৃত জায়গা (end, tenant numerals). Unpaginated, "মোট n টি". | D5, D6, D27, D19 |
| 7 | New school frame | `FullPageShell size="form"` title "নতুন স্কুল", Close returns to `/schools`, asks before discarding typed values. Route sets `staticData: { chromeless: true }`. | D21–D23 |
| 8 | Step indicator | **New** route-local `ol` of two steps (১ স্কুলের তথ্য · ২ প্রথম অ্যাডমিন), current step filled, `aria-current="step"`. | Steps were invisible |
| 9 | Step 1 card | Card "স্কুলের তথ্য" + help (**New**); fields স্কুলের নাম *, লিংকের নাম * with help (**New**) explaining the allowed characters and the auto-fill. | D25 |
| 10 | Step 2 card | Card "প্রথম অ্যাডমিন" + help "ইমেইল বা ফোন — অন্তত একটি দিন। এই ঠিকানায় আমন্ত্রণ যাবে।" (**New**); fields অ্যাডমিনের নাম *, ইমেইল, ফোন in `grid gap-4 md:grid-cols-2` (name spans 2). | D25 |
| 11 | Footer | Step 1: বাতিল করুন (left) / পরবর্তী + `arrow-right` (right). Step 2: পেছনে (left) / স্কুল তৈরি করুন (right, busy while saving). Success: (none left) / স্কুল দেখুন (right). | D22, D29 |
| 12 | Validation text | The four English Zod messages become translated keys (**New**). | D9 |
| 13 | Success step | Card with `h2` "স্কুল তৈরি হয়েছে", the invitation as `StatusBadge domain="invitation"` (no raw `PENDING`), then the optional import disclosure unchanged in behaviour. | D9, D27 |

## Mobile behaviour
- List: title, subtitle, full-width "নতুন স্কুল"; search full width; each school is a compact two-line row inside one Card (name + badge, then "লিংকের নাম · তারিখ"), eye action 44 px on the right; same for the backup rows ("কত দিন পরপর · শেষ সফল · জায়গা" as the second line).
- New school: full screen, no app chrome, one column; step labels truncate; footer buttons 44 px.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Status label source | `StatusBadge domain="school"` (needs `common.status.school.*`, which does not exist — that is why it shows "Active") · `tone` + `label` from `platform.json` | `tone` + `label` with new `platform:schools.status.{ACTIVE,SUSPENDED}` | `common.json` is foundation-owned; the tone form exists (31.2.8b) and both platform pages use the same keys. |
| Backup table | merge into the schools table · keep a separate section | keep a separate titled section | Merging joins two queries and two error states; a clear `h2` fixes "where am I" at no risk. |
| Pagination | 25 per page · unpaginated | unpaginated | `useSchools()` returns the whole list and the platform runs a handful of schools (route comment). |
| Form frame | page · `FullPageShell` | `FullPageShell` on its own route | D23 names "new school"; the route exists, so the URL is the route. |
| Name → link-name auto-fill for Bangla names | transliterate · leave empty with help | leave empty, explain in help | `slugify()` keeps only `a-z0-9`; transliteration is a new feature (D1). |

## Files
- `client-admin/src/routes/_platform/schools/index.tsx` — header action, search label wiring, empty/error, backup section heading
- `client-admin/src/routes/_platform/schools/-schools-list-view.tsx` — ListShell props, columns, badge, `formatDate`, RowActions, unpaginated, search field
- `client-admin/src/routes/_platform/schools/-schools-list-view.stories.tsx` — add a "suspended school" row and an empty story
- `client-admin/src/routes/_platform/schools/-backup-health.tsx` — columns, badge, `formatDateTime`, numerals in sizes, unpaginated
- `client-admin/src/routes/_platform/schools/-backup-health.stories.tsx` — add FAILED + never rows
- `client-admin/src/routes/_platform/schools/index.test.tsx` — update assertions
- `client-admin/src/routes/_platform/schools/new.tsx` — `FullPageShell`, chromeless, footer per step, dirty, close
- `client-admin/src/routes/_platform/schools/-create-school-wizard.tsx` — step indicator, cards, help texts, translated validation, success step; drop the in-form buttons
- `client-admin/src/routes/_platform/schools/-create-school-wizard.stories.tsx` — stories per step
- `client-admin/src/routes/_platform/schools/new.test.tsx` — **New** test file
- `e2e/platform/provision-and-suspend.spec.ts`, `e2e/platform/provision-from-workbook.spec.ts` — only if a selector breaks (see step 9)
- `ui/src/i18n/locales/bn/platform.json`, `ui/src/i18n/locales/en/platform.json` — keys below (later changed again by platform-2 and platform-3, which run after this)

## Steps
1. **Read first:** `patterns.md` §3 PageHeader / FullPageShell, §4 FilterBar / DataTable (unpaginated) / RowActions / StatusBadge, §5; `PATTERN: DataTable (unpaginated)` in `kit/patterns.html`; the mockups `PLAN/pages/platform/schools/mockup.html` and `…/schools_new/mockup.html`.
2. **List view** (`-schools-list-view.tsx`).
   - `ListShell`: `title={t('schools.title')}`, `subtitle={t('schools.caption')}`, `actions={[{ id: 'new', label: t('schools.newAction'), icon: <PlusIcon />, priority: 'primary', onClick: onNew }]}` (new prop `onNew: () => void`, wired in `index.tsx` to `navigate({ to: '/schools/new' })`). Drop `page`, `pageSize`, `totalCount`, `onPageChange`, `onPageSizeChange`; pass `paginated={false}`.
   - Search: replace the raw `<input>` with the FilterBar search field (`fields=[{ id: 'q', type: 'search', label: t('schools.searchLabel'), placeholder: t('schools.searchPlaceholder'), primary: true }]`, `values={{ q: search }}`, `onChange={(v) => onSearchChange(v.q ?? '')}`) so the label is visible and the phone layout comes from the kit.
   - Columns: `name` → `accessorFn: (row) => row.name`, `card: 'title'`, cell `font-medium` (delete the `renderName` prop and the `Link` in `index.tsx`); `slug` → header `schools.columnSlug` (`card: 'subtitle'`); `status` → `<StatusBadge tone={row.status === 'ACTIVE' ? 'success' : 'warning'} label={t(`schools.status.${row.status}`)} />`, `card: 'badge'`; `created_at` → `formatDate(row.created_at, config)` (`useRegionConfig()` from `@biddaloy/ui/i18n`, `formatDate` from `@biddaloy/ui/utils`).
   - `rowActions={(row) => [{ intent: 'view', label: t('schools.viewAction', { name: row.name }), to: `/schools/${row.id}` }]}`.
   - `emptyMessage` → `emptyState={{ title: t('schools.emptyMessage'), explanation: t('schools.emptyExplanation') }}`; `error` stays (DataTable renders `ErrorState` with Retry → `schoolsQuery.refetch()`; add an `onRetry` prop if ListShell needs it).
3. **Backup section** (`index.tsx` + `-backup-health.tsx`).
   - `index.tsx`: wrap in `<section aria-labelledby="backup-health-title" className="space-y-3">` with `<h2 id="backup-health-title" className="text-h2">{t('backupHealth.title')}</h2>` and `<p className="mt-0.5 text-text-secondary">{t('backupHealth.caption')}</p>`. The outer wrapper becomes `space-y-6` (was `flex flex-col gap-8`).
   - `-backup-health.tsx`: `formatFileSize(bytes, config)` keeps its loop but renders the number with `formatNumber(value, config, { decimals: 1 })` and `formatNumber(numeric, config)` for bytes; units stay Latin (`B`, `KB`, `MB`…). `lastStatus` → `<StatusBadge tone={…} label={…} />` with tone map `{ DONE: 'success', FAILED: 'danger', QUEUED: 'info', RUNNING: 'info', DELETED: 'neutral' }`, label `tBackup(`status.${s}`)`; `null` → `tone="neutral" label={t('backupHealth.never')}`; `card: 'badge'`. `lastSuccess` → `formatDateTime(row.last_success_at, config)` or `t('backupHealth.never')`. `name` keeps `card: 'title'`; `schedule` and `lastSuccess` `card: 'subtitle'` (joined with " · " by DataTable). `paginated={false}`; drop the page props; `emptyMessage` → `emptyState={{ title: t('backupHealth.emptyMessage'), explanation: '' }}` (or omit explanation if optional).
4. **New school frame** (`new.tsx`).
   - `createFileRoute('/_platform/schools/new')({ staticData: { chromeless: true }, … })` — the platform layout (31.3.3) renders chromeless leaves without `AppShell`.
   - `const close = useCloseFullPage(() => void navigate({ to: '/schools' }));` `dirty = step !== 'success' && (schoolValues.name !== '' || schoolValues.slug !== '' || adminValues.name !== '' || adminValues.email !== '' || adminValues.phone !== '')` — the wizard reports live values through a new `onValuesChange` callback (`form.watch` subscription in each step form) so typing counts before "next".
   - Return `<FullPageShell title={t('createWizard.title')} onClose={close} dirty={dirty} size="form" secondary={…} primary={…}>` around `<CreateSchoolWizard …/>`:
     - `school`: secondary `{ label: t('actions.cancel', { ns: 'common' }), onClick: close }`, primary `{ label: t('createWizard.nextAction'), onClick: () => schoolFormRef.current?.requestSubmit() }` (show `ArrowRightIcon` after the label if `primary` accepts an icon; otherwise text only).
     - `admin`: secondary `{ label: t('createWizard.backAction'), onClick: handleAdminBack }`, primary `{ label: t('createWizard.submitAction'), onClick: () => adminFormRef.current?.requestSubmit(), busy: provisionSchool.isPending }`.
     - `success`: no secondary, primary `{ label: t('createWizard.viewSchool'), onClick: () => navigate({ to: '/schools/$schoolId', params: { schoolId: result.school.id } }) }`; `onClose` goes to `/schools`.
   - The two forms get `ref`s via new `schoolFormRef` / `adminFormRef` props (`React.RefObject<HTMLFormElement>`), placed on the `<form>` that `FormShell` renders (pass `ref` through, or wrap in a plain `<form>`). Delete `renderDetailLink`.
   - Non-409 errors: `toast.error(t('createWizard.submitError'))` (**New** key) instead of the raw `error.message` (D9).
5. **Wizard markup** (`-create-school-wizard.tsx`).
   - Delete every `Card className="mx-auto max-w-lg p-6"` and the in-form `<Button>`s. Each step renders `<div className="space-y-6">` = `StepIndicator` + one Card (`Card padded`, title `h2 text-h2`, help `p mt-0.5 text-text-secondary`, fields `mt-4 grid gap-4` / `md:grid-cols-2` for step 2 with the name field `md:col-span-2`). `FormSection legend` duplicates the card title — remove the legend (keep `FormSection` only if FormShell needs it, with `legend` visually hidden).
   - `StepIndicator` (local function): `<ol aria-label={t('createWizard.stepsLabel')} className="flex items-center gap-2">`; each step `<li className="flex min-w-0 items-center gap-2">` with a number span `flex size-7 shrink-0 items-center justify-center rounded-full text-label` (current/done: `bg-primary font-semibold text-primary-foreground`; upcoming: `border border-border-functional text-text-secondary`) and a label `truncate` (current: `font-semibold text-text-primary`, else `text-text-secondary`); a connector `<li aria-hidden="true" className="h-px min-w-6 flex-1 bg-border-subtle" />` between; current step gets `aria-current="step"`. Numbers via `formatNumber(n, config)`.
   - Required marks on স্কুলের নাম, লিংকের নাম, অ্যাডমিনের নাম. `FormDescription` help under লিংকের নাম (`createWizard.slugHelp`), and the step-2 card help (`createWizard.adminStepHelp`).
   - Translated validation: build the schemas inside the component (`React.useMemo(() => makeSchoolStepSchema(t), [t])`) and use `t('createWizard.errors.slugPattern' | 'contactRequired' | 'emailInvalid')`; `min(1)` gets `t('createWizard.errors.required')`. `slugify` export stays.
   - Success: Card with `h2 text-h2` `successTitle`, `p mt-1 text-text-secondary` `successInvitationLabel` + `<StatusBadge domain="invitation" status={result.invitation.status} />` on one line, then `ImportWorkbookSection` (unchanged logic; its warning becomes the kit error text style `flex items-center gap-1 text-caption text-destructive` + `CircleAlertIcon`).
6. **i18n** (`platform.json`, bn / en). The glossary (31.3.4b) has already renamed `columnSlug`, `slugLabel`, `slugConflict`, `searchPlaceholder` — do not touch them.
   - add `schools.newAction`: "নতুন স্কুল" / "New school"
   - add `schools.viewAction`: "{{name}} দেখুন" / "View {{name}}"
   - add `schools.status.ACTIVE`: "সক্রিয়" / "Active"; `schools.status.SUSPENDED`: "স্থগিত" / "Suspended"
   - add `schools.emptyExplanation`: "অন্য নাম বা লিংকের নাম দিয়ে খুঁজে দেখুন।" / "Try another name or link name."
   - change `backupHealth.title`: "ব্যাকআপের অবস্থা" / "Backup status"; `backupHealth.caption`: "প্রতিটি স্কুলের ব্যাকআপ কত দিন পরপর হয়, শেষবার কী হয়েছে আর কতটা জায়গা লাগছে।" / "How often each school is backed up, how the last attempt went and how much space it uses."
   - change `backupHealth.columnSchedule`: "কত দিন পরপর" / "How often"; `columnLastStatus`: "শেষ চেষ্টা" / "Last attempt"; `columnLastSuccess`: "শেষ সফল ব্যাকআপ" / "Last successful backup"; `columnStorage`: "ব্যবহৃত জায়গা" / "Space used"; `never`: "কখনো হয়নি" / "Never"
   - add `createWizard.title`: "নতুন স্কুল" / "New school"; `stepsLabel`: "ধাপ" / "Steps"
   - change `createWizard.schoolStepTitle`: "স্কুলের তথ্য" / "School details"; add `schoolStepHelp`: "স্কুলের নাম আর ওয়েব ঠিকানায় ব্যবহারের ছোট নাম দিন।" / "Give the school's name and the short name used in its web address."
   - add `createWizard.slugHelp`: "শুধু ইংরেজি ছোট হাতের অক্ষর, সংখ্যা আর হাইফেন (-)। নাম ইংরেজিতে লিখলে এটি নিজে থেকে বসে যায়।" / "Only lowercase English letters, numbers and hyphens (-). It fills in by itself when the name is typed in English."
   - add `createWizard.adminStepHelp`: "ইমেইল বা ফোন — অন্তত একটি দিন। এই ঠিকানায় আমন্ত্রণ যাবে।" / "Give an email or a phone — at least one. The invitation goes there."
   - add `createWizard.errors.required`: "এটি পূরণ করুন।" / "Fill this in."; `errors.slugPattern`: "শুধু ইংরেজি ছোট হাতের অক্ষর, সংখ্যা আর একটি করে হাইফেন দিন।" / "Use only lowercase English letters, numbers and single hyphens."; `errors.contactRequired`: "ইমেইল বা ফোন — অন্তত একটি দিন।" / "Give an email or a phone number."; `errors.emailInvalid`: "সঠিক ইমেইল ঠিকানা দিন।" / "Enter a valid email address."
   - add `createWizard.submitError`: "স্কুল তৈরি করা যায়নি। আবার চেষ্টা করুন।" / "The school could not be created. Try again."
   - add `createWizard.successInvitationLabel`: "অ্যাডমিনের আমন্ত্রণ:" / "Admin invitation:" (keep `successInvitation` for the unused-key report; stop rendering it)
7. Remove the stale header comments that describe "placeholder" detail pages; keep the idempotency-key comment.
8. **Stories**: list view — default, one suspended school, empty search; backup — DONE / FAILED / never rows; wizard — step 1, step 2 with errors, success.
9. **E2E**: run `e2e/platform/provision-and-suspend.spec.ts` and `provision-from-workbook.spec.ts`. Labels and button names keep their keys, so `getByLabel(nameLabel)`, `getByRole('button', { name: nextAction | submitAction })` and `getByRole('heading', { name: successTitle })` still match. Only if one fails (e.g. two buttons with the same name), scope it to `page.getByRole('contentinfo')` for the footer.

## Tests
- `index.test.tsx`: header has one filled button "নতুন স্কুল" that navigates to `/schools/new`; status cell shows "সক্রিয়" / "স্থগিত" (not "Active"); created date renders `formatDate` long form; each row has a link named "… দেখুন" to `/schools/<id>`; footer shows "মোট ৩টি"; no "previous/next" buttons; backup row with `last_status: null` shows "কখনো হয়নি" twice; search label is visible (`getByLabelText('স্কুল খুঁজুন')`).
- `new.test.tsx` (**New**): renders `h1` "নতুন স্কুল", the step list with step 1 `aria-current="step"`, a "বন্ধ করুন" button; empty submit shows the translated "এটি পূরণ করুন।"; an invalid link name shows `errors.slugPattern`; "পরবর্তী" moves to step 2; neither email nor phone shows `errors.contactRequired`; a 409 returns to step 1 with the conflict on the link-name field; success shows the invitation badge and "স্কুল দেখুন"; Close with typed values asks before leaving.
- E2E: see step 9.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] `/schools` has a visible "নতুন স্কুল" button; status badges are Bangla; the table shows "মোট n টি" and no pager.
- [ ] The backup table sits under its own `h2` "ব্যাকআপের অবস্থা"; sizes use tenant numerals.
- [ ] `/schools/new` has no sidebar / top bar / bottom bar, shows which step you are on, and has Cancel / Back and Close.
- [ ] Validation messages and the success screen are translated; no `PENDING` on screen.

## Out of scope
- Transliterating a Bangla school name into a link name — new feature (D1).
- Merging backup status into the schools table — left as a separate section (see Decisions).

Wave: 9   Lane: platform   Decisions: D5, D6, D9, D15, D16, D19, D21, D22, D23, D24, D25, D27, D28, D29, D32   Depends on: 31.3.8b
