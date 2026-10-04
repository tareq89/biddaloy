# [31.4.communications-2b] Bulk fee reminders — full-page modal with clear steps

## Goal
`/communications/reminders?mode=bulk` opens as a `FullPageShell` that matches the "after (bulk)" screenshots: a numbered step row, labelled filters with the phone filter sheet, a selection table in tenant numerals, and Back / Next / Preview / Send in the sticky footer.
b runs after a (communications-2a).

## What and why
The bulk wizard sends one fee reminder to up to 500 students' guardians in three steps: pick students, write the message, check the server preview and send. Today it sits inside the normal page with its own `max-w-5xl` wrapper, a small `text-lg` title, a "›"-separated step line, filter selects without a phone layout, month options printed as `01`–`12`, 10 rows per page, raw `{{…}}` placeholder buttons, and the server's English 400 text. D21/D23 say a flow with steps and a table is a full-page modal; the redesign moves it there and reuses 2a's placeholder and recipient-list work.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After (bulk, recipients step) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders_bulk/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders_bulk/mobile.webp?raw=true" width="260"> |
| After (single page, ticket a) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | `FullPageShell size="wide"` titled "একসাথে ফি রিমাইন্ডার"; Close ("বন্ধ করুন") and Esc return to the single page, asking first when something was picked or typed. The "একক রিমাইন্ডার" ghost link goes away. | D21, D22, D23 |
| 2 | Step row | **New** local `WizardSteps`: numbered circles — current `bg-primary`, done `bg-secondary` + check (clickable), upcoming `bg-muted`; lines between; scrolls sideways on phone. Step 3 renamed "যাচাই ও পাঠানো". | Current state visible at a glance |
| 3 | Step heading | Each step starts with `h2` + one sentence ("কাদের পাঠাবেন" / "কী লিখবেন" / "যাচাই করে পাঠান"). | Tells the user what this step is for |
| 4 | Filters | `FilterBar` (kit) with শ্রেণি, শাখা, মাস, বছর, ফির অবস্থা — visible labels on desktop, "ফিল্টার (n)" + bottom sheet on phone, removable chips. Months by name (`formatMonthName`), years in tenant digits. | D24, D6, D9 |
| 5 | Selection table | Default 25 rows; student cell = name + registration number caption; "শ্রেণি · শাখা" in one column; amounts and months end-aligned, months via `formatNumber`. Counter line "৫০০ জনের মধ্যে ৪ জন শিক্ষার্থী বাছা হয়েছে". Phone: cards with a 44 px checkbox. | D19, B23, D6 |
| 6 | Message step | Card with "দফার নাম", message (display placeholders from 2a), `PlaceholderButtons`, channel checkbox rows `min-h-11`, WhatsApp fields. | D9, 44 px targets |
| 7 | Review step | Summary as a facts `dl` (যারা পাবেন, বাদ পড়েছেন, এসএমএস ইউনিট when metered), skipped-by-reason list, per-student `details` rows `min-h-11` with `RecipientList`. Projection card restyled as a Card. | Readable at a glance |
| 8 | Footer | Secondary: "বাতিল করুন" on step 1, "আগের ধাপ" after. Primary: "পরের ধাপ: বার্তা" → "পরের ধাপ: যাচাই" → "প্রাপকদের প্রিভিউ করুন" → "n জনকে রিমাইন্ডার পাঠান" once the preview is current. | D22 footer; one filled button |
| 9 | Errors | 400 → translated `bulk.review.previewInvalid` / `bulk.review.sendInvalid`; 429 and credit messages unchanged. | D9 |
| 10 | Result | After queueing, the body shows "রিমাইন্ডার পাঠানো শুরু হয়েছে" + sentence; footer primary "পাঠানোর অগ্রগতি দেখুন" opens the round's detail page. | D29 (link → button) |

## Mobile behaviour
- Header: title (truncates) + Close button `h-11`. Footer: secondary left, primary right, both `h-11`.
- Filters collapse into "ফিল্টার (n)" + chips; the sheet's primary shows "n টি ফলাফল দেখুন".
- Table rows become cards: checkbox (44 px) on the start edge, name + amount on top, "সপ্তম শ্রেণি · শাখা ক · ৩ মাসের বকেয়া", registration number.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Frame | stay a page / FullPageShell on `?mode=bulk` | FullPageShell, URL keeps `?mode=bulk&step=` | D21 (steps + table), D22 (search param on host route) |
| Step UI | `WizardShell` inside FullPageShell / local step row + `useWizardShellStep` | local `-bulk/wizard-steps.tsx` | `WizardShell` renders its own `h1` and footer, which would double the FullPageShell's; shared request filed to give it a headless mode |
| Month + year filters | one MonthPicker / two Selects | keep two Selects, translated labels | Keeps "year only" filtering the API allows; no behaviour change |
| Review primary | separate Preview button in the body / footer primary changes | footer primary is "Preview" until the preview matches, then "Send" | Same rule as 2a; footer holds the one filled button |

## Files
- `client-admin/src/routes/_staff/communications/reminders.tsx` — `mode=bulk` branch renders the full-page wizard (also changed by communications-2a, runs earlier)
- `client-admin/src/routes/_staff/communications/-bulk/bulk-reminder-wizard.tsx` — FullPageShell, steps, FilterBar, table, footer logic, errors
- `client-admin/src/routes/_staff/communications/-bulk/wizard-steps.tsx` — **New**
- `client-admin/src/routes/_staff/communications/-bulk/bulk-reminder-wizard.test.tsx` — updated
- `client-admin/src/routes/_staff/communications/-bulk/bulk-sms-projection-card.tsx` + `.stories.tsx` — Card + facts styling, `formatNumber`
- `client-admin/src/routes/_staff/communications/-shared/skip-reason.ts` — no change; callers tidied (also changed by communications-2a)
- `ui/src/i18n/locales/en/communications.json`, `ui/src/i18n/locales/bn/communications.json` (also changed by communications-1 and -2a, run earlier)

## Steps
1. **Frame.** `BulkReminderWizard` returns `<FullPageShell title={t('bulk.title')} size="wide" onClose={close} dirty={dirty} secondary={…} primary={…}>`. `const close = useCloseFullPage(() => void navigate({ to: '/communications/reminders', search: { mode: undefined, step: undefined } }))`. `dirty = selectedIds.size > 0 || batchName !== '' || template !== ''` and `!send.isSuccess`. Delete the outer `div.mx-auto … max-w-5xl` and the "একক রিমাইন্ডার" button. The single page's `RegionConfigProvider` wrap in `reminders.tsx` stays around it.
2. **Steps.** Keep `const [stepId, setStepId] = useWizardShellStep(STEP_IDS)`. Drop `WizardShell`; compute `currentIndex`, `isValid` per step from the existing `isValid` lambdas (move them into a `stepValid: Record<StepId, boolean>`). Body: `<WizardSteps steps={[…labels]} currentIndex onStepClick={(i) => i < currentIndex && setStepId(STEP_IDS[i])} />`, then only the current step's content (keep the "visited steps stay mounted with `hidden`" behaviour so filters/selection survive Back), and an `sr-only` `aria-live="polite"` line `t('wizard.stepAnnouncement', { current, total, label }, { ns: 'common' })` that receives focus on step change (copy the two effects from `ui/src/shells/wizard-shell.tsx:75-100`).
3. **`wizard-steps.tsx` (New).** `ol aria-label={t('bulk.stepsLabel')} className="flex min-h-11 items-center gap-2 overflow-x-auto [scrollbar-width:none]"`; per step `li.flex shrink-0 items-center gap-2` (`aria-current="step"` on the current): circle `flex size-7 shrink-0 items-center justify-center rounded-full` + current `bg-primary text-label font-semibold text-primary-foreground` (number via `formatNumber(i + 1, config)`), done `bg-secondary text-secondary-foreground` with `Check size-4`, upcoming `bg-muted text-label text-text-secondary`; label: current `span.font-semibold`, done `button.inline-flex h-11 items-center font-medium text-primary md:h-8` (calls `onStepClick`), upcoming `span.text-text-secondary`. Between steps `li[aria-hidden] h-px w-6 shrink-0 bg-border-functional md:w-12`.
4. **Footer.** `secondary = currentIndex === 0 ? { label: t('actions.cancel', { ns: 'common' }), onClick: close } : { label: t('bulk.back'), onClick: goBack }`. `primary` by step: recipients `{ label: t('bulk.nextToMessage'), onClick: goNext, disabled: !stepValid.recipients }`; message `{ label: t('bulk.nextToReview'), onClick: goNext, disabled: !stepValid.message }`; review and `!previewMatchesInputs` → `{ label: preview.isPending ? t('bulk.review.previewing') : t('bulk.review.previewAction'), onClick: handlePreview, busy: preview.isPending }`; review and matching → `{ label: t('bulk.sendToCount', { count: previewResult.recipients_count }), onClick: handleSubmit, busy: send.isPending, disabled: previewResult.recipients_count === 0 || creditBlocked }`. After success: `primary = { label: t('bulk.result.viewBatch'), onClick: () => navigate({ to: '/communications/batches/$batchId', params: { batchId: send.data.id } }) }`, no secondary. Remove the in-body Preview button.
5. **Step 1 body.** `h2.text-h2` `t('bulk.recipients.title')` + `p.mt-1.text-text-secondary` `t('bulk.recipients.help')`. `FilterBar` from `@biddaloy/ui/shells` with `fields` = five `kind: 'select'` descriptors (keys `classId`, `sectionId`, `month`, `year`, `status`; `allLabel` `bulk.recipients.allOption`; month options `{ value: String(m), label: formatMonthName(m, config) }` for 1–12; year options `{ value: String(y), label: renderDigits(String(y), config.numerals) }`; status options as today), `values={filters}`, `onChange` = existing `setFilter` semantics (class change clears section, page back to 1), `resultCount={duesQuery.data?.total}`. Delete the local `FilterSelect`. Counter `p.font-medium aria-live="polite"` (`selectedCount` key). `DataTable`: `pageSize` state default 25 with `onPageSizeChange` (delete `PAGE_SIZE = 10`); columns — student `accessorFn` → `<><p className="font-medium">{row.full_name}</p><p className="text-caption text-text-secondary">{row.registration_number}</p></>` (`card: 'title'`), class·section `${class_name ?? '—'} · ${section_name ?? '—'}`, due (`align: 'end'`, `tabular-nums`), monthsOverdue `formatNumber(row.months_overdue, config)` (`align: 'end'`); `emptyState={{ title: t('bulk.recipients.empty'), explanation: t('bulk.recipients.emptyHelp') }}`.
6. **Step 2 body.** `h2` `t('bulk.message.title')` + help; one `Card padded` with `grid gap-4`: দফার নাম Input (required), message Textarea with 2a's display template (`toServerTemplate` in `fingerprint` and `buildInput`, unknown check via `findUnknownLabels` + `findUnsupportedPlaceholders`, same as 2a step 3), SMS counter + note when SMS is on, `PlaceholderButtons`, channels `fieldset` with `legend.text-label` and checkbox rows `<label className="flex min-h-11 items-center gap-3 md:min-h-8">`, WhatsApp fields.
7. **Step 3 body.** `h2` `t('bulk.review.title')` + help (`notPreviewedHint` or `stale` in `text-status-due-fg`). When a matching preview exists: `Card padded` with `dl.grid grid-cols-2 gap-x-6 gap-y-2 md:flex md:flex-wrap` facts — recipients, skipped (`formatNumber`), plus `BulkSmsProjectionCard` below; `noRecipients` as kit error text; skipped-by-reason `h3.text-h3` + `ul.divide-y` rows `flex justify-between gap-4 py-3` (`t(skipReasonKey(reason))` — drop the raw `reason` fallback) and `bulk.review.reasonCount`; per-student `h3` + `details` rows: `summary` `flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3`, body `px-3 pb-3` with `RecipientList`. Errors: preview 400 → `t('bulk.review.previewInvalid')`, send 400 → `t('bulk.review.sendInvalid')`; 429 and `insufficientCreditMessage` unchanged — delete the `error.message` branch of `requestErrorMessage`.
8. **`bulk-sms-projection-card.tsx`.** `Card padded`, `h3.text-h3` title, values in a `dl.mt-3 grid grid-cols-3 gap-x-4` with `formatNumber`; shortfall line as kit error text. Update its story args only if a prop changes (none expected).
9. **Result body.** `Card padded`: `h2` `bulk.result.title`, `p.mt-1` `bulk.result.queued`. The text link goes away (footer primary, step 4).
10. **Locale keys** (en + bn):

| Key | en | bn |
|---|---|---|
| `bulk.steps.review` (changed) | Check and send | যাচাই ও পাঠানো |
| `bulk.stepsLabel` (new) | Steps | ধাপ |
| `bulk.back` (new) | Previous step | আগের ধাপ |
| `bulk.nextToMessage` (new) | Next: message | পরের ধাপ: বার্তা |
| `bulk.nextToReview` (new) | Next: check | পরের ধাপ: যাচাই |
| `bulk.sendToCount_one` / `_other` (new) | Send reminder to {{count}} person / Send reminders to {{count}} people | {{count}} জনকে রিমাইন্ডার পাঠান |
| `bulk.recipients.title` (new) | Who to send to | কাদের পাঠাবেন |
| `bulk.recipients.help` (new) | Students with unpaid fees are listed below. Tick the ones to send to — up to 500. | বকেয়া আছে এমন শিক্ষার্থীরা নিচে আছে। যাদের পাঠাতে চান টিক দিন — সর্বোচ্চ ৫০০ জন। |
| `bulk.recipients.filterStatus` (changed) | Fee status | ফির অবস্থা |
| `bulk.recipients.selectedCount` (changed) | {{count}} of {{max}} students picked | {{max}} জনের মধ্যে {{count}} জন শিক্ষার্থী বাছা হয়েছে |
| `bulk.recipients.classSectionHeader` (new) | Class · section | শ্রেণি · শাখা |
| `bulk.recipients.emptyHelp` (new) | Change the filters to see more students. | আরও শিক্ষার্থী দেখতে ফিল্টার বদলান। |
| `bulk.message.title` (new) | What to write | কী লিখবেন |
| `bulk.message.help` (new) | Give this round a name you'll recognise later in Reminder history. | দফার এমন একটা নাম দিন যা পরে রিমাইন্ডার ইতিহাসে চিনতে পারবেন। |
| `bulk.review.title` (new) | Check and send | যাচাই করে পাঠান |
| `bulk.review.previewInvalid` (new) | The preview could not be made — go back and check the students and message. | প্রিভিউ দেখানো যায়নি — আগের ধাপে গিয়ে শিক্ষার্থী ও বার্তা দেখুন। |
| `bulk.review.sendInvalid` (new) | The reminders were not sent — check the earlier steps and preview again. | রিমাইন্ডার পাঠানো যায়নি — আগের ধাপগুলো দেখে আবার প্রিভিউ করুন। |

`bulk.title`, `bulk.result.*`, `bulk.message.batchNameLabel`, `notPreviewedHint`, `previewErrorMessage` already carry the glossary wording (31.3.4b) — do not touch them. `bulk.backToSingle` and the old `classHeader` / `sectionHeader` become unused: delete them in en + bn.

## Tests
- `bulk-reminder-wizard.test.tsx`: renders inside a dialog-less full page with heading level 1 "Bulk fee reminders" and a "Close" button; footer primary reads "Next: message" and is disabled until a student is ticked; "Previous step" returns to step 1 with the selection kept; on step 3 the primary is "Preview recipients" until the preview succeeds, then "Send reminders to N people"; editing the message after a preview turns it back to "Preview recipients"; month filter options read month names, not `01`; a 400 on preview shows the translated sentence; Close with a ticked student asks before leaving; default page size 25.
- E2E: none reference the bulk wizard.

## Acceptance
- [ ] Desktop at 1440 px matches the "after (bulk)" screenshot.
- [ ] Mobile at 390 px matches the "after (bulk)" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (the footer's).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route or helper files (D15).
- [ ] No app top bar, sidebar or bottom bar while the wizard is open; Close returns to `/communications/reminders`.
- [ ] Step row shows the current step filled, done steps with a check, upcoming steps grey.
- [ ] Filters have visible labels on desktop and collapse into "ফিল্টার (n)" on phone.
- [ ] Month options show names; years and counts use tenant digits.

## Out of scope
- `WizardShell` headless/full-page mode — shared request filed; this ticket keeps a local step row.
- B8 toast — 31.3.6.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| WizardShell headless / full-page mode | Refused | — | use the fallback in the ticket (own step row with useWizardShellStep inside FullPageShell); one page, new shell mode |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: communications   Decisions: D6, D9, D19, D21, D22, D23, D24, D25, D28, D29   Depends on: 31.3.8b, 31.4.communications-2a
