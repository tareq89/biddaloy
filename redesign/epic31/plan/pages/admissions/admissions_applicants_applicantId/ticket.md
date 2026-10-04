# [31.4.admissions-2] Applicant detail — facts header, readable values, reachable notes

## Goal
`/admissions/applicants/$applicantId` shows the applicant with a kit detail header (crumbs, name + StatusBadge, facts, one primary "ভর্তি করুন"), no one-tab row, every value translated or formatted, and a reachable "নোট যোগ করুন".

## What and why
Office staff open an application here to check it and decide: put it on the shortlist, admit it, or reject it. Today the page has a tab row with a single tab, shows raw values (`MALE`, `PHOTO`, `SHORTLIST`, `2020-06-01`, `01711000005`), packs reference and phone into one grey line, colours the shortlisted badge with a token that does not exist, and the "record a note" dialog has no button that opens it. The redesign uses the kit detail header with facts, puts the applicant, documents and history in three cards, and gives every value a label.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_applicants_applicantId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admissions/admissions_applicants_applicantId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `DetailShell` without `tabs`; `facts`: রেফারেন্স নম্বর, আবেদনের তারিখ (`formatDate(created_at)`), **New** ভর্তি পর্ব (title from `useIntake(applicant.intake_id)`, `—` while loading). Replaces the free-form `identifiers` line. | D16, D20 (no one-tab row), D9 |
| 2 | Status | `StatusBadge` from `APPLICANT_STATUS` (admissions-1). | D27; the old shortlisted pill had no colour |
| 3 | Actions | `বাছাই তালিকায় রাখুন` (secondary, only when PENDING), `ভর্তি করুন` (primary, PENDING/SHORTLISTED), **New** `নোট যোগ করুন` (tertiary → More), `প্রত্যাখ্যান করুন` (destructive → More, last, after a separator). Phone: primary full width + More. | D16, D29; note-only evaluate existed but nothing opened it |
| 4 | Card "আবেদনকারীর তথ্য" | One Card, FieldGrid (`grid gap-4 md:grid-cols-3`): জন্ম তারিখ `formatDate`, লিঙ্গ translated (ছেলে / মেয়ে / অন্যান্য), অভিভাবকের নাম, অভিভাবকের ফোন `formatPhone`, ইমেইল, ঠিকানা; missing values "দেওয়া হয়নি". | D5, D8, D9, B22 (`ApplicantDetail.tsx:93`) |
| 5 | Card "নথিপত্র" | Rows: icon well (`image` for photo, `file-text` otherwise) + translated type (ছবি / জন্ম সনদ / একাডেমিক ট্রান্সক্রিপ্ট) + "আপলোড হয়েছে". Empty: "কোনো নথি আপলোড করা হয়নি". | D9 (was `PHOTO`) |
| 6 | Card "মূল্যায়নের ইতিহাস" | Right column on desktop (`md:grid-cols-3`, cards left span 2). Subtitle "নতুনগুলো আগে". Each entry: `StatusBadge` for the decision (নোট neutral, বাছাই তালিকায় রাখা হয়েছে info, ভর্তি করা হয়েছে success, প্রত্যাখ্যান করা হয়েছে danger), `formatDateTime(created_at)`, the note. Sorted newest first. | D5, D9, D27 |
| 7 | Dialogs | Evaluate (shortlist / note) and Reject: `DialogContent size="sm"`, a visible label on the textarea (no placeholder-as-label). Reject's confirm uses `variant="danger"` (red filled is allowed only here). Admit modal: phone via `formatPhone`, `size="sm"`. | D21, D25, D29, B22 (`AdmitApplicantModal.tsx:72`) |

## Mobile behaviour
- Header: crumbs (last two), name + badge, facts in a 2-column grid, then "ভর্তি করুন" (`flex-1`) + More (বাছাই তালিকায় রাখুন, নোট যোগ করুন, প্রত্যাখ্যান করুন).
- Cards stack: applicant info, documents, history. FieldGrid is one column.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where reject sits | inline tinted button / More | More, last item after a separator | Adding the tertiary "নোট যোগ করুন" makes PageHeader put the destructive action in More (31.2.5a rule); a rare, final action should not sit next to the primary |
| Where "add note" sits | button inside the history card / header More | header More (tertiary) | Keeps one action area; the card stays read-only |
| Gender values | load `admission-public` namespace / own keys | own keys `detail.genderOptions.*` | The staff page should not load the public form's namespace; unknown values show `detail.notProvided` |
| Reviewer name on history | show / omit | omit | DTO has only `reviewer_user_id`; shared request filed |
| Admission round fact | `useIntakes()` list / `useIntake(id)` | `useIntake(applicant.intake_id)` | One small request, cached with the intake page |

## Files
- `client-admin/src/features/admission/ApplicantDetail.tsx` — header, cards, history, reject dialog
- `client-admin/src/features/admission/EvaluateApplicantForm.tsx` — dialog size, visible label
- `client-admin/src/features/admission/AdmitApplicantModal.tsx` — `formatPhone`, dialog size
- `client-admin/src/features/admission/applicantStatus.ts` (also changed by admissions-1, runs earlier) — read only unless a tone is missing
- `client-admin/src/routes/_staff/admissions/applicants/index.test.tsx` (also changed by admissions-1, runs earlier) — detail cases
- `ui/src/i18n/locales/{en,bn}/admission-staff-applicants.json` (also changed by admissions-1, runs earlier) — keys below
- `e2e/admission.spec.ts` (also changed by admissions-1, runs earlier) — no selector change expected; run it

## Steps
1. **Locale (`admission-staff-applicants.json`, en + bn).** Change `detail.actionShortlist` "Shortlist" → "Add to shortlist" / "শর্টলিস্ট করুন" → "বাছাই তালিকায় রাখুন"; `evaluate.shortlistTitle` "Shortlist applicant" → "Add to shortlist" / "বাছাই তালিকায় রাখুন"; `evaluate.notesLabel` "Notes" → "Note" / "নোট" (same bn). Add: `detail.factIntake` "Admission round" / "ভর্তি পর্ব"; `detail.factReference` "Reference number" / "রেফারেন্স নম্বর"; `detail.factApplied` "Applied on" / "আবেদনের তারিখ"; `detail.actionAddNote` "Add note" / "নোট যোগ করুন"; `detail.historySubtitle` "Newest first" / "নতুনগুলো আগে"; `detail.uploaded` "Uploaded" / "আপলোড হয়েছে"; `detail.genderOptions.MALE` "Boy" / "ছেলে", `.FEMALE` "Girl" / "মেয়ে", `.OTHER` "Other" / "অন্যান্য"; `detail.documentTypes.PHOTO` "Photo" / "ছবি", `.BIRTH_CERTIFICATE` "Birth certificate" / "জন্ম সনদ", `.TRANSCRIPT` "Academic transcript" / "একাডেমিক ট্রান্সক্রিপ্ট"; `detail.decision.NOTE` "Note" / "নোট", `.SHORTLIST` "Added to shortlist" / "বাছাই তালিকায় রাখা হয়েছে", `.ADMIT` "Admitted" / "ভর্তি করা হয়েছে", `.REJECT` "Rejected" / "প্রত্যাখ্যান করা হয়েছে"; `detail.rejectNotesLabel` "Reason (optional)" / "কারণ (না দিলেও চলবে)"; `detail.rejectDescription` "{{name}} will be told the application was not accepted. This cannot be undone." / "{{name}}-এর আবেদন গ্রহণ করা হয়নি বলে জানানো হবে। এটি আর ফেরানো যাবে না।". `detail.noteOnly` becomes unused — delete it.
2. **Header.** Remove `tabs`, `activeTab`, `onTabChange` and `identifiers`; pass the cards as the body (tab-less `DetailShell`, contract addendum 7). `facts={[{ label: t('detail.factReference'), value: applicant.reference_number }, { label: t('detail.factApplied'), value: formatDate(applicant.created_at, regionConfig) }, { label: t('detail.factIntake'), value: intakeQuery.data?.title ?? '—' }]}` with `const intakeQuery = useIntake(applicant.intake_id)` (call the hook before the early returns with `applicantQuery.data?.applicant.intake_id`). `statusBadge={<StatusBadge tone={APPLICANT_STATUS[s].tone} label={t(APPLICANT_STATUS[s].labelKey)} />}`; delete `STATUS_BADGE_CLASS` and the local `statusLabel`.
3. **Actions.** `[{ id: 'shortlist', label: t('detail.actionShortlist'), icon: <ListChecks />, priority: 'secondary', allowed: shortlistable, onClick: () => openEvaluate('SHORTLIST') }, { id: 'admit', label: t('detail.actionAdmit'), icon: <UserCheck />, priority: 'primary', allowed: mutable, onClick: () => setAdmitOpen(true) }, { id: 'note', label: t('detail.actionAddNote'), priority: 'tertiary', allowed: mutable, onClick: () => openEvaluate(undefined) }, { id: 'reject', label: t('detail.actionReject'), priority: 'destructive', allowed: mutable, onClick: () => setRejectOpen(true) }]`.
4. **Body.** `<div className="grid gap-6 md:grid-cols-3 md:items-start">` → left `<div className="space-y-6 md:col-span-2">` with Card "আবেদনকারীর তথ্য" (`Card padded`, `h2 text-h2`, `dl mt-4 grid gap-4 md:grid-cols-3`, `dt text-caption text-text-secondary`) and Card "নথিপত্র" (`ul mt-2 divide-y divide-border-subtle`, row `flex items-center gap-3 py-3`, icon well `flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-text-secondary`, label `min-w-0 flex-1 font-medium`, `text-text-secondary` "আপলোড হয়েছে"); right Card "মূল্যায়নের ইতিহাস" (`p mt-1 text-text-secondary` subtitle, `ul mt-2 divide-y divide-border-subtle`, entry `py-3`: `flex flex-wrap items-center justify-between gap-2` with the decision `StatusBadge` + `text-caption text-text-secondary` `formatDateTime(created_at, regionConfig)`, then `p mt-1.5` note). Sort `[...evaluations].sort((a, b) => b.created_at.localeCompare(a.created_at))`. Decision tone: `null` → neutral `decision.NOTE`, SHORTLIST info, ADMIT success, REJECT danger. Gender: `t(`detail.genderOptions.${g}`, { defaultValue: t('detail.notProvided') })` for MALE/FEMALE/OTHER, else `notProvided`. Keep the `ponytail:` comment about the missing download endpoint.
5. **Dialogs.** Reject: `DialogContent size="sm"`; header title + `DialogDescription` `t('detail.rejectDescription', { name })`; `<Label htmlFor="reject-notes">{t('detail.rejectNotesLabel')}</Label>` + `Textarea id="reject-notes"` (no placeholder); confirm `variant="danger"`. `EvaluateApplicantForm`: `size="sm"`, visible `Label` "নোট" + required mark, title `decision === 'SHORTLIST' ? shortlistTitle : actionAddNote`. `AdmitApplicantModal`: `size="sm"`, `formatPhone(applicant.guardian_phone, regionConfig)`.
6. Run `yarn workspace @biddaloy/ui check:i18n`, the tests below, `e2e/admission.spec.ts` (local recipe), then `graphify update .`.

## Tests
- `applicants/index.test.tsx` → "shows uploaded documents and evaluation history when present": expects "ছবি"/"Photo" not `PHOTO`, decision "Added to shortlist" not `SHORTLIST`, long date-time; add: no `role="tablist"` on the page; gender `MALE` renders "Boy"; facts show the intake title from a mocked `GET /admission-intakes/:id`.
- "shortlists an applicant…" / "hides Shortlist…": button name is the new `detail.actionShortlist` text (read through `t`).
- "rejects an applicant…": opens More → "প্রত্যাখ্যান করুন" menu item → dialog has a labelled textarea; confirm button has `data-variant="danger"`.
- **New** case: More → "নোট যোগ করুন" opens the note dialog and posts `{ notes }` with no `decision`.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No tab row; facts show reference number, applied date and admission round.
- [ ] Gender, document types and history decisions are translated words.
- [ ] "নোট যোগ করুন" and "প্রত্যাখ্যান করুন" are in More; reject's red filled button appears only inside its dialog.

## Out of scope
- Document preview/download — no storage-serving endpoint yet (existing `ponytail:` note).
- Reviewer name on history entries — shared request filed (server field).
- Last crumb shows the generic noun until the applicant resolver lands — shared request filed.
- After admitting, a link to the new student — the admit API returns no student id.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| crumb resolver: applicant name | Accepted | 31.3.5 | resolver key admissionApplicantDetail reads the applicantQueryOptions(id) cache -> applicant.applicant_name; the page only has to keep using useApplicant(id) |
| server reviewer_name on evaluations | Deferred | — | use the fallback in the ticket (history without reviewer name) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: admissions   Decisions: D5, D8, D9, D16, D20, D21, D25, D27, D29   Depends on: 31.3.8b, 31.4.admissions-1
