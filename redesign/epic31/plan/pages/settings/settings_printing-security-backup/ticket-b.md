# [31.4.settings-4b] Settings — Backup category: two cards, plain words

## Goal
The Backup category has two `SettingsSection` cards: "ব্যাকআপ" (schedule, space used, past backups) and "ব্যাকআপ থেকে ফিরিয়ে আনুন" (the restore wizard). The status column uses `StatusBadge`, row actions use `RowActions`, the schedule uses a kit `Select`, and no backend error text, "জব", "স্ন্যাপশট" or "রিটেনশন" is on screen. `?backup=<jobId>` still downloads that backup and marks its row.
(b runs after a: `ticket.md` (settings-4a) adds the `actions` slot to `SettingsSection` that this ticket uses.)

## What and why
Backup is where an admin takes a copy of the school's data, sets automatic backups and restores a copy. Today it is one card with a native `<select>` and a table whose "পিন করা" column holds a text button. Failed rows print the server's English error ("ব্যর্থ হয়েছে: ECONNRESET…"). File sizes are in Latin digits, and the restore wizard sits at the bottom of the same card under an `h3`. The file-type error asks for a ".zip", while the picker accepts only ".xlsx". This ticket splits backup and restore into two cards and puts the "new backup" action on the card's title row. Status becomes badges, download and keep-forever become icon actions, and the words are plain.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/before-mobile.webp?raw=true" width="260"> |
| After — Backup | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/backup/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_printing-security-backup/backup/mobile.webp?raw=true" width="260"> |

The audit role had no `BACKUP_MANAGE`, so "Before" (the `admin__settings` page) does not show this card; the current look is the plain `Card` in `backup-section.tsx`. The first row in the "after" shots is the one a `?backup=<jobId>` link points at (highlighted label). The upload area is `BulkUploadPreview`'s own markup (foundation); the mockup only approximates it.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Category | One card → two `SettingsSection`s: "ব্যাকআপ" and "ব্যাকআপ থেকে ফিরিয়ে আনুন". | patterns §9; restore is a different task |
| 2 | Backup card header | Title "ব্যাকআপ ও পুনরুদ্ধার" → "ব্যাকআপ". The two description lines become one description. "নতুন ব্যাকআপ তৈরি করুন" (filled) moves to the title row (`actions`), still hidden while the list is empty. | D16-like header, D29 |
| 3 | Schedule | Native `<select>` → kit `Select`, next to a **New** "জায়গা" box ("৫০০ MB-এর মধ্যে ৩৫.৫ MB ব্যবহার হয়েছে"). The help says it saves on choosing. | D25; state visible |
| 4 | Past backups | **New** `h3` "আগের ব্যাকআপ" + a help line on automatic clean-up and keeping forever. | "রিটেনশন" jargon |
| 5 | Table columns | ধরন (+ pin icon when kept) · অবস্থা (`StatusBadge`) · শুরু · আকার (`formatNumber`) · কে নিয়েছেন ("স্বয়ংক্রিয়" for scheduled backups, **New**) · কাজ. The "পিন করা" column goes. | D6, D19, D27 |
| 6 | Row actions | `RowActions`: download, and keep forever / stop keeping (pin icons) on finished rows. An expired download shows a neutral badge "ডাউনলোডের মেয়াদ শেষ" in the status cell instead of text in the actions cell. | D19, D27 |
| 7 | Failed rows | "ব্যর্থ হয়েছে: {{reason}}" (raw `row.error`) → only the danger badge "ব্যর্থ হয়েছে". | D9 |
| 8 | Restore card | `RestoreWizard hideTitle` inside its own card with a description (**New**). The template download becomes a ghost button under the upload area, with one sentence saying who it is for. | D29; restore was buried |
| 9 | Wording | "ব্যাকআপ জব" → "আগের ব্যাকআপ"; "পুনরুদ্ধার-পূর্ব স্ন্যাপশট" → "ফিরিয়ে আনার আগের কপি"; "ক্রেডেনশিয়াল", "রিটেনশন", "ট্যাব" replaced (step 6); ".zip" → ".xlsx" in the file-type error. | D32; bug: wrong file type named |

## Mobile behaviour
- The new-backup button is full width under the description; schedule and space stack.
- Backups are DataTable cards: kind (title, pin icon), status badge, start time (subtitle), size and "কে নিয়েছেন" fields, then the actions with visible labels ("ডাউনলোড", "স্থায়ীভাবে রাখুন"). The deep-linked card keeps the label highlight.
- In the restore card the "choose file" and "download template" buttons are full width.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Restore as full-page modal (D21: has steps + preview) | FullPageShell · inline card | inline card, unchanged flow | it is not a dialog today; `RestoreWizard` is also used inside the platform's create-school wizard and restore dialog, so a route-level change would cross lanes |
| Restore title | keep its `h3` · card `h2` | new `hideTitle?: boolean` prop (default `false`); Backup passes `true` and the card shows the `h2` | platform callers keep their look |
| Pin action | new RowAction intent · `edit` + icon override | `intent: 'edit'` with `icon` = `PinIcon` / `PinOffIcon` | the intent table has no "pin"; brand colour fits "change this"; no shared change |
| Expired download | text in the actions cell · badge in the status cell | neutral `StatusBadge` "ডাউনলোডের মেয়াদ শেষ" replaces the DONE badge | RowActions has no text slot; the state belongs in the status column |
| Failed reason | show `row.error` · hide | hide; the badge says it failed | D9 — `row.error` is a server string |
| Space used | progress bar · text | text in a `bg-muted` box | no Progress component in the kit; the number is what matters |
| Page size | 10 · 25 | 25 | D19 |

## Files
- `client-admin/src/pages/settings/backup-section.tsx`
- `client-admin/src/pages/settings/backup-section.test.tsx`
- `client-admin/src/pages/settings/backup-section.stories.tsx` — keep every story rendering (states unchanged)
- `client-admin/src/pages/settings/restore-wizard.tsx` — `hideTitle`; template block moved below the upload
- `client-admin/src/pages/settings/restore-wizard.test.tsx`
- `ui/src/i18n/locales/en/backup.json`, `ui/src/i18n/locales/bn/backup.json`

## Steps
1. **Read first:** `settings-layout.tsx` (`SettingsSection` with `actions`, from settings-4a) and `PrintersSection.tsx` as converted by 4a (same DataTable + RowActions shape). The mockup is `PLAN/pages/settings/settings_printing-security-backup/backup/mockup.html`. Patterns: §4 DataTable, RowActions, StatusBadge; §6 Select; §9.

2. **`backup-section.tsx` — structure.** `BackupSection` returns a fragment of two cards. Keep every hook, `handleDownload`, the deep-link effect (`deepLinkTriggered`, `lastSeenBackupJobId`, `highlightRef`, the scroll effect), `handleRequest`, `handleTogglePin`, `handleScheduleChange`, the SUPER_ADMIN guard and `if (!canManage) return null` exactly as they are.
   ```tsx
   <>
     <SettingsSection id="backup-section" title={t('sectionTitle')}
       description={`${t('containsDescription')} ${t('neverContainsDescription')}`}
       actions={jobs.length > 0 ? <Button type="button" className="w-full md:w-auto" loading={requestMutation.isPending} onClick={handleRequest}><DatabaseBackupIcon />{t('requestExport')}</Button> : undefined}>
       …
     </SettingsSection>
     <SettingsSection title={t('restoreSectionTitle')} description={t('restoreDescription')}>
       <div className="mt-4"><RestoreWizard hideTitle /></div>
     </SettingsSection>
   </>
   ```

3. **Backup card body.**
   - `<div className="mt-4 grid gap-4 md:grid-cols-2">`:
     - Schedule, only when `!isSuperAdmin`: `Label htmlFor="backup-schedule"` (`scheduleLabel`) + `<Select value={schedule} onValueChange={(v) => handleScheduleChange(v as 'OFF' | 'WEEKLY' | 'DAILY')} disabled={!settingsQuery.data || updateSettings.isPending}><SelectTrigger id="backup-schedule" aria-describedby="backup-schedule-help">…` with the 3 options. Help `<p id="backup-schedule-help" className="text-caption text-text-secondary">{t('scheduleHint')}</p>`.
     - Space: `<div className="flex flex-col gap-1.5"><span className="text-label text-text-primary">{t('storageLabel')}</span><p className="flex min-h-11 items-center rounded-md bg-muted px-3 md:min-h-8">{t('storageUsed', { used, cap })}</p></div>`.
   - Deep-link error: `<p role="alert" className="mt-4 flex items-center gap-1 text-destructive"><CircleAlertIcon className="size-4" />…</p>` (same two messages as today).
   - `<h3 className="mt-6 text-h3">{t('jobsListTitle')}</h3><p className="mt-0.5 text-text-secondary">{t('retentionHelp')}</p>`.
   - Empty: today's `EmptyState` (`mt-3`). Otherwise the `DataTable` in `<div className="mt-3">`, keeping `tableId`, `caption={t('jobsListTitle')}`, `page`, `totalCount`, `loading`, `isFetching`, `error`.

4. **Rows and columns.**
   - `const PAGE_SIZE = 25;`. Keep `BackupRow` with `expired`; drop `downloading` (RowActions has no per-button spinner; the global toast covers failures).
   - `formatFileSize(bytes, config)`: same maths, but the number goes through `formatNumber(Number(value.toFixed(1)), config)` (and `formatNumber(numeric, config)` for bytes), so it follows D6. Units stay `B / KB / MB / GB / TB`.
   - Columns:

     | id | header | value | card |
     |---|---|---|---|
     | `kind` | `columnKind` | today's highlight `<span>` (keep `ref` + `rounded-sm bg-secondary px-1` when `row.id === backupJobId`) holding the label + `{row.pinned && <PinIcon className="ms-1.5 inline size-3.5 text-primary" role="img" aria-label={t('pinnedLabel')} />}` | `title` |
     | `status` | `columnStatus` | `<StatusBadge tone={TONE[row.status]} label={t(`status.${row.status}`)} />`; when `row.status === 'DONE' && row.expired` → `<StatusBadge tone="neutral" label={t('downloadExpired')} />` | `badge` |
     | `date` | `columnCreatedAt` | `formatDateTime(…)` as today | `subtitle` |
     | `size` | `columnSize` | `formatFileSize(row.size_bytes, regionConfig)` | `field`, `align: 'end'` |
     | `requestedBy` | `columnRequestedBy` | `row.requested_by?.full_name ?? (row.kind === 'EXPORT' ? t('requestedByAutomatic') : '—')` (a scheduled backup has no requester: `backup-schedule.service.ts:105`) | `field` |

     `const TONE = { QUEUED: 'warning', RUNNING: 'info', DONE: 'success', FAILED: 'danger', DELETED: 'neutral' } as const;`
   - `rowActions={(row) => row.status !== 'DONE' ? [] : [ …(row.expired ? [] : [{ intent: 'download', label: t('download'), onClick: () => void handleDownload(row.id) }]), { intent: 'edit', icon: row.pinned ? <PinOffIcon /> : <PinIcon />, label: row.pinned ? t('unpin') : t('pin'), onClick: () => handleTogglePin(row.id, !row.pinned) } ]}`.
   - Delete the `pinned` and `actions` columns, the `failedReason` render, and the local `BackupStatusBadge` with its comment.

5. **`restore-wizard.tsx`.**
   - `RestoreWizardProps` gets `hideTitle?: boolean` (JSDoc: "Backup settings renders its own card title"). `{!hideTitle && <h3 className="text-h3">{t('restoreSectionTitle')}</h3>}`.
   - Move the template block below `BulkUploadPreview`: `{canManageBackup && <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 md:flex-row md:items-center md:justify-between"><p className="text-text-secondary">{t('templatePrompt')}</p><Button variant="ghost" className="w-full shrink-0 md:w-auto" loading={downloadingTemplate} onClick={…}><DownloadIcon />{t('downloadTemplate')}</Button></div>}`. The root becomes `flex flex-col gap-4`.
   - No other change to validation, the confirmation gate, the progress panel or the `tenantId` / `expectedSchoolName` props (the platform lane relies on them).

6. **i18n `backup.json`, en + bn.**
   - Change:
     - `sectionTitle` → "Backup" / "ব্যাকআপ"
     - `containsDescription` → "A backup holds every student, guardian, class, fee, invoice and payment record of this school." / "একটি ব্যাকআপে এই স্কুলের সব শিক্ষার্থী, অভিভাবক, শ্রেণি, ফি, চালান ও পেমেন্টের তথ্য থাকে।"
     - `neverContainsDescription` → "Passwords and online-payment secret keys are never in it." / "পাসওয়ার্ড ও অনলাইন পেমেন্টের গোপন কী কখনো থাকে না।"
     - `restoreSectionTitle` → "Restore from a backup" / "ব্যাকআপ থেকে ফিরিয়ে আনুন"
     - `jobsListTitle` → "Past backups" / "আগের ব্যাকআপ"
     - `kindSnapshot` → "Copy taken before a restore" / "ফিরিয়ে আনার আগের কপি"
     - `downloadSnapshot` → "Download the copy taken before the restore" / "ফিরিয়ে আনার আগের কপি ডাউনলোড করুন"
     - `restoreSnapshotFirst` → "A copy of the current data is taken first and linked here when done." / "শুরুর আগে এখনকার তথ্যের একটি কপি রাখা হয়, শেষ হলে এখানে তার লিংক দেখাবে।"
     - `restoreFailedUndo` → "Parts before {{tab}} were applied — restore the copy taken before to go back." / "{{tab}}-এর আগের অংশগুলো বসানো হয়েছে — আগের অবস্থায় ফিরতে আগের কপিটি ফিরিয়ে আনুন।"
     - `inviteRestoredUsersHint` → "Restored users come back without passwords — tick this to email them an invitation." / "ফিরিয়ে আনা ব্যবহারকারীদের পাসওয়ার্ড থাকে না — তাদের ইমেইলে আমন্ত্রণ পাঠাতে এটি টিক দিন।"
     - `diffColumnTab` → "Data" / "তথ্যের ধরন"
     - `columnRequestedBy` → "Taken by" / "কে নিয়েছেন"
     - `columnActions` → "Actions" / "কাজ"
     - `downloadExpired` → "Download expired" / "ডাউনলোডের মেয়াদ শেষ"
     - `scheduleLabel` → "Automatic backup" / "স্বয়ংক্রিয় ব্যাকআপ"
     - `scheduleHint` → "Saved as soon as you choose. A change can take up to an hour to start." / "বেছে নিলেই সংরক্ষিত হয়। বদল কার্যকর হতে এক ঘণ্টা পর্যন্ত লাগতে পারে।"
     - `pin` → "Keep forever" / "স্থায়ীভাবে রাখুন"
     - `unpin` → "Stop keeping forever" / "স্থায়ীভাবে রাখা বাতিল"
     - `pinGone` → "This backup was already removed by the automatic clean-up. The list has been refreshed." / "স্বয়ংক্রিয় পরিষ্কারে এই ব্যাকআপটি আগেই মুছে গেছে। তালিকা নতুন করে দেখানো হয়েছে।"
     - `storageUsed` → "{{used}} of {{cap}} used" / "{{cap}}-এর মধ্যে {{used}} ব্যবহার হয়েছে"
     - `fileWrongType` → "This file type isn't supported — choose a .xlsx backup file" / "এই ফাইলের ধরন চলবে না — একটি .xlsx ব্যাকআপ ফাইল বেছে নিন"
   - Add:
     - `restoreDescription` "Your file replaces this school's current data. You see what will change before anything starts, and a copy of today's data is kept." / "ব্যাকআপ ফাইল দিলে এই স্কুলের এখনকার তথ্য ফাইলের তথ্য দিয়ে বদলে যায়। শুরুর আগে কী বদলাবে তা দেখানো হবে, আর এখনকার তথ্যের একটি কপি রাখা হবে।"
     - `retentionHelp` "Old backups are deleted automatically to save space. Keep forever the ones you need." / "জায়গা বাঁচাতে পুরোনো ব্যাকআপ নিজে থেকে মুছে যায়। যেটি রাখতে চান সেটি স্থায়ীভাবে রাখুন।"
     - `storageLabel` "Space" / "জায়গা"
     - `requestedByAutomatic` "Automatic" / "স্বয়ংক্রিয়"
     - `pinnedLabel` "Kept forever" / "স্থায়ীভাবে রাখা আছে"
     - `templatePrompt` "Moving a whole school from another system? Fill in the blank template and upload it here." / "অন্য সিস্টেম থেকে পুরো স্কুল আনছেন? খালি টেমপ্লেট পূরণ করে এখানে দিন।"
   - Leave `failedReason`, `columnPinned` and `exportSectionTitle` in the file (unused) so nothing else breaks. Run `yarn workspace @biddaloy/ui check:i18n`.

## Tests
- `backup-section.test.tsx`:
  - Statuses render as badges with their labels; a FAILED row with `error: 'ECONNRESET'` does not show "ECONNRESET".
  - A DONE row has a "Download" icon button and a "Keep forever" button; a pinned row shows "Stop keeping forever" and the "Kept forever" icon label.
  - After a 410 on download, the row's status reads "Download expired" and the download action is gone.
  - A row with `requested_by: null, kind: 'EXPORT'` shows "Automatic".
  - The schedule is a combobox labelled "Automatic backup"; choosing "Daily" PATCHes `backup.schedule: 'DAILY'` (existing case, new query).
  - The `?backup=<id>` deep-link cases (download once, expired, failed, a second id) stay green unchanged.
  - With jobs present there is one "Create a new backup" button; with none, only the EmptyState's.
- `restore-wizard.test.tsx`: with `hideTitle` there is no "Restore from a backup" heading; without it, there is. The template button still downloads.
- `e2e/journeys/backup-restore.spec.ts`: settings-1a already points it at `/settings?section=backup`. It finds the table by `t('backup.jobsListTitle')` and the download button by `t('backup.download')`, so it keeps working (RowActions' `aria-label` = label). Re-run it.
- The platform's `-create-school-wizard` and `-detail/restore-workbook-dialog` tests must still pass (no `hideTitle` there).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per card (the restore card has none until `BulkUploadPreview` shows its own Confirm).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No native `<select>`; no "জব", "স্ন্যাপশট", "রিটেনশন", "ক্রেডেনশিয়াল" or server error text in the category.
- [ ] File sizes and the space line use the school's numerals.
- [ ] `/settings?backup=<jobId>` opens Backup, downloads that backup once and highlights its row.

## Out of scope
- Turning restore into a full-page modal (D21): it would change the platform lane's flows that reuse `RestoreWizard`. Left inline; say so on review.
- The inner look of `BulkUploadPreview` (upload area, error table, Confirm button) belongs to the foundation component.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: settings   Decisions: D6, D9, D19, D21, D25, D27, D29, D30, D32   Depends on: 31.3.8b, 31.4.settings-4a
