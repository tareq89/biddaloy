# [31.4.print-2b] Print preview — rounds, checks and cards laid out

## Goal
Inside the full-page modal from print-2a, the preview step reads top to bottom as: one settings card (round, design, printer, cards per round), the pre-flight warning when needed, then the cards — front and back side by side — with every label in plain Bangla and no raw field key on screen.

b runs after [31.4.print-2a] (`ticket.md`), which adds the `FullPageShell` frame, Close, Back and the footer Print button.

## What and why
Before printing a round, the user checks the design and printer, sees which round they are on, fixes or accepts problems (missing photo, text too long), and looks at the cards. Today these are a loose stack: a free-floating select grid, a separate round bar of tiny chips, a yellow panel that prints raw keys ("নেই: student.name") and a three-column card grid where front and back wrap under each other. The redesign groups the controls in one card with the round stepper in its header, turns the pre-flight panel into a kit warning card with a 44 px "print anyway" row, flags problem cards in the grid, and uses "দফা" and "নকশা" as the glossary says.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — picker | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview/before-mobile.webp?raw=true" width="260"> |
| After — picker (print-2a) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview/mobile.webp?raw=true" width="260"> |
| Before — preview | _not captured_ | _not captured_ |
| After — preview | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview_ids/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview_ids/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Settings card | One Card: header row = `h2` with `header.batch` ("দফা ২ / ৩ · ২৫টি কার্ড") + **New** help "একটি দফা প্রিন্ট ও নিশ্চিত করলে পরেরটি খুলবে।" on the left, the round stepper on the right; below, `grid gap-4 md:grid-cols-3`: নকশা (`Select`, only when >1 published, disabled once started + **New** help "প্রিন্ট শুরু হলে নকশা বদলানো যায় না।"), প্রিন্টার (`Select`), প্রতি দফায় কার্ড (`Input`, disabled once started, **New** help "সর্বোচ্চ nটি"). | Controls next to what they change; where-am-I in one glance |
| 2 | Round stepper | `BatchBar` chips `h-8 rounded-full px-3 text-label`: done = success colours + `circle-check`; current = `bg-secondary text-secondary-foreground font-semibold ring-2 ring-primary ring-inset` + `printer`; locked = `bg-muted text-text-secondary` + `lock`. Text "দফা n · cটি" (numbers via `formatNumber`). | Today: tiny chips with a "✓" glyph |
| 3 | No printer | Notice becomes a Card with the text and an outline "প্রথম প্রিন্টার যোগ করুন". | D28/D29 |
| 4 | Pre-flight | `PreflightPanel` = warning card `rounded-lg border border-border-subtle bg-status-due-bg p-4 text-status-due-fg md:p-5`: `h2 text-h3` with `triangle-alert`, list, then a 44 px checkbox row "জেনেও এই দফা প্রিন্ট করুন". The "empty" reason shows the field's label (`slotLabel`), never `student.name`. | D9 bug; D17 target size |
| 5 | Cards | `ul grid gap-6 md:grid-cols-2`; each item: name `font-medium` + `StatusBadge tone="warning"` when it has a pre-flight issue (label = the reason when there is one, else **New** "দেখা দরকার"); front and back in one row (`flex flex-wrap gap-2`), caption under each. | Front/back wrapped under each other in a 3-column grid |
| 6 | Locked note | When a round waits for its "did all print?" answer, `p text-text-secondary` with `locked` above the cards. | State visible near the cards |
| 7 | Did-all-print dialog | `DialogContent size="sm"`; footer Cancel/secondary then primary, per `Dialog` pattern. | D21 |
| 8 | Wording | "টেমপ্লেট" → "নকশা" in `controls.template` and `noTemplate.*`; `controls.batchSize` drops "(সর্বোচ্চ …)" (moved to help). | D32 (sidebar says "প্রিন্টের নকশা") |

## Mobile behaviour
- None — below `md` the frame shows the "open on a computer" state from print-2a; this body is not mounted.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Printer in the heading | keep "· printer" after the round / only in the select | only in the select | The select shows it; the heading stays the exact `header.batch` text the e2e specs look for. |
| Problem cards | list only in the panel / also a badge on the card | both | You see which card to look at without matching names by eye. |
| Grid columns | 3 / 2 | 2 | Front and back stay side by side at `max-w-5xl`. |
| Number input | keep native number / a stepper | keep `Input type="number"` | Not on D25's banned list; its digits are the browser's (noted in Out of scope). |

## Files
- `client-admin/src/components/print/preview/print-preview.tsx` — body layout (also changed by print-2a, runs earlier)
- `client-admin/src/components/print/preview/print-preview.test.tsx` (also changed by print-2a)
- `client-admin/src/components/print/preview/print-preview.stories.tsx`
- `client-admin/src/components/print/preview/batch-bar.tsx`
- `client-admin/src/components/print/preview/preflight-panel.tsx`
- `client-admin/src/components/print/preview/did-all-print-dialog.tsx`
- `client-admin/src/components/print/preview/did-all-print-dialog.test.tsx`
- `ui/src/i18n/locales/{en,bn}/printPreview.json` (also changed by print-2a)

## Steps
1. **Locale `printPreview.json`** (en / bn; "batch/ব্যাচ" is already "round/দফা" via 31.3.4b). Change `controls.template` → "Design" / "নকশা"; `controls.batchSize` → "Cards per round" / "প্রতি দফায় কার্ড"; `noTemplate.title` → "No design for this document yet" / "এই নথির জন্য এখনও কোনো নকশা নেই"; `noTemplate.explanation` → "The design decides how the card looks." / "নকশা ঠিক করে কার্ডটি দেখতে কেমন হবে।"; `preflight.printAnyway` → "Print this round anyway" / "জেনেও এই দফা প্রিন্ট করুন". Add `round.help` "Print and confirm a round to unlock the next." / "একটি দফা প্রিন্ট ও নিশ্চিত করলে পরেরটি খুলবে।"; `round.step` "Round {{n}} · {{count}}" / "দফা {{n}} · {{count}}টি"; `round.listLabel` "Rounds" / "দফা"; `controls.templateLocked` "The design can't change once printing starts." / "প্রিন্ট শুরু হলে নকশা বদলানো যায় না।"; `controls.batchMax` "Up to {{max}}" / "সর্বোচ্চ {{max}}টি"; `preflight.badge` "Check" / "দেখা দরকার"; `previewLabel` "Card preview" / "কার্ডের প্রিভিউ".
2. **`print-preview.tsx` body** (inside the shell from a; sections spaced by the shell body's `space-y-6`):
   - Settings `Card padded`: `<div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-h2">{t('header.batch', {…})}</h2><p className="mt-1 text-text-secondary">{t('round.help')}</p></div><BatchBar … /></div>` then `<div className="mt-4 grid gap-4 md:grid-cols-3">` with the three fields (Field classes, labels via `<Label>`; template help only when `started`; batch help `controls.batchMax` with `formatNumber(maxBatch)`). Remove the old `header` line `header.printer`.
   - No printer: `Card padded` with `p` `noPrinter.notice` and `Button variant="outline"` `noPrinter.action` in `flex flex-wrap items-center justify-between gap-3`.
   - `PreflightPanel` as today's props.
   - Locked note: `pending && <p className="text-text-secondary">{t('locked')}</p>`.
   - Cards: `<section aria-label={t('previewLabel')}><ul className="grid gap-6 md:grid-cols-2">`; each `li className="flex flex-col gap-2"`: `p className="flex items-center gap-2 font-medium"` = label + (issue ? `<StatusBadge tone="warning" label={issue.reasons.length === 1 ? issue.reasons[0] : t('preflight.badge')} />` : null); figures `div className="flex flex-wrap gap-2"`, `figcaption className="text-caption text-text-secondary"`.
   - Pre-flight empty reason: `t('preflight.empty', { fields: slotLabel(tEditor, nameKey) ?? '' })`.
   - Error: `previewError` as `ErrorState` with retry = re-run `loadPreview` for the current batch.
3. **`batch-bar.tsx`.** `ol className="flex flex-wrap gap-2" aria-label={t('round.listLabel')}`; chip classes per Change 2; text `t('round.step', { n: formatNumber(index + 1, region), count: formatNumber(size, region) })`; icons `CircleCheck` / `Printer` / `Lock` (`size-3.5`, `aria-hidden`); keep `aria-current="step"` and the sr-only locked text.
4. **`preflight-panel.tsx`.** Section classes per Change 4; `h2 className="flex items-center gap-2 text-h3"` with `TriangleAlert`; `ul className="mt-2 list-disc space-y-1 ps-5"`; label row `mt-2 flex min-h-11 cursor-pointer items-center gap-3 font-medium md:min-h-8` around `Checkbox`.
5. **`did-all-print-dialog.tsx`.** `<DialogContent size="sm">`; footer buttons in `DialogFooter` order: secondary (outline) first, primary last.
6. Update the story file to show: one round, three rounds mid-run, pre-flight issues, no printer.
7. Run `yarn test:frontend run components/print/preview`, the e2e `print-id-cards`, `office-staff-role`, `keyboard/print-preview` specs, then `graphify update .`.

## Tests
- `print-preview.test.tsx`: the round heading text equals `header.batch`; the stepper marks done / current / locked chips; a card with no photo shows a "No photo" badge; the empty-name reason shows the field label, never `student.name`; template select is disabled after the first round is printed; printer select and "Print this round anyway" keep their accessible names.
- `did-all-print-dialog.test.tsx`: unchanged behaviour; content has the `max-w-100` size class.
- e2e (`print-id-cards.spec.ts`, `office-staff-role.spec.ts`, `keyboard/print-preview.spec.ts`): no change expected — every lookup goes through `t()` and the heading keeps the exact `header.batch` text; run them.

## Acceptance
- [ ] Desktop at 1440 px matches the "after — preview" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Front and back of each card sit side by side.
- [ ] No "student.name" / "staff.name" text anywhere on the page.
- [ ] The words "টেমপ্লেট" and "ব্যাচ" do not appear on this page.

## Out of scope
- The browser's number input shows Latin digits while typing (D6) — a numeral-aware number field would be a new shared component.
- The card artwork itself comes from `TemplateRenderer` (shared, unchanged).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| grant desktop-only-gate.tsx to the print lane (export useIsWide, copyPageLink) | Accepted | — | granted to print-2a: no foundation ticket touches client-admin/src/components/print/desktop-only-gate.tsx |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: print   Decisions: D6, D9, D17, D21, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.print-2a
