# [31.4.staff-4a] Evaluations and survey page — one header, badges, icon actions

## Goal
`/staff/evaluations` and `/staff/evaluations/surveys/$surveyId` match their "after" screenshots: the evaluations page has one `h1` "মূল্যায়ন" with a per-tab primary action, line tabs, labelled filters, status badges, eye actions and a table total; the survey page is a detail page with facts, no lone tab, and results in Bangla numerals. Split: this is part a; the survey form as a full-page modal is part b (`ticket-b.md`, runs after a).

## What and why
An admin uses Evaluations to see every staff ACR (annual confidential report), every teacher survey and every reported incident, and to start a new one. Today the page has no heading of its own — each tab's list title becomes the `h1`, pill tabs sit above it, the filters have no labels, status is plain text, dates are ISO, totals use Latin digits, the actions column is an underlined "খুলুন" link, and there is no visible way to start an ACR or report an incident (only the command palette). The survey page shows a single "ফলাফল" tab plus a second "ফলাফল" heading, packs its settings into one run-on line, shows English subject names and Latin digits, and puts publish/close errors as loose red text. The redesign gives the page the kit header + tabs + DataTable, and the survey page the kit detail header.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — evaluations | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations/before-mobile.webp?raw=true" width="260"> |
| After — evaluations | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations/mobile.webp?raw=true" width="260"> |
| Before — survey | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations_surveys_surveyId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations_surveys_surveyId/before-mobile.webp?raw=true" width="260"> |
| After — survey | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations_surveys_surveyId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_evaluations_surveys_surveyId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Evaluations header | `PageContainer` + `PageHeader` title "মূল্যায়ন" (= sidebar label), subtitle "এসিআর, শিক্ষক জরিপ ও ঘটনা এক জায়গায়।" (**New**). | D16, D32 |
| 2 | Header action | One filled primary that follows the tab (only with `ACR_WRITE`): এসিআর → "এসিআর শুরু করুন", জরিপ → "নতুন জরিপ", ঘটনা → "ঘটনা জানান". Each opens the dialog the page already mounts. **New** visible entry for ACR and incident (palette-only today). | D16, D29 |
| 3 | Tabs | Kit line tabs below the header (not above the title); selected tab stays in `?tab=`. | D20 |
| 4 | Tab panels | No `ListShell` inside a tab (it rendered a second page header and the `h1`). Each tab = `FilterBar` + `DataTable`. Tab titles "এসিআর তালিকা" / "শিক্ষক জরিপ" / "ঘটনা" stay only as the table caption. | D16 |
| 5 | Filters | Visible labels "শিক্ষাবর্ষ" and "অবস্থা" (ACR), "ধরন" and "গুরুত্ব" (incidents); phone = "ফিল্টার (n)" sheet. | D24, D32 |
| 6 | ACR table | Columns কর্মী (bold), শিক্ষাবর্ষ, অবস্থা = StatusBadge (চলমান warning, সম্পন্ন success), মোট নম্বর (end-aligned, `formatNumber`), সম্পন্নের তারিখ (`formatDate`), কাজ = RowActions `view` "খুলুন". | D5, D6, D19, D27 |
| 7 | Incidents table | গুরুত্ব = StatusBadge (বেশি danger, মাঝারি warning, কম neutral); তারিখ `formatDate`; বিবরণ truncated to one line (`max-w-*` not allowed → `truncate` inside the cell with `title`). No row action (no incident page exists). | D27, D5 |
| 8 | Surveys table | শিরোনাম plain bold text (no underline link); অবস্থা = StatusBadge (খসড়া neutral, চালু success, বন্ধ info); শেষ হবে `formatDate`; RowActions `view` "খুলুন" → survey page. | D19, D27 |
| 9 | Totals | ACR and incidents: client-side pages of 25 with TableCount + pager (the server returns everything); surveys: `paginated={false}` → "মোট nটি". Empty table → EmptyState, no footer. | D19, D28 |
| 10 | Survey header | `DetailShell` without tabs: name + StatusBadge, `facts` = কারা উত্তর দেবে, পরিচয় (গোপন / নাম দেখা যাবে), শুরু, শেষ, ফল দেখানোর ন্যূনতম উত্তর. | D16, D20, D27 |
| 11 | Survey actions | DRAFT → primary "চালু করুন"; OPEN → primary "জরিপ বন্ধ করুন" opening a `ConfirmDialog` (**New** confirm); CLOSED → none. Errors → `toast.error` with the existing sentences. | D29, D28 |
| 12 | Results | Section `h2` "ফলাফল" + "শিক্ষক ও বিষয় অনুযায়ী · মোট nটি" (**New**); one Card per teacher-subject (`md:grid-cols-2`); per question: text left, "গড় ৫-এর মধ্যে ৪.৬" right (`formatNumber`, 1 decimal); comments as a quiet list; a sealed pair shows a warning badge "অপেক্ষায়" + the waiting sentence with a **New** reason. | D6, D27 |
| 13 | Names | Subject names in the UI language (`name_bn` when bn and present, else `name_en`); counts through `formatNumber`. | D6, D9 |

## Mobile behaviour
- Evaluations: title, subtitle, full-width primary; tabs scroll if needed; "ফিল্টার" button opens the sheet; ACR / incident / survey rows become cards (name + badge, subtitle, `dl`, "খুলুন" action with a label).
- Survey: crumbs show the last two; facts in a 2-column `dl`; result cards stack.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Header action | none (palette only) · three buttons · one primary per tab | one primary per tab | D16 allows one filled button; the dialogs already live on this page. |
| Paging | unpaginated · client pages of 25 | client pages (ACR, incidents); unpaginated (surveys) | Registers and incidents grow every year; surveys stay few. Server already returns all rows. |
| CLOSED survey tone | neutral · info | info | Draft is neutral; "closed" means results are now visible, so it needs a different tone. |
| Close survey | one click · ConfirmDialog | ConfirmDialog | Closing stops every guardian and student from answering and cannot be undone. |
| Lone results tab | keep · drop | drop (`tabs` omitted) | One tab is not a choice; it duplicated the "ফলাফল" heading. |

## Files
- `client-admin/src/routes/_staff/staff/evaluations.tsx` — PageContainer, PageHeader, per-tab primary, line tabs
- `client-admin/src/routes/_staff/staff/-evaluations/acr-register.tsx` — FilterBar + DataTable, badges, RowActions, paging
- `client-admin/src/routes/_staff/staff/-evaluations/incidents-list.tsx` — same
- `client-admin/src/routes/_staff/staff/-evaluations/surveys-list.tsx` — DataTable, badges, RowActions, no own button
- `client-admin/src/routes/_staff/staff/evaluations_.surveys.$surveyId.tsx` — DetailShell facts, actions, ConfirmDialog, toasts
- `client-admin/src/routes/_staff/staff/-evaluations/survey-results.tsx` — cards, numbers, sealed state
- `client-admin/src/routes/_staff/staff/-evaluations/use-survey-names.ts` — localized subject name
- `client-admin/src/routes/_staff/staff/-evaluations/evaluations.test.tsx` — update
- `client-admin/src/routes/_staff/staff/-evaluations/surveys.test.tsx` — list/results cases only (form cases change in staff-4b)
- `ui/src/i18n/locales/{bn,en}/evaluations.json` — keys below (also changed by staff-2c, runs earlier)
- `e2e/journeys/committee-role.spec.ts` — heading assertions (lines 52, 56)
- `e2e/journeys/survey.spec.ts` — close now confirms (line 97)

## Steps
1. **`evaluations.tsx`.** Root becomes `<PageContainer>` → `<PageHeader title={t('title')} subtitle={t('subtitle')} actions={canWrite ? [primaryFor(tab)] : []} />` then `<Tabs value={tab} …>` (same `onValueChange`; the line variant is the default after 31.2.5b). `primaryFor`: `acr` → `{ id: 'startAcr', label: t('acr.start'), icon: <PlusIcon />, priority: 'primary', onClick: () => setStartOpen(true) }`; `surveys` → `{ id: 'newSurvey', label: t('surveys.new'), … onClick: () => setSurveyOpen(true) }`; `incidents` → `{ id: 'reportIncident', label: t('incident.report'), … onClick: () => setReportOpen(true) }`. Remove `className="flex flex-col gap-4"`; tab panels get `className="space-y-4 pt-4 md:pt-6"`. Palette flag effect unchanged in this ticket.
2. **Shared list helper inside each tab file (no new file):** replace `<ListShell …>` with
   `<section className="space-y-4"><FilterBar fields={filterFields} values={state.filters} onChange={actions.setFilters} resultCount={rows.length} /><DataTable … /></section>` (surveys: no FilterBar). `FilterBar` from `@biddaloy/ui/shells`, `DataTable` / `StatusBadge` / `Skeleton` from `@biddaloy/ui/components`. `useListShellState({ limit: 25 })`; `const pageRows = rows.slice((state.page - 1) * state.limit, state.page * state.limit)`; pass `data={pageRows} page={state.page} pageSize={state.limit} totalCount={rows.length} onPageChange={actions.setPage} onPageSizeChange={actions.setLimit}`. `emptyState={{ title: …, explanation: … }}`, `error` as today, `loading` as today.
3. **`acr-register.tsx`.** Filter labels: `acr.register.yearFilter` / `statusFilter` (text changes below). `allLabel` for status → `acr.register.allStatuses` (text below). Columns: `staff` → `<StaffName>` in `font-medium` (while `useUser` loads render `<Skeleton className="h-4 w-24" />` instead of "…"), `year` (`card: 'subtitle'`, rendered `t('acr.register.cardSubtitle', { year })`), `status` → `<StatusBadge tone={row.status === 'COMPLETED' ? 'success' : 'warning'} label={t(`acr.status.${row.status}`)} />` (`card: 'badge'`), `total` → `align: 'end'`, `row.total === null ? '—' : formatNumber(row.total, regionConfig)`, header `acr.register.columnTotal`, `completed` as today. Delete the `actions` column; `rowActions={(row) => [{ intent: 'view', label: t('acr.register.open'), to: `/staff/${row.user_id}/acr/${row.id}` }]}`. Empty: `{ title: t('acr.register.emptyTitle'), explanation: t('acr.register.empty') }`.
4. **`incidents-list.tsx`.** Same frame. `severity` → `<StatusBadge tone={{ HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' }[row.severity]} label={t(`incident.severities.${row.severity}`)} />`; `description` cell `<span className="block truncate" title={row.description}>`; staff name as step 3. No `rowActions`. Empty: `{ title: t('incident.emptyTitle'), explanation: t('incident.empty') }`.
5. **`surveys-list.tsx`.** Drop the `onNew` prop and its `Button` (the page header owns it; update the caller in step 1). `DataTable paginated={false}`; `title` plain `font-medium` text (`card: 'title'`); `status` → StatusBadge `{ DRAFT: 'neutral', OPEN: 'success', CLOSED: 'info' }`; `closes` as today; `rowActions` `view` `t('surveys.open')` → `/staff/evaluations/surveys/${row.id}`. Empty: `{ title: t('surveys.empty'), explanation: t('surveys.emptyBody') }` (both keys exist).
6. **`evaluations_.surveys.$surveyId.tsx`.** Remove the wrapping `div` and both `role="alert"` paragraphs; `onError` of each mutation → `toast.error(t('surveys.detail.publishError' | 'closeError'))`. `DetailShell` props: `statusBadge={<StatusBadge tone=… label=… />}` (map of step 5), `facts={[{ label: t('surveys.columnRespondents'), value: t(`surveys.respondents.${survey.respondent}`) }, { label: t('surveys.detail.identityLabel'), value: t(survey.anonymous ? 'surveys.detail.identityHidden' : 'surveys.detail.identityShown') }, { label: t('surveys.detail.opensAt'), value: date(survey.opens_at) }, { label: t('surveys.detail.closesAt'), value: date(survey.closes_at) }, { label: t('surveys.detail.minResponsesLabel'), value: t('surveys.detail.minResponsesValue', { count: formatNumber(survey.min_responses, regionConfig) }) }]}`; drop `identifiers`, `tabs`, `activeTab`, `onTabChange`; render `<SurveyResults …>` as the children / body slot (whatever 31.2.5 gives DetailShell for "no tabs"). Actions: `publish` as today; `close` becomes `priority: 'primary'` and opens `ConfirmDialog` (`title` `surveys.detail.closeConfirm.title`, `description` `…closeConfirm.description` with `{{title}}`, `confirmLabel` `surveys.detail.close`, `tone="default"`, `busy={close.isPending}`, `onConfirm` = `close.mutate`). Error state and skeleton unchanged.
7. **`survey-results.tsx`.** Header: `h2 text-h2` + `p mt-0.5 text-text-secondary` `t('surveys.detail.resultsSubtitle', { count: formatNumber(results.length, cfg) })`. Drop the `p` for OPEN status when results are present (the sealed cards say it); keep `sealedOpen` only when `results.length === 0`. List `ul grid gap-4 md:grid-cols-2`; each `li` Card classes (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`): `h3 text-h3` teacher, `p text-text-secondary` `subject · t('surveys.detail.responses', { count: formatNumber(pair.count) })`. Hidden pair: header row gets `<StatusBadge tone="warning" label={t('surveys.detail.waitingBadge')} />`, then `p role="status" mt-3 text-text-secondary` = `t('surveys.detail.waiting', { count, min })` (both formatted) + " " + `t('surveys.detail.waitingWhy')`. Shown pair: `ul mt-3 divide-y divide-border-subtle`, each question `li py-3` (`last:pb-0`): row `flex items-start justify-between gap-4` with `p font-medium` text and `p shrink-0 tabular-nums` = average (`averageStars === null` → `text-text-secondary` `t('surveys.detail.noStarsShort')`; else `t('surveys.detail.averageStars', { value: formatNumber(q.averageStars, cfg, { decimals: 1 }) })`). Comments `ul aria-label={t('surveys.detail.comments')} className="mt-2 space-y-1 text-text-secondary"` with `li className="border-s-2 border-border-subtle ps-3"`; none → `p mt-2 text-text-secondary` `noComments`. `useTenantRegionConfig()` for `cfg`.
8. **`use-survey-names.ts`.** `const { locale } = useLocale();` subject name = `locale === 'bn' && x.name_bn ? x.name_bn : x.name_en`.
9. **Locale keys** (`evaluations.json`, bn / en):
   - add `subtitle`: "এসিআর, শিক্ষক জরিপ ও ঘটনা এক জায়গায়।" / "ACRs, teacher surveys and incidents in one place."
   - change `acr.register.yearFilter` and `acr.register.columnYear`: "শিক্ষাবর্ষ" / "Academic year"; `acr.register.allYears`: "সব শিক্ষাবর্ষ" / "All academic years"; `acr.register.allStatuses`: "সব অবস্থা" / "All statuses"; `acr.register.columnTotal`: "মোট নম্বর" / "Total score"
   - add `acr.register.cardSubtitle`: "শিক্ষাবর্ষ {{year}}" / "Academic year {{year}}"; `acr.register.emptyTitle`: "কোনো এসিআর নেই" / "No ACRs"
   - add `incident.emptyTitle`: "কোনো ঘটনা নেই" / "No incidents"
   - add `surveys.open`: "খুলুন" / "Open"
   - add `surveys.detail.identityLabel`: "পরিচয়" / "Identity"; `identityHidden`: "গোপন" / "Hidden"; `identityShown`: "নাম দেখা যাবে" / "Names shown"; `minResponsesLabel`: "ফল দেখানোর ন্যূনতম উত্তর" / "Answers needed before results show"; `minResponsesValue`: "{{count}}টি" / "{{count}}"
   - add `surveys.detail.resultsSubtitle`: "শিক্ষক ও বিষয় অনুযায়ী · মোট {{count}}টি" / "By teacher and subject · {{count}} in total"; `waitingBadge`: "অপেক্ষায়" / "Waiting"; `waitingWhy`: "কারো পরিচয় যাতে বোঝা না যায়, তাই এর কম উত্তরে ফল দেখানো হয় না।" / "Results stay hidden below this number so no single answer can be traced."; `noStarsShort`: "যথেষ্ট রেটিং নেই" / "Not enough ratings"
   - change `surveys.detail.waiting` bn: "আরও উত্তরের অপেক্ষায় ({{min}}টির মধ্যে {{count}}টি)।" (adds the full stop; en likewise)
   - add `surveys.detail.closeConfirm.title`: "জরিপ বন্ধ করবেন?" / "Close this survey?"; `closeConfirm.description`: "“{{title}}” বন্ধ হলে আর কেউ উত্তর দিতে পারবে না। এটি আবার চালু করা যাবে না।" / "Once “{{title}}” is closed nobody can answer it any more. It cannot be reopened."
   - remove now-unused `surveys.detail.anonymousOn` / `anonymousOff` only if `rg` finds no other reader.
10. **e2e.** `committee-role.spec.ts:52` → heading `t('evaluations.title')`; `:56` → `expect(page.getByRole('tab', { name: t('evaluations.tabs.surveys'), selected: true })).toBeVisible()`; `:57` unchanged (the header button carries `surveys.new`). `survey.spec.ts:97` → after clicking `surveys.detail.close`, click the confirm button in `getByRole('alertdialog')` with the same name.

## Tests
- `evaluations.test.tsx`: page has exactly one `h1` "মূল্যায়ন"; ACR status cell renders the badge text; the row's link has `aria-label` "খুলুন" and `href` `/staff/:user/acr/:id`; with 30 ACRs the footer shows the 25-row page and "মোট ৩০"; header button label follows the tab (and is absent without `ACR_WRITE`); existing filter / empty / refusal cases keep passing (empty now asserts the EmptyState title).
- `surveys.test.tsx`: list shows the status badge and no underlined title link; results show `formatNumber` averages and the sealed badge; OPEN survey "জরিপ বন্ধ করুন" opens a confirm and only the confirm calls the close mutation.
- e2e: `committee-role.spec.ts`, `survey.spec.ts` as step 10.

## Acceptance
- [ ] Desktop at 1440 px matches both "after" screenshots.
- [ ] Mobile at 390 px matches both "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (none on a closed survey).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The evaluations `h1` is "মূল্যায়ন" and sits above the tabs; tab titles are not headings.
- [ ] Each status in all three tables and on the survey page is a StatusBadge.
- [ ] Actions column shows an eye icon with tooltip "খুলুন", never a text link.
- [ ] The survey page has no tab strip and no duplicate "ফলাফল" heading.

## Out of scope
- Crumb "মূল্যায়ন" disappears on the survey page (route-crumbs marks it `dynamic`) — shared request filed; until then the trail is কর্মী › {title}.
- Staff names load one `useUser` call per row (APIs return only ids) — shared request filed; a name search is not offered until names come with the list.
- No edit for a draft survey (no edit flow exists; D1).
- `StartAcrDialog`, `ReportIncidentDialog` (`-detail/`, staff lane; not changed by any ticket) — placed, not edited.
- The survey form itself → staff-4b; the ACR form → staff-5; the ACR / Incidents / Performance tabs of the staff page → staff-2c.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| third survey crumb | Accepted | 31.3.5 | trail কর্মী › মূল্যায়ন (link /staff/evaluations?tab=surveys) › {title}; resolver key surveyDetail; new key nav:items.surveyDetail |
| server full_name on /acr-assessments and /incidents rows | Deferred | — | use the fallback in the ticket (useUser per row, no name search) |

Wave: 9   Lane: staff   Decisions: D5, D6, D9, D16, D19, D20, D24, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.staff-3
