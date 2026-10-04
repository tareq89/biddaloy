# [31.4.portal-8] Portal syllabus — header, per-subject progress, numbered topic list

## Goal
`/portal/syllabus` shows a page header with the selected child, then one card per subject with a progress bar ("৫টির মধ্যে ২টি বিষয়বস্তু সম্পন্ন") and a numbered topic list with status badges, matching the "after" screenshots.

## What and why
This page tells a guardian how far the child's class has got through the syllabus, subject by subject. Today the page is a bare `text-lg` title, a list of topic names with badges and no sense of progress, a `max-w-2xl` wrapper, and the "no class" / "no topics" states are grey paragraphs in a card. The redesign adds the kit header, a progress line per subject, numbered rows that keep the teaching order, and real empty states.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_syllabus/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_syllabus/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_syllabus/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_syllabus/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageContainer size="narrow"` + `PageHeader` (title `syllabus.title` = nav label, subtitle "<name> · <class> <section> · রোল <n>", roll via `formatNumber`). Remove `max-w-2xl` and the hand-made `<h1>`. | D15, D16, D6 |
| 2 | Subject card | One `<article>` Card per subject (`p-4 md:p-5`), name `text-h2`. | D17 (cards were `p-3.5`, title `text-sm`) |
| 3 | **New** progress | Existing `ProgressBar` under the name, label "৫টির মধ্যে ২টি বিষয়বস্তু সম্পন্ন" (**New** key, counts via `formatNumber`); done = topics with status `DONE`. | The guardian's question is "how far", the page had no answer |
| 4 | Topic rows | `ol.divide-y` rows `min-h-11`: a **New** order number pill (1…n inside the subject, tenant digits), name `font-medium`, description under it in `text-caption text-text-secondary` (only when present), `StatusBadge domain="syllabusTopic"` on the right. | Order is the teaching order; the row needed weight and spacing |
| 5 | Empty / no class | `EmptyState` (icon `book-open`) with **New** titles; the existing sentences (`syllabus.noClass`, `syllabus.empty`) become the explanation. | D28 |
| 6 | Loading | Skeleton shaped like the page: header bars + two card bars, no `max-w-2xl`. | D28, D15 |

## Mobile behaviour
- One column; the student picker chips wrap; the badge stays on the right of each row (`shrink-0`) and long topic names wrap under the number.
- The bottom bar marks "আরও" (31.3.2); no control on this page besides the picker chips (44 px).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Progress | none; a page-level total; per subject | per subject bar + sentence | guardians follow subjects, not a grand total |
| Row number | raw `sequence`; index in subject | index + 1 | `sequence` can have gaps (10, 11, 20); the guardian needs 1, 2, 3 |
| Subject names | ask `/subjects`; server adds names | shared request to the server | families get 403 on `/subjects`; the server never fills `subject_name_*` today (see Out of scope) |
| Container | wide; narrow | narrow | D15: a reading page |
| Filled button | — | none | read-only page |

## Files
- `client-admin/src/routes/portal/syllabus.tsx` — header, cards, progress, rows, empty states, skeleton
- `client-admin/src/routes/portal/syllabus.test.tsx` — updated assertions
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — new keys (also changed by portal-1…7, run earlier)

## Steps
1. Imports: add `PageHeader`, `PageContainer`, `ProgressBar` from `@biddaloy/ui/components`, `useRegionConfig` from `@biddaloy/ui/i18n`, `formatNumber` from `@biddaloy/ui/utils`, `BookOpenIcon` from `lucide-react`; drop `Card` if unused.
2. `useStudentMeta`: pass `roll: formatNumber(student.roll_number, config)` (`const config = useRegionConfig()`), same as portal-7 did in `programs.tsx`.
3. Loaded frame: `<PageContainer size="narrow"><PageHeader title={t('syllabus.title')} subtitle={`${selected.full_name} · ${studentMeta(selected)}`} />` then the `StudentPicker` (unchanged, only when `students.length > 1`), then the body. No-children frame: `PageContainer` + `PageHeader title` + the existing `EmptyState`. Error frame keeps no `<h1>` (the file's contract; `useRouteFocus` falls back to `<main>`).
4. No class: `<EmptyState icon={<BookOpenIcon />} title={t('syllabus.noClassTitle')} explanation={t('syllabus.noClass')} />`. No topics: `<EmptyState icon={<BookOpenIcon />} title={t('syllabus.emptyTitle')} explanation={t('syllabus.empty')} />`.
5. `SyllabusBody` keeps the bucketing and sort. Render the subjects in `div.space-y-6`. Each: `<Card asChild padded><article aria-labelledby={`subject-${subject.subjectId}`}>` → `h2.text-h2` (`id`), then `div.mt-3` → `<ProgressBar done={done} total={subject.topics.length} label={t('syllabus.progressLabel', { done: formatNumber(done, config), total: formatNumber(subject.topics.length, config) })} />` where `done = subject.topics.filter((x) => x.status === SyllabusTopicStatus.DONE).length` (`SyllabusTopicStatus` from `@biddaloy/shared`).
6. Rows: `ol.mt-3.divide-y.divide-border-subtle.border-t.border-border-subtle`; `li.flex.min-h-11.items-start.gap-3.py-2.5`: `span.mt-0.5.flex.size-6.shrink-0.items-center.justify-center.rounded-full.bg-muted.text-caption.text-text-secondary` with `formatNumber(index + 1, config)` (`aria-hidden="true"` — the `<ol>` already numbers for screen readers); `div.min-w-0.flex-1` → `p.font-medium` name + optional `p.text-caption.text-text-secondary` description; then `<StatusBadge domain="syllabusTopic" status={topic.status} />` (its wrapper `shrink-0`).
7. Skeleton (`SyllabusSkeleton` and the topics-pending block): drop `max-w-2xl`; bars `h-9 w-2/5` (title), `h-5 w-3/5` (subtitle), two `h-48 w-full rounded-lg` cards in `space-y-6`; keep `aria-busy` + the sr-only label.
8. Locale (en / bn), under `portal.syllabus`: `progressLabel` "{{done}} of {{total}} topics done" / "{{total}}টির মধ্যে {{done}}টি বিষয়বস্তু সম্পন্ন"; `noClassTitle` "Not in a class yet" / "এখনও কোনো শ্রেণিতে যুক্ত নয়"; `emptyTitle` "No syllabus yet" / "এখনও কোনো সিলেবাস নেই". Keep `noClass`, `empty`, `unknownSubject`.

## Tests
- `syllabus.test.tsx`: keep the grouping/sort, class-id, child-switch, no-class (no topics request), error/retry and "no write controls" cases; update text lookups to the new `EmptyState` titles; add: a subject with 5 topics, 2 `DONE`, shows "2 of 5 topics done" and a `progressbar` with `aria-valuenow="2"`; rows are numbered 1…n inside each subject (not by `sequence` 10, 20…); the subtitle shows the child's name; exactly one `h1`.
- `e2e/keyboard/portal-syllabus.spec.ts` looks up the heading `portal.syllabus.title` — kept; no change.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary per view (none on this read-only page).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Each subject card shows a progress bar and an "x of y topics done" line in the tenant's digits.
- [ ] Topic rows are numbered 1…n per subject; every status is a badge with an icon.
- [ ] "No class" and "no topics" are `EmptyState`s, not grey paragraphs.

## Out of scope
- Subject names: the server never fills `subject_name_en/bn` on `GET /syllabus-topics`, so every card is titled "অন্যান্য বিষয়" today — filed in `shared-requests.md` (server). With the fix the cards show "গণিত", "বাংলা"… with no change to this page.
- `StudentPicker` restyle — already requested by portal-2/3.
- `ProgressBar` label size (shared) — used as is, like portal-7.
- Sidebar highlighting both "সারসংক্ষেপ" and "সিলেবাস" (before shot) — fixed by 31.2.9 / 31.3.2.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server subject names on syllabus topics | Accepted | 31.3.7c | SyllabusTopic.subject_name_en / subject_name_bn (already typed) are now filled; unknownSubject stays as the null case |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: portal   Decisions: D6, D9, D15, D16, D17, D27, D28   Depends on: 31.3.8b, 31.4.portal-7
