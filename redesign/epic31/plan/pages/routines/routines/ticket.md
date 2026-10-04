# [31.4.routines-1a] Class routine — section table, readable builder page

## Goal
`/routines` lists the chosen class's sections in one kit table (class kept in the URL), and `/routines/$sectionId` shows a kit detail header with the routine's state, the week table in a card, a day-by-day list on phone, translated conflict messages and a kit workload table. Split: dialogs (cell picker, fill empty periods) are `routines-1b`, which runs after this one.

## What and why
`/routines` is where an admin picks a class and a section to build that section's weekly routine; `/routines/$sectionId` is the builder itself. Today the first page is a bare browser `<select>` and a list of boxes, the class choice is lost when you come back from the builder, and the builder has a raw heading, a tiny unlabeled "ফিল অ্যাসিস্ট" button, no sign of whether the routine is a draft or published, English server sentences in the conflict list, a blank screen while loading, plain grey text for every problem state, and on phone only a "screen too small" sentence. The redesign uses the kit's PageHeader, DataTable, DetailShell, StatusBadge, EmptyState and Tabs, keeps the class in the URL, shows how full the week is, and gives the phone a one-day-at-a-time list that opens the same cell picker.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — `/routines` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines/before-mobile.webp?raw=true" width="260"> |
| After — `/routines` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines/mobile.webp?raw=true" width="260"> |
| Before — `/routines/$sectionId` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_sectionId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_sectionId/before-mobile.webp?raw=true" width="260"> |
| After — `/routines/$sectionId` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_sectionId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_sectionId/mobile.webp?raw=true" width="260"> |

(The "before" builder shot shows the no-shift message — the audit school had no shift set. The "after" shows the normal case; the problem states are in Changes 13–16.)

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | `/routines` header | `PageContainer` + `PageHeader` title `builderList.title` ("শ্রেণির রুটিন" after the glossary) + **New** subtitle `builderList.subtitle`. No actions. Remove `p-4` / `gap-4` wrapper. | D15, D16 |
| 2 | `/routines` class picker | Raw `<select>` → kit `Select` in a `FormField` with visible label "শ্রেণি", `md:w-72`, placeholder `common` "বাছুন". | D25, D37 |
| 3 | `/routines` class in URL | **New** search param `?classId=` (`validateSearch`, `z.string().uuid().optional().catch(undefined)`); changing the class navigates with `replace: true`. With no param the first class is used. | Back from the builder used to land on an empty picker |
| 4 | `/routines` sections | Boxes → `DataTable paginated={false}`: শাখা (link to the builder, "শাখা ক"), শিক্ষার্থী (`align: 'end'`, `formatNumber`), one row action `edit` "রুটিন সাজান" (`to` the builder). Footer `TableCount` "মোট ৩টি". Phone: compact two-line rows ("শাখা ক" / "৪২ জন শিক্ষার্থী"). | D19, D6 |
| 5 | `/routines` states | Loading: `DataTable loading`. Class with no sections: `EmptyState` (`builderList.emptyTitle/emptyExplanation`) with outline action **New** "শ্রেণি খুলুন" → `/classes/$classId`. School with no classes: **New** `EmptyState` with outline "শ্রেণিতে যান" → `/classes`. Query error: `ErrorState` **New** `builderList.error`. | D28 |
| 6 | Builder header | `DetailShell` without tabs: `name` = `builder.title` ("ষষ্ঠ শ্রেণি – ক", equals the crumb from 31.3.5), `statusBadge` = routine state (ড্রাফট neutral · পর্যালোচনায় warning · প্রকাশিত success, labels `review.stateLabel.*`), `facts`: শিক্ষার্থী "৪২ জন", **New** পূরণ হয়েছে "২৫টির মধ্যে ১৯টি পিরিয়ড". | D16, D27; state was invisible |
| 7 | Builder actions | Primary `builder.fillAssistAction` renamed "খালি ঘর পূরণ করুন" (icon `wand-sparkles`); **New** outline "পর্যালোচনা ও প্রকাশ" (icon `send`) → `/routines/review`. Phone: primary full width + More (holds the outline). | D16, D29, D32 ("ফিল অ্যাসিস্ট" is jargon) |
| 8 | Conflict list | Kit look (Card radius, `p-4`, `triangle-alert` icon, `ps-5`); each item shows **New** `conflictList.codes.<code>` text, never `violation.message` / `warning.message` (English server sentences). | D9 |
| 9 | Keyboard hint | **New** `builder.keyboardHint` line above the table, desktop only. | The keyboard model (arrows, Enter, Delete, type-ahead) was undiscoverable |
| 10 | Week table | `RoutineGrid` wrapped in a Card (`overflow-hidden`, no padding) inside `hidden md:block` so its phone sentence never shows. Its inner look and cell `aria-label` (`common:routine.cellLabel`) come from 31.2.3b (wave 2); pass no new props. | D17 |
| 11 | Phone week | **New** `-builder-day-list.tsx` below `md`: kit `Tabs` (line) of working days, today's weekday selected (else the first); the day's periods as rows (`min-h-14`): "পিরিয়ড ১" + start time, subject + teachers or "+ খালি", `chevron-right`; break rows muted. Tapping a row opens the same `CellPicker` (`setActiveCell`). | Phone layout designed, not a dead end |
| 12 | Workload | `WorkloadPanel` becomes a Card: title `h2` "শিক্ষকের কর্মভার", the underloaded sentence as its subtitle, then `DataTable paginated={false}`: শিক্ষক, পিরিয়ড / সপ্তাহ (`align: 'end'`), অবস্থা (danger `StatusBadge` "দৈনিক সীমার বেশি" or "—"); `TableCount`. Red-tinted rows go. | D19, D27 |
| 13 | No `?classId` | `EmptyState` (icon `table`) **New** title `builder.noClassIdTitle`, reworded explanation, outline action "শ্রেণির রুটিন" → `/routines`. | D28, D32 ("রুটিন বিল্ডার") |
| 14 | Section not found | `EmptyState` title `builder.sectionNotFound` + **New** explanation, same action. | D28 |
| 15 | Class has no shift | `EmptyState` **New** title `builder.noShiftTitle`, explanation existing, outline "শ্রেণি খুলুন" → `/classes/$classId`. | D28 |
| 16 | Year has no routine | `EmptyState` **New** title `builder.noRoutineTitle`, explanation existing, outline "রুটিন পর্যালোচনা খুলুন" → `/routines/review`. | D28 |
| 17 | Loading | `return null` → a skeleton shaped like the header + a 6-row table, `aria-busy="true"`. | D28 |
| 18 | Labels | **New** `-subject-name.ts`: `subjectName(subject, language)` = `name_bn` when the UI is Bangla and it is set, else `name_en`. Subject/teacher not found → "—", never the id. | D9, D38 (Bangla screen showed English subject names) |
| 19 | Dates | Local `todayIso()` → `toIsoDate(new Date())` from `@biddaloy/ui/utils`. | B19, one helper |

## Mobile behaviour
- `/routines`: one column; the class select is full width; sections are compact two-line rows with a 44 px edit icon; the whole name cell is a 44 px link.
- Builder: crumbs show the last two; facts in a 2-column grid; primary "খালি ঘর পূরণ করুন" full width + More (holds "পর্যালোচনা ও প্রকাশ").
- The week table is replaced by day tabs + one day's period rows; each row ≥ 56 px and opens the cell picker. No keyboard hint.
- Workload table becomes compact rows: name + "সপ্তাহে ৪টি পিরিয়ড", badge on the right.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Section picker shape | keep two steps (class → section) · one flat list of all sections | Two steps, class in the URL | No all-sections endpoint with counts (D1, no API change); `useSectionLookup` has no class id or count |
| Default class | empty until picked · first class | First class when `?classId` is absent | The page is never empty; one obvious next action (open a section) |
| Phone builder | "too narrow" sentence (today) · horizontal-scroll table · one-day list | One-day list in a route helper | Same data and same picker; a 5×7 table cannot be tapped at 390 px |
| Clearing a cell on phone | add a "Clear" button to the picker · leave desktop-only | Desktop-only (Delete key) for now | Adding a clear action to the picker is new behaviour; noted in Out of scope |
| Builder header | PageHeader · DetailShell without tabs | `DetailShell` | Addendum 7: a detail page without tabs still uses it; gives `statusBadge` + `facts` |
| "Filled" fact | none · count from `cells` | `Object.keys(cells).length` of `weekdays.length × class periods` | Already in memory; tells the admin how far along the week is |
| Conflict text | show server message · translate by code | Translate by `code`, fallback `conflictList.codes.unknown` | D9; codes are a closed union in `ui/src/hooks/routines.ts` |

## Files
- `client-admin/src/routes/_staff/routines/index.tsx` — header, Select, `?classId`, DataTable, states
- `client-admin/src/routes/_staff/routines/index.test.tsx` — rewritten for the Select + table
- `client-admin/src/routes/_staff/routines/$sectionId.tsx` — DetailShell, states, skeleton, grid wrapper, day list, labels, `toIsoDate`
- `client-admin/src/routes/_staff/routines/$sectionId.test.tsx` — header/state/translated-conflict assertions (time strings in it are also changed by 31.2.3, runs earlier)
- `client-admin/src/routes/_staff/routines/-builder-day-list.tsx` — **new**, phone day list
- `client-admin/src/routes/_staff/routines/-builder-day-list.test.tsx` — **new**
- `client-admin/src/routes/_staff/routines/-subject-name.ts` — **new**, `subjectName()`
- `client-admin/src/routes/_staff/routines/-workload-panel.tsx` — Card + DataTable + StatusBadge
- `client-admin/src/routes/_staff/routines/-workload-panel.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-conflict-list.tsx` — kit look, messages by code
- `client-admin/src/routes/_staff/routines/-conflict-list.test.tsx` — updated
- `ui/src/i18n/locales/en/routines.json`, `ui/src/i18n/locales/bn/routines.json` — keys below
- `e2e/journeys/routine-builder.spec.ts` — table locator by name (the page now has two tables)

## Steps
1. **`-subject-name.ts`** (new): `export function subjectName(subject: Pick<Subject, 'name_en' | 'name_bn'> | undefined, language: string): string` → `'—'` when undefined; `language.startsWith('bn') && subject.name_bn ? subject.name_bn : subject.name_en`. Language from `useTranslation().i18n.language`.
2. **Locale keys** (en / bn). Change values:
   - `builder.title` → "{{className}} – {{sectionName}}" (both languages; en dash, same as the crumb).
   - `builder.fillAssistAction` → "Fill empty periods" / "খালি ঘর পূরণ করুন".
   - `builder.noClassIdExplanation` → "Open this page from the class routine list so we know which section it is." / "শ্রেণির রুটিনের তালিকা থেকে শাখাটি খুলুন, তাহলে বোঝা যাবে কোন শাখার রুটিন।"
   Add:
   - `builderList.subtitle` "Pick a class, open a section, then arrange its weekly routine." / "শ্রেণি বেছে একটি শাখা খুলুন, তারপর সাপ্তাহিক রুটিন সাজান।"
   - `builderList.sectionColumn` "Section" / "শাখা"; `builderList.sectionName` "Section {{name}}" / "শাখা {{name}}"; `builderList.studentsColumn` "Students" / "শিক্ষার্থী"; `builderList.tableCaption` "Sections of {{className}}" / "{{className}}-র শাখা"; `builderList.openAction` "Arrange routine" / "রুটিন সাজান"; `builderList.openClassAction` "Open class" / "শ্রেণি খুলুন"; `builderList.noClassesTitle` "No classes yet" / "এখনো কোনো শ্রেণি নেই"; `builderList.noClassesExplanation` "Add a class and its sections first." / "আগে একটি শ্রেণি ও তার শাখা যোগ করুন।"; `builderList.goToClasses` "Go to classes" / "শ্রেণিতে যান"; `builderList.error` "Couldn't load the classes. Check your connection and try again." / "শ্রেণির তালিকা আনা যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।"
   - `builder.studentsFact` "Students" / "শিক্ষার্থী"; `builder.studentsValue` "{{count}} students" / "{{count}} জন"; `builder.filledFact` "Filled" / "পূরণ হয়েছে"; `builder.filledValue` "{{filled}} of {{total}} periods" / "{{total}}টির মধ্যে {{filled}}টি পিরিয়ড"; `builder.reviewAction` "Review and publish" / "পর্যালোচনা ও প্রকাশ"; `builder.keyboardHint` "Click a cell, or move with the arrow keys and press Enter. Delete clears a cell." / "একটি ঘরে ক্লিক করুন, অথবা তীর-চাবি দিয়ে গিয়ে Enter চাপুন। Delete চাপলে ঘরটি খালি হয়।"; `builder.backToList` "Class routine" / "শ্রেণির রুটিন"; `builder.noClassIdTitle` "Which section?" / "কোন শাখা, বোঝা যাচ্ছে না"; `builder.sectionNotFoundExplanation` "It may have been removed. Pick it again from the list." / "শাখাটি হয়তো মুছে ফেলা হয়েছে। তালিকা থেকে আবার বাছুন।"; `builder.noShiftTitle` "This class has no shift" / "শ্রেণির শিফট ঠিক করা নেই"; `builder.openClass` "Open class" / "শ্রেণি খুলুন"; `builder.noRoutineTitle` "No routine yet" / "এখনো কোনো রুটিন নেই"; `builder.openReview` "Open routine review" / "রুটিন পর্যালোচনা খুলুন"; `builder.loading` "Loading the routine" / "রুটিন লোড হচ্ছে". (No cell `aria-label` key here: the grid and the phone day list both use `common.json` `routine.cellLabel` / `routine.cellLabelEmpty`, added by 31.1.2a.)
   - `conflictList.codes.BREAK_SLOT` "A period can't go into a break." / "বিরতির সময়ে পিরিয়ড বসানো যায় না।"; `.TEACHER_DOUBLE_BOOKED` "A teacher on this period is already teaching another section at this time." / "এই সময়ে শিক্ষক অন্য একটি শাখায় পড়াচ্ছেন।"; `.SECTION_DOUBLE_BOOKED` "This section already has a period at this time." / "এই শাখার এই সময়ে আগে থেকেই একটি পিরিয়ড আছে।"; `.ROOM_DOUBLE_BOOKED` "This room is already in use at this time." / "এই সময়ে কক্ষটি আগে থেকেই ব্যবহৃত হচ্ছে।"; `.TEACHER_OVER_DAILY_LIMIT` "This would put a teacher over their daily period limit." / "এতে শিক্ষকের দিনের সর্বোচ্চ পিরিয়ডের সীমা পার হয়ে যাবে।"; `.TEACHER_NOT_ASSIGNED` "This teacher isn't assigned to this subject for this section." / "এই শিক্ষক এই শাখার এই বিষয়ের জন্য নিয়োগ পাননি।"; `.TEACHER_OVER_CONSECUTIVE_LIMIT` "A teacher would teach more periods in a row than the limit." / "একজন শিক্ষক সীমার চেয়ে বেশি টানা পিরিয়ড পড়াবেন।"; `.unknown` "This breaks one of the routine rules." / "এটি রুটিনের একটি নিয়মের সাথে মেলে না।"
   - `workloadPanel.teacherColumn` "Teacher" / "শিক্ষক"; `workloadPanel.periodsColumn` "Periods / week" / "পিরিয়ড / সপ্তাহ"; `workloadPanel.statusColumn` "Status" / "অবস্থা"; `workloadPanel.periodsPerWeekShort` "{{count}} periods a week" / "সপ্তাহে {{count}}টি পিরিয়ড" (phone line).
   Delete `builderList.pickAnotherClass`, `builderList.selectClass` (Select uses `common` placeholder).
3. **`index.tsx`**: add `validateSearch` (`classId`). `const classId = search.classId ?? classes[0]?.id`. Render `PageContainer` → `PageHeader title={t('builderList.title')} subtitle={t('builderList.subtitle')}` → `FormField label={t('builderList.classLabel')}` wrapping `Select` (options = classes, value = classId, `onValueChange={(id) => navigate({ search: { classId: id }, replace: true })}`) in a `md:w-72` div → `DataTable` with `caption={t('builderList.tableCaption', { className })}`, `paginated={false}`, `loading={classesQuery.isPending || sectionsQuery.isPending}`, columns: section (Link `to="/routines/$sectionId" params search={{ classId }}`, class `flex min-h-11 flex-col justify-center hover:text-primary md:min-h-0`, text `builderList.sectionName`; phone second line `builderList.enrolledCount`), students (`align: 'end'`, `formatNumber(section.enrolled_count, config)`), `rowActions={(s) => [{ intent: 'edit', label: t('builderList.openAction'), to: \`/routines/${s.id}?classId=${classId}\` }]}`, `emptyState` = Change 5. Classes empty → the no-classes `EmptyState` instead of field + table. `classesQuery.isError || sectionsQuery.isError` → `ErrorState message={t('builderList.error')} onRetry`.
4. **`-conflict-list.tsx`**: item text `t(\`conflictList.codes.${code}\`, { defaultValue: t('conflictList.codes.unknown') })`; dedupe items with the same code (one sentence per code). Boxes: `rounded-lg border p-4` + existing status tones; title row `flex items-center gap-2 font-medium` with `TriangleAlert` (`size-4`); list `mt-1 list-disc ps-5`. Keep `role="alert"` on violations.
5. **`-workload-panel.tsx`**: `Card` (`padded={false}`, `overflow-hidden`) with a `div.p-4.md:p-5` holding `h2.text-h2` (`workloadPanel.legend`) and, when `underloaded.length > 0`, `p.mt-1.text-text-secondary` (`workloadPanel.underloaded`). Then `DataTable paginated={false} caption={t('workloadPanel.legend')}` with the 3 columns of Change 12 (status cell: `<StatusBadge tone="danger" label={t('workloadPanel.overLimit')} />` or "—"); phone line `workloadPanel.periodsPerWeekShort`. Teacher not found → "—". Empty → `p.px-4.pb-4.text-text-secondary` `workloadPanel.empty`. Loading → `DataTable loading`. Remove `periodsPerWeek` key usage (keep the key; review.tsx may not use it — delete only if `rg` finds no other use).
6. **`-builder-day-list.tsx`** (new): props `{ weekdays, weekdayLabels, periods: RoutineGridPeriodRow[], cells: Record<string, RoutineGridCell>, onActivateCell(weekday, periodSlotId) }`. State `day` = today's `getDay()` if in `weekdays`, else `weekdays[0]`. Kit `Tabs` (line) with `aria-label={t('agenda.daySwitcherLabel')}`; panel `ul` = Card (`divide-y divide-border-subtle overflow-hidden`). Break row: `li.bg-muted.px-4.py-2.text-center.text-caption.text-text-secondary` = `period.name ?? t('grid.breakUnnamed')` + " · " + `formatTime(starts_at)` – `formatTime(ends_at)`. Class row: `li.p-2 > button` (`flex min-h-14 w-full items-center gap-3 rounded-md border px-3 py-2 text-start`, filled `border-border-subtle bg-surface`, empty `border-dashed border-border-subtle text-text-secondary`, warning `border-status-due-fg bg-status-due-bg text-status-due-fg`), left `w-24 shrink-0`: `agenda.periodLabel` (`text-label font-medium`) + `formatTime(starts_at)` (`text-caption text-text-secondary`); middle: subject `font-medium` (+ `TriangleAlert size-3.5` when warning) and teachers `text-caption`, or `Plus size-3.5` + `grid.emptyCell`; right `ChevronRight size-4`. `aria-label` = the same text `RoutineGrid` gives the cell (31.2.3b): filled `t('routine.cellLabel', { ns: 'common', weekday: weekdayLabels[day], period: t('agenda.periodLabel', { sequence: period.sequence }), subject: cell.subjectLabel, teachers: cell.teacherLabels.join(', ') })`, empty `t('routine.cellLabelEmpty', { ns: 'common', weekday: weekdayLabels[day], period: … })` (the route already loads `common`; no new prop). Click → `onActivateCell(day, period.id)`.
7. **`$sectionId.tsx`**:
   - Pending (`sectionsQuery.isPending || routinesQuery.isPending`): `PageContainer` + `Skeleton` header bars + a table-shaped skeleton (6 rows `h-14`), `aria-busy="true"`, sr-only `builder.loading`.
   - Problem states (Changes 13–16): `PageContainer` + `PageHeader title={t('builder.backToList')}` (only when no section is known; otherwise `DetailShell name={builder.title}`) + `EmptyState` with the outline `action` given there (links via `navigate`).
   - Normal: `DetailShell name={t('builder.title', { className, sectionName })} statusBadge={<StatusBadge tone={DRAFT→'neutral', REVIEW→'warning', PUBLISHED→'success'} label={t(\`review.stateLabel.${routine.state}\`)} />} facts={[{ label: t('builder.studentsFact'), value: t('builder.studentsValue', { count: section.enrolled_count }) }, { label: t('builder.filledFact'), value: t('builder.filledValue', { filled: formatNumber(filled), total: formatNumber(total) }) }]} actions={[{ id: 'review', label: t('builder.reviewAction'), icon: <Send />, priority: 'secondary', onClick: () => navigate({ to: '/routines/review' }) }, { id: 'fill', label: t('builder.fillAssistAction'), icon: <WandSparkles />, priority: 'primary', onClick: () => setFillAssistOpen(true) }]}`. `total = weekdays.length × periods.filter(p => p.kind !== 'BREAK').length`, `filled = Object.keys(cells).length`. `enrolled_count` comes from `ClassSectionWithCount` (already returned by `useClassSections`).
   - Body order (`space-y-6`): `ConflictList` (warnings), `section.space-y-3` holding `p.hidden.text-text-secondary.md:block` (`builder.keyboardHint`), `div.hidden.md:block` → `Card padded={false} className="overflow-hidden"` → `RoutineGrid` (unchanged props), `div.md:hidden` → `BuilderDayList`; then `WorkloadPanel`.
   - Labels: `subjectLabel: subjectName(subject, i18n.language)`; teacher fallback `'—'`.
   - `todayIso()` → `toIsoDate(new Date())`; delete the local helper.
   - Delete the raw `<h1>` and the raw button.
8. Logical classes only (`ps-`, `text-start`); no `max-w-*` in either route file.

## Tests
- `index.test.tsx`: Select shows the classes; picking one updates `?classId` (router memory history) and the table lists "Section A" with its count; `TableCount` "Total 2"; the edit row action links to `/routines/<id>?classId=<id>`; no-sections → EmptyState with "Open class"; no classes → no-classes EmptyState; error → ErrorState with Retry.
- `$sectionId.test.tsx`: h1 = "Class 6 – A"; StatusBadge "Draft" for a DRAFT routine; facts show "1 of 25 periods" style text; the 409 case now shows `conflictList.codes.TEACHER_DOUBLE_BOOKED` text instead of the mocked server message (line ~174); missing `classId` / no shift / no routine each render their EmptyState title and action; pending renders `aria-busy` instead of nothing.
- `-builder-day-list.test.tsx`: renders tabs for the given weekdays; today's weekday selected; a break row has no button; clicking an empty row calls `onActivateCell(weekday, periodId)`; a filled row's accessible name equals the `common:routine.cellLabel` text (en) and an empty row's ends in ": empty".
- `-workload-panel.test.tsx`: over-limit teacher shows the danger badge; underloaded count in the subtitle; unknown teacher shows "—", never the id.
- `-conflict-list.test.tsx`: a known code renders its sentence; an unknown code renders `codes.unknown`; the server `message` is never in the DOM.
- `e2e/journeys/routine-builder.spec.ts`: lines ~97 and ~151 `page.locator('table')` → `page.getByRole('table', { name: t('routines.grid.caption') })` (the workload table is a second table now). Line ~172 asserts the alert by `violationsTitle` — unchanged.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (`/routines` has none; the builder has "খালি ঘর পূরণ করুন").
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route files (D15).
- [ ] No `<select>` left in `index.tsx`.
- [ ] Coming back from a builder to `/routines` keeps the class that was chosen.
- [ ] The builder header shows the routine's state badge and the "filled" fact.
- [ ] A conflict shows a Bangla sentence, never the English server text.
- [ ] Below `md` the builder shows day tabs + period rows, and tapping a row opens the cell picker.
- [ ] Workload is a table with a total; over-limit teachers carry a danger badge.
- [ ] No blank screen while loading; every problem state is an EmptyState with one outline action.

## Out of scope
- `ui/src/components/routine-grid.tsx` inner look (period name over time, kit table head, cell tokens, cell aria-label from `common:routine.cellLabel`) — shipped by 31.2.3b before this ticket; do not add routine label keys to `routines.json`.
- Clearing a cell on phone (no clear control in the picker; desktop uses Delete) — new behaviour, not added.
- There is no UI to create a routine for a year (pre-existing gap); the no-routine state links to `/routines/review`.
- Cell picker and fill-empty-periods dialogs: `routines-1b`.
- `subjectName()` could live in `ui/src/utils` for other pages (exams, marks, homework) — kept local to this lane.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| routine-grid kit look, period label + time range, empty/warning icons, cell aria-label | Accepted | 31.2.3b | no prop change; do NOT add routines.builder.cellAria — the grid uses common.json routine.cellLabel(Empty) |

Wave: 9   Lane: routines   Decisions: D5, D6, D9, D15, D16, D17, D19, D25, D27, D28, D29, D32, D37, D38   Depends on: 31.3.8b
