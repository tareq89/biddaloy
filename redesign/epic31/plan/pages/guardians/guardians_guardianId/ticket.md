# [31.4.guardians-2] Guardian detail — kit header, carded tabs, full-page edit

## Goal
`/guardians/$guardianId` matches the "after" screenshots: crumbs instead of the back link, a detail header with facts and one filled "পেমেন্ট রেকর্ড করুন", line tabs whose panels are cards and tables in the kit look, no raw enums, and the 8-field edit form as a `FullPageShell` reached by `?edit=1`.

## What and why
Staff open a guardian to see how to reach them, which children they look after, what was sent to them and what they paid — and often to take a payment for all siblings at once. Today the page starts with an underlined "back to list" link, the header shows the raw relationship (`Father`), the tabs are pills, the tables have no frame, the communication and payment tabs print `SMS`, `DELIVERED` and `CASH`, "record payment" is a second filled button hidden inside a tab, and the edit dialog has 8 fields labelled only by placeholders. The redesign moves the facts and the payment action into the kit `DetailShell` header, puts each tab's content in a Card, translates every value and turns the edit form into a full-page modal with visible labels.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guardians/guardians_guardianId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guardians/guardians_guardianId/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guardians/guardians_guardianId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guardians/guardians_guardianId/mobile.webp?raw=true" width="260"> |

The "after" shots show `?tab=linkedStudents`.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Back link | Removed; the layout's crumbs "অভিভাবক › {name}" do the job. | D16 |
| 2 | Header | `DetailShell` name + `StatusBadge domain="guardian"`; `facts` (**New** use): সম্পর্ক (`relationshipLabel`), ফোন (`formatPhone`), পছন্দের যোগাযোগ মাধ্যম, যুক্ত শিক্ষার্থী "২ জন". `identifiers` removed. | D9, D16, kit DetailHeader |
| 3 | Header actions | outline "সম্পাদনা" (`pencil`, `GUARDIAN_UPDATE`) + filled "পেমেন্ট রেকর্ড করুন" (`hand-coins`, `PAYMENT_RECORD`, navigates to `/payments?record=1&guardian_id=…`). Phone: primary + More (edit inside). | D16, D29 — the record button used to be a second filled button inside a tab |
| 4 | Tabs | Line tabs from `DetailShell` (foundation); labels unchanged. | D20 |
| 5 | তথ্য tab | One Card, `h2` "যোগাযোগের তথ্য" (**New** key), FieldGrid (`dl grid gap-4 md:grid-cols-3`): ফোন, বিকল্প ফোন, ইমেইল, পেশা, পছন্দের যোগাযোগ মাধ্যম, ঠিকানা. The primary-contact badge is dropped here (it is in the header). | Kit Card + FieldGrid |
| 6 | যুক্ত শিক্ষার্থী tab | Card with `h2` + one-line description (**New**) + outline "যুক্ত শিক্ষার্থী সম্পাদনা করুন" (now gated by `GUARDIAN_UPDATE`, **New** gate); `DataTable paginated={false}`: নাম, শ্রেণি (`সপ্তম · ক`), রোল (end-aligned, `formatNumber`), রেজিস্ট্রেশন নম্বর (**New** column), কাজ = RowActions `view` → `/students/$id`. Phone: compact two-line rows. Footer "মোট ২টি". | D19, kit DataTable (unpaginated) |
| 7 | Edit linked students | The inline edit mode becomes a `Dialog size="md"` holding the existing `StudentPicker`; footer বাতিল (outline) + সংরক্ষণ করুন (primary). | D21 (1 field → dialog); keeps one primary on the page |
| 8 | যোগাযোগের ইতিহাস tab | Card + `DataTable paginated={false}`: তারিখ (`formatDate`), মাধ্যম (translated, not `SMS`), প্রাপক, অবস্থা = `StatusBadge domain="communication"`. Empty → `EmptyState`. | D9, D27, D28 |
| 9 | পেমেন্টের ইতিহাস tab | Card + `DataTable paginated={false}`: তারিখ, শিক্ষার্থী (plain text), পরিমাণ (end-aligned), পদ্ধতি (`common:enums.paymentMethod.*`, not `CASH`), রেফারেন্স; RowActions `view` → `/payments/$id` (**New**). Record button and `RecordPaymentModal` mount removed from the tab (now in the header). Empty → `EmptyState`. | D9, D19, D29 |
| 10 | Edit guardian | `FullPageShell size="form"` opened by `?edit=1` (**New** search key): title "অভিভাবক সম্পাদনা", one Card "অভিভাবকের তথ্য" with every field labelled (পূর্ণ নাম * , সম্পর্ক, ফোন, বিকল্প ফোন, ইমেইল, পেশা, পছন্দের যোগাযোগ মাধ্যম, ঠিকানা full width), error under the name field; footer বাতিল করুন / পরিবর্তন সংরক্ষণ করুন; Close/Esc ask before discarding. | D21 (8 fields), D22, D25 |

## Mobile behaviour
- Header: crumbs (last two), name + badge, facts in a 2-column grid, then one row: "পেমেন্ট রেকর্ড করুন" (`flex-1`) + More (holds "সম্পাদনা").
- Tab row scrolls sideways with the right-edge fade; only the selected panel shows.
- Tables become compact two-line rows inside the Card (title + caption `সপ্তম · ক · রোল ৭ · REG-…`), eye icon on the right.
- Edit form: full-screen, single column, footer buttons 44 px.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Header primary | Edit · Record payment | Record payment primary, Edit outline | Same split as the kit's student DetailHeader; taking a payment for siblings is the frequent task; edit is rarer. Without `PAYMENT_RECORD` the header has only the outline Edit (at most one primary). |
| How record payment opens | mount `RecordPaymentModal` · navigate | navigate to `/payments?record=1&guardian_id=` | Works today (`payments/index.tsx` opens the modal with the guardian preselected) and after the payments lane's ticket, which redirects `?record=1` to its full-page `/payments/record` route keeping `guardian_id`. `/payments/record` itself drops `guardian_id` until that ticket lands, so it is not used directly. |
| Edit form frame | Dialog lg · FullPageShell | `FullPageShell` via `?edit=1` | D21: more than 6 fields. Search param because no edit route exists (D1: no new routes). |
| Edit file name | rename to `-edit-guardian-form.tsx` · keep | keep `-edit-guardian-dialog.tsx` and the `EditGuardianDialog` export | 31.5.1b's allow-list names this file; renaming would break its list. |
| Relationship field in the form | select · text | keep text input (now labelled) | Free text is the stored shape; display is translated by `relationshipLabel`. |

## Files
- `client-admin/src/routes/_staff/guardians/$guardianId.tsx` — DetailShell facts/actions, back link removed, `edit` search key, edit shell mount
- `client-admin/src/routes/_staff/guardians/$guardianId.test.tsx` — update assertions
- `client-admin/src/routes/_staff/guardians/-edit-guardian-dialog.tsx` — FullPageShell frame, labelled fields
- `client-admin/src/routes/_staff/guardians/-detail/information-tab.tsx` — Card + FieldGrid (also changed by guardians-1, runs earlier — phone import)
- `client-admin/src/routes/_staff/guardians/-detail/linked-students-tab.tsx` — Card, DataTable, edit Dialog
- `client-admin/src/routes/_staff/guardians/-detail/communication-tab.tsx` — Card, DataTable, labels, badge, EmptyState
- `client-admin/src/routes/_staff/guardians/-detail/payments-tab.tsx` — Card, DataTable, method label, RowActions, record button removed
- `client-admin/src/routes/_staff/guardians/-relationship-label.ts` — read only (created by guardians-1)
- `ui/src/i18n/locales/bn/guardians.json`, `ui/src/i18n/locales/en/guardians.json` — keys below (also changed by guardians-1, runs earlier)

## Steps
1. **Search schema** (`$guardianId.tsx`): add `edit: z.number().optional().catch(undefined)` next to `tab`.
2. **Header.** Delete the `<Link to="/guardians">` back link and the outer `flex flex-col gap-4` wrapper's first child. In `DetailShell`:
   - remove `identifiers`; add `facts={[{ label: t('detail.information.columnRelationship'), value: relationshipLabel(g.relationship, t) }, { label: t('detail.information.columnPhone'), value: g.phone ? formatPhone(g.phone, regionConfig) : t('detail.information.emptyValue') }, { label: t('detail.information.columnPreferredCommunication'), value: t(`preferredCommunicationOptions.${g.preferred_communication}`) }, { label: t('list.columnLinkedStudents'), value: t('detail.facts.studentCount', { count: g.students.length }) }]}`.
   - `actions={[{ id: 'edit', label: t('detail.actions.edit'), icon: <PencilIcon />, priority: 'secondary', allowed: canUpdate, onClick: () => navigate({ search: (s) => ({ ...s, edit: 1 }) }) }, { id: 'record-payment', label: t('recordAction', { ns: 'payments' }), icon: <HandCoinsIcon />, priority: 'primary', allowed: canRecord, onClick: () => navigate({ to: '/payments', search: { record: '1', guardian_id: guardianId } }) }]}` with `canRecord = useHasPermission(Permission.PAYMENT_RECORD)`.
   - Keep the loading `Skeleton` and the `ErrorState` branch unchanged.
3. **Edit shell.** Replace `editDialogOpen` state with the search key: `const close = useCloseFullPage(() => navigate({ search: ({ edit: _e, ...rest }) => rest, replace: true }));` and render `{search.edit === 1 && <EditGuardianDialog guardian={g} config={regionConfig} onClose={close} />}`.
4. **`-edit-guardian-dialog.tsx`.** Props become `{ guardian, config, onClose }` (drop `open`/`onOpenChange`; the reset-on-open effect goes — the component mounts fresh). Return `<FullPageShell title={t('editDialog.title')} onClose={onClose} size="form" dirty={!isEqual(form, toFormState(guardian))} secondary={{ label: t('actions.cancel', { ns: 'common' }), onClick: onClose }} primary={{ label: t('editDialog.save'), onClick: () => formRef.current?.requestSubmit(), busy: updateGuardian.isPending }}>` around `<form ref={formRef} onSubmit={handleSubmit}>` (compare the 8 string fields directly; no lodash). Body: one Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`), `h2` `editDialog.sectionTitle`, fields in `mt-4 grid gap-4 md:grid-cols-2` using `FormField` + `Label htmlFor` for each existing control (remove every `aria-label`/placeholder-as-label); `full_name` marked required with its error under the input (`editDialog.fullNameRequired`); address `Textarea` spans `md:col-span-2`; the Select keeps its options. `updateGuardian.isError` → error text at the end of the card. `onSuccess: onClose`.
5. **তথ্য tab.** Wrap in a Card; `h2` `detail.information.title`; `dl className="mt-4 grid gap-4 md:grid-cols-3"`, each pair `dt text-caption text-text-secondary` / `dd`. Order: phone, alternate phone, email, occupation, preferred communication, address. Delete the primary-contact pair. `SkeletonFieldList fields={6}`.
6. **যুক্ত শিক্ষার্থী tab.** Card with `overflow-hidden` and no padding; header block `flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5` with `h2` `detail.linkedStudents.title`, `p mt-1 text-text-secondary` `detail.linkedStudents.description`, and (when `GUARDIAN_UPDATE`) outline button `detail.linkedStudents.editAction` with `UserRoundPenIcon`. Under it `DataTable` (`paginated={false}`, `tableId="guardian-linked-students"`): `name` (`card: 'title'`), `class` = `` `${s.class_section.class.name} · ${s.class_section.section_name}` ``, `roll` (`align: 'end'`, `formatNumber(s.roll_number, config)`), `registration` = `s.registration_number`, `rowActions={(s) => [{ intent: 'view', label: t('list.view'), to: `/students/${s.id}` }]}`, `emptyState={{ title: t('detail.linkedStudents.emptyMessage'), explanation: t('detail.linkedStudents.emptyExplanation') }}`. Edit: `Dialog` (`DialogContent size="md"`, title `editAction`) with `StudentPicker` in the body, footer outline `cancelAction` + primary `saveAction` (`loading`), error text in the body; on success close it.
7. **যোগাযোগের ইতিহাস tab.** Card (`overflow-hidden`) + `DataTable paginated={false}`: date `formatDate(parseServerDate(log.created_at), regionConfig)`, medium `t(`preferredCommunicationOptions.${log.medium}`, { defaultValue: log.medium })`, recipient, status `<StatusBadge domain="communication" status={log.status} />`. `emptyState={{ title: t('detail.communication.emptyMessage'), explanation: t('detail.communication.emptyExplanation') }}`.
8. **পেমেন্টের ইতিহাস tab.** Delete the `canRecord` block, the `RecordPaymentModal` import and state. Card + `DataTable paginated={false}`: date, student `payment.student.full_name` (plain text), amount (`align: 'end'`, same formatting as today), method `t(`enums.paymentMethod.${payment.payment_method}`, { ns: 'common' })`, reference (`?? t('list.emptyValue')`); `rowActions={(p) => [{ intent: 'view', label: t('detail.payments.view'), to: `/payments/${p.id}` }]}`; `emptyState={{ title: t('detail.payments.emptyMessage'), explanation: t('detail.payments.emptyExplanation') }}`.
9. Remove leftover `text-sm`, `text-muted-foreground`, `underline` classes from these files; tokens only.
10. **i18n** (`guardians.json`, bn / en):
    - delete `detail.back`, `detail.identifiers`
    - add `detail.facts.studentCount_one` / `_other`: "{{count}} জন" (both) / "{{count}} student" / "{{count}} students"
    - add `detail.information.title`: "যোগাযোগের তথ্য" / "Contact details"
    - add `detail.information.columnRelationship`: "সম্পর্ক" / "Relationship"
    - add `detail.linkedStudents.title`: "যুক্ত শিক্ষার্থী" / "Linked students"
    - add `detail.linkedStudents.description`: "এই অভিভাবক যাদের দেখাশোনা করেন।" / "The students this guardian looks after."
    - add `detail.linkedStudents.columnRoll`: "রোল" / "Roll"; `detail.linkedStudents.columnRegistration`: "রেজিস্ট্রেশন নম্বর" / "Registration number"
    - add `detail.linkedStudents.emptyExplanation`: "শিক্ষার্থী যুক্ত করলে এখানে দেখা যাবে।" / "Linked students will show up here."
    - add `detail.communication.emptyExplanation`: "এই অভিভাবককে কোনো বার্তা পাঠালে এখানে দেখা যাবে।" / "Messages sent to this guardian will show up here."
    - add `detail.payments.view`: "পেমেন্ট দেখুন" / "View payment"
    - add `detail.payments.emptyExplanation`: "এই অভিভাবকের সন্তানদের পেমেন্ট এখানে দেখা যাবে।" / "Payments for this guardian's children will show up here."
    - add `editDialog.sectionTitle`: "অভিভাবকের তথ্য" / "Guardian details"
    - delete `detail.linkedStudents.columnSection` (class and section share one column now)

## Tests
- `$guardianId.test.tsx`: no link named "অভিভাবক তালিকায় ফিরুন"; header facts show "বাবা" and `01711-000001`; exactly one filled header button ("পেমেন্ট রেকর্ড করুন") and it navigates to `/payments?record=1&guardian_id=<id>`; without `PAYMENT_RECORD` no filled button; clicking "সম্পাদনা" sets `edit=1` and renders an `h1` "অভিভাবক সম্পাদনা" with a labelled "পূর্ণ নাম" input; saving calls `PATCH` and removes `edit` from the URL; communication tab shows "এসএমএস" and the badge "পৌঁছেছে" (not `SMS`/`DELIVERED`); payments tab shows "নগদ টাকা" (not `CASH`) and a "পেমেন্ট দেখুন" link; linked-students edit opens a dialog and has no inline Save button on the tab.
- E2E: no spec targets this page's selectors today (`rg "guardians.detail" e2e` is empty). 31.2.13d already fixed the tab assertions in this test file.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No underlined back link; crumbs read "অভিভাবক › {name}".
- [ ] Each tab panel is a Card; tables show "মোট n টি" and no pager.
- [ ] No `SMS`, `DELIVERED`, `CASH`, `Father` anywhere on the page.
- [ ] `?edit=1` opens a full-page form with a visible label on every field; Esc with changes asks first.

## Out of scope
- Payment rows link to `/payments/$id`; the payment detail page itself belongs to the payments lane.
- `StudentPicker` (`-student-picker.tsx`) internals are unchanged; it only moves into a dialog.
- Communication log has no "message text" column — the API row has none; adding it is a feature.

Wave: 9   Lane: guardians   Decisions: D8, D9, D16, D19, D20, D21, D22, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.guardians-1
