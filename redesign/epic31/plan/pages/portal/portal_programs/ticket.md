# [31.4.portal-7] Portal programs — status badge, progress sentence, short milestone list

## Goal
`/portal/programs` shows each program as a card with a `StatusBadge`, a progress bar with a plain sentence, and only the latest achieved milestones plus the next one (the full list one tap away), with long-form dates and the tenant's digits, matching the "after" screenshots.

## What and why
This page shows a guardian how far the child has come in each program (for example Hifz) and what comes next. Today the status ("প্রত্যাহৃত") is plain grey text, progress reads "4 / 30" in Latin digits, dates are ISO (`2026-03-01`), ticks are text glyphs (☑ ☐), and all 30 milestones are listed so the card runs off a phone screen. The redesign uses a status badge, a sentence under the bar, icon ticks, `formatDate`, and shows the last three achieved plus the next milestone with a "show all" button.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_programs/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_programs/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_programs/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_programs/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageContainer size="narrow"` + `PageHeader` (title `programs.title` = nav label, subtitle "<name> · <class> · রোল <n>", roll via `formatNumber`). Remove `max-w-2xl` and the hand-made `<h1>`. | D15, D16, D6 |
| 2 | Program card | One `<article>` Card per enrolment (no shared outer card): name `text-h2` + `StatusBadge` — ACTIVE info, COMPLETED success, WITHDRAWN neutral; label from `programs:status.*`. | D27 (status was plain text) |
| 3 | Progress | Existing `ProgressBar` with the **New** sentence "৩০টির মধ্যে ৪টি মাইলফলক অর্জিত" as its label (digits via `formatNumber`). Hidden when `milestone_total === 0`, as today. | "4 / 30" read as a fraction in Latin digits (D6) |
| 4 | Milestone rows | `ul.divide-y` rows `min-h-11`: `circle-check` in `text-status-paid-fg` (achieved) or `circle` in `text-text-secondary` (not yet), name, right side `formatDate(achieved_on)` + " · score / grade" when present. The first not-achieved milestone is `font-medium` with a neutral badge "পরবর্তী" (**New** key). | D5 (ISO dates), icons instead of text glyphs, "what's next" visible |
| 5 | **New** short list | When there are more than 4 milestones, show only the last 3 achieved + the next one; a ghost button "সব ৩০টি মাইলফলক দেখুন" / "কম দেখান" (**New** keys, `aria-expanded`) toggles the full list. | A 30-row list buried every other program |
| 6 | Empty | `EmptyState` (icon `milestone`, **New** title + sentence, no action) instead of a paragraph. | D28 |

## Mobile behaviour
- Same single column; the toggle button is full width (`w-full md:w-auto`), `h-11`.
- Milestone rows keep the date on the right; long names wrap, the date never does (`shrink-0`).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Long lists | show all; paginate; last 3 achieved + next with "show all" | last 3 + next + toggle | the guardian's questions are "how far" (the bar) and "what next" (the row); the rest is one tap away |
| ACTIVE tone | success; info | info | COMPLETED needs to look different from "in progress"; info = in progress in the kit table |
| Shared `MilestoneChecklist` | reuse; keep a read-only list in the route | route list | the shared component has no read-only mode (file header explains); not this lane's territory |
| Toggle state | URL; component state | component state per card | a passing look, not a place |
| Container | wide; narrow | narrow | D15: a reading page |

## Files
- `client-admin/src/routes/portal/programs.tsx` — header, cards, badge, progress label, milestone rows, short list, empty state
- `client-admin/src/routes/portal/programs.test.tsx` — updated assertions
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — new keys, remove `programs.empty` (also changed by portal-1…6, run earlier)

## Steps
1. Wrap the loaded frame in `<PageContainer size="narrow">` with `<PageHeader title={t('programs.title')} subtitle={`${selected.full_name} · ${studentMeta(selected)}`} />`; `useStudentMeta` passes `roll: formatNumber(student.roll_number, config)` (`const config = useRegionConfig()` from `@biddaloy/ui/i18n`). No-children frame: PageHeader + existing `EmptyState`. Drop `max-w-2xl` from `ProgramsSkeleton` and make its body two `h-40` card bars.
2. Empty list → `<EmptyState icon={<MilestoneIcon />} title={t('programs.emptyTitle')} explanation={t('programs.emptyExplanation')} />`. Delete the outer `<Card className="flex flex-col">` and the `bordered` prop; render cards in `div.space-y-6`.
3. `ProgramCard`: `<Card asChild><article className="p-4 md:p-5" aria-labelledby={`program-${entry.enrollment.id}`}>`; head `div.flex.flex-wrap.items-center.gap-x-3.gap-y-1` → `h2.text-h2` (`id`) + `<StatusBadge tone={TONE[entry.enrollment.status] ?? 'neutral'} label={tPrograms(`status.${entry.enrollment.status}`, { defaultValue: '' })} />` where `const TONE = { ACTIVE: 'info', COMPLETED: 'success', WITHDRAWN: 'neutral' } as const` (skip the badge when the label is empty — never the raw enum).
4. Progress (when `milestone_total > 0`): `div.mt-3` → `<ProgressBar done={…} total={…} label={t('programs.progressLabel', { done: formatNumber(entry.achieved_count, config), total: formatNumber(entry.milestone_total, config) })} />`.
5. Visible rows, as a pure exported helper in the route file (`export function visibleMilestones(milestones, expanded)`): `nextIndex = milestones.findIndex((m) => m.achievement === null)`; if `expanded || milestones.length <= 4` return all; else take the indexes of achieved milestones, keep the last 3, add `nextIndex` when ≥ 0, return those milestones in list order. `const [expanded, setExpanded] = React.useState(false)` per card.
6. Rows: `ul.mt-3.divide-y.divide-border-subtle.border-t.border-border-subtle`; `li.flex.min-h-11.items-center.gap-3.py-2`: `CircleCheckIcon` (`shrink-0 text-status-paid-fg`, `aria-label={t('programs.achieved')}`) or `CircleIcon` (`shrink-0 text-text-secondary`, `aria-label={t('programs.notYet')}`); `span.min-w-0.flex-1` name (`font-medium` for the next one); right: achieved → `span.shrink-0.text-end.text-caption.text-text-secondary` = `formatDate(achieved_on, config)` + (score or grade ? ` · ${[scoreText, grade].filter(Boolean).join(' / ')}` : ''), where `scoreText = score !== null && Number.isFinite(Number(score)) ? formatNumber(Number(score), config) : score`; next → `<StatusBadge tone="neutral" label={t('programs.next')} />`. Delete the ☑/☐ glyphs.
7. Toggle (only when `milestones.length > 4`): ghost `Button` `className="mt-2 w-full md:w-auto"`, `aria-expanded={expanded}`, `ChevronDownIcon` / `ChevronUpIcon`, label `expanded ? t('programs.showFewer') : t('programs.showAll', { count: entry.milestones.length })`.
8. Locale (en / bn), under `portal.programs`: `progressLabel` "{{done}} of {{total}} milestones achieved" / "{{total}}টির মধ্যে {{done}}টি মাইলফলক অর্জিত"; `next` "Next" / "পরবর্তী"; `achieved` "Achieved" / "অর্জিত"; `notYet` "Not yet" / "এখনও হয়নি"; `showAll_one` / `showAll_other` "Show all {{count}} milestones" / "সব {{count}}টি মাইলফলক দেখুন"; `showFewer` "Show fewer" / "কম দেখান"; `emptyTitle` "No programs yet" / "এখনও কোনো প্রোগ্রাম নেই"; `emptyExplanation` "Programs appear here once the school enrols this student in one." / "স্কুল এই শিক্ষার্থীকে কোনো প্রোগ্রামে ভর্তি করলে এখানে দেখা যাবে।". Remove `programs.empty`.

## Tests
- `programs.test.tsx`: `visibleMilestones` — 30 milestones with 4 achieved returns milestones 2, 3, 4 and 5 (by index 1–4); 6 all achieved returns the last 3; ≤ 4 milestones returns all; `expanded` returns all. Component: status shows as a badge with the translated label; progress label reads "4 of 30 milestones achieved"; an achieved date renders long form (no `2026-03-01`); the next milestone carries "Next"; "Show all 30 milestones" reveals all 30 rows and flips `aria-expanded`; two enrolments in one program still render two cards; empty data shows the new `EmptyState` title; keep the picker and error cases.
- `e2e/journeys/programs.spec.ts` asserts the h1 `portal.programs.title` and the program name — both kept; no change.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] No filled primary button on this page (read-only).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Every program status is a badge with an icon.
- [ ] A 30-milestone program shows 4 rows until "show all" is pressed.

## Out of scope
- `ProgressBar` look (shared, `ui/src/components/programs/progress-bar.tsx`) — used as is; its label is `text-xs` today and follows whatever the foundation sweep does.
- `MilestoneChecklist` read-only mode — not needed for this page.
- `StudentPicker` restyle — already requested by portal-2/3.
- No shared requests filed for this page.

Wave: 9   Lane: portal   Decisions: D5, D6, D9, D15, D16, D27, D28   Depends on: 31.3.8b, 31.4.portal-6
