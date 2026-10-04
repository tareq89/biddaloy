# [31.4.staff-5] ACR form — full-page modal, step tabs, calm score buttons

## Goal
`/staff/$userId/acr/$assessmentId` opens as a chromeless `FullPageShell` that matches the "after" screenshot: the staff member's name in the title, year + status + autosave line, the three steps as line tabs, criteria in one card per block with selected scores shown as a tinted (not filled) button, DatePickers in step 1, and Back / Next / Complete in the footer.

## What and why
An admin fills a staff member's annual confidential report (ACR) in three steps: period, scoring each criterion 4–1, closing remarks; every change autosaves. Today it is a page inside the app chrome whose crumb is a UUID, whose first line is the browser tab title ("… — এসিআর 2026-2027 · Biddaloy"), whose step 1 uses browser `dd/mm/yyyy` date inputs, and whose step 2 paints every chosen score as a filled primary button (a dozen filled buttons on one screen), with Latin digits on the score buttons. The autosave state is a tiny line at the far right. D23 lists the ACR form as a full-page modal; the redesign gives it the kit frame, a clear "who / which year / saved" line, and one filled button per view.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId_acr_assessmentId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId_acr_assessmentId/before-mobile.webp?raw=true" width="260"> |
| After (step 2) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId_acr_assessmentId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId_acr_assessmentId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | Own route made chromeless (`staticData: { chromeless: true }`) and wrapped in `FullPageShell size="form"`; title (the only `h1`) "এসিআর — {name}" (**New** key); Close returns to where the user came from (staff ACR tab or the register), fallback `/staff/$userId?tab=acr`. | D22, D23 |
| 2 | Context line | **New**: `dl` শিক্ষাবর্ষ + StatusBadge (চলমান warning / সম্পন্ন success) on the left; autosave status on the right with an icon (saved `check`, saving spinner, error `circle-alert` in danger). Replaces the document-title paragraph and the far-right caption. | D27, "can I see the state?" |
| 3 | Steps | `WizardShell` replaced by kit line `Tabs` (`?step=period|criteria|closing`); every step is reachable (autosave keeps each one); a finished step 1 shows a success `circle-check` in its tab. | D20, D22 (a WizardShell inside a FullPageShell would add a second `h1`) |
| 4 | Footer | secondary "পিছনে" (disabled on step 1), primary "পরবর্তী" → on the last step "এসিআর সম্পন্ন করুন" (busy while completing). | D22, D29 |
| 5 | Step 1 | Period start / end = `DatePicker`; fields in a Card `grid gap-4 md:grid-cols-2`, description full width. | D25, D5 |
| 6 | Step 2 progress | **New** line "১২টির মধ্যে ৪টিতে নম্বর দেওয়া হয়েছে" (phone prefixes "মানদণ্ড ৫ / ১২ ·"); keyboard hint stays on desktop only. | state visible |
| 7 | Step 2 criteria | One Card per block (`h2` "অংশ ২: কাজের মান" …); rows divided; label + neutral badge "নম্বর দেওয়া হয়নি"; active row marked by a `border-s-2 border-primary` bar. Score buttons outline; the chosen one `border-primary bg-secondary text-secondary-foreground` + `check`; labels "৪ · অত্যন্ত ভালো" with tenant numerals. | D29, D6 |
| 8 | Step 2 phone | Unchanged behaviour (one criterion at a time, 2×2 big buttons, prev/next) restyled; prev/next labels "আগের মানদণ্ড" / "পরের মানদণ্ড" (**New**). | D23 |
| 9 | Step 3 | Card, fields as today; "পদোন্নতির যোগ্য" = two whole-row radio options; the Ctrl+Enter hint stays (desktop only). | D25 |
| 10 | Completed / read-only | Same frame; sections stacked as Cards (no tabs); total "মোট নম্বর ৪২" (`formatNumber`) in the context line; Print (outline) in the context line; footer primary "আবার খুলুন" (ACR_WRITE) else "বন্ধ করুন". | D29, D6 |

## Mobile behaviour
- Full screen, no app chrome or bottom bar; title truncates, Close (44 px) stays top-right.
- Step 2 shows only the active criterion's block card and that criterion; score buttons are 56 px (`h-14`) in a 2×2 grid.
- Footer Back / Next 44 px at the bottom.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Step navigation | keep `WizardShell` · kit Tabs + footer | Tabs + footer Back/Next | WizardShell renders its own PageHeader `h1` and footer; inside FullPageShell that doubles both. Tabs are a kit pattern; autosave makes free jumping safe. |
| Gate on "all scored" | block Next on step 2 · block only Complete | block only Complete (existing toast + progress line) | Free jumping between steps; nothing is lost. |
| Selected score look | filled primary · tinted outline | tinted outline + check | D29: a dozen filled buttons hide the one real primary (footer). |
| Title | "বার্ষিক গোপনীয় প্রতিবেদন" · "এসিআর — {name}" | "এসিআর — {name}" | A full-page modal has no crumbs; the name says whose report this is. "ACR" stays per 31.3.4a. |
| `dirty` | never · while saving/failed | `autosave.state === 'saving' || 'error'` | Close asks only when something could be lost. |

## Files
- `client-admin/src/routes/_staff/staff/$userId_.acr.$assessmentId.tsx` — chromeless, FullPageShell, title, context line, close, `?step=`
- `client-admin/src/routes/_staff/staff/$userId_.acr.test.tsx` — update
- `client-admin/src/routes/_staff/staff/-acr/acr-form.tsx` — Tabs steps, footer wiring, cards, DatePickers, completed view
- `client-admin/src/routes/_staff/staff/-acr/acr-form.test.tsx` — update
- `client-admin/src/routes/_staff/staff/-acr/acr-form.stories.tsx` — props change
- `client-admin/src/routes/_staff/staff/-acr/criterion-step.tsx` — block cards, score button look, numerals, progress
- `ui/src/i18n/locales/{bn,en}/evaluations.json` — keys below (also changed by staff-2c, staff-4a, staff-4b, run earlier)
- `e2e/keyboard/acr-form.spec.ts`, `e2e/journeys/evaluations-regression.spec.ts`, `e2e/journeys/evaluations-tail.spec.ts`, `e2e/journeys/committee-role.spec.ts` (also changed by staff-4a) — see step 8

## Steps
1. **Route.** Add `staticData: { chromeless: true }` and `validateSearch: z.object({ step: z.enum(['period', 'criteria', 'closing']).optional().catch(undefined) })`. In `AcrPageInner`: `const navigate = Route.useNavigate(); const close = useCloseFullPage(() => void navigate({ to: '/staff/$userId', params: { userId }, search: { tab: 'acr' } }));` (`useCloseFullPage`, `FullPageShell` from `@biddaloy/ui/shells`). `AcrForm` renders the `FullPageShell` itself (it owns the footer state); the route passes `title={t('acr.pageTitle', { name })}`, `onClose={close}`, `step={search.step ?? 'period'}`, `onStepChange={(s) => void navigate({ search: { step: s }, replace: true })}`, `yearName={year}`. The skeleton and error states render inside `<FullPageShell title={t('acr.title')} onClose={close} primary={{ label: t('actions.close', { ns: 'common' }), onClick: close }}>`. Remove the `p.text-sm` title paragraph; keep the `document.title` effect.
2. **`AcrForm` frame.** New props `title: string`, `onClose: () => void`, `step`, `onStepChange`, `yearName: string`. Remove `WizardShell`. Body:
   - Context row `flex flex-wrap items-center justify-between gap-x-4 gap-y-2`: `dl flex flex-wrap items-center gap-x-6 gap-y-2` with শিক্ষাবর্ষ (`acr.yearLabel`) → `yearName`, a `StatusBadge` (`acr.status.*`), on a completed ACR also মোট নম্বর (`acr.total`) → `formatNumber(total)` and `<AcrPrintButton>`; right side `p role="status" aria-live="polite" className="flex items-center gap-1.5 text-caption text-text-secondary"` with icon by `autosave.state` (`CheckIcon` / `LoaderCircleIcon animate-spin` / `CircleAlertIcon text-destructive`) + `t(`acr.save.${state}`)`; idle renders nothing but keeps the element.
   - Not completed: `Tabs value={step} onValueChange={onStepChange}` with `TabsList aria-label={t('acr.stepsLabel')}` and three `TabsTrigger`s (`acr.steps.*`); the period trigger gets `<CircleCheckIcon className="size-4 text-status-paid-fg" />` when `period_from && period_to` are set. `TabsContent className="space-y-4 pt-4 md:pt-6"`.
   - Footer via `FullPageShell` props: `secondary={{ label: t('wizard.back', { ns: 'common' }), onClick: prev }}` hidden on step 1 (omit the prop); `primary` = step < last ? `{ label: t('wizard.next', { ns: 'common' }), onClick: next }` : readOnly ? `{ label: t('actions.close', { ns: 'common' }), onClick: onClose }` : `{ label: t('acr.submit'), onClick: () => void submit(), busy: complete.isPending }`. `dirty={autosave.state === 'saving' || autosave.state === 'error'}`.
   - Completed: no Tabs; the three step contents stacked, each in a Card with `h2 text-h2` `acr.steps.*`; `primary` = canWrite ? `{ label: t('acr.reopen'), onClick: handleReopen, busy: reopen.isPending }` : close (as above). Remove the old `h1` and `completedReadOnly` row text? Keep `completedReadOnly` as `p text-text-secondary` above the cards (e2e reads it).
3. **Step 1.** Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`), fields `grid gap-4 md:grid-cols-2`; period from/to → `DatePicker` (`value={step1.period_from ? parseDate(step1.period_from) : undefined}`, `onValueChange={(d) => patchStep1({ period_from: d ? toIsoDate(d) : '' })}`, `disabled={readOnly}`, `aria-labelledby` the Label, `min` on "to" = from); employment duration `Input`; description `Textarea` `md:col-span-2`. `TextField`'s `type` prop goes away.
4. **Step 3.** Same Card; the five fields single column; "পদোন্নতির যোগ্য": `RadioGroup` with two `<label className="flex min-h-11 items-center gap-3 md:min-h-8">` rows; `submitHint` → `p hidden text-text-secondary md:block`.
5. **`criterion-step.tsx`.** New top row `flex flex-wrap items-center justify-between gap-x-4 gap-y-1`: `p font-medium aria-live="polite"` = `<span className="md:hidden">{t('acr.criterionOf', { current, total })} · </span>{t('acr.scoredOf', { scored, total })}` (numbers via `formatNumber`; `scored` = criteria with a score); `p id="acr-keyboard-hint" className="hidden text-text-secondary md:block"` (only when not readOnly). Each block = Card `section` (`hidden md:block` when it does not hold the active criterion, as today), `h2 text-h2` title, `ul mt-2`; each `li` `flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between md:gap-4` + `md:border-b md:border-border-subtle` except the last, `hidden md:flex` when not active (as today); label wrapper `flex min-w-0 flex-wrap items-center gap-2 border-s-2 ps-3` + `border-primary` when active else `border-transparent`; unscored → `<StatusBadge tone="neutral" label={t('acr.step2.unscored')} />`. Group `role="group"` kept (`grid shrink-0 grid-cols-2 gap-2 md:flex md:gap-1`). Score `Button variant="outline"` always, `aria-pressed` kept, `className` `h-14 md:h-8 md:px-2.5` + (selected ? `border-primary bg-secondary font-semibold text-secondary-foreground` : ''), selected shows `<CheckIcon className="size-4" />`; text `{formatNumber(value, cfg)} · {t(`acr.scores.${value}`)}`. Phone prev/next: outline with chevrons, labels `acr.prevCriterion` / `acr.nextCriterion`.
6. **Stories.** `acr-form.stories.tsx`: pass the new props (`title`, `onClose`, `step`, `onStepChange`, `yearName`); one story per step + completed.
7. **Locale keys** (`evaluations.json`, bn / en):
   - add `acr.pageTitle`: "এসিআর — {{name}}" / "ACR — {{name}}"; `acr.stepsLabel`: "এসিআরের ধাপ" / "ACR steps"
   - add `acr.scoredOf`: "{{total}}টির মধ্যে {{scored}}টিতে নম্বর দেওয়া হয়েছে" / "{{scored}} of {{total}} scored"
   - add `acr.prevCriterion`: "আগের মানদণ্ড" / "Previous criterion"; `acr.nextCriterion`: "পরের মানদণ্ড" / "Next criterion"
   - `acr.next` / `acr.back` become unused (footer uses `common:wizard.*`, which the e2e specs already click) — delete them if `rg` finds no reader.
8. **e2e.** `acr-form.spec.ts:50` and `evaluations-regression.spec.ts:150` click `common.wizard.next` — still the footer label, no change; check the sidebar comment at `acr-form.spec.ts:48` (no sidebar now) and keep the direct focus. `evaluations-regression.spec.ts:155-163`: groups and `aria-pressed` unchanged. `committee-role.spec.ts:61` and `evaluations-tail.spec.ts:125`: replace the heading check with `await expect(page.getByRole('dialog').getByRole('heading', { level: 1 })).toBeVisible()`; `committee-role.spec.ts:65` `getByLabel(step1.periodFrom)` now finds the DatePicker trigger — `toBeDisabled()` still holds because `disabled={readOnly}`.

## Tests
- `acr-form.test.tsx`: digit keys still score and advance; selected score has `aria-pressed="true"` and no `bg-primary` class; "Next" moves to criteria (and `onStepChange` called with `'criteria'`); Complete blocked until all scored (toast) then completes on Ctrl+Enter; completed view shows cards, total via `formatNumber`, Reopen as the primary; the period tab shows the check icon once both dates are set; DatePicker writes `YYYY-MM-DD` into the autosave payload.
- `$userId_.acr.test.tsx`: renders a `dialog` whose `h1` is "এসিআর — {name}"; error cases unchanged; Close with no history navigates to `/staff/:id?tab=acr`.
- e2e as step 8.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (the footer's).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The page covers the app chrome (no sidebar, top bar or bottom bar); no UUID crumb anywhere.
- [ ] Autosave state is visible next to the year and status.
- [ ] No `<input type="date">` in step 1; score buttons show Bangla digits in bn.

## Out of scope
- The ACR tab on the staff detail page (list, trend bars) — staff-2c.
- `StartAcrDialog` (`-detail/start-acr-dialog.tsx`; not changed by any ticket) — placed, not edited; it still navigates to this route.
- The ACR criteria settings editor (`acr.criteriaSettings.*`) — settings lane (settings-2).
- `e2e/responsive/routes.ts` visits this route; responsive sweeps of chromeless routes belong to the foundation.

Wave: 9   Lane: staff   Decisions: D5, D6, D20, D22, D23, D25, D27, D29   Depends on: 31.3.8b, 31.4.staff-4b
