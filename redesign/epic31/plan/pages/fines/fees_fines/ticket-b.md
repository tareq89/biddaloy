# [31.4.fines-1b] Fines — generate and log as full-page modals

## Goal
"নিয়ম থেকে জরিমানা তৈরি" and "জরিমানা যোগ করুন" open as `FullPageShell`s reflected in the URL (`?generateFines=1`, `?logFine=1`); generate always shows what it will create before creating it, with correct amounts; the waive dialog uses kit sizes, labels and a normal primary. Runs after fines-1a.

## What and why
Generate sweeps a month of attendance into fines; log writes one fine for one or more students; waive forgives part or all of a fine. Today generate and log are small dialogs that hold a list (search results, preview rows), so they scroll inside a box; generate's "preview" is skipped whenever there are no duplicates, so the accountant creates fines without seeing them; the preview prints "3 × ৳60.00" when ৳60.00 is already the row's total; the month and date fields are native browser controls; server error strings are shown raw; and waive confirms with a red filled button outside a confirm dialog. The redesign moves generate and log into full-page modals (D21, D23), splits generate into "see what will be created" then "create", and tidies the waive dialog.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — fines page (modals open from it) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines/before-mobile.webp?raw=true" width="260"> |
| After — generate fines (full-page, preview shown) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines_generate/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/fines/fees_fines_generate/mobile.webp?raw=true" width="260"> |
| After — log fine | _not captured_ (same frame, `size="form"`, layout in step 4) | _not captured_ |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Fines page — URL | `?generateFines=1` / `?logFine=1` stop being one-shot flags: the modal is open while the param is set; opening sets it, closing goes back (`useCloseFullPage`). Palette links keep working unchanged. | D22 — reflected in the address bar; Back closes, refresh reopens |
| 2 | Generate — frame | `Dialog max-w-xl` → `FullPageShell size="wide"` title "নিয়ম থেকে জরিমানা তৈরি", footer Cancel (outline, left) + one primary (right). | D21 (holds a preview), D23 lists "generate fines" |
| 3 | Generate — scope card | Card "কোন মাস, কাদের জন্য" + one-line description; native `type="month"` → `MonthPicker` (required); শ্রেণি / শাখা `Select`s with real labels; notify checkbox row 44 px. | D25, D37 |
| 4 | Generate — two steps | Primary reads **New** "হিসাব দেখুন" until a preview exists for the current scope, then "জরিমানা তৈরি করুন". The auto-submit after a duplicate-free preview is removed — the preview is always shown first. Changing month / class / section clears the preview (as today). | One obvious next action; the accountant sees what will be created |
| 5 | Generate — preview | **New** section "যা তৈরি হবে" + subtitle "৫ জন শিক্ষার্থী, মোট ৳১৭০.০০"; the scrolling `ul` → `DataTable paginated={false}`: শিক্ষার্থী / জরিমানা (fine type name) / কতবার / পরিমাণ. Fixes "count × amount" (amount is already the row total — `FineSweepService` computes `billable × unit`, capped). Zero preview → EmptyState "এই মাসে কোনো জরিমানা তৈরি হবে না।" and the primary disabled. | Bug + D19 |
| 6 | Generate — duplicates | Radio group moves to its own Card with a warning icon heading; each option is a 44 px row with label + hint. | D17, touch targets |
| 7 | Log — frame | `Dialog max-w-lg` → `FullPageShell size="form"` title "জরিমানা যোগ করুন". | D21 (6 fields + a result list) |
| 8 | Log — fields | Card "শিক্ষার্থী": search `Input` with visible label, results as 44 px rows in one Card, chosen students as removable chips (remove button labelled "… সরান", today English "Remove …"). Card "জরিমানা": fine type `Select`, amount `MoneyInput` + help "খালি রাখলে…", date `DatePicker` (`max` today), reason `Textarea`, notify checkbox. | D25, D9, D37 |
| 9 | Both — errors | `describeSubmitError` never returns `error.message`; always the translated sentence. | D9 |
| 10 | Waive dialog | `size="md"`; **New** description sentence (was the reason placeholder); fine `Select` with a real label; confirm button `variant="default"` (was red filled); Cancel outline; "মাফ" → "মওকুফ" in its labels. | D21, D25, D29, D32 |

## Mobile behaviour
- Full-page modals cover the whole screen (no top bar, sidebar or bottom bar); header 56 px with title + "বন্ধ করুন"; footer always visible (sticky) with Cancel left and the primary right, both 44 px.
- Generate scope fields stack one per row; preview rows are two-line (name, then "fine type · ৩ বার") with the amount on the end; radio rows wrap their hint text.
- Log: search field full width; chips wrap; result rows 44 px.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| URL for the modals | new routes / search param on `/fees/fines` | keep the existing `?generateFines=1` / `?logFine=1` params | No new route (D1); the palette (31.5.1b) already links to these params. |
| Auto-generate after a clean preview | keep / always stop at preview | always stop | A preview you never see is not a preview; costs one click. |
| Submit label after preview | static / with count | static "জরিমানা তৈরি করুন" | The count sits in the preview subtitle; a static label keeps `e2e` lookups by key simple. |
| Preview "জরিমানা" column | rule note (server English) / fee-structure name | fee-structure name from `useFeeStructures({ fee_type: FINE })` | D9 — the note is an English server string. |
| Log modal on the student page | change host / leave | leave: `LogFineModal` keeps `open` / `onOpenChange` props | `students/-detail/fines-tab.tsx` (students lane) mounts it with local state; URL reflection there is a shared request. |
| Waive as full page | dialog / full page | dialog `md` | ≤ 4 fields, no list (D21). |

## Files
- `client-admin/src/routes/_staff/fees/fines/index.tsx` — modals driven by search params (also changed by fines-1a, runs earlier)
- `client-admin/src/routes/_staff/fees/fines/index.test.tsx` — URL open/close tests (also changed by fines-1a, runs earlier)
- `client-admin/src/routes/_staff/fees/fines/-modals/generate-fines-modal.tsx` — FullPageShell, MonthPicker, two-step flow, preview table, errors
- `client-admin/src/routes/_staff/fees/fines/-modals/generate-fines-modal.test.tsx` — update
- `client-admin/src/routes/_staff/fees/fines/-modals/log-fine-modal.tsx` — FullPageShell, cards, DatePicker, errors
- `client-admin/src/routes/_staff/fees/fines/-modals/log-fine-modal.test.tsx` — update
- `client-admin/src/routes/_staff/fees/fines/-modals/waive-fine-dialog.tsx` — size, description, label, primary variant
- `client-admin/src/routes/_staff/fees/fines/-modals/waive-fine-dialog.test.tsx` — confirm variant assertion
- `ui/src/i18n/locales/bn/fines.json` — keys below (also changed by fines-1a, runs earlier)
- `ui/src/i18n/locales/en/fines.json` — keys below (also changed by fines-1a, runs earlier)
- `e2e/journeys/fines.spec.ts` — month picking + two-step generate

## Steps
1. **Host (`index.tsx`).** Keep `logFine` / `generateFines` in `finesSearchSchema`. Delete the effect that consumes and strips them and the `logFineOpen` / `generateFinesOpen` state. Derive `const logOpen = search.logFine === '1' && canGenerate` and `const generateOpen = search.generateFines === '1' && canGenerate`. `openLog = () => void navigate({ search: (prev) => ({ ...prev, logFine: '1' }) })`, same for generate (used by the header actions, the empty-state action and the `l` / `g` keys from fines-1a). `closeLog = useCloseFullPage(() => void navigate({ search: ({ logFine: _l, ...rest }) => rest, replace: true }))`, same for generate (`useCloseFullPage` from `@biddaloy/ui/shells`). Mount `<LogFineModal open={logOpen} onOpenChange={(o) => !o && closeLog()} />` and `<GenerateFinesModal open={generateOpen} onOpenChange={(o) => !o && closeGenerate()} />`. Update the file comment: the params are now the open state, not one-shot flags.
2. **Generate frame (`generate-fines-modal.tsx`).** `if (!open) return null;` then `<FullPageShell title={t('generate.title')} onClose={resetAndClose} size="wide" dirty={preview !== null} primary={{ label: hasCurrentPreview ? t('generate.submitAction') : t('generate.previewAction'), onClick: handleSubmit, busy: previewMutation.isPending || generate.isPending, disabled: !canSubmit || (hasCurrentPreview && preview.would_create === 0 && preview.duplicates.length === 0) }} secondary={{ label: t('actions.cancel', { ns: 'common' }), onClick: resetAndClose }}>`, where `hasCurrentPreview = preview !== null && previewScopeKey === scopeKey()`. `handleSubmit` no longer takes an event: drop `preventDefault` and the `<form>` element (the primary lives in the shell footer). Delete the line `if (result.duplicates.length === 0 && result.would_create > 0) submitGenerate('SKIP');` and its comment.
3. **Generate body.** Three blocks inside the shell:
   - Scope Card `<section aria-labelledby="gen-scope" className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">`: `h2` `t('generate.scopeHeading')`, `<p className="mt-1 text-text-secondary">{t('generate.description')}</p>`, `<div className="mt-4 grid gap-4 md:grid-cols-3">` with `FormField` (required) + `MonthPicker value={month} onValueChange={(v) => { setMonth(v); setPreview(null); }}` (id `generate-fines-month` so `getByLabel(t('fines.generate.monthLabel'))` resolves), class and section `FormField` + `Select` (real `<label htmlFor>`, drop `aria-label`s), and the notify `Checkbox` row `flex min-h-11 items-center gap-3 md:col-span-3 md:min-h-8`.
   - Preview (only when `hasCurrentPreview`): zero case → `<EmptyState icon={<CalendarCheck2 />} title={t('generate.previewZero')} explanation={t('generate.previewZeroHint')} />`. Otherwise `<section aria-labelledby="gen-preview" className="space-y-3">` with `h2` `t('generate.previewHeading')`, `<p className="mt-0.5 text-text-secondary">` `generate.previewLine` (unchanged key; `count` through `formatNumber`), and `<DataTable tableId="fine-preview" caption={t('generate.previewHeading')} paginated={false} data={preview.students} getRowId={(r) => \`${r.student_id}-${r.rule_id}\`} columns=…>` — `student` (`studentNames.get(id) ?? '—'`, never the id; `card: 'title'`), `fine` (fee-structure name: `fineTypes.get(row.fee_structure_id) ?? '—'` from `useFeeStructures({ fee_type: FeeType.FINE, limit: 100 })`), `count` (`t('generate.countTimes', { count: row.count, n: formatNumber(row.count) })`, `align: 'end'`), `amount` (`formatCurrency(serverAmountToMinorUnits(row.amount, config), config)`, `align: 'end'`); headers `generate.columnStudent` / `columnFine` / `columnCount` / `columnAmount`. Keep `data-testid="fine-preview-rows"` on a wrapper `div` for the existing test.
   - Duplicates (when `preview.duplicates.length > 0`): Card with `<h2 className="flex items-center gap-2 text-h3"><TriangleAlert className="text-status-due-fg" aria-hidden="true" />{t('generate.duplicates.heading')}</h2>` and the existing `RadioGroup` (`aria-labelledby` the heading); each option `<label className="flex min-h-11 items-start gap-3 py-2">` with the item, then `<span><span className="block font-medium">label</span><span className="block text-caption text-text-secondary">hint</span></span>`.
   - Errors: `describeSubmitError` returns `t('generate.errorMessage')` for every error (drop the `ApiError` branch); render it as `<p role="alert" className="flex items-center gap-1 text-caption text-destructive">` with `CircleAlert` above the footer.
4. **Log frame + body (`log-fine-modal.tsx`).** `if (!open) return null;` → `<FullPageShell title={t('logForm.title')} onClose={resetAndClose} dirty={selected.length > 0 || note !== ''} primary={{ label: logFine.isPending ? t('logForm.saving') : t('logForm.save'), onClick: submit, busy: logFine.isPending, disabled: !canSubmit }} secondary={{ label: t('actions.cancel', { ns: 'common' }), onClick: resetAndClose }}>` (default `size="form"`). Body:
   - Card "শিক্ষার্থী" (`h2` `t('logForm.studentsLabel')`): chips row `flex flex-wrap gap-2` — each chip `inline-flex h-7 items-center gap-1 rounded-full bg-secondary ps-3 pe-1 text-label text-secondary-foreground` with an icon button `aria-label={t('logForm.removeStudent', { name })}` (was English "Remove …"); then `FormField label={t('logForm.studentsLabel')}` + `Input type="search"` (drop its `aria-label`; the visible label keeps `getByLabel(t('fines.logForm.studentsLabel'))` working); results `<ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">`, each a `<button className="flex min-h-11 w-full items-center px-3 text-start hover:bg-muted">` with the name (accessible name = the name — the keyboard spec clicks it by name).
   - Card "জরিমানা" (`h2` `t('logForm.detailsHeading')`) `grid gap-4 md:grid-cols-2`: fee type `Select` (real label, required), amount `MoneyInput` + help `t('logForm.amountHint')` (existing key, now rendered), date `DatePicker value=… max={today}` with label `logForm.incidentDateLabel` (state stays ISO via `toIsoDate`), reason `Textarea` `md:col-span-2` (label `logForm.noteLabel`, required), notify `Checkbox` row `md:col-span-2`.
   - `describeSubmitError` → always `t('logForm.errorMessage')`.
5. **Waive (`waive-fine-dialog.tsx`).** `<DialogContent size="md" closeLabel=…>`; `DialogDescription` → `t('waiveDialog.description')`; fine `Select` wrapped in `FormField label={t('columns.fine')}` (drop `aria-label`); radio rows `min-h-11`; confirm `Button` drops `variant="destructive"` (default primary).
6. **i18n (`fines.json`, bn + en).**

    | Key | bn | en |
    |---|---|---|
    | `generate.scopeHeading` (**New**) | কোন মাস, কাদের জন্য | Which month, for whom |
    | `generate.previewAction` (**New**) | হিসাব দেখুন | See what will be made |
    | `generate.previewHeading` (**New**) | যা তৈরি হবে | What will be made |
    | `generate.previewZeroHint` (**New**) | অন্য মাস বা শ্রেণি বাছুন। | Pick another month or class. |
    | `generate.countTimes` (**New**, `_one`/`_other` in en) | {{n}} বার | {{n}} time / {{n}} times |
    | `generate.columnStudent` / `columnFine` / `columnCount` / `columnAmount` (**New**) | শিক্ষার্থী / জরিমানা / কতবার / পরিমাণ | Student / Fine / Times / Amount |
    | `generate.description` (changed) | এক মাসের উপস্থিতি দেখে সক্রিয় প্রতিটি নিয়ম থেকে জরিমানা তৈরি হবে। | Fines are made from every active rule, using one month's attendance. |
    | `logForm.detailsHeading` (**New**) | জরিমানা | Fine |
    | `logForm.removeStudent` (**New**) | {{name}} সরান | Remove {{name}} |
    | `waiveDialog.description` (**New**) | যতটা মওকুফ করবেন, শিক্ষার্থীর বকেয়া থেকে ততটা কমে যাবে। | The amount you waive comes off the student's balance. |
    | `waiveDialog.title` / `fullLabel` / `partialLabel` / `amountLabel` / `reasonPlaceholder` / `confirm` / `waiving` / `errorMessage` (changed) | জরিমানা মওকুফ করুন / পুরোটা মওকুফ করুন / কিছু অংশ মওকুফ করুন / কত টাকা মওকুফ করবেন / কেন এই জরিমানা মওকুফ করা হচ্ছে / মওকুফ করুন / মওকুফ করা হচ্ছে… / জরিমানা মওকুফ করা যায়নি | (en unchanged) |

    `palette.*` stays unchanged (31.5.1b).

## Tests
- `index.test.tsx`: clicking "Make fines from rules" sets `?generateFines=1` and shows the full-page modal (dialog named "Make fines from rules"); "Close" removes the param; landing on `/fees/fines?logFine=1` opens Log fine; an EXECUTIVE landing on `?logFine=1` sees no modal.
- `generate-fines-modal.test.tsx`: primary reads "See what will be made" first; after the preview resolves it reads "Generate fines" and the preview table shows the fine-type name and "৳60.00" for a row with `count: 3, amount: 60` (not "3 × ৳60.00"); a duplicate-free preview does **not** call the generate endpoint until the second click; changing the month resets the label; a 422 shows "Failed to generate fines", never the server text; keep the zero-preview, REMOVE_OLDER and `would_create 0` tests (update their clicks to the two-step flow).
- `log-fine-modal.test.tsx`: renders inside a full-page frame (h1 "Log fine", Close button); the date field is a DatePicker with label "Incident date"; a server error shows `logForm.errorMessage`; the chip remove button is named "Remove Rahim"; keep the amount-prefill, reason-required, two-students and prefill tests.
- `waive-fine-dialog.test.tsx`: the confirm button has no `data-variant="destructive"`; the fine select has the visible label "Fine".
- `e2e/journeys/fines.spec.ts` `:94-110`: after opening, replace `.fill(previousMonthValue)` with — the modal already defaults to the previous month; assert `dialog.getByLabel(t('fines.generate.monthLabel'))` contains the month (`toContainText` of the year digits) and only if `previousMonthValue` is not the previous calendar month open the picker and click the month button by name. Then click `t('fines.generate.previewAction')`, wait for the preview heading `t('fines.generate.previewHeading')`, click `t('fines.generate.submitAction')`, expect the dialog hidden. Update the comment about auto-advance.
- `e2e/keyboard/fines.spec.ts` — run unchanged: the dialog is still found by role + `logForm.title`, the search by `logForm.studentsLabel`, results by name, save by `logForm.save`, waive by `waiveDialog.confirm` / `waiveDialog.title` (texts change, keys do not).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot of generate.
- [ ] Mobile at 390 px matches it; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (each full-page footer, the waive dialog).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The address bar shows `?generateFines=1` / `?logFine=1` while a modal is open; Back closes it; refresh reopens it.
- [ ] Generate never creates fines without the preview having been shown.
- [ ] Preview amounts equal the server's row totals.
- [ ] No native month/date input and no red filled button outside a ConfirmDialog.

## Out of scope
- `students/-detail/fines-tab.tsx` opens `LogFineModal` with local state (no URL) — students lane; shared request filed.
- The server writes the rule note in English — shared request (in fines-1a).
- A multi-select student picker in `ui/src/components/student-picker.tsx` — foundation-owned; the search list stays page-local.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| PageAction to?: string (render header action as a link) | Refused | — | use the fallback in the ticket (button + navigate; e2e keeps tag 'button'); one page |
| server rule-made fine note not English | Accepted | 31.3.7d | new rule-made notes are written in the school's language and numerals ("৩ দিন অনুপস্থিত (১ দিন মওকুফ)"); keep showing note as is; notes written before 31.3.7d stay English (immutable history) |
| students route ?logFine=1 (students-lane files) | Accepted | 31.5.0 | URL: /students/<id>?tab=fines&logFine=1; LogFineModal props unchanged; fines-1b needs nothing |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: fines   Decisions: D1, D5, D9, D17, D19, D21, D22, D23, D25, D29, D32, D37   Depends on: 31.3.8b, 31.4.fines-1a
