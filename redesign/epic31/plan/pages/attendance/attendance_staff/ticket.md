# [31.4.attendance-3] Staff attendance + leave — roster card, plain leave page

## Goal
`/attendance/staff` shows one header with a labelled date picker and a "ছুটি" button, a roster card with live counts and one save bar; `/attendance/staff/leave` shows a header whose title matches its crumb, the balance as a kit table, and a plain "not available yet" empty state instead of the engineering message (B18).

## What and why
`/attendance/staff` is where an admin marks every staff member present, absent, late or on leave for one day; `/attendance/staff/leave` is where any staff member sees how many leave days are left and asks for leave. Today the marking page uses a native date input showing `04/10/2026`, a row of four outline buttons per person (filled when chosen, so up to 32 filled buttons), no counts, a save button tucked under the list, and an underlined "ছুটি" link at the very bottom. The leave page has a title that is not its crumb ("আমার ছুটি" under the crumb "ছুটি"), a bare table in Latin digits, and an approvals box that tells the user to "ask the engineering team". The redesign reuses the roster look of attendance-1 (one card, compact status pill, sticky save bar), moves "ছুটি" next to the date, and gives the leave page the kit header, table and empty state.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — staff attendance | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_staff/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_staff/before-mobile.webp?raw=true" width="260"> |
| After — staff attendance | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_staff/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_staff/mobile.webp?raw=true" width="260"> |
| Before — leave | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_staff_leave/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_staff_leave/before-mobile.webp?raw=true" width="260"> |
| After — leave | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_staff_leave/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/attendance/attendance_staff_leave/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Staff — container + header | `PageContainer`; header `h1` "কর্মীর উপস্থিতি" (= sidebar label after 31.3.4a) + **New** subtitle "৮ জন কর্মী". No breadcrumbs (one level deep). | D15, D16 |
| 2 | Staff — date | Native `<input type="date">` → `DatePicker` with visible label "তারিখ", trigger shows "৪ঠা অক্টোবর, ২০২৬"; the URL keeps `?date=2026-10-04` via `toIsoDate`. | D5, D25, D37, B19 |
| 3 | Staff — leave link | Underlined "ছুটি" link at the page bottom → outline link-button "ছুটি" (`calendar-minus`) beside the date field. | D29; the link sat far from anything |
| 4 | Staff — counts | **New** strip of five StatusBadges above the rows: উপস্থিত (success), অনুপস্থিত (danger), বিলম্বে (warning), ছুটি (info), অচিহ্নিত (neutral), counted from the draft. | "Can I see the current state?" — D27 |
| 5 | Staff — rows | Separate bordered boxes → one Card with `divide-y` rows; name `font-medium` + **New** role caption ("শিক্ষক") from `user.role`; `AttendanceStatusControl` `variant="compact"` (pill) instead of `expanded`. | D17, D29 (expanded fills the chosen button: one filled button per row) |
| 6 | Staff — row click | **New**: clicking / Space on the name toggles উপস্থিত ⇄ অনুপস্থিত (unmarked → উপস্থিত), same as the student roster; Enter = উপস্থিত and `l` = ছুটি stay. | The compact pill needs two taps for the common case; matches attendance-1 |
| 7 | Staff — save | Button under the list → a save bar after the card, `sticky bottom-16 md:bottom-0`: "২ জন অচিহ্নিত" (or the saved / error sentence) + the one primary "উপস্থিতি সংরক্ষণ করুন" (`save` icon). | D14, D16 — primary stays reachable on a long roster |
| 8 | Staff — shortcut hint | **New** one-line hint in the card foot, desktop only. | Keyboard model was invisible |
| 9 | Staff — loading | Skeleton shaped like the roster (header bar + 6 rows) instead of one grey block. | D28 |
| 10 | Leave — header | `h1` "ছুটি" (= last crumb "কর্মীর উপস্থিতি › ছুটি") + **New** subtitle; primary "ছুটির আবেদন করুন" with `plus`. "আমার ছুটি" becomes the `h2` of the balance section. | D16, D32 |
| 11 | Leave — balance | Bare `<table>` → `DataTable paginated={false}`: ধরন / বার্ষিক কোটা (দিন) / ব্যবহৃত (দিন) / অবশিষ্ট (দিন), numbers end-aligned through `formatNumber`, footer "মোট ৫টি". Phone: compact rows "নৈমিত্তিক — ৮ দিন বাকি". | D6, D19 |
| 12 | Leave — no staff profile | A signed-in user with no staff profile saw "no leave policy configured" (wrong). **New** EmptyState "আপনার কর্মী প্রোফাইল নেই" and no request button. | Honest state |
| 13 | Leave — approvals (B18) | Engineering message → `EmptyState` (icon `inbox`) title "মুলতুবি আবেদন", sentence "কর্মীদের ছুটির আবেদন এখানে অনুমোদন করার সুবিধা এখনো চালু হয়নি।", no action. | D9, D28, B18 |
| 14 | Leave — request dialog | `DialogContent size="md"`; leave type `<select>` → `Select`; two native date inputs → two `DatePicker`s (`min` of the end = start); reason `Input` → `Textarea`; Cancel outline then primary. Server error text → translated sentence (balance exceeded has its own). | D21, D25, D37, D9 |

## Mobile behaviour
- Staff: date field and "ছুটি" share one row under the title (date `flex-1`, button `shrink-0`), both 44 px.
- Staff: count badges wrap onto two lines; status pills stay ≥ 44 px; the save bar sits above the bottom bar (`sticky bottom-16`) with the primary filling the rest of the row; shortcut hint hidden.
- Leave: primary "ছুটির আবেদন করুন" full width under the subtitle; balance rows are two-line (type + "কোটা ১০ · ব্যবহৃত ২") with "৮ দিন বাকি" on the end.
- Bottom bar: "আরও" is the marked cell on both pages (neither is a cell).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Status control | `expanded` (4 buttons) / `compact` pill | compact at every width | Same as attendance-1; expanded gives one filled primary per row (D29). |
| Row click | no click / P⇄A toggle | P⇄A toggle | Keeps one tap for the common case once the 4 buttons go; same rule as `-roster-marker.tsx`. Enter / `l` unchanged. |
| "Mark all present" button | add / leave out | leave out | Not a feature of this page today (D1). |
| Where "ছুটি" goes | header action / beside date / keep bottom link | outline button beside the date | Page has no header primary (the save bar is the primary); it is the only other place to go from here. |
| Leave title | "আমার ছুটি" / "ছুটি" | "ছুটি" | Title = last crumb (D16); "আমার ছুটি" stays as the section heading so the e2e heading lookup still finds it. |
| Approvals panel | hide / keep message / empty state | empty state | B18 says "plain not available yet"; hiding would make approvers think the feature is missing entirely. |
| Request form size | dialog / full page | dialog `md` | 4 fields, no table (D21). |

## Files
- `client-admin/src/routes/_staff/attendance/staff/index.tsx` — container, header, DatePicker, leave button, counts, save bar, skeleton
- `client-admin/src/routes/_staff/attendance/staff/index.test.tsx` — update
- `client-admin/src/routes/_staff/attendance/staff/-staff-attendance-grid.tsx` — card rows, role caption, compact pill, row click
- `client-admin/src/routes/_staff/attendance/staff/-staff-attendance-grid.test.tsx` — update
- `client-admin/src/routes/_staff/attendance/staff/leave.tsx` — header, DataTable, empty states
- `client-admin/src/routes/_staff/attendance/staff/leave.test.tsx` — update
- `client-admin/src/routes/_staff/attendance/staff/-leave-approve-list.tsx` — EmptyState (B18)
- `client-admin/src/routes/_staff/attendance/staff/-leave-request-dialog.tsx` — size, Select, DatePickers, Textarea, translated errors (props unchanged — also mounted by `staff/-detail/attendance-leave-tab.tsx`)
- `client-admin/src/routes/_staff/attendance/staff/-leave-request-dialog.test.tsx` — update
- `ui/src/i18n/locales/bn/staffAttendance.json` — keys below
- `ui/src/i18n/locales/en/staffAttendance.json` — keys below
- `ui/src/i18n/locales/bn/leave.json` — keys below
- `ui/src/i18n/locales/en/leave.json` — keys below
- `e2e/staff-attendance-leave.spec.ts` — date picking in the request dialog

## Steps
1. **Staff page header (`index.tsx`).** Delete the `p-4` wrapper. Wrap every branch in `<PageContainer>` (`@biddaloy/ui`). Render
   `<header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">`:
   - left `<div className="min-w-0">`: `<h1 className="text-h1">{t('grid.title')}</h1>` and, once users load, `<p className="mt-0.5 text-text-secondary">{t('grid.staffCount', { count: formatNumber(staff.length, regionConfig) })}</p>` (`regionConfig = useRegionConfig()` from `@biddaloy/ui/i18n`, `formatNumber` from `@biddaloy/ui/utils`).
   - right `<div className="flex items-end gap-2">`: `<FormField label={t('grid.dateLabel')} className="min-w-0 flex-1 md:w-64 md:flex-none">` around `<DatePicker value={parseIsoDate(date)} onValueChange={(next) => next && void navigate({ search: (prev) => ({ ...prev, date: toIsoDate(next) }) })} />` (`toIsoDate` from `@biddaloy/ui/utils`; build the `Date` from `date` with the same local-date parse attendance-1 uses — `new Date(y, m - 1, d)`), then `<Button asChild variant="outline" className="shrink-0"><Link to="/attendance/staff/leave"><CalendarMinus aria-hidden="true" />{t('items.leave', { ns: 'nav' })}</Link></Button>`. Delete the native `<input type="date">` and the bottom underlined `Link`.
2. **Counts.** In `index.tsx` compute from `draft` over `staff`: `present`, `absent`, `late`, `leave`, `unmarked = staff.length - marked`. Pass them to the grid as a `counts` prop (or render the strip inside the grid's card header — the card belongs to the grid, step 3). Strip: `<p className="flex flex-wrap gap-2">` with five `StatusBadge tone=… label=…`: `success` `t('grid.countPresent', { n })`, `danger` `countAbsent`, `warning` `countLate`, `info` `countLeave`, `neutral` `countUnmarked`; every `n` through `formatNumber`.
3. **Roster card (`-staff-attendance-grid.tsx`).** Return `<section aria-labelledby="staff-roster" className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">` with `<h2 id="staff-roster" className="sr-only">{t('grid.rosterHeading')}</h2>`, then the counts bar `<div className="border-b border-border-subtle p-4 md:px-5">`, then the existing `<ul aria-label={t('grid.title')}>` (keep the label — e2e scopes to it) as `className="divide-y divide-border-subtle"`. Each `<li className="flex min-h-14 items-center gap-3 px-4 py-1.5 md:px-5" data-testid=…>` (keep the testid) holds:
   - `<div className="min-w-0 flex-1">` with the existing name `<button>` (classes `flex min-h-11 max-w-full items-center rounded-md text-start font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`, text = `user.full_name` only — e2e needs the exact name) and below it `<span className="block truncate text-caption text-text-secondary">{user.role ? t(`roles.${user.role}`, { ns: 'staff' }) : null}</span>` (the route already loads `staff`).
   - The name button gets `onClick={() => onStatusChange(id, status === AttendanceStatus.PRESENT ? AttendanceStatus.ABSENT : AttendanceStatus.PRESENT)}`; the existing `onKeyDown` already `preventDefault`s Enter and `l`, so Enter does not also fire the click.
   - `<AttendanceStatusControl value={status} onChange=… disabled=… studentName={user.full_name} />` (default `compact`; drop `variant="expanded"`). Delete the inner bordered `div`, the `sm:` classes and the phone-layout comment.
   - Foot, only when not `disabled`: `<p className="hidden border-t border-border-subtle px-5 py-3 text-caption text-text-secondary md:block">{t('grid.shortcutHint')}</p>`. Update the file comment: row click toggles P⇄A.
4. **Save bar (`index.tsx`).** Replace the `flex flex-col items-end` block with (only when `canMark`) `<div className="sticky bottom-16 z-20 flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-e2 md:bottom-0 md:px-5">`: left a `<span className="shrink-0 text-text-secondary">` that shows `role="alert"` `t('grid.errorMessage')` (text `text-destructive`) when `markAttendance.isError`, else `role="status"` `t('grid.saved')` when `isSuccess`, else `t('grid.unmarkedRemaining', { n })`; right the `Button` (`className="flex-1 md:ms-auto md:flex-none"`, `<Save aria-hidden="true" />` before the label, same `loading` / `disabled` / `onClick`).
5. **States (`index.tsx`).** Pending: `<div aria-busy="true">` with `sr-only` `grid.loading`, a `Skeleton className="h-8 w-48"`, then a Card with six `Skeleton className="h-14"` rows. Error / empty: unchanged components (`EmptyState` gets `icon={<UserCheck />}`; its action renders outline).
6. **Leave page (`leave.tsx`).** Wrap in `PageContainer`. Use `PageHeader` with `title={t('items.leave', { ns: 'nav' })}`, `subtitle={t('page.subtitle')}` and, when `staffProfileId !== null`, `actions={[{ id: 'request', label: t('myLeave.requestButton'), priority: 'primary', icon: <Plus />, onClick: () => setRequestOpen(true) }]}`. Breadcrumbs come from the layout (`route-crumbs.ts` already has both crumbs). `nav` is loaded by the layout (today's `index.tsx` already reads `items.leave` from it), so the loader stays `('leave', 'common')`.
7. **Balance section.** `<section aria-labelledby="leave-balance" className="space-y-3">` + `<h2 id="leave-balance" className="text-h2">{t('myLeave.title')}</h2>`, then:
   Keep today's branch order (the balance query is disabled while `staffProfileId` is `''`, so it stays pending forever for a user with no profile — test the profile before the balance):
   - `currentUserQuery.isPending` → `DataTable loading` (same columns, no data).
   - `staffProfileId === null` → `EmptyState` icon `<UserX />`, title `t('myLeave.noProfileTitle')`, explanation `t('myLeave.noProfileMessage')`, no action.
   - `balanceQuery.isPending` → `DataTable loading`.
   - error → `ErrorState` (unchanged props).
   - empty → `EmptyState` icon `<CalendarX2 />`, title `t('myLeave.emptyTitle')`, explanation `t('myLeave.empty')`.
   - data → `<DataTable tableId="leave-balance" caption={t('myLeave.title')} paginated={false} data={balanceQuery.data} getRowId={(r) => r.leave_type} columns=…>`: `type` (`t(\`type.${row.leave_type}\`)`, `card: 'title'`), `quota` (`formatNumber(row.annual_quota_days, regionConfig)`, `align: 'end'`), `used` (same, `used_days`), `balance` (`align: 'end'`, `card: 'badge'`, renders `<span className="hidden md:inline">{formatNumber(row.balance)}</span><span className="md:hidden">{t('myLeave.daysLeft', { count: row.balance, n: formatNumber(row.balance) })}</span>`). Headers `myLeave.columnType` / `columnQuota` / `columnUsed` / `columnBalance`. `sorting={null}`, no-op `onSortingChange`.
8. **Approvals (`-leave-approve-list.tsx`, B18).** Return `<EmptyState icon={<Inbox />} title={t('approve.title')} explanation={t('approve.notAvailableMessage')} />`. Shorten the file comment to two lines: no list endpoint yet (`GET /leave/requests`), replace with a real list when it exists.
9. **Request dialog (`-leave-request-dialog.tsx`).** `<DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>`. Keep the props and the `useEffect` reset. Fields inside `<div className="flex flex-col gap-4">`, each a `FormField` with a visible label:
   - type: `Select` (`SelectTrigger` id `leave-request-type`, items `t(\`type.${type}\`)`), required mark.
   - start / end: `DatePicker` (ids `leave-request-start` / `leave-request-end`); keep state as ISO strings and convert with `toIsoDate`; end gets `min={startDate}` once a start exists. Required marks.
   - reason: `Textarea rows={3}` with `placeholder={t('request.reasonPlaceholder')}`.
   - Footer: `DialogClose` outline Cancel, then the primary (unchanged).
   - Errors: replace `serverErrorMessage` with `createRequest.error instanceof ApiError && createRequest.error.details?.code === 'LEAVE_BALANCE_EXCEEDED' ? t('request.errorBalance') : t('request.errorMessage')`. Never render `error.message`.
10. **i18n.** (bn after 31.3.4b already reads "উপস্থিতি" instead of "হাজিরা".)

    | File · key | bn | en |
    |---|---|---|
    | staffAttendance `grid.title` (changed) | কর্মীর উপস্থিতি | Staff attendance |
    | staffAttendance `grid.submit` (changed) | উপস্থিতি সংরক্ষণ করুন | Save attendance |
    | staffAttendance `grid.staffCount` (**New**, `_one`/`_other` in en) | {{count}} জন কর্মী | {{count}} staff member / {{count}} staff members |
    | staffAttendance `grid.rosterHeading` (**New**) | কর্মীর তালিকা | Staff |
    | staffAttendance `grid.countPresent` / `countAbsent` / `countLate` / `countLeave` / `countUnmarked` (**New**) | উপস্থিত {{n}} / অনুপস্থিত {{n}} / বিলম্বে {{n}} / ছুটি {{n}} / অচিহ্নিত {{n}} | Present {{n}} / Absent {{n}} / Late {{n}} / Leave {{n}} / Unmarked {{n}} |
    | staffAttendance `grid.unmarkedRemaining` (**New**) | {{n}} জন অচিহ্নিত | {{n}} unmarked |
    | staffAttendance `grid.shortcutHint` (**New**) | শর্টকাট: নামের ওপর Enter চাপলে উপস্থিত · L চাপলে ছুটি · নামে ক্লিক করলে উপস্থিত ও অনুপস্থিত বদলায় | Shortcuts: Enter on a name marks present · L marks leave · clicking a name switches present and absent |
    | leave `page.subtitle` (**New**) | এ বছরে আপনার কোন ধরনের ছুটি কত দিন বাকি | How many days of each kind of leave you have left this year |
    | leave `myLeave.columnQuota` / `columnUsed` / `columnBalance` (changed) | বার্ষিক কোটা (দিন) / ব্যবহৃত (দিন) / অবশিষ্ট (দিন) | Annual quota (days) / Used (days) / Remaining (days) |
    | leave `myLeave.daysLeft` (**New**, `_one`/`_other` in en) | {{n}} দিন বাকি | {{n}} day left / {{n}} days left |
    | leave `myLeave.emptyTitle` (**New**) | ছুটির নিয়ম এখনো ঠিক করা হয়নি | No leave rules yet |
    | leave `myLeave.noProfileTitle` (**New**) | আপনার কর্মী প্রোফাইল নেই | You have no staff profile |
    | leave `myLeave.noProfileMessage` (**New**) | ছুটির হিসাব শুধু কর্মীদের জন্য। দরকার হলে অ্যাডমিনকে আপনার কর্মী প্রোফাইল তৈরি করতে বলুন। | Leave is tracked for staff only. Ask an admin to create your staff profile if you need one. |
    | leave `request.reasonPlaceholder` (**New**) | যেমন: পারিবারিক কাজ | e.g. family matter |
    | leave `request.errorBalance` (**New**) | এই ধরনের ছুটির যথেষ্ট দিন বাকি নেই। কম দিন বাছুন বা অন্য ধরন বাছুন। | Not enough days of this leave type left. Pick fewer days or another type. |
    | leave `approve.notAvailableMessage` (changed, B18) | কর্মীদের ছুটির আবেদন এখানে অনুমোদন করার সুবিধা এখনো চালু হয়নি। | Approving staff leave requests here is not available yet. |

    Remove `myLeave.balanceTitle` (no longer read).

## Tests
- `index.test.tsx`: h1 is "Staff attendance"; the date field has the accessible name "Date" and its trigger shows the long date; picking a day navigates with an ISO `date` param; a "Leave" link points to `/attendance/staff/leave`; marking one row updates the "Present 1" badge; the save bar shows "1 unmarked" before saving and "Attendance saved" after; no element carries `fixed`.
- `-staff-attendance-grid.test.tsx`: keep the three tests (Enter → PRESENT, `l` → LEAVE, Tab order, skip users without a profile); add: clicking a name of an unmarked row calls `onStatusChange(id, PRESENT)`, clicking again with status PRESENT calls it with ABSENT; the role caption "Teacher" renders under the name; the name button's accessible name is exactly the full name.
- `leave.test.tsx`: h1 is "Leave"; "My leave" is an h2; the balance shows `8` in the Remaining column and the table footer reads "Total 5"; with `LEAVE_APPROVE` the empty state "Pending requests" shows the new sentence and never the word "engineering"; a user with `staff_profile_id: null` sees "You have no staff profile" and no "Request leave" button.
- `-leave-request-dialog.test.tsx`: pick dates through the DatePicker (click trigger, click `[data-date="2026-10-01"]`) instead of typing; a 422 with `details.code = 'LEAVE_BALANCE_EXCEEDED'` shows "Not enough days of this leave type left…" and not the server text; a 500 shows `request.errorMessage`.
- `e2e/staff-attendance-leave.spec.ts`: the staff step keeps working unchanged (heading `grid.title`, list label, exact-name button, `grid.submit`, `grid.saved`, link `nav.items.leave`). In the request step replace `startInput.fill('2026-03-10')` / `endInput.fill('2026-03-11')` with: click the trigger found by `page.getByLabel(t('leave.request.startDateLabel'))`, then while `page.locator('[role="grid"] [data-date="2026-03-10"]')` is not visible click `page.getByRole('button', { name: t('common.date.previousMonth') })` (cap 24 clicks), then click the cell; same for the end date with `2026-03-11`. The heading `leave.myLeave.title` is still a heading (h2).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (staff: save; leave: request; dialog: submit).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No native `<input type="date">` or `<select>` left in these files.
- [ ] Status pills are the compact variant; no row shows four buttons.
- [ ] Count badges change as rows are marked.
- [ ] The save bar stays reachable while scrolling a long roster and sits above the phone bottom bar.
- [ ] Leave h1 reads "ছুটি", matching the last crumb.
- [ ] The approvals box shows the plain sentence; the server or "engineering" is never mentioned.

## Out of scope
- The page cannot show marks already saved for a date (there is no `GET` for a day's staff register): filed as a shared request; the page keeps starting each date unmarked.
- Approving / rejecting leave needs `GET /leave/requests` (B18) — server work, not this ticket.
- Sidebar and crumb label "কর্মীর উপস্থিতি" — 31.3.4a renames `nav.items.staffAttendance`.
- `staff/-detail/attendance-leave-tab.tsx` mounts `LeaveRequestDialog` — staff lane; the dialog's props stay the same.
- Shared requests filed (`pages/attendance/shared-requests.md`): a read endpoint + hook for one day's staff register.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server GET /staff-attendance/register?date= + hook | Deferred | — | use the fallback in the ticket (each date starts unmarked; saving overwrites) |

Wave: 9   Lane: attendance   Decisions: D1, D5, D6, D9, D14, D15, D16, D17, D19, D21, D25, D27, D28, D29, D32, D37   Depends on: 31.3.8b, 31.4.attendance-2
