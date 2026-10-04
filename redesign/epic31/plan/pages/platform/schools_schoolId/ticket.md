# [31.4.platform-2] School detail — one header, dialogs instead of inline forms

## Goal
`/schools/$schoolId` matches the "after" screenshots: a `DetailShell` header (crumbs, name + badge, facts, one filled "অ্যাডমিন যোগ করুন", More menu), no tab bar, no back link, stats with tenant numerals, admins as a quiet kit table with icon actions, SMS credits as a balance + one outline button, and plain words everywhere.

## What and why
The operator opens a school to see how it is doing, invite or re-invite its admins, top up its SMS credits, and — rarely — suspend it, restore its data from a backup file or undo its ready-made curriculum. Today the page has a single-tab tab bar, an underlined "স্কুলে ফিরে যান" link above the crumbs, admin rows drawn with heavy black borders, two inline forms that each carry a filled button (three filled buttons on one screen), English validation text, the jargon "ওয়ার্কবুক থেকে পুনরুদ্ধার করুন", a tinted red "স্থগিত করুন" as the most prominent header action, and a "স্কুল সেটিংসে যান" link that actually opens the operator's own current school's settings. The redesign keeps every behaviour and puts it into kit patterns: header actions by importance, forms in dialogs, rows in a table.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools_schoolId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools_schoolId/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools_schoolId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/platform/schools_schoolId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `DetailShell` without `tabs`: crumbs "স্কুল › {name}" from the layout; name + `StatusBadge` (tone + `platform:schools.status.*`, added by platform-1); facts লিংকের নাম (`slug`), তৈরি হয়েছে (`formatDate(created_at)`). The "স্কুলে ফিরে যান" link and the one-tab tab bar go. | D16, D20, D9 |
| 2 | Header actions | Primary "অ্যাডমিন যোগ করুন" (`user-plus`). ACTIVE: More → "ব্যাকআপ ফাইল থেকে ডেটা ফেরত আনুন" (`archive-restore`), separator, "স্কুল স্থগিত করুন" (destructive, last). SUSPENDED: outline "পুনরায় সক্রিয় করুন" (`rotate-ccw`) inline + More → restore. | D16, D29; red was the loudest control |
| 3 | Stats card | Title stays "পরিসংখ্যান"; labels plain (পাঠানোর অপেক্ষায় বার্তা, ব্যর্থ বার্তা (গত ৭ দিন), সর্বশেষ ব্যবহার); numbers `formatNumber`, last activity `formatDateTime`; `grid grid-cols-2 gap-4 md:grid-cols-5`, values `text-h2 tabular-nums`. | D5, D6, D32 |
| 4 | Admins card | Card holding a table: title + one-line help (**New**); columns নাম · ইমেইল বা ফোন (`formatPhone` for phone) · আমন্ত্রণ (`StatusBadge domain="invitation"`) · কাজ = RowActions `send` "আমন্ত্রণ আবার পাঠান" (when resend allowed) + `reject` "আমন্ত্রণ বাতিল করুন" (when revoke allowed). Footer "মোট n জন". Empty → `EmptyState` with outline "অ্যাডমিন যোগ করুন". | D19, D28; heavy borders gone |
| 5 | Add admin | Inline form → **New** `AddAdminDialog` (`DialogContent size="md"`): নাম *, ইমেইল, ফোন + help "ইমেইল বা ফোন — অন্তত একটি দিন।"; Cancel / "অ্যাডমিন যোগ করুন". Opened from the header primary and the empty state. | D21, D29 |
| 6 | Revoke confirm | `ConfirmDialog tone="danger"` with the existing texts. | D29 |
| 7 | SMS credits card | Title + help (**New**), outline "ক্রেডিট দিন বা কমান" (`coins`) on the right, balance `dl` ব্যবহার করা যাবে / পাঠানোর জন্য আটকে আছে (`text-h2`). The grant form moves into **New** `GrantSmsCreditsDialog` (`size="sm"`); success closes it and shows `toast.success`. | D21, D29 |
| 8 | Grant form wording | "ইউনিট (প্রদানের জন্য ধনাত্মক…)" → label "এসএমএস সংখ্যা" + help "দিতে চাইলে ধনাত্মক সংখ্যা (যেমন ৫০০), কমাতে চাইলে মাইনাস দিয়ে (যেমন -১০০)।" | D32 |
| 9 | Ready-made curriculum card | `Card padded`, `h2 text-h2`, kit text classes; button keeps `variant="destructive"` (tinted) + `undo-2` icon. Words come from `presetReset` (already renamed by 31.3.4b). | D17 |
| 10 | Layout | Stats and admins full width; SMS credits and ready-made curriculum side by side on desktop (`grid gap-6 md:grid-cols-2 md:items-start`), stacked on phone. | Fewer long rows |
| 11 | Restore dialog | `DialogContent size="lg"` + `max-h-dvh overflow-y-auto` replacing `max-h-[85vh] max-w-2xl`; title "{{name}} — ব্যাকআপ ফাইল থেকে ডেটা ফেরত আনুন". | D21, tokens only |
| 12 | Settings link | Removed. | It opened the signed-in operator's *current* school settings, not this school's |
| 13 | Errors | Server `ApiError.message` strings are no longer shown; each failure shows its translated sentence. English Zod messages become keys. | D9 |

## Mobile behaviour
- Header: crumbs (last two), name + badge, facts 2 columns, then "অ্যাডমিন যোগ করুন" (`flex-1`) + More.
- Stats 2 columns, last activity spans both.
- Admins: compact two-line rows in the card (name + invitation badge, contact below), icon actions 44 px.
- SMS credits: the outline button goes full width under the help text; dialogs are full width with stacked footer buttons, primary on top.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Header primary | Suspend/Reactivate (today) · Add admin | "অ্যাডমিন যোগ করুন" | It is the routine task (first admin, replacements); suspend is rare and destructive, so it lives in More (D29: no filled red outside a confirm). |
| Inline forms | keep inline · dialogs | dialogs (≤ 6 fields) | One filled button per view (D29); the forms are needed rarely. |
| Restore from backup | Dialog · `FullPageShell` (D21: it holds a preview table) | keep a Dialog, `size="lg"` | A full-page modal needs its own route or a chromeless search-param state; `chromeless` is static per route (31.3.3) and D1 forbids new routes. Logged as a deviation. |
| "Workbook" wording | "ওয়ার্কবুক" · "এক্সেল ফাইল" · "ব্যাকআপ ফাইল" | "ব্যাকআপ ফাইল" | The file is the school's own backup export (`backup` namespace); operators know "backup", not "workbook". |
| Settings link | keep · remove | remove | Misleading destination; there is no per-school settings route for SUPER_ADMIN (D1). |

## Files
- `client-admin/src/routes/_platform/schools/$schoolId.tsx` — DetailShell without tabs, facts, actions by status, dialogs' open state, layout grid; drop back link, settings link, `useDetailShellTab`, `validateSearch`
- `client-admin/src/routes/_platform/schools/$schoolId.test.tsx` — update assertions
- `client-admin/src/routes/_platform/schools/-detail/stats-card.tsx` — labels, `formatNumber`, `formatDateTime`, kit classes
- `client-admin/src/routes/_platform/schools/-detail/admins-card.tsx` — table, empty state, footer count; no form
- `client-admin/src/routes/_platform/schools/-detail/admin-row.tsx` — becomes the RowActions + revoke `ConfirmDialog` helper (`useAdminRowActions(schoolId, admin)` returning `{ actions, dialog }`)
- `client-admin/src/routes/_platform/schools/-detail/add-admin-form.tsx` — becomes `AddAdminDialog` (same file, renamed export)
- `client-admin/src/routes/_platform/schools/-detail/admins-card.stories.tsx` — update
- `client-admin/src/routes/_platform/schools/-detail/sms-credits-card.tsx` — balance + outline button + dialog
- `client-admin/src/routes/_platform/schools/-detail/grant-sms-credits-form.tsx` — wording, translated validation, renders inside the dialog body
- `client-admin/src/routes/_platform/schools/-detail/sms-credits-card.test.tsx`, `grant-sms-credits-form.test.tsx` — update
- `client-admin/src/routes/_platform/schools/-detail/preset-reset-card.tsx` — Card + text classes, icon
- `client-admin/src/routes/_platform/schools/-detail/restore-workbook-dialog.tsx` — dialog size and title
- `ui/src/i18n/locales/bn/platform.json`, `ui/src/i18n/locales/en/platform.json` — keys below (also changed by platform-1, runs earlier)

## Steps
1. **Read first:** `patterns.md` §4 Tabs / DetailShell (`facts`, optional `tabs`), RowActions, §7 Dialog / ConfirmDialog; `PATTERN: DetailHeader`, `PATTERN: DataTable (unpaginated)`, `PATTERN: Dialog (md)`, `PATTERN: ConfirmDialog` in `kit/patterns.html`; the mockup `PLAN/pages/platform/schools_schoolId/mockup.html`.
2. **Route** (`$schoolId.tsx`).
   - Delete `schoolDetailSearchSchema`, `validateSearch`, `useDetailShellTab`, the `<Link to="/schools">` and the `<Link to="/settings">`. The wrapper `div.flex.flex-col.gap-4` goes; `DetailShell` is the root.
   - `DetailShell` props: `name={school.name}`, `statusBadge={<StatusBadge tone={school.status === 'ACTIVE' ? 'success' : 'warning'} label={t(`schools.status.${school.status}`)} />}`, `facts={[{ label: t('schools.columnSlug'), value: school.slug }, { label: t('schools.columnCreated'), value: formatDate(school.created_at, config) }]}`, no `tabs`.
   - `actions`:
     ```ts
     [
       { id: 'addAdmin', label: t('schoolDetail.admins.addAction'), icon: <UserPlusIcon />, priority: 'primary', onClick: () => setAddAdminOpen(true) },
       ...(school.status === 'SUSPENDED'
         ? [{ id: 'statusAction', label: t('schoolDetail.actions.reactivate'), icon: <RotateCcwIcon />, priority: 'secondary', onClick: () => setStatusDialogOpen(true) }]
         : []),
       { id: 'restoreFromWorkbookAction', label: t('schoolDetail.actions.restoreFromWorkbook'), icon: <ArchiveRestoreIcon />, priority: 'tertiary', onClick: () => setRestoreDialogOpen(true) },
       ...(school.status === 'ACTIVE'
         ? [{ id: 'statusAction', label: t('schoolDetail.actions.suspend'), priority: 'destructive', onClick: () => setStatusDialogOpen(true) }]
         : []),
     ]
     ```
     Tertiary and destructive land in the More menu (DetailShell rule), destructive last after a separator. `e2e/pages/detail-shell.ts` `clickAction` already opens More when the button is not inline, so the two platform specs keep working.
   - Body (children of DetailShell when there are no tabs — use the prop the foundation gives for tab-less content, e.g. `children`): `<StatsCard …/>`, `<AdminsCard … onAdd={() => setAddAdminOpen(true)} />`, `<div className="grid gap-6 md:grid-cols-2 md:items-start"><SmsCreditsCard …/><ResetPresetCard …/></div>`.
   - Render `<AddAdminDialog schoolId open={addAdminOpen} onOpenChange={setAddAdminOpen} />` next to the existing `StatusActionDialog` and `RestoreWorkbookDialog`.
   - Loading: `Skeleton` shaped like header + two cards (`h-8 w-64`, `h-32 w-full`, `h-48 w-full` in `space-y-6`) instead of one `h-40` bar.
3. **Stats** (`stats-card.tsx`): `Card padded`; `h2 className="text-h2"`; `dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5"`; `dt text-caption text-text-secondary`; number `dd text-h2 tabular-nums` with `formatNumber(stats.x, config)`; last activity item `col-span-2 md:col-span-1`, `dd font-medium`, `formatDateTime(stats.last_activity_at, config)` or `t('schoolDetail.stats.never')`. Error/loading keep their branches inside the same Card.
4. **Admins** (`admins-card.tsx`, `admin-row.tsx`).
   - Card `overflow-hidden` without padding; header `div className="p-4 md:px-5"` with `h2 text-h2` `admins.title` and `p mt-1 text-text-secondary` `admins.help`.
   - `DataTable` `tableId="platform-school-admins"`, `caption={t('schoolDetail.admins.title')}`, `paginated={false}`, columns: `name` (`card: 'title'`, `font-medium`), `contact` = `admin.email ?? (admin.phone ? formatPhone(admin.phone, config) : '—')` (`card: 'subtitle'`), `invitation` = `admin.invitation ? <StatusBadge domain="invitation" status={admin.invitation.status} /> : '—'` (`card: 'badge'`). `rowActions={(admin) => actionsFor(admin)}` where `admin-row.tsx` exports `useAdminRowActions(schoolId)` returning `(admin) => RowAction[]` plus a single `ConfirmDialog` element for the row being revoked (state: `revokeTarget: SchoolAdminListItem | null`). Keep the `canResend` / `canRevoke` rules; `send` intent label `admins.resend` (busy text not needed — show `toast.success(t('schoolDetail.admins.resendSuccess'))` on success, `toast.error(t('schoolDetail.admins.resendError'))` on failure); `reject` intent label `admins.revoke` opens `ConfirmDialog tone="danger" title={t('admins.revokeConfirmTitle')} description={t('admins.revokeConfirmDescription', { name })} confirmLabel={t('admins.revoke')} busy={revoke.isPending}`; revoke error → `toast.error(t('admins.revokeError'))`. Because each row used its own mutation hooks keyed by `user_id`, call `useResendSchoolAdminInvitation(schoolId, userId)` / `useRevoke…` inside a tiny per-action component or switch to `mutateAsync` on hooks created for the target — keep the existing hook signatures, do not edit `ui/src/hooks`.
   - Empty: `emptyState={{ title: t('admins.empty'), explanation: t('admins.emptyExplanation'), action: { label: t('admins.addAction'), onClick: onAdd } }}`.
   - Delete the `<AddAdminForm>` render and the `useAddSchoolAdmin` call from this card.
5. **Add admin dialog** (`add-admin-form.tsx` → export `AddAdminDialog({ schoolId, open, onOpenChange })`).
   - Owns `useAddSchoolAdmin(schoolId)`. `Dialog` + `DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}`; header title `admins.addTitle`, description `admins.addDescription`; body = the existing three fields (`grid gap-4 md:grid-cols-2`, name `md:col-span-2`, name required); help under the phone field `admins.contactHelp`.
   - Footer: Cancel (outline, `DialogClose`) + primary `admins.addAction` (`type="submit"`, `loading`).
   - On success: `form.reset()`, close, `toast.success(t('admins.addSuccess'))`. On error: inline `role="alert"` error text with `t('admins.addError')` (no server message).
   - Schema messages via `t` (build the schema in `useMemo`): `platform:createWizard.errors.required|contactRequired|emailInvalid` (added by platform-1).
6. **SMS credits** (`sms-credits-card.tsx`, `grant-sms-credits-form.tsx`).
   - Card `padded`; header `flex flex-col gap-3 md:flex-row md:items-start md:justify-between`: title `h2 text-h2` + `p mt-1 text-text-secondary` `smsCredit.help`; outline `Button` `smsCredit.grantAction` with `CoinsIcon`, `className="w-full md:w-auto"`, shown only when `balance !== null`.
   - Balance `dl className="mt-4 grid grid-cols-2 gap-4"`, values `text-h2 tabular-nums` via `formatNumber`. Loading → `Skeleton h-12 w-full`; error → error text; unmetered → `text-text-secondary` sentence (no button).
   - **New** local `GrantSmsCreditsDialog` in `sms-credits-card.tsx`: `DialogContent size="sm"`, title `smsCredit.grantTitle`, body = `GrantSmsCreditsForm` (fields only, `formId` prop so the footer submit uses `form={formId}`), footer Cancel / primary `smsCredit.grantSubmit`. Idempotency-key logic stays exactly as it is. On success: close + `toast.success(t('smsCredit.grantSuccess'))`; on error: inline translated `smsCredit.grantError` (no `ApiError.message`).
   - `grant-sms-credits-form.tsx`: label `smsCredit.unitsLabel` (new text) + `FormDescription` `smsCredit.unitsHelp`; `inputMode="numeric"`; Zod messages via `t` (`smsCredit.errors.wholeNumber`, `errors.notZero`, `errors.reasonLength`); drop its own submit `Button` and the `grantTitle` heading (the dialog has them).
7. **Ready-made curriculum** (`preset-reset-card.tsx`): `Card padded`; `h2 className="text-h2"`; `p className="mt-1 text-text-secondary"`; `Button variant="destructive" className="mt-4"` with `Undo2Icon` before the label. No string change.
8. **Restore dialog** (`restore-workbook-dialog.tsx`): `DialogContent size="lg" className="max-h-dvh overflow-y-auto" closeLabel={…}`; keep the long comment about scrolling, update it to the new classes.
9. **i18n** (`platform.json`, bn / en):
   - change `schoolDetail.actions.restoreFromWorkbook`: "ব্যাকআপ ফাইল থেকে ডেটা ফেরত আনুন" / "Restore data from a backup file"; `actions.suspend`: "স্কুল স্থগিত করুন" / "Suspend school"
   - change `schoolDetail.restoreWorkbookDialog.title`: "{{name}} — ব্যাকআপ ফাইল থেকে ডেটা ফেরত আনুন" / "{{name}} — restore data from a backup file"
   - change `schoolDetail.stats.communicationsQueued`: "পাঠানোর অপেক্ষায় বার্তা" / "Messages waiting to send"; `communicationsFailed7d`: "ব্যর্থ বার্তা (গত ৭ দিন)" / "Failed messages (last 7 days)"; `lastActivity`: "সর্বশেষ ব্যবহার" / "Last used"
   - add `schoolDetail.admins.help`: "যাঁরা এই স্কুলের সব কাজ দেখতে ও সামলাতে পারেন।" / "People who can see and manage everything in this school."
   - add `admins.emptyExplanation`: "প্রথম অ্যাডমিনকে আমন্ত্রণ পাঠালে তিনি স্কুল চালু করতে পারবেন।" / "Invite the first admin so they can set the school up."
   - add `admins.addDescription`: "এই ঠিকানায় সাইন-ইনের আমন্ত্রণ যাবে।" / "A sign-in invitation goes to this address."; `admins.contactHelp`: "ইমেইল বা ফোন — অন্তত একটি দিন।" / "Give an email or a phone — at least one."; `admins.addSuccess`: "আমন্ত্রণ পাঠানো হয়েছে।" / "Invitation sent."; `admins.resendSuccess`: "আমন্ত্রণ আবার পাঠানো হয়েছে।" / "Invitation sent again."; `admins.contactColumn`: "ইমেইল বা ফোন" / "Email or phone"; `admins.invitationColumn`: "আমন্ত্রণ" / "Invitation"; `admins.nameColumn`: "নাম" / "Name"; `admins.total`: "মোট {{count}} জন" / "{{count}} in total" (only if `TableCount` does not already give "মোট n টি" — prefer the kit's)
   - change `admins.resend`: "আমন্ত্রণ আবার পাঠান" / "Send invitation again"; `admins.revoke`: "আমন্ত্রণ বাতিল করুন" / "Cancel invitation"; `admins.revokeConfirmTitle`: "আমন্ত্রণ বাতিল করবেন?" / "Cancel this invitation?"
   - add `smsCredit.help`: "প্ল্যাটফর্ম থেকে এই স্কুলকে দেওয়া এসএমএস।" / "SMS the platform has given this school."; `smsCredit.grantAction`: "ক্রেডিট দিন বা কমান" / "Add or remove credits"; `smsCredit.grantSubmit`: "সংরক্ষণ করুন" / "Save"; `smsCredit.unitsHelp`: "দিতে চাইলে ধনাত্মক সংখ্যা (যেমন ৫০০), কমাতে চাইলে মাইনাস দিয়ে (যেমন -১০০)।" / "A positive number adds (e.g. 500); a minus number removes (e.g. -100)."
   - change `smsCredit.unitsLabel`: "এসএমএস সংখ্যা" / "Number of SMS"; `smsCredit.available`: "ব্যবহার করা যাবে" / "Available"; `smsCredit.reserved`: "পাঠানোর জন্য আটকে আছে" / "Held for sending"; `smsCredit.grantTitle`: "এসএমএস ক্রেডিট দিন বা কমান" / "Add or remove SMS credits"
   - add `smsCredit.errors.wholeNumber`: "পূর্ণ সংখ্যা দিন।" / "Enter a whole number."; `errors.notZero`: "শূন্য ছাড়া একটি সংখ্যা দিন।" / "Enter a number other than zero."; `errors.reasonLength`: "কারণটি অন্তত ৫ অক্ষরে লিখুন।" / "Write the reason in at least 5 characters."
   - leave `schoolDetail.back`, `schoolDetail.settingsLink`, `schoolDetail.tabs.overview` in place for the unused-key report (do not render them).
10. **Stories**: `admins-card.stories.tsx` — two admins (activated + pending), empty; `stats-card.stories.tsx` and `grant-sms-credits-form.stories.tsx` keep working with the new props.

## Tests
- `$schoolId.test.tsx`:
  - header shows the name `h1`, "সক্রিয়" badge, facts "লিংকের নাম" + long-form created date; no tablist; no link named "স্কুলে ফিরে যান" or "স্কুল সেটিংসে যান".
  - exactly one filled button ("অ্যাডমিন যোগ করুন"); for ACTIVE, "স্কুল স্থগিত করুন" and "ব্যাকআপ ফাইল থেকে ডেটা ফেরত আনুন" are `menuitem`s inside "আরও অ্যাকশন"; for SUSPENDED, "পুনরায় সক্রিয় করুন" is an inline button.
  - stats render with Bangla digits; `last_activity_at: null` shows "কখনো না".
  - admins: a pending row has buttons named "আমন্ত্রণ আবার পাঠান" and "আমন্ত্রণ বাতিল করুন"; an activated row has none; revoke asks in an `alertdialog` first; resend failure shows the translated toast.
  - add admin: clicking the header primary opens a `dialog`; empty contact shows "ইমেইল বা ফোন — অন্তত একটি দিন।"; success closes it and refetches; failure shows "এই অ্যাডমিনকে যোগ করা যায়নি।" and keeps the values (rewrite the three existing inline-form cases).
  - suspend / reactivate cases keep their flow through the `StatusActionDialog`.
- `sms-credits-card.test.tsx`: balance with Bangla digits; the outline button opens a dialog; a successful grant closes it; an unmetered school shows no button.
- `grant-sms-credits-form.test.tsx`: `0` → "শূন্য ছাড়া একটি সংখ্যা দিন।"; `1.5` → "পূর্ণ সংখ্যা দিন।"; short reason → `errors.reasonLength`.
- E2E: run `e2e/platform/provision-and-suspend.spec.ts`, `e2e/platform/provision-from-workbook.spec.ts`, `e2e/keyboard/curriculum-preset.spec.ts` — `clickAction` handles More, the preset button text is unchanged; no edit expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No tab bar, no back link, no settings link; crumbs are the way back.
- [ ] No inline forms on the page; add admin and SMS credits open dialogs.
- [ ] Admin rows have no black borders; actions are icon buttons with tooltips.
- [ ] The word "ওয়ার্কবুক" does not appear on the page.

## Out of scope
- Restore as a full-page modal (see Decisions) — needs a route or a layout change.
- Last crumb shows the generic "স্কুল" until a `schoolDetail` crumb resolver exists — filed in `shared-requests.md`.
- `status-action-dialog.tsx` and `preset-reset-dialog.tsx` already follow the dialog/confirm rules once foundation lands; untouched.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| crumb resolver: school name | Accepted | 31.3.5 | resolver key schoolDetail reads the useSchools() list cache (schoolsKeys.lists()) -> row with this id -> name |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: platform   Decisions: D5, D6, D9, D16, D17, D19, D20, D21, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.platform-1
