# [31.4.students-7a] Student detail Guardians, Messages, Activity, Documents tabs + leave/readmit dialogs

## Goal
The student's "অভিভাবক", "যোগাযোগ", "কার্যক্রম" and "কাগজপত্র" tabs and the leave / readmit dialogs match the "after" screenshots' look: kit tables with formatted phones, translated relationship / medium / action words, date-times instead of ISO strings, a link to each guardian, outline buttons only, and date pickers instead of typed dates.
Split for size: Notes and Records are students-7b (b runs after a).

## What and why
These tabs answer "who looks after this student, what have we sent them, what changed". Today the Guardians tab prints the relationship as typed (`Father`), the phone raw and has no way to open the guardian; Messages and Activity print ISO timestamps and enum constants (`SMS`, `DELIVERED`, `UPDATE`); Documents has a filled "আইডি কার্ড প্রিন্ট" next to the header's primary; the leave and readmit dialogs use the browser date box and show raw server error text. The redesign uses `DataTable` (unpaginated) with RowActions, `StatusBadge`, the formatters, `DatePicker` and `Dialog size="md"`.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_guardians/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId_guardians/mobile.webp?raw=true" width="260"> |

The shot is the Guardians tab; Messages and Activity use the same table card.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Guardians table | `DataTable paginated={false}`: নাম (+ "প্রধান যোগাযোগ" caption for the primary contact) · সম্পর্ক (translated) · ফোন (`formatPhone`) · ইমেইল (or —) · পছন্দের মাধ্যম (translated) · RowAction `view` → `/guardians/$guardianId` (**New** link). Footer "মোট ৩টি". | D8, D9, D19, B22 (`guardians-tab.tsx:55`). |
| 2 | Guardians hint | Under the table: "অভিভাবক যোগ বা বদল করতে **শিক্ষার্থীর তথ্য সম্পাদনা করুন**।" (in-sentence link to `/students/$id/edit`, only with `STUDENT_UPDATE`). **New** text. | Says where guardians are edited. |
| 3 | Messages table | তারিখ ও সময় (`formatDateTime`), মাধ্যম (translated), প্রাপক, অবস্থা (`StatusBadge domain="communication"`); newest first. | D5, D9, D27. |
| 4 | Activity table | তারিখ ও সময় (`formatDateTime`), কাজ (`auditLogs:actions.*`, e.g. "হালনাগাদ হয়েছে"), করেছেন (`performed_by_name`, **New** column — field already in the DTO). | D5, D9. |
| 5 | Empty states | `EmptyState` with one sentence for guardians (icon `users-round`), messages (`message-square`), activity (`history`). | D28. |
| 6 | Documents | "আইডি কার্ড প্রিন্ট" filled → outline (`id-card`); print-history heading `text-h2` in a Card. | D29. |
| 7 | Leave dialog | `DialogContent size="md"`; তারিখ → `DatePicker` (max = today, placeholder "তারিখ বাছুন"); errors under their fields with the Error-text classes; dues warning as a warning box; server error → translated `errors.generic` only. 5 fields → stays a dialog. | D21, D25, D9. |
| 8 | Readmit dialog | Same: `size="md"`, `DatePicker`, translated errors, select placeholders "বাছুন". | D21, D25, D9. |

## Mobile behaviour
- Guardians: two-line rows (name + "প্রধান যোগাযোগ", then "সম্পর্ক · ফোন") with the 44 px view icon on the right.
- Messages: "date-time · medium" under the recipient, status badge on the right. Activity: action as title, "date-time · who" under it.
- Dialog footers stack, primary on top (Dialog default).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Relationship text | as typed · translate known values | Map known English values case-insensitively to `common:enums.relationship.*` (31.3.4a), else as typed | Free-text field; D9 forbids `Father` in a Bangla UI. |
| Edit guardians here | inline add/remove · link to edit form | Link in a sentence | Guardians are edited in the student form (guardian picker, students-2); no new feature (D1). |
| Activity "who" column | omit · add | Add | `performed_by_name` is already returned; "what changed" without "who" is half the answer. |
| Leave/readmit size | full page · dialog | Dialog `md` | 5 fields, no steps or table (D21). |

## Files
- `client-admin/src/routes/_staff/students/-detail/guardians-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/guardians-tab.test.tsx` — **New**
- `client-admin/src/routes/_staff/students/-detail/communication-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/activity-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/documents-tab.tsx`
- `client-admin/src/routes/_staff/students/-detail/documents-tab.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/leave-dialog.tsx`
- `client-admin/src/routes/_staff/students/-detail/leave-dialog.test.tsx`
- `client-admin/src/routes/_staff/students/-detail/leave-dialog.stories.tsx`
- `client-admin/src/routes/_staff/students/-detail/readmit-dialog.tsx`
- `client-admin/src/routes/_staff/students/-detail/readmit-dialog.test.tsx`
- `ui/src/i18n/locales/bn/students.json` — keys below (also changed by students-1…6b, run earlier)
- `ui/src/i18n/locales/en/students.json` — same keys
- `ui/src/i18n/locales/{bn,en}/student-lifecycle.json` — select placeholder only (if needed, step 6)

## Steps
1. **`guardians-tab.tsx`.** Inside `TabQueryState`: `DataTable tableId="student-guardians" caption={t('detail.guardians.caption', { name: student.full_name })} paginated={false}` over `student.guardians` sorted primary first. Columns: `name` (cell `<span className="flex flex-wrap items-center gap-2 font-medium">{g.full_name}{g.is_primary_contact && <span className="text-caption font-normal text-text-secondary">{t('detail.guardians.primary')}</span>}</span>`), `relationship` (`relationshipLabel(g.relationship)`: `const key = g.relationship.trim().toLowerCase(); KNOWN.includes(key) ? t(\`enums.relationship.${key}\`, { ns: 'common' }) : g.relationship` with `KNOWN = ['father','mother','brother','sister','grandfather','grandmother','uncle','aunt','other']`), `phone` (`g.phone ? formatPhone(g.phone, rc) : '—'`), `email` (or `—`), `preferredCommunication` (`t(\`form.preferredCommunicationOptions.${g.preferred_communication}\`)`); card subtitle `t('detail.guardians.cardSubtitle', { relationship, phone })`; `rowActions={(g) => [{ intent: 'view', label: t('detail.guardians.view', { name: g.full_name }), to: \`/guardians/${g.id}\` }]}`; `emptyState={{ title: t('detail.guardians.emptyMessage'), explanation: t('detail.guardians.emptyExplanation'), icon: <UsersRoundIcon /> }}`. Below, when `useHasPermission(Permission.STUDENT_UPDATE)`: `<p className="mt-3 text-text-secondary"><Trans i18nKey="detail.guardians.editHint" t={t} components={{ link: <Link to="/students/$studentId/edit" params={{ studentId }} className="font-medium text-primary underline underline-offset-2" /> }} /></p>`.
2. **`communication-tab.tsx`.** `DataTable tableId="student-messages" paginated={false}` over logs sorted `created_at` desc: `date` (`formatDateTime(log.created_at, rc)`), `medium` (`t(\`form.preferredCommunicationOptions.${log.medium}\`, { defaultValue: log.medium })`), `recipient`, `status` (`<StatusBadge domain="communication" status={log.status} />`); EmptyState (icon `MessageSquareIcon`, sentence `detail.communication.emptyExplanation`).
3. **`activity-tab.tsx`.** Add `useTranslation('auditLogs')` as a second binding (the route loader preloads it — students-4 step 8). Columns: `date` (`formatDateTime`), `action` (`tAudit(\`actions.${log.action}\`, { defaultValue: log.action })`), `by` (`log.performed_by_name ?? '—'`, header `detail.activity.columnBy`). EmptyState (icon `HistoryIcon`, sentence `detail.activity.emptyExplanation`).
4. **`documents-tab.tsx`.** Print button → `variant="outline"` + `IdCardIcon`. History block → `<Card padded><h2 className="text-h2">{t('documents.historyTitle')}</h2><div className="mt-4"><SubjectPrintHistory … /></div></Card>` (drop the `aria-label` section — the heading names it). `StudentPhotoCard` unchanged (not this lane's file).
5. **`leave-dialog.tsx`.** `<DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>`. Date: `<DatePicker value={occurredOn ? new Date(occurredOn) : undefined} onValueChange={(d) => setOccurredOn(d ? toIsoDate(d) : '')} max={new Date()} aria-invalid=… aria-describedby=… />` (state stays an ISO string; `todayDateInputValue` can go if unused). Field wrappers → Field/Label classes; error lines → `flex items-center gap-1 text-caption text-destructive` + `CircleAlertIcon`. Dues warning → `<p role="status" className="flex items-start gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg"><TriangleAlertIcon className="size-4 shrink-0" />…</p>`. Server error → always `t('errors.generic')` (drop `leave.error.message`).
6. **`readmit-dialog.tsx`.** Same as step 5 for the date, errors and size. Select placeholders: if `common:form.select` exists use it, else change `readmit.classPlaceholder` / `sectionPlaceholder` in `student-lifecycle.json` to "বাছুন" / "Select".
7. **i18n** (`students.json`, bn / en):
   - change `detail.guardians.primary` "প্রধান যোগাযোগ" / "Primary contact"
   - add `detail.guardians.caption` "{{name}}-এর অভিভাবক" / "Guardians of {{name}}"
   - add `detail.guardians.columnPhone` "ফোন" / "Phone"; `columnEmail` "ইমেইল" / "Email"; `columnPreferred` "পছন্দের মাধ্যম" / "Preferred contact"; delete `columnContact`
   - add `detail.guardians.cardSubtitle` "{{relationship}} · {{phone}}" / "{{relationship}} · {{phone}}"
   - add `detail.guardians.view` "{{name}}-এর বিবরণ দেখুন" / "View {{name}}"
   - add `detail.guardians.emptyExplanation` "শিক্ষার্থীর তথ্য সম্পাদনা করে অভিভাবক যোগ করুন।" / "Add a guardian by editing the student."
   - add `detail.guardians.editHint` "অভিভাবক যোগ বা বদল করতে <link>শিক্ষার্থীর তথ্য সম্পাদনা করুন</link>।" / "To add or change guardians, <link>edit the student</link>."
   - change `detail.communication.columnDate` and `detail.activity.columnDate` "তারিখ ও সময়" / "Date and time"
   - add `detail.communication.emptyExplanation` "রিমাইন্ডার বা বার্তা পাঠালে এখানে দেখা যাবে।" / "Reminders and messages you send show up here."
   - change `detail.activity.columnAction` "কাজ" / "Action"; add `detail.activity.columnBy` "করেছেন" / "Done by"
   - add `detail.activity.emptyExplanation` "এই শিক্ষার্থীর তথ্য বদলালে এখানে লেখা থাকবে।" / "Changes to this student are recorded here."

## Tests
- `guardians-tab.test.tsx` (**New**): phone reads `01711-000004`; relationship `Father` renders "বাবা", an unknown value renders as typed; primary guardian listed first with "প্রধান যোগাযোগ"; view link points to `/guardians/:id`; edit hint only with `STUDENT_UPDATE`.
- `documents-tab.test.tsx`: print button is outline and still navigates to `/print/preview` with the same search.
- `leave-dialog.test.tsx` / `readmit-dialog.test.tsx`: no `input[type=date]`; picking a date sets the ISO value sent to the mutation; future date shows `errors.dateFuture`; a 409/500 shows `errors.generic`, never the server text.
- `leave-dialog.stories.tsx`: still renders (DatePicker in the story).
- E2E: `e2e/keyboard/student-lifecycle.spec.ts` never fills the date (it keeps the default, today) and finds fields by label — run it; no edit expected. Keep the default date = today in both dialogs so it stays green.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Guardian phones read `01711-000004`; relationships are Bangla words; each row opens the guardian.
- [ ] Messages and Activity show long date-times and translated words; Activity shows who did it.
- [ ] Leave and readmit dialogs use the date picker and never show server error text.

## Out of scope
- `client-admin/src/components/print/student-photo-card.tsx` and `SubjectPrintHistory` — print / reports lanes.
- Guardian editing inside this tab — not built (D1).

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: students   Decisions: D5, D8, D9, D19, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.students-6b
