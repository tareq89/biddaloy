# [31.4.portal-6] Portal results — one card per exam, figures up front

## Goal
`/portal/results` shows each published exam as a card with pass/fail status, GPA, grade, total marks and position visible without opening anything, a disclosure for the subject table and a labelled Print button, matching the "after" screenshots.

## What and why
This page shows a guardian how the child did in each published exam and lets them print the report card. Today each exam is one thin `<details>` line with only the letter grade, pass/fail as tiny red text (and nothing for a pass), an unlabelled print icon, and a subject breakdown of bare "82 — A+" lines in Latin digits; the empty state is a stray paragraph. The redesign puts the four figures and a `StatusBadge` on each card, shows subjects in a small table, labels Print, and uses the kit empty state.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_results/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_results/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_results/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_results/mobile.webp?raw=true" width="260"> |

(The before shot is the empty state — the seeded parent had no published results.)

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageContainer size="narrow"` + `PageHeader` (title `results.title` = nav label, subtitle "<name> · <class> · রোল <n>", roll via `formatNumber`). Remove `max-w-2xl` and the hand-made `<h1>`. | D15, D16, D6 |
| 2 | Exam card | One `<article>` Card per exam (server order, newest first): name `text-h2` + `StatusBadge` (fail → danger "অকৃতকার্য"; else success "উত্তীর্ণ", **New** key), kind label (`exams:kind.*`) under it, then facts `dl` জিপিএ / গ্রেড / মোট নম্বর / অবস্থান (`text-h2` values; `grid-cols-2` phone, `md:flex` desktop). | Figures visible without a click; D27 (fail was plain red text, pass had nothing) |
| 3 | Card footer | `border-t` row: ghost disclosure button "বিষয়ভিত্তিক নম্বর দেখুন / লুকান" (**New** keys, `aria-expanded`, chevron) and outline "প্রিন্ট করুন" button with `printer` icon (aria-label keeps `results.printLabel`). Phone: stacked, full width; desktop: in one row, Print at the end. | Print was an unlabelled icon; one action per control |
| 4 | Subject table | When open: unpaginated `DataTable` বিষয় / প্রাপ্ত (end-aligned) / গ্রেড / জিপিএ (desktop only), fourth subject tagged "চতুর্থ বিষয়" in caption text, failed subject's grade in `text-status-overdue-fg`; `TableCount` footer. Still fetched only when opened. | Bare "82 — A+" lines; D6, D19 |
| 5 | Default open | The first (newest) card starts open; others closed. | The latest result is what the guardian came for |
| 6 | Empty | `EmptyState` (icon `award`, **New** title + sentence, no action) instead of a paragraph. | D28 |
| 7 | Numbers | GPA via `formatNumber(gpa, config, { decimals: 2 })`, marks / position via `formatNumber`, position `—` when null. Grades ("A+") stay as written. | D6 |

## Mobile behaviour
- Facts in a 2 × 2 grid; footer buttons stacked full width (`h-11`).
- Subject table keeps three columns (বিষয় / প্রাপ্ত / গ্রেড); GPA column hidden below `md`; the fourth-subject tag drops under the name.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Row shape | keep `<details>` line; table of exams; card per exam | card per exam | few exams per year; the figures need room on a phone; the breakdown sits inside the card |
| Disclosure | native `<details>`; button + state | button with `aria-expanded` + `React.useState` | the summary today holds a nested button (invalid interactive nesting); a plain button is simpler to style and test |
| Print | icon only; labelled outline | labelled outline | no hover on phone; it is the one thing a guardian does here |
| Pass label | nothing; "উত্তীর্ণ" badge | badge | D27: every status is a badge |
| Container | wide; narrow | narrow | D15: a reading page |

## Files
- `client-admin/src/routes/portal/results.tsx` — header, card, footer, subject table, empty state, numerals
- `client-admin/src/routes/portal/results.test.tsx` — updated assertions
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — new keys, remove `results.empty` (also changed by portal-1…5, run earlier)

## Steps
1. Wrap the loaded frame (inside the existing `print:hidden` wrapper, which loses `max-w-2xl` and becomes plain `print:hidden`) in `<PageContainer size="narrow">` with `<PageHeader title={t('results.title')} subtitle={`${selected.full_name} · ${studentMeta(selected)}`} />`; `useStudentMeta` passes `roll: formatNumber(student.roll_number, config)` (`const config = useRegionConfig()` from `@biddaloy/ui/i18n`). Keep `PrintTarget` a sibling, unchanged. No-children frame: PageHeader + existing `EmptyState`. Drop `max-w-2xl` from `ResultsSkeleton`.
2. Empty list → `<EmptyState icon={<AwardIcon />} title={t('results.emptyTitle')} explanation={t('results.emptyExplanation')} />` (no action).
3. Replace `ResultRow` with `ResultCard({ row, studentId, defaultOpen, onPrint })`; render `resultsQuery.data.map((row, i) => <ResultCard key={row.exam_id} defaultOpen={i === 0} … />)` in a `div.space-y-6`. Delete the wrapping `Card` and the `bordered` prop. Import `StudentResultRow` from `@biddaloy/ui/hooks` and delete the local interface.
4. `ResultCard`: `const [open, setOpen] = React.useState(defaultOpen)`; `<Card asChild><article className="overflow-hidden p-0" aria-labelledby={`result-${row.exam_id}`}>`. Top `div.p-4.md:p-5`: `div.flex.flex-wrap.items-center.gap-x-3.gap-y-1` → `h2.text-h2` (`id`) + `<StatusBadge tone={row.is_fail ? 'danger' : 'success'} label={row.is_fail ? t('results.failTag') : t('results.passTag')} />`; `p.text-text-secondary` = `t(`kind.${row.exam_kind}`, { ns: 'exams', defaultValue: '' })` — render nothing when empty (never the raw enum); `dl.mt-3.grid.grid-cols-2.gap-x-6.gap-y-2.md:flex.md:flex-wrap.md:gap-x-10` with four `div`s → `dt.text-caption.text-text-secondary` (`reportCard.gpa`, `reportCard.grade`, `reportCard.totalMarks`, `reportCard.position`, all `{ ns: 'exams' }`, the pattern `PrintTarget` already uses) and `dd.text-h2.tabular-nums`.
5. Footer `div.flex.flex-col.gap-2.border-t.border-border-subtle.px-4.py-3.md:flex-row.md:px-5`: ghost `Button` (`aria-expanded={open}`, `aria-controls={`result-subjects-${row.exam_id}`}`, `ChevronDownIcon` / `ChevronUpIcon`, label `results.showSubjects` / `results.hideSubjects`) and outline `Button` (`PrinterIcon` + `t('reportCard.print', { ns: 'exams' })`, `aria-label={t('results.printLabel', { name: row.exam_name })}`, `className="md:ms-auto"`, `onClick={onPrint}`).
6. When `open`: `<ResultBreakdown id=… studentId examId />`. Pending → `Skeleton` rows (`h-10`, three) in `div.border-t.border-border-subtle.p-4`; error → `p.border-t.border-border-subtle.px-4.py-3.text-caption.text-destructive` `results.breakdownError`. Data → `<DataTable tableId={`portal-result-${examId}`} caption={t('results.subjectsCaption', { name: card.exam_name })} paginated={false} data={card.subjects} getRowId={(s) => s.subject_id} columns={…} />` with columns `subject` (name; when `is_fourth_subject` add `span.block.text-caption.text-text-secondary.md:ms-2.md:inline` `reportCard.fourthSubject`), `obtained` (`align: 'end'`, `formatNumber`), `grade` (`text-status-overdue-fg` when `is_fail`), `gpa` (`align: 'end'`, `formatNumber(…, { decimals: 2 })`, header/cell `hidden md:table-cell`). Column headers: `reportCard.subject`, `reportCard.obtained`, `reportCard.grade`, `reportCard.gpa` (`{ ns: 'exams' }`).
7. Locale (en / bn), under `portal.results`: `passTag` "Pass" / "উত্তীর্ণ"; `showSubjects` "Show subject marks" / "বিষয়ভিত্তিক নম্বর দেখুন"; `hideSubjects` "Hide subject marks" / "বিষয়ভিত্তিক নম্বর লুকান"; `subjectsCaption` "{{name}} — marks by subject" / "{{name}} — বিষয়ভিত্তিক নম্বর"; `emptyTitle` "No results yet" / "এখনও কোনো ফলাফল প্রকাশিত হয়নি"; `emptyExplanation` "Results appear here once the school publishes them." / "স্কুল ফলাফল প্রকাশ করলে এখানে দেখা যাবে।". Remove `results.empty`.

## Tests
- `results.test.tsx`: each exam renders a heading level 2 and a status badge ("Pass" / "Fail") — replace the "tags only the failed exam" case so the passed exam asserts "Pass"; GPA renders with two decimals and a null position renders "—"; the first card's subject table is visible on load (one breakdown request), the second card's is not until its "Show subject marks" button is pressed (`aria-expanded` flips); the fourth subject shows its tag; print button is found by its `printLabel` aria-label and still triggers `window.print`; empty data shows the new `EmptyState` title; keep the picker, no-class, no-children and both error cases; in `bn` numbers render Bangla digits.
- `e2e/journeys/result-publish.spec.ts` asserts the heading `portal.results.title` and the exam name text — both kept; no change.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] No filled primary button on this page (read-only).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] GPA, grade, total marks and position are visible on every card without opening it.
- [ ] Every exam shows a pass or fail badge.
- [ ] Printing still prints only the report card.

## Out of scope
- `ReportCard` print layout (shared component) — untouched.
- `StudentPicker` restyle — already requested by portal-2/3.
- No shared requests filed for this page.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: portal   Decisions: D6, D9, D15, D16, D19, D27, D28, D29   Depends on: 31.3.8b, 31.4.portal-5
