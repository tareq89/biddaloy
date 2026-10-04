# [31.4.students-4] Student detail — kit header, grouped tabs, overview card

## Goal
`/students/$studentId` matches the "after" screenshots: crumbs instead of a back link, the student's key facts (registration no., class, roll, primary guardian) in the header, one filled "ফি আদায়", a one-row tab strip ordered by topic, and an Overview tab that shows every personal field in translated words.

## What and why
This page is where staff look up everything about one student and act on them. Today the header repeats the list link as an underlined "back" link, packs registration/class/roll into one grey line, and the 19 tabs wrap onto two centred pill rows (four on a phone) in an order that mixes money, study and people. The Overview tab shows four fields with raw values (`SMS`, `MALE`, an ISO date). The redesign puts the header into `DetailShell`'s `facts`, orders the tabs by topic in one scrolling line, and turns Overview into one "ব্যক্তিগত তথ্য" card. Tickets students-5a…7b then restyle the other tabs; this ticket owns the route file and the tab strip.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/students/students_studentId/mobile.webp?raw=true" width="260"> |

The "after" shot shows a student who has a promotion override, so the header carries the short warning badge.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Above the title | Remove the "শিক্ষার্থী তালিকায় ফিরুন" link. The layout's breadcrumb "শিক্ষার্থী › {name}" is the way back. | D16, kit DetailHeader. |
| 2 | Header facts | Replace `identifiers` with `facts`: রেজিস্ট্রেশন নম্বর (`REG-2026-0001`, Latin), শ্রেণি (`সপ্তম · শাখা ক`), রোল (`formatNumber`), প্রধান অভিভাবক (`করিম উদ্দিন · 01711-000004`, **New**: from `student.guardians`, already in the payload). | D6, D8, kit DetailHeader. |
| 3 | Override badge | `PromotionOverrideBadge` becomes `StatusBadge tone="warning"` with a short label ("বিশেষ বিবেচনায় উত্তীর্ণ" / "…একই শ্রেণিতে" / "…পাস সম্পন্ন"); the full sentence with note and user stays in the Enrollment tab. Today the whole sentence (note + user) sits in the header as a pill. | D27, header must stay one line. |
| 4 | Header actions | Same actions and permissions, with icons: outline সম্পাদনা (`pencil`), outline ছাড়ার তথ্য লিখুন / পুনরায় ভর্তি (`log-out` / `rotate-ccw`), filled ফি আদায় (`hand-coins`); More: রিমাইন্ডার পাঠান (`send`), আইডি কার্ড প্রিন্ট (`id-card`), separator, মুছে ফেলুন (`trash-2`). Phone: primary full width + More; outline ones move into More (PageHeader does this). | D16, D29. |
| 5 | Tab order | One row (DetailShell line tabs): সংক্ষিপ্ত বিবরণ · অভিভাবক · ভর্তি তথ্য · উপস্থিতি · ফলাফল · বাড়ির কাজ · বিষয় নির্বাচন · প্রোগ্রাম · পারফরম্যান্স · ফি · জরিমানা · স্বয়ংক্রিয় বিল · পেমেন্ট · চালান · যোগাযোগ · নোট · রেকর্ড · কাগজপত্র · কার্যক্রম. Today money, people and study tabs are mixed. Tab ids and `?tab=` values stay the same. | D20; people → study → money → history. |
| 6 | Tab labels | "পুনরাবৃত্ত ফি" → "স্বয়ংক্রিয় বিল" (glossary "automatic billing"); "ডকুমেন্ট" → "কাগজপত্র" (glossary "Print & documents"). | D32. |
| 7 | Overview | One Card "ব্যক্তিগত তথ্য" (h2) holding a FieldGrid: নাম (বাংলা) **New**, জন্ম তারিখ (`formatDate`), লিঙ্গ (translated), রক্তের গ্রুপ **New**, পছন্দের যোগাযোগ মাধ্যম (translated), বাড়ির ঠিকানা. Phone: two columns, address full width. | D5, D9; the fields are already in the `useStudent` payload. |
| 8 | Delete | `DeleteStudentDialog` becomes `ConfirmDialog tone="danger"`; a failed delete shows a toast and keeps the dialog open. | D29 (red only in a confirm dialog). |
| 9 | Loading / error | Pending = `RoutePending variant="detail"` (same as the route's `pendingComponent`), not one bare bar; error = `ErrorState` inside `PageContainer`. | D28. |
| 10 | Loader | Add `'auditLogs'` to `loadRouteNamespaces(...)` — students-7a's Activity tab reads `auditLogs:actions.*`. | Avoid whole-page suspend (same reasoning as the existing comment). |

## Mobile behaviour
- Facts are a 2-column grid; "প্রধান অভিভাবক" spans both columns.
- Header: one row with the filled "ফি আদায়" (`flex-1`) and More; edit and leave/readmit are in More.
- Tab row scrolls sideways with the edge fade; the selected tab must be scrolled into view on load (shared request filed — see Out of scope).
- Overview card: 2 columns, address spans both.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| 19 tabs | Merge into fewer tabs with sections · keep all in one scrolling row | Keep all, reorder by topic | D1 (no feature change) and the kit's "Tabs (overflowing)" pattern was drawn for this page; merging would rewrite five tab components at once. |
| Where "Guardians" sits | Keep 8th · move 2nd | 2nd | The question asked most at the front desk is "who is the parent, what's the number"; the primary guardian is also in the header facts. |
| Leave / readmit button | More menu · inline outline | Inline outline (desktop) | Keeps the existing `pendingFocus` hand-off between the two buttons (`[data-action-id]`), which needs both to be real header buttons. |
| Override badge text | Full sentence · short label | Short label, full sentence in Enrollment | A badge must stay one line; the note and approver belong with the enrolment row. |
| Health notes, father/mother, religion on Overview | Show · leave in Records | Leave in Records | They are gated by `STUDENT_RECORDS_READ` and edited there. |
| Student photo in header | Add avatar · leave in কাগজপত্র tab | Leave | `DetailShell` has no avatar slot; adding one is shared work and not needed for this ticket. |

## Files
- `client-admin/src/routes/_staff/students/$studentId.tsx` — header facts, actions/icons, tab order, labels, loading/error, loader namespace
- `client-admin/src/routes/_staff/students/$studentId.test.tsx` — update
- `client-admin/src/routes/_staff/students/-detail/overview-tab.tsx` — card + translated fields
- `client-admin/src/routes/_staff/students/-detail/delete-student-dialog.tsx` — ConfirmDialog
- `client-admin/src/routes/_staff/students/-detail/promotion-override-badge.tsx` — StatusBadge with short label
- `client-admin/src/routes/_staff/students/-detail/promotion-override-badge.test.tsx` — update
- `ui/src/i18n/locales/bn/students.json` — keys below (also changed by students-1/2/3, run earlier)
- `ui/src/i18n/locales/en/students.json` — same keys (also changed by students-1/2/3, run earlier)

## Steps
1. **Back link and wrapper.** In `StudentDetailPage` delete the `<Link to="/students">…detail.back…</Link>` and the `<div className="flex flex-col gap-4">` wrapper (DetailShell renders `PageContainer`, D15). Drop the now-unused `Link` import.
2. **Pending / error.** `studentQuery.isPending` → `<RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />`. `isError` → `<PageContainer><ErrorState … /></PageContainer>` (`PageContainer` from `@biddaloy/ui/shells`), messages unchanged.
3. **Facts.** Remove `identifiers`; pass
   ```ts
   const primaryGuardian = student.guardians.find((g) => g.is_primary_contact) ?? student.guardians[0];
   facts={[
     { label: t('detail.facts.registrationNumber'), value: student.registration_number },
     { label: t('detail.facts.class'), value: t('detail.facts.classValue', { class: student.class_section.class.name, section: student.class_section.section_name }) },
     { label: t('detail.facts.roll'), value: formatNumber(student.roll_number, regionConfig) },
     ...(primaryGuardian ? [{ label: t('detail.facts.primaryGuardian'),
        value: primaryGuardian.phone ? `${primaryGuardian.full_name} · ${formatPhone(primaryGuardian.phone, regionConfig)}` : primaryGuardian.full_name }] : []),
   ]}
   ```
   (`formatNumber`, `formatPhone` from `@biddaloy/ui/utils`). The 4th fact spans both columns on phone — if `facts` items cannot take a class, leave it in the grid flow (acceptable).
4. **Status badges.** `statusBadge` = `<><StatusBadge domain="enrollment" status=… /><PromotionOverrideBadge studentId={studentId} /></>` — drop the wrapping `span` with `inline-flex gap-2` (the DetailShell row already has `gap-x-3`).
5. **`promotion-override-badge.tsx`.** Switch to `useTranslation('students')`; keep the "latest by `committed_at`" logic; render `<StatusBadge tone="warning" label={t(\`detail.overrideBadge.${latest.final_outcome.toLowerCase()}\`)} />`. Remove the hand-styled `span`.
6. **Actions.** Keep ids, priorities, `allowed` and handlers exactly; add `icon`: edit `<PencilIcon />`, record-leaving `<LogOutIcon />`, readmit `<RotateCcwIcon />`, collect-fees `<HandCoinsIcon />`, send-reminder `<SendIcon />`, print-id-card `<IdCardIcon />`, delete `<Trash2Icon />` (lucide-react). PageHeader puts tertiary + destructive into More with delete last below a separator.
7. **Tabs.** Reorder `TAB_IDS` and the `tabs` array to: `overview, guardians, enrollment, attendance, results, homework, subject-choices, programs, performance, fees, fines, recurring-fees, payments, invoices, communication, notes, records, documents, activity`. Keep each tab's `content`, label source and permission gate unchanged.
8. **Loader.** Add `'auditLogs'` to the `loadRouteNamespaces(...)` list with a one-line comment: Activity tab (students-7a) reads `auditLogs:actions.*`.
9. **`overview-tab.tsx`.** Inside `TabQueryState` render `<Card padded><h2 className="text-h2">{t('detail.overview.title')}</h2><FieldGrid className="mt-4 grid-cols-2">…</FieldGrid></Card>` (if `FieldGrid` does not take `className`, write `<dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">` with the same `Field` children). Fields, in order:
   - `detail.overview.fullNameBn` → `student.full_name_bn ?? '—'`
   - `detail.overview.dateOfBirth` → `student.date_of_birth ? formatDate(student.date_of_birth, regionConfig) : t('list.emptyValue')`
   - `detail.overview.gender` → local `genderLabel(value)`: `MALE|FEMALE|OTHER` → `t('form.fields.genderOptions.X')` (keys added by students-1), any other non-empty value as typed, empty → `—`
   - `detail.overview.bloodGroup` → `student.blood_group ?? '—'`
   - `detail.overview.preferredCommunication` → `t(\`form.preferredCommunicationOptions.${student.preferred_communication}\`)`
   - `detail.overview.address` → `student.home_address ?? '—'`, Field spans 2 columns on phone (`col-span-2 md:col-span-1`)
   Update `SkeletonFieldList fields={6}`.
10. **`delete-student-dialog.tsx`.** Replace the Dialog markup with `<ConfirmDialog open onOpenChange tone="danger" title={t('detail.deleteDialog.title')} description={t('detail.deleteDialog.description', { name: studentName })} confirmLabel={t('detail.deleteDialog.confirm')} busy={deleteStudent.isPending} onConfirm={handleConfirm} />`; on mutation error call `toast.error(t('detail.deleteDialog.errorMessage'))` and keep the dialog open. Props of `DeleteStudentDialog` unchanged.
11. **i18n** (`students.json`, bn / en):
    - delete `detail.back`, `detail.identifiers`
    - add `detail.facts.registrationNumber` "রেজিস্ট্রেশন নম্বর" / "Registration no."
    - add `detail.facts.class` "শ্রেণি" / "Class"; `detail.facts.classValue` "{{class}} · শাখা {{section}}" / "{{class}} · Section {{section}}"
    - add `detail.facts.roll` "রোল" / "Roll"; `detail.facts.primaryGuardian` "প্রধান অভিভাবক" / "Primary guardian"
    - add `detail.overview.title` "ব্যক্তিগত তথ্য" / "Personal details"
    - add `detail.overview.fullNameBn` "নাম (বাংলা)" / "Name in Bangla"; `detail.overview.bloodGroup` "রক্তের গ্রুপ" / "Blood group"
    - change `detail.overview.address` "বাড়ির ঠিকানা" / "Home address"
    - add `detail.overrideBadge.promote` "বিশেষ বিবেচনায় উত্তীর্ণ" / "Promoted by exception"; `.retain` "বিশেষ বিবেচনায় একই শ্রেণিতে" / "Kept back by exception"; `.graduate` "বিশেষ বিবেচনায় পাস সম্পন্ন" / "Graduated by exception"
    - change `detail.tabs.recurringFees` "স্বয়ংক্রিয় বিল" / "Automatic billing"; `detail.tabs.documents` "কাগজপত্র" / "Documents"

## Tests
- `$studentId.test.tsx`: no link named "শিক্ষার্থী তালিকায় ফিরুন"; facts show `REG-…`, `সপ্তম · শাখা ক`, the roll in Bangla digits and the primary guardian with `01711-000004`; tablist order matches step 7 (assert the first three tab names and that "স্বয়ংক্রিয় বিল" and "কাগজপত্র" exist); exactly one button with the primary variant in the header; Delete opens a dialog with `role="alertdialog"`; the 31.2.13d hidden-panel rules still hold.
- Overview (in the same file or a new `overview-tab.test.tsx` if simpler): renders "পুরুষ" and "এসএমএস", never `MALE` / `SMS`; DOB is long-form.
- `promotion-override-badge.test.tsx`: label is the short key, latest override wins, nothing renders without overrides.
- E2E: `e2e/keyboard/student-lifecycle.spec.ts` and `e2e/a11y/overlay-openers.ts` find actions by key-based names — unchanged names, no edit. `overlay-openers.ts` waits for the delete dialog; if it asserts `role="dialog"`, the ConfirmDialog's `alertdialog` breaks it — that spec is foundation territory (filed).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No back link; breadcrumb "শিক্ষার্থী › {name}" is the only way back.
- [ ] Header shows four facts including the primary guardian's formatted phone.
- [ ] Tabs are one line in the order of step 7 and never wrap.
- [ ] Overview shows six fields in one card with translated gender and contact method.
- [ ] Delete uses the red confirm dialog; no red button anywhere else.

## Out of scope
- Scroll the selected tab into view when a page opens on `?tab=fees` etc. — needs a change in `ui/src/shells/detail-shell.tsx` (filed).
- `e2e/a11y/overlay-openers.ts` delete-dialog role (`alertdialog`) — filed for the ConfirmDialog foundation owner.
- Photo in the header — not built (see Decisions).
- `-send-reminder-dialog.tsx` is shared with the list page and left as is.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| DetailShell scrolls the selected tab into view | Accepted | 31.2.5b | nothing to pass |
| overlay-openers student-delete accepts alertdialog | Accepted | 31.3.8a | expectDialogOpen accepts dialog or alertdialog for every opener |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: students   Decisions: D5, D6, D8, D9, D15, D16, D20, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.students-3
