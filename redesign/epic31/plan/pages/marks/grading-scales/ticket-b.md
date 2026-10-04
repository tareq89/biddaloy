# [31.4.marks-4b] Grading scale editor — context, save on top, readable rows

## Goal
`/grading-scales/$scaleId` shows which year and class the scale is for, keeps "সংরক্ষণ করুন" as the one primary in the header (enabled only with changes, guarded on leave), shows coverage as a labelled card, edits rows as a kit table on desktop and as cards on phone with tenant numerals, and never shows a server English sentence.

b runs after a (`marks-4a`, `ticket.md` in this folder).

## What and why
An admin uses the editor to say which percentage range gives which grade and GPA (A+ 80–100 …), check that 0–100 is fully covered, and save; or copy the scale to another class or year. Today the page shows only the name — not the year or class — Save is a filled button at the very bottom after the table, the empty state is a lone outline button "বিডি এনসিটিবি থেকে শুরু করুন", the rows are seven raw inputs with an underlined red "মুছুন" link and Latin digits, the GPA of a fail band can still be typed, the Enter-adds-a-row shortcut is invisible, the problem list prints the server's English message ("Gap between 79 and 81"), the overlap hatch uses CSS variables that do not exist (`var(--destructive)`), band 4 is painted the same red as a gap, and leaving with unsaved edits loses them silently. The redesign uses the kit detail header with facts, a coverage Card, a kit band table / phone cards, translated problems and a leave guard.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales/before-mobile.webp?raw=true" width="260"> |
| After — list | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales/mobile.webp?raw=true" width="260"> |
| Before — editor | _not captured_ | _not captured_ |
| After — editor | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales_scaleId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/marks/grading-scales_scaleId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `DetailShell` without tabs: crumbs (layout) → name → **New** facts শিক্ষাবর্ষ (year name), কোন শ্রেণির জন্য (class name or "সব শ্রেণি"), গ্রেড ("৭টি"). Actions: outline "অন্য শ্রেণি বা বর্ষে কপি করুন" (`copy`) and primary "সংরক্ষণ করুন" (`save`, busy while previewing), both `allowed: canManage`. Save is **disabled until something changed** (**New**). | D16; where am I + one primary visible without scrolling |
| 2 | Preset banner | Existing `PresetWarningBanner` stays, placed under the header (it is a `client-admin/src/components` file — placed, not edited). | — |
| 3 | Coverage | `CoverageBar` inside a Card: title `h2` **New** "০ থেকে ১০০% — কোন নম্বরে কোন গ্রেড"; the bar `h-4 rounded-md border border-border-subtle`; **New** row of grade letters under their ranges (same widths); status line with icon — complete `circle-check text-status-paid-fg` "০ থেকে ১০০ পর্যন্ত প্রতিটি নম্বরের একটি করে গ্রেড আছে।", gap / overlap `circle-alert text-destructive` "লাল অংশের নম্বরের কোনো গ্রেড নেই।" / "ডোরাকাটা অংশের নম্বরে দুটি গ্রেড পড়েছে।". Colours: pass bands cycle `bg-chart-5`, `bg-chart-2`, `bg-chart-1`, `bg-chart-3` (never `chart-4`, which equals `destructive` = gap); fail bands `bg-text-secondary`; overlap hatch uses `var(--color-destructive)` / `var(--color-muted)` (the old names do not exist). Keep the three `data-testid`s. | D27; state visible; bug |
| 4 | Problems | The server's problem list is rendered from `problem.type` with translated sentences (`detail.problems.<type>`, "সারি {{row}}" when `index` is set), never `problem.message`; shown as a danger callout under the header (`role="alert"`, `rounded-lg bg-status-overdue-bg p-3 text-status-overdue-fg`, `triangle-alert`). | D9 (today English server text) |
| 5 | Band table (desktop) | Section title `h2` "গ্রেডের সারি" + help "প্রতিটি সারি একটি নম্বরের সীমা আর তার গ্রেড। ফেল গ্রেডের জিপিএ থাকে না।". Flush Card table, kit header band: সারি · শুরু (%) · শেষ (%) · গ্রেড · জিপিএ · ফেল গ্রেড · মন্তব্য (ঐচ্ছিক) · কাজ. Inputs `h-8 w-20` (comment full width), number cells end-aligned. Row delete = icon button `trash-2 text-destructive` with tooltip "সারি মুছুন" (was an underlined link). Footer: outline "সারি যোগ করুন" (`plus`) + **New** hint "শেষ সারির গ্রেডের ঘরে Enter চাপলেও নতুন সারি যোগ হয়।". | D19, D29; shortcut visible |
| 6 | Numbers in cells | From/To/GPA inputs show tenant numerals and accept ০–৯ or 0–9 (`renderDigits` / `parseNumber` from `@biddaloy/ui/utils`), `type="text" inputMode="decimal"` (was `type="number"`, Latin only). | D6 |
| 7 | Fail band | Ticking "ফেল গ্রেড" clears and disables the GPA input (placeholder "—"); unticking re-enables it. | Server rule D4 of Epic 20: a fail band has no GPA |
| 8 | Empty scale | Inside the bands section an `EmptyState` `list-plus` **New** "এখনো কোনো গ্রেড নেই" + "জাতীয় পাঠ্যক্রমের (NCTB) গ্রেড দিয়ে শুরু করে দরকারমতো বদলান, অথবা নিজে সারি যোগ করুন।", action outline "NCTB-র গ্রেড বসান" (fills `NCTB_BANDS`), secondary "সারি যোগ করুন". | D28 |
| 9 | Leave guard | **New**: `useBlocker` while dirty → `ConfirmDialog tone="danger"` "সংরক্ষণ না করে চলে যাবেন?" / "গ্রেডের পরিবর্তনগুলো এখনো সংরক্ষিত হয়নি, চলে গেলে হারিয়ে যাবে।" / "থাকুন" / "তবুও চলে যান". | Unsaved edits were lost silently |
| 10 | Recompute dialog | `size="sm"`; impact sentence as a warning callout when `count > 0`; **New** help "সংরক্ষণের আগে অতিরিক্ত অনুমোদন চাওয়া হতে পারে।"; the error line always `recomputePreview.errorMessage` (today it prints `error.message`, a server string); confirm label "সংরক্ষণ করুন". | D9, D21 |
| 11 | Copy dialog | `size="sm"`; labels tied to controls ("কোন শিক্ষাবর্ষে", "কোন শ্রেণিতে"); class default "সব শ্রেণি"; the occupied check runs **as soon as** year/class are picked (warning line under the fields, Copy disabled) instead of after clicking; `useAcademicYears({ limit: 100 })` (same B13 cause). | D21, D25, B13 |
| 12 | Loading | Detail-shaped skeleton: crumb bar, `h-7 w-64` title, three `w-24` fact bars, an `h-24` card, an `h-64` card; `aria-busy`. | D28 |

## Mobile behaviour
- Header: facts in a 2-column grid; "সংরক্ষণ করুন" full width + "আরও অ্যাকশন" (copy goes into More).
- Coverage card full width; grade letters under the bar stay one line (narrow bands may truncate a two-letter grade).
- Each band is a Card: title "A+ · ৮০–১০০%" + 44 px delete; a 2-column grid শুরু (%) / শেষ (%) / গ্রেড / জিপিএ (`h-11`); checkbox row "ফেল গ্রেড"; মন্তব্য (ঐচ্ছিক) full width. "সারি যোগ করুন" is a full-width outline button under the cards. The Enter hint is hidden.
- The bottom bar marks "আরও".

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Save placement | bottom of page (today) / header | header primary, disabled until dirty | One primary, visible without scrolling; disabled says "nothing to save". The problems callout sits right under it. |
| Phone rows | horizontal-scroll table / cards | cards | 7 inputs per row cannot fit 390 px; cards keep each field labelled and 44 px. |
| Numerals in inputs | keep `type=number` / text + parse | text + `parseNumber` with a per-cell draft string | D6 everywhere; a draft string lets "3." be typed on the way to "3.5". |
| Problem text | show server message / translate by type | translate by `type` (+ row from `index`) | D9; the 8 types are a closed union (`server/src/modules/grading/band-validation.ts`). |
| Leave guard | none / blocker | blocker + ConfirmDialog | Losing seven typed rows on a sidebar click is data loss. Same pattern as marks-1's grid. |

## Files
- `client-admin/src/routes/_staff/grading-scales/$scaleId.tsx` — header + facts, save/dirty, problems, empty state, blocker, skeleton
- `client-admin/src/routes/_staff/grading-scales/$scaleId.test.tsx` — updated
- `client-admin/src/routes/_staff/grading-scales/-band-editor.tsx` — kit table, phone cards, numerals, fail→GPA, delete icon, hint
- `client-admin/src/routes/_staff/grading-scales/-band-editor.test.tsx` — updated
- `client-admin/src/routes/_staff/grading-scales/-band-editor.stories.tsx` — add an "empty" and a "phone" story
- `client-admin/src/routes/_staff/grading-scales/-coverage-bar.tsx` — card, letters, icons, colours, CSS vars
- `client-admin/src/routes/_staff/grading-scales/-coverage-bar.test.tsx` — updated
- `client-admin/src/routes/_staff/grading-scales/-copy-scale-dialog.tsx` — size, labels, live occupied check, year limit
- `client-admin/src/routes/_staff/grading-scales/-copy-scale-dialog.test.tsx` — updated
- `client-admin/src/routes/_staff/grading-scales/-recompute-preview-dialog.tsx` — size, callout, error text
- `client-admin/src/routes/_staff/grading-scales/-recompute-preview-dialog.test.tsx` — updated
- `e2e/keyboard/grading-scales.spec.ts` — Save is now before the table in tab order (also changed by marks-4a, runs earlier)
- `ui/src/i18n/locales/en/grading.json` — `detail`, `bandEditor`, `coverageBar`, `copyDialog`, `recomputePreview` (also changed by marks-1/2/3/4a)
- `ui/src/i18n/locales/bn/grading.json` — same

## Steps
1. **Locale (`grading.json`, en / bn).**
   - `detail`: add `facts.academicYear` "Academic year" / "শিক্ষাবর্ষ", `facts.appliesTo` "Applies to" / "কোন শ্রেণির জন্য", `facts.grades` "Grades" / "গ্রেড"; `copy` → "Copy to another class or year" / "অন্য শ্রেণি বা বর্ষে কপি করুন"; `startFromNctb` → "Use NCTB grades" / "NCTB-র গ্রেড বসান"; add `emptyTitle` "No grades yet" / "এখনো কোনো গ্রেড নেই", `emptyText` "Start from the national curriculum (NCTB) grades and change what you need, or add rows yourself." / "জাতীয় পাঠ্যক্রমের (NCTB) গ্রেড দিয়ে শুরু করে দরকারমতো বদলান, অথবা নিজে সারি যোগ করুন।"; `problemsHeading` → "This scale can't be saved yet:" / "এই পদ্ধতি এখনো সংরক্ষণ করা যাবে না:"; add `problems.empty` "Add at least one row." / "অন্তত একটি সারি যোগ করুন।", `problems.out_of_range` "Row {{row}}: the range must be between 0 and 100." / "সারি {{row}}: সীমা ০ থেকে ১০০-এর মধ্যে হতে হবে।", `problems.inverted` "Row {{row}}: “from” is larger than “to”." / "সারি {{row}}: শুরুর নম্বর শেষের চেয়ে বড়।", `problems.duplicate_sequence` "Row {{row}} repeats another row's position." / "সারি {{row}}-এর ক্রম অন্য সারির সাথে মিলে গেছে।", `problems.missing_zero` "The lowest row must start at 0." / "সবচেয়ে নিচের সারি ০ থেকে শুরু হতে হবে।", `problems.missing_hundred` "The highest row must end at 100." / "সবচেয়ে উপরের সারি ১০০-তে শেষ হতে হবে।", `problems.gap` "Some marks have no grade — see the red part of the bar." / "কিছু নম্বরের গ্রেড নেই — বারের লাল অংশ দেখুন।", `problems.overlap` "Some marks have two grades — see the striped part of the bar." / "কিছু নম্বরে দুটি গ্রেড পড়েছে — বারের ডোরাকাটা অংশ দেখুন।", `problems.unknown` "Something in the rows is not right. Check them and try again." / "সারিগুলোতে কোথাও ভুল আছে। দেখে আবার চেষ্টা করুন।"; add `leaveTitle` "Leave without saving?" / "সংরক্ষণ না করে চলে যাবেন?", `leaveText` "Your grade changes are not saved yet and will be lost." / "গ্রেডের পরিবর্তনগুলো এখনো সংরক্ষিত হয়নি, চলে গেলে হারিয়ে যাবে।", `stay` "Stay" / "থাকুন", `leave` "Leave anyway" / "তবুও চলে যান".
   - `bandEditor`: add `title` "Grade rows" / "গ্রেডের সারি", `help` "Each row is a range of marks and its grade. A fail grade has no GPA." / "প্রতিটি সারি একটি নম্বরের সীমা আর তার গ্রেড। ফেল গ্রেডের জিপিএ থাকে না।", `columnRow` "Row" / "সারি"; `columnFrom` → "From (%)" / "শুরু (%)"; `columnTo` → "To (%)" / "শেষ (%)"; `columnFail` → "Fail grade" / "ফেল গ্রেড"; `columnComment` → "Comment (optional)" / "মন্তব্য (ঐচ্ছিক)"; `columnActions` bn → "কাজ"; `delete` → "Delete row" / "সারি মুছুন"; `addBand` → "Add row" / "সারি যোগ করুন"; add `cellLabel` "Row {{row}} — {{column}}" / "সারি {{row}} — {{column}}", `cardTitle` "{{grade}} · {{from}}–{{to}}%" (same in bn), `enterHint` "Press <k>Enter</k> in the last row's grade to add a row." / "শেষ সারির গ্রেডের ঘরে <k>Enter</k> চাপলেও নতুন সারি যোগ হয়।".
   - `coverageBar`: add `title` "0 to 100% — which marks get which grade" / "০ থেকে ১০০% — কোন নম্বরে কোন গ্রেড"; `label` → "Grade ranges from 0 to 100 percent" / "০ থেকে ১০০ শতাংশ পর্যন্ত গ্রেডের ভাগ"; `hasGaps` → "Marks in red have no grade." / "লাল অংশের নম্বরের কোনো গ্রেড নেই।"; `hasOverlaps` → "Striped marks have two grades." / "ডোরাকাটা অংশের নম্বরে দুটি গ্রেড পড়েছে।"; `complete` → "Every mark from 0 to 100 has exactly one grade." / "০ থেকে ১০০ পর্যন্ত প্রতিটি নম্বরের একটি করে গ্রেড আছে।".
   - `copyDialog`: `title` → "Copy grading scale" / "গ্রেডিং পদ্ধতি কপি করুন"; `description` bn → "„{{name}}“-এর গ্রেডগুলো অন্য শ্রেণি বা বর্ষে কপি হবে।"; `academicYearLabel` → "To academic year" / "কোন শিক্ষাবর্ষে"; `classLabel` → "To class" / "কোন শ্রেণিতে"; `yearDefault` → "All classes" / "সব শ্রেণি"; `willCreate_*` bn → "{{count}}টি গ্রেড কপি হবে।" (en "{{count}} grade(s) will be copied."); `occupiedError` → "That class already has grades for this year. Open it to change them." / "ওই শ্রেণির এই বর্ষে আগে থেকেই গ্রেড আছে। বদলাতে চাইলে সেটি খুলুন।"; `errorMessage` bn → "কপি করা যায়নি। আবার চেষ্টা করুন।".
   - `recomputePreview`: `impact_*` bn → "{{count}} জন শিক্ষার্থীর ফলাফল নতুন গ্রেড অনুযায়ী আবার হিসাব হবে।"; `noImpact` bn → "এই পদ্ধতি এখনো কোনো ফলাফলে ব্যবহার হয়নি — কিছু আবার হিসাব হবে না।"; add `approvalHint` "You may be asked for extra approval before saving." / "সংরক্ষণের আগে অতিরিক্ত অনুমোদন চাওয়া হতে পারে।"; `confirm` → "Save" / "সংরক্ষণ করুন".
2. **`$scaleId.tsx` — header.** Load names: `useAcademicYears({ limit: 100 })`, `useClasses()`; facts values = year name / class name / `t('list.yearDefault')` for no class / `formatNumber(bands.length)` + "টি" via `t('list.bandCount', …)` from marks-4a (Skeleton `h-3 w-16` while pending, "—" if not found). Render `<DetailShell name={scale.name} facts={…} actions={[{ id: 'copy', label: t('detail.copy'), icon: <Copy />, onClick: () => setCopyOpen(true), allowed: canManage }, { id: 'save', label: t('detail.save'), priority: 'primary', icon: <Save />, onClick: () => void handleSave(), allowed: canManage, disabled: !dirty || previewBands.isPending, busy: previewBands.isPending }]}>` (if `DetailShellAction` lacks `disabled`/`busy`, render the Save `Button` yourself in the DetailShell `actions` slot the same way marks-1 renders "জমা দিন"). `dirty = JSON.stringify(bands) !== JSON.stringify(scale.bands.map(toBandInput))`. Remove the bottom Save button and the top `h1` row.
   - `{canSeePresetBanner && <PresetWarningBanner />}` directly after the header.
   - Problems: `const problemText = (p) => t(\`detail.problems.${p.type}\`, { row: p.index === undefined ? '' : formatNumber(p.index + 1, config), defaultValue: t('detail.problems.unknown') })`; callout markup per Change 4 with a `ul` (`list-disc ps-5`). Keep `MutationErrorMessage` for network failures.
   - Bands section: `<section className="space-y-3" aria-labelledby="bands-title">` with `h2#bands-title className="text-h2"` + help `mt-1 text-text-secondary`; when `bands.length === 0` render `EmptyState` per Change 8 (`action` = NCTB fill, `secondaryAction` = append `emptyBandAfter([])` — export that helper from `-band-editor.tsx`), else `<BandEditor …/>`.
   - Blocker: `const blocker = useBlocker({ shouldBlockFn: () => dirty && !confirmedRef.current, withResolver: true })` (set `confirmedRef.current = true` in the recompute dialog's `onConfirmed` before the cache refresh resets `dirty`); `ConfirmDialog` per Change 9.
   - Skeleton per Change 12 (`aria-busy="true"`, replace the two bars).
3. **`-coverage-bar.tsx`.** Wrap in `<section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5" aria-labelledby="coverage-title">` with `h2#coverage-title className="text-h2"`. Bar `mt-4 flex h-4 w-full overflow-hidden rounded-md border border-border-subtle`. Colours: compute per covered segment the band that owns it (first band whose range contains `segment.from`); `band.is_fail ? 'bg-text-secondary' : PASS_COLORS[passIndex % 4]` with `PASS_COLORS = ['bg-chart-5', 'bg-chart-2', 'bg-chart-1', 'bg-chart-3']`. Overlap gradient → `var(--color-destructive)` / `var(--color-muted)`. Letters: a second `div` `mt-1 flex w-full text-caption font-medium text-text-secondary` (`aria-hidden`), one `span` per segment with the same `style={{ width }}`, `min-w-0 truncate text-center`, text = owning band's grade (gaps/overlaps empty). Status `p` `mt-3 flex items-center gap-1.5` with `CircleCheck`/`CircleAlert` (`size-4 shrink-0`, `text-status-paid-fg` / `text-destructive`); keep the three texts' keys. `computeSegments` signature unchanged.
4. **`-band-editor.tsx`.** Add `function NumberCell({ value, onValue, label, disabled, className })`: `const { numerals } = useRegionConfig(); const [draft, setDraft] = useState<string | null>(null); const shown = draft ?? (value === null || value === undefined ? '' : renderDigits(String(value), numerals));` `onChange`: `setDraft(raw)`; if `raw.trim() === ''` → `onValue(null)`; else `try { onValue(parseNumber(raw)) } catch { /* keep draft, wait for more input */ }`; `onBlur` → `setDraft(null)`. `<Input type="text" inputMode="decimal" className="w-20 text-end tabular-nums" …/>`. For from/to, `null` → keep the previous number (they are required).
   - Desktop (`hidden md:block`): flush Card (`overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1`) + kit `Table` header band; columns per Change 5; every input `aria-label={t('bandEditor.cellLabel', { row: formatNumber(i + 1), column })}`; fail = `Checkbox`; delete = icon `Button variant="ghost" size="icon"` `Trash2` `text-destructive` with `Tooltip` "সারি মুছুন" and the cell label as `aria-label`. Footer `flex items-center justify-between gap-4 border-t border-border-subtle px-4 py-3`: outline "সারি যোগ করুন" + `Trans` hint (`<kbd className="rounded-sm border border-border-subtle bg-muted px-1 font-sans" />`).
   - Phone (`md:hidden`): `ul space-y-3`, one Card per band per Mobile behaviour (`h3 text-h3` with `cardTitle`, inputs `h-11` via `NumberCell className="w-full"`, `Label htmlFor` ids `band-${sequence}-from` …), then a full-width outline "সারি যোগ করুন".
   - Fail rule: `onCheckedChange={(c) => updateBand(i, c === true ? { is_fail: true, gpa: null } : { is_fail: false })}`; GPA `disabled={band.is_fail}` with `placeholder="—"`.
   - Keep `emptyBandAfter`, Enter-on-last-row, and the DOM tab order (from → to → grade → gpa → fail → comment → delete). Export `emptyBandAfter`.
   - Render only one of the two layouts with `useIsMobile()` (the same switch marks-1 uses) so tests and keyboard order see one set of inputs.
5. **`-copy-scale-dialog.tsx`.** `useAcademicYears({ limit: 100 })`; `size="sm"`, `closeLabel`; `Label htmlFor` + trigger ids; `occupied = targetScale !== undefined && targetScale.bands.length > 0` computed on render → warning line (kit Error text, `role="alert"`) and `disabled={occupied || isPending}` on Copy; drop `occupiedError` state. Exports/props unchanged.
6. **`-recompute-preview-dialog.tsx`.** `size="sm"`; when `affectedResultCount > 0` render the impact as `<p className="flex gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg"><TriangleAlert className="size-4 shrink-0" />…</p>` in the body (description = `noImpact` only when 0); `approvalHint` as help text; error line always `t('recomputePreview.errorMessage')`. Keep the pinned-open logic.
7. **`e2e/keyboard/grading-scales.spec.ts`.** Save now sits in the header, before the table: in the save step use `tabUntilFocused(page, t('grading.detail.save'), 90, { tag: 'BUTTON', shift: true })`. The NCTB button is found by the same key (now inside the empty state). Update the comments that count cells.
8. Run `pnpm --filter client-admin test grading-scales/`, `pnpm --filter @biddaloy/ui check:i18n`, the e2e spec locally if possible (`biddaloy_local_e2e_recipe`), then `graphify update .`.

## Tests
- `$scaleId.test.tsx` — header shows the year and class names as facts; Save is disabled before any edit and enabled after one; a problem of type `gap` renders the translated sentence and **not** the mocked `message` text; `inverted` with `index: 2` says "Row 3"; an empty scale shows "No grades yet" and "Use NCTB grades" fills 7 rows; navigating away with an edit opens "Leave without saving?"; keep the existing preset-banner tests.
- `-band-editor.test.tsx` — existing behaviours stay (Enter appends, delete leaves the gap, GPA clear → null, comment clear → null, Add row) with the new labels ("Row 1 — From (%)", "Add row", "Delete row"); typing "৮৫" in From stores `85`; ticking "Fail grade" sets `gpa: null` and disables the GPA input.
- `-coverage-bar.test.tsx` — segment tests unchanged; the complete state renders the success icon text; a fail band's segment has `bg-text-secondary`; no segment uses `bg-chart-4`.
- `-copy-scale-dialog.test.tsx` — the occupied warning shows right after picking an occupied target and Copy is disabled (replace the click-then-error flow); fields found by label.
- `-recompute-preview-dialog.test.tsx` — a thrown `Error('raw server text')` shows the translated error, not "raw server text"; the approval tests stay.
- `-band-editor.stories.tsx` — add `Empty` (no bands) and `Phone` (`parameters.viewport` 390) stories.
- `e2e/keyboard/grading-scales.spec.ts` — run.

## Acceptance
- [ ] Desktop at 1440 px matches the "after — editor" screenshot.
- [ ] Mobile at 390 px matches the "after — editor" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view ("সংরক্ষণ করুন" in the header; the dialogs' own confirm).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The header names the year and class; Save is in the header and disabled until a change.
- [ ] Problems are Bangla/English sentences from the locale, never the server message.
- [ ] Cells show tenant numerals and accept both digit systems; a fail row's GPA is disabled.
- [ ] The overlap hatch is visible (striped red) and no pass band is the same red as a gap.
- [ ] Leaving with unsaved rows asks first.

## Out of scope
- The last crumb of this page is the raw `$scaleId` (no `gradingScaleDetail` resolver) — filed (`use-breadcrumbs.ts`).
- `PresetWarningBanner` look — owned by its own component file; only placed here.
- Renaming a scale (`useUpdateGradingScale` exists, no UI) — not added (D1).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| crumb resolver: scale name | Accepted | 31.3.5 | resolver key gradingScaleDetail -> name from gradingScaleQueryOptions(id) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: marks   Decisions: D6, D9, D15, D16, D19, D21, D25, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.marks-4a
