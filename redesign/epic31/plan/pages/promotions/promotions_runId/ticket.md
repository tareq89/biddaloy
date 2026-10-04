# [31.4.promotions-2] Promotion list detail — kit header, clickable decisions, safe delete

## Goal
`/promotions/$runId` matches the "after" screenshots: a `DetailShell` header with facts and one filled "চূড়ান্ত করুন", the counts as status badges, placement problems explained in one alert card, a kit table where the final decision is a real select (mouse and keyboard), no raw codes, and "তালিকা মুছুন" behind a confirm.

## What and why
This is where the admin checks the system's suggestion for every student (promote, keep in class, graduate), changes the few that need it with a reason, and finalises the list. Today the desktop "final" cell is a focusable box that only reacts to the P/R/G keys — a mouse user cannot change a decision at all; placement problems print the raw code `OVER_CAPACITY`; counts are plain "label: n" text; the commit button's label carries "(Ctrl+Enter)"; a missing class name falls back to its UUID; and "রান মুছুন" deletes the draft immediately although a confirm text already exists in the namespace. The redesign keeps every behaviour (keyboard model, debounced notes, flush-before-commit, stale/cohort handling) and puts it into kit patterns.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions_runId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/promotions/promotions_runId/mobile.webp?raw=true" width="260"> |

The "after" shots show a draft with one placement problem and one decision changed by hand.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `DetailShell` (no tabs): name `{source} → {target}`, StatusBadge খসড়া (neutral) / চূড়ান্ত (success); crumbs "প্রমোশন › প্রমোশন তালিকা" come from the layout. The sticky band goes. | D16, kit DetailHeader |
| 2 | Facts | নতুন শিক্ষাবর্ষ, গড় করা পরীক্ষা "২টি", বিন্যাস পদ্ধতি, শিক্ষার্থী "৪২ জন". Finalised lists add চূড়ান্ত করার তারিখ, চূড়ান্ত করেছেন, অনুমোদন করেছেন (when set) — replacing the grey read-only banner and the `runSummary` line. | D16; the banner repeated the facts |
| 3 | Actions (draft, `PROMOTION_MANAGE`) | outline "ফলাফল থেকে হালনাগাদ" (`rotate-ccw`, was "রিফ্রেশ"), filled "চূড়ান্ত করুন" (`circle-check`, no shortcut text in the label), More → "তালিকা মুছুন" (destructive) opening `ConfirmDialog tone="danger"` with the existing `grid.deleteConfirm.*` texts. **New** confirm step. | D16, D29; delete was one click with no way back |
| 4 | Counts | One `role="status"` row of StatusBadges: উত্তীর্ণ n (success), অপরিবর্তিত n (warning), গ্র্যাজুয়েট n (neutral), নিজে বদলানো n (info), সমস্যা n (danger when > 0, neutral at 0). Numbers via `formatNumber`. | D6, D27 |
| 5 | Problem / stale / cohort messages | One alert Card each (Card + `bg-status-overdue-bg` icon well + `h2 text-h3` + sentence): placement problems "চূড়ান্ত করার আগে nটি সমস্যা ঠিক করুন" (**New**); stale results keeps its text + outline "ফলাফল থেকে হালনাগাদ"; cohort changed keeps its text. | D28 look, one place to read why Finalise is blocked |
| 6 | Table frame | Card `overflow-hidden`, kit `thead`/rows; footer "মোট ৪২ জন · কীবোর্ডে: …" (**New** hint, carries the Ctrl+Enter tip removed from the button). | D19 |
| 7 | Columns | মেধাক্রম (end) · শিক্ষার্থী (name + "রোল n" caption) · গড় জিপিএ (**New**, `mean_gpa`, end, 2 decimals) · প্রস্তাব · চূড়ান্ত সিদ্ধান্ত · গ্রুপ (only when the school has groups, **New** rule) · নতুন শাখা ও রোল (`ক · ১২`, or a danger badge with the problem, or `—`) · কেন বদলালেন. The separate "লক্ষ্য শাখা", "নতুন রোল" and "বিন্যাস ত্রুটি" columns merge into one. | Fewer, readable columns |
| 8 | Final decision cell | A kit `Select` (উত্তীর্ণ / অপরিবর্তিত / গ্র্যাজুয়েট), clickable; P/R/G and ↑/↓/→ still work on the focused trigger. "নিজে বদলানো" info badge under it when it differs from the suggestion. Finalised lists show plain text. | Mouse users could not change a decision |
| 9 | Reason input | `Input` (not a raw `<input>`), shown only on rows changed by hand, placeholder "কেন বদলালেন?"; other rows show `—`. Error text under it as today. | D25; 40 empty disabled boxes were noise |
| 10 | Placement problem text | `OVER_CAPACITY` → "শাখায় জায়গা নেই", `NO_ELIGIBLE_SECTION` → "মানানসই কোনো শাখা নেই", unknown → "শাখা ঠিক করা যায়নি". | D9 |
| 11 | Names, never ids | Classes from `useAllClasses()`, years from `useAcademicYears({ limit: 100 })`, users via `useUser`; loading → `Skeleton`, unknown → `—`. | D9 |
| 12 | Commit dialog | `DialogContent size="sm"`; Cancel outline (was ghost); counts in the body via `formatNumber`; blocked reasons unchanged. | D21, D29 |
| 13 | Load error | `ErrorState` with its own sentence "প্রমোশন তালিকাটি লোড করা যায়নি।" (**New** key) and Retry, instead of the list page's message. | D28 |

## Mobile behaviour
- Header: crumbs, name + badge, facts 2×2, then "চূড়ান্ত করুন" (`flex-1`) + More (holds "ফলাফল থেকে হালনাগাদ" and "তালিকা মুছুন").
- Count badges wrap onto two lines; alert cards full width.
- One student at a time (existing stepper, `-entry-card.tsx`) in a Card: outline icon buttons ‹ › (44 px) around "৪২ জনের মধ্যে ৫ নম্বর"; name `h2` + "নিজে বদলানো" badge; `dl` of রোল, মেধাক্রম, গড় জিপিএ, প্রস্তাব, নতুন শাখা ও রোল; "চূড়ান্ত সিদ্ধান্ত" as three whole-row radio options (no more three filled/outline buttons); গ্রুপ select when groups exist; "কেন বদলালেন" input with a required mark on a changed row.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Final cell control | keyboard-only box · segmented buttons · `Select` | `Select` with the existing key handlers on its trigger | Kit pattern; Radix skips its own key handler when ours calls `preventDefault()`, so P/R/G and arrow navigation keep working and `e2e/keyboard/promotion.spec.ts` (finds it by label `grid.columnFinal`) needs no change. |
| Sticky header | keep sticky band · normal DetailShell | normal `DetailShell` | Kit has no sticky detail header; Finalise sits at the top and Ctrl+Enter works from anywhere. |
| Phone layout | full list of cards · keep stepper | keep the stepper, restyled | Matches the marks-entry stepper it was cloned from; 40 cards each with a select and a text box is long and error-prone. |
| Reason input on unchanged rows | disabled input · `—` | `—` | Nothing to type there; the input appears the moment the decision changes, and focus already jumps to it. |
| Delete confirm | none · `ConfirmDialog` | `ConfirmDialog tone="danger"` | The `deleteConfirm` keys existed but were never used; deleting a draft cannot be undone. |

## Files
- `client-admin/src/routes/_staff/promotions/$runId.tsx` — DetailShell header/facts/actions, counts, alert cards, table, Select cell, delete confirm, names
- `client-admin/src/routes/_staff/promotions/$runId.test.tsx` — update assertions
- `client-admin/src/routes/_staff/promotions/-entry-card.tsx` — phone card restyle, radio options, `Input`
- `client-admin/src/routes/_staff/promotions/-commit-dialog.tsx` — size, outline Cancel, formatted counts
- `client-admin/src/routes/_staff/promotions/-commit-dialog.test.tsx` — Cancel variant / counts
- `ui/src/i18n/locales/bn/promotions.json`, `ui/src/i18n/locales/en/promotions.json` — keys below (also changed by promotions-1, runs earlier)

## Steps
1. **Data.** `useClasses({})` → `useAllClasses()`; `useAcademicYears()` → `useAcademicYears({ limit: 100 })`. Replace every `?? run.source_class_id` / `?? row.target_class_id` / `?? run.target_academic_year_id` / `?? run.committed_by_user_id` fallback with a `Skeleton className="h-4 w-24"` while the query loads and `t('list.emptyValue')` otherwise.
2. **Load/error.** `ErrorState message={t('grid.loadError')} retryLabel={t('actions.retry', { ns: 'common' })}`.
3. **Header.** Replace the sticky `<div>` with `<DetailShell name={`${sourceClassName} → ${targetClassName}`} statusBadge={<StatusBadge tone={readOnly ? 'success' : 'neutral'} label={t(readOnly ? 'list.statusCommitted' : 'list.statusDraft')} />} facts={facts} actions={actions}>` and render the rest of the page as its children (or directly after it if `DetailShell` takes no children — check its props).
   - `facts`: `[{ label: t('grid.facts.targetYear'), value: targetYearName }, { label: t('grid.facts.exams'), value: t('grid.facts.examCount', { count: run.exam_ids.length }) }, { label: t('grid.facts.algorithm'), value: algorithmLabel }, { label: t('grid.facts.students'), value: t('grid.facts.studentCount', { count: entries.length }) }]`, plus when `readOnly`: `committedAt` (`formatDate(run.committed_at, config)`), `committedBy` (user name), and `approvedBy` only when `run.approved_by_user_id`.
   - `actions` (only when `!readOnly && canManage`): `{ id: 'refresh', label: refreshRun.isPending ? t('grid.refreshing') : t('grid.refresh'), icon: <RotateCcwIcon />, priority: 'secondary', onClick: () => void refresh() }`, `{ id: 'commit', label: t('grid.commit'), icon: <CircleCheckIcon />, priority: 'primary', onClick: () => setCommitOpen(true) }`, `{ id: 'delete', label: t('grid.delete'), icon: <Trash2Icon />, priority: 'destructive', onClick: () => setDeleteOpen(true) }`.
   - Delete: `<ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} tone="danger" title={t('grid.deleteConfirm.title')} description={t('grid.deleteConfirm.body')} confirmLabel={t('grid.deleteConfirm.confirm')} cancelLabel={t('grid.deleteConfirm.cancel')} busy={deleteRun.isPending} onConfirm={deleteDraft} />`.
4. **Counts.** `<div role="status" aria-label={t('grid.countsLabel')} className="flex flex-wrap gap-2">` with five `StatusBadge tone=… label={t('grid.countBadge', { label: t('grid.counts.promoted'), count: formatNumber(counts.promoted, config) })}`; tones per Change 4.
5. **Alert cards.** A small local component `AlertCard({ title, body, action })`: `<section role="alert" className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">` + `<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-overdue-bg text-status-overdue-fg"><TriangleAlertIcon /></span>` + `h2 className="text-h3"` + `p className="text-text-secondary"` + optional action. Render: errors (`!readOnly && counts.errors > 0`: title `grid.errorsTitle` with count, body `grid.errorsBody`); `staleBanner` (title `grid.staleResultsPrompt`, action outline refresh button); `cohortChangedBanner` (title `grid.cohortChangedPrompt`, no body).
6. **Table** (desktop branch). Wrap in `<section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"><div className="overflow-x-auto"><table className="w-full text-start">`; `thead className="border-b border-border-subtle bg-muted text-label text-text-secondary"`, `th className="h-10 px-4 font-medium"` (`text-end` for rank and GPA); `tbody className="divide-y divide-border-subtle"`, rows `hover:bg-muted`, cells `px-4 py-1.5`. Drop the sticky first column. Columns per Change 7:
   - GPA: `entry.mean_gpa !== null ? formatNumber(Number(entry.mean_gpa), config, { decimals: 2 }) : t('list.emptyValue')`.
   - Student: `<span className="font-medium">{entry.student_name}</span><span className="block text-caption text-text-secondary">{t('grid.studentRoll', { roll: formatNumber(entry.student_roll_number, config) })}</span>`.
   - Group column only when `groups.length > 0` (header and cells).
   - Placement cell: if `!override && eff.final_outcome === 'PROMOTE' && entry.placement_error` → `<StatusBadge tone="danger" label={t(`grid.placementError.${entry.placement_error}`, { defaultValue: t('grid.placementError.unknown') })} />`; else if PROMOTE → `` `${sectionName} · ${formatNumber(entry.new_roll_number, config)}` `` (either part `—` when null); else `—`.
   - Footer: `<p className="border-t border-border-subtle px-4 py-3 text-text-secondary">{t('grid.footerHint', { count: formatNumber(entries.length, config) })}</p>` (hide the keyboard part when `readOnly` — use `grid.footerTotal` then).
7. **Final decision cell.** Replace the `role="button"` div with `<Select value={eff.final_outcome} onValueChange={(v) => setOutcome(entry, v as PromotionOutcome)}>` + `<SelectTrigger ref={…same focusRefs key `outcome:${id}`…} aria-label={t('grid.columnFinal')} className="w-36" onKeyDown={(e) => handleOutcomeKeyDown(e, entry, rowIndex)}>` + three `SelectItem`s labelled `t(OUTCOME_KEY[o])`. `handleOutcomeKeyDown` already calls `preventDefault()` for the keys it handles — keep that; change its event type to `React.KeyboardEvent<HTMLButtonElement>`. Under the trigger, when `override`: `<StatusBadge tone="info" label={t('grid.overrideChip')} className="mt-1" />`. When `readOnly`: render `t(OUTCOME_KEY[eff.final_outcome])` as text instead of the Select.
8. **Reason cell.** When `override` (and not `readOnly`): `<Input ref={…note key…} aria-label={t('grid.columnOverrideNote')} placeholder={t('grid.notePlaceholder')} value={eff.override_note ?? ''} onChange onBlur …/>` + the existing error `<p role="alert">` with error-text classes. When `readOnly`: the note as text or `—`. Otherwise `—`. `setOutcome` still focuses `note:${id}` in `requestAnimationFrame`; if the input is not mounted yet at that moment, move the focus into a `useEffect` keyed on a `focusNoteFor` state set by `setOutcome`.
9. **`-entry-card.tsx`.** Card classes; header row `flex items-center justify-between gap-2`: outline icon buttons (`size-11`, `ChevronLeftIcon`/`ChevronRightIcon`, `aria-label` = `stepper.previous` / `stepper.next`) around `stepper.progress`. Then `h2 text-h2` name + override badge, `dl mt-3 grid grid-cols-2 gap-x-4 gap-y-2` (roll, rank, GPA, suggested, placement full width — same placement rule as step 6). Outcome: `RadioGroup aria-label={t('grid.columnFinal')}` with three `<label className="flex min-h-11 items-center gap-3">` rows divided by `divide-y divide-border-subtle` (replaces the three Buttons). Group `Select` only when `groups.length > 0`, with a visible `Label`. Note: `Label` + `Input` (not `<input>`), required mark when `override`. The component receives `config` (RegionConfig) as a new prop for `formatNumber`.
10. **`-commit-dialog.tsx`.** `<DialogContent size="sm">`; Cancel `variant="outline"`; pass counts through `formatNumber` (new `config` prop) before interpolation.
11. **i18n** (`promotions.json`, bn / en):
    - change `grid.refresh`: "ফলাফল থেকে হালনাগাদ" / "Update from results"; `grid.refreshing`: "হালনাগাদ হচ্ছে…" / "Updating…"
    - change `grid.columnStudent`: "শিক্ষার্থী" / "Student"; `grid.columnSuggested`: "প্রস্তাব" / "Suggested"; `grid.columnFinal`: "চূড়ান্ত সিদ্ধান্ত" / "Final decision"; `grid.columnOverrideNote`: "কেন বদলালেন" / "Why changed"
    - add `grid.columnPlacement`: "নতুন শাখা ও রোল" / "New section and roll"; delete `grid.columnTargetSection`, `grid.columnNewRoll`, `grid.columnPlacementError`
    - change `grid.overrideChip` and `grid.counts.overrides`: "নিজে বদলানো" / "Changed by hand"; `grid.counts.errors`: "সমস্যা" / "Problems"
    - change `grid.noteRequired`: "নিজে বদলালে কারণ লেখা আবশ্যক।" / "Write why you changed it."
    - add `grid.notePlaceholder`: "কেন বদলালেন?" / "Why did you change it?"
    - add `grid.studentRoll`: "রোল {{roll}}" / "Roll {{roll}}"
    - add `grid.placementError.OVER_CAPACITY`: "শাখায় জায়গা নেই" / "No room in any section"; `.NO_ELIGIBLE_SECTION`: "মানানসই কোনো শাখা নেই" / "No matching section"; `.unknown`: "শাখা ঠিক করা যায়নি" / "Could not place in a section"
    - add `grid.errorsTitle`: "চূড়ান্ত করার আগে {{count}}টি সমস্যা ঠিক করুন" / "Fix {{count}} problem(s) before finalising"; `grid.errorsBody`: "লাল চিহ্ন দেওয়া শিক্ষার্থীদের নতুন শ্রেণির কোনো শাখায় বসানো যায়নি। শাখার ধারণক্ষমতা বাড়িয়ে ফলাফল থেকে হালনাগাদ করুন, অথবা তাদের সিদ্ধান্ত বদলান।" / "Students marked in red could not be placed in any section of the next class. Raise the section capacity and update from results, or change their decision."
    - add `grid.countsLabel`: "সারসংক্ষেপ" / "Summary"; `grid.countBadge`: "{{label}} {{count}}" (both)
    - add `grid.footerHint`: "মোট {{count}} জন · কীবোর্ডে: সিদ্ধান্তের ঘরে P, R বা G চাপুন, ↑ ↓ দিয়ে সারি বদলান, Ctrl+Enter দিয়ে চূড়ান্ত করুন।" / "{{count}} students · Keyboard: press P, R or G on a decision, ↑ ↓ to move between rows, Ctrl+Enter to finalise."; `grid.footerTotal`: "মোট {{count}} জন" / "{{count}} students"
    - add `grid.facts.targetYear`: "নতুন শিক্ষাবর্ষ" / "Next academic year"; `grid.facts.exams`: "গড় করা পরীক্ষা" / "Exams averaged"; `grid.facts.examCount`: "{{count}}টি" / "{{count}}"; `grid.facts.algorithm`: "বিন্যাস পদ্ধতি" / "Placement"; `grid.facts.students`: "শিক্ষার্থী" / "Students"; `grid.facts.studentCount`: "{{count}} জন" / "{{count}}"; `grid.facts.committedAt`: "চূড়ান্ত করার তারিখ" / "Finalised on"; `grid.facts.committedBy`: "চূড়ান্ত করেছেন" / "Finalised by"; `grid.facts.approvedBy`: "অনুমোদন করেছেন" / "Approved by"
    - add `grid.loadError`: "প্রমোশন তালিকাটি লোড করা যায়নি।" / "Couldn't load this promotion list."
    - change `stepper.progress`: "{{total}} জনের মধ্যে {{current}} নম্বর" / "{{current}} of {{total}}"; `stepper.previous`: "আগের শিক্ষার্থী" / "Previous student"; `stepper.next`: "পরের শিক্ষার্থী" / "Next student"
    - delete `grid.readOnlyBanner`, `grid.runSummary`, `grid.commitShortcutHint`
    - change the remaining "ওভাররাইড" wording, **bn only** (en stays — `students/-detail/promotion-override-badge.test.tsx:99`, students lane, asserts the en text): `overrideNote`: "সিস্টেমের প্রস্তাব নিজে বদলানো হয়েছে — কারণ লেখা আবশ্যক।"; `badge.promote`: "নিজে বদলে উত্তীর্ণ, {{year}}: {{note}} — {{user}}"; `badge.retain`: "নিজে বদলে অপরিবর্তিত, {{year}}: {{note}} — {{user}}"; `badge.graduate`: "নিজে বদলে গ্র্যাজুয়েট, {{year}}: {{note}} — {{user}}"

## Tests
- `$runId.test.tsx`: the final cell is a combobox named "চূড়ান্ত সিদ্ধান্ত"; picking "অপরিবর্তিত" with the mouse sends the PATCH and shows the "নিজে বদলানো" badge and a reason input; pressing `r` on the focused trigger still does the same and focuses the reason input (existing assertion); a row with `placement_error: 'OVER_CAPACITY'` shows "শাখায় জায়গা নেই" and the alert card "চূড়ান্ত করার আগে ১টি সমস্যা ঠিক করুন"; the text `OVER_CAPACITY` is nowhere; the filled header button is "চূড়ান্ত করুন" with no "Ctrl+Enter" in its name; "তালিকা মুছুন" opens a confirm and `DELETE` fires only after confirming; a finalised run shows the "চূড়ান্ত করেছেন" fact and no Select; a class missing from the classes response renders "—", never the id; with no vocabulary groups there is no "গ্রুপ" column. Phone (`matchMedia` mocked): outcome options are radios; ‹ › buttons are named "আগের শিক্ষার্থী" / "পরের শিক্ষার্থী".
- `-commit-dialog.test.tsx`: Cancel is an outline button; counts render in Bangla digits.
- E2E: `e2e/keyboard/promotion.spec.ts:183-190` (focus by label `grid.columnFinal`, press `r`, reason input focused, Ctrl+Enter opens the confirm) and `:224` (h1 starts with "{class} →") keep passing — run it; no edit expected. If the h1 check fails because of the arrow spacing, keep the name as `` `${source} → ${target}` ``.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] A decision can be changed with the mouse and with P/R/G; ↑/↓ still move between rows.
- [ ] Counts are coloured badges; placement problems read in Bangla and are explained in the alert card.
- [ ] Deleting a draft asks first; the confirm button is the only red filled button.
- [ ] No raw `<input>` remains in `$runId.tsx` or `-entry-card.tsx`.

## Out of scope
- `students/-detail/promotion-override-badge.tsx` (students lane) reads `promotions:badge.*`; only the wording in this namespace changes (step 11), not that file.
- No "before" screenshot exists for this page (the audit run had no promotion list id).
- Server-side placement messages stay codes; the page translates them.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: promotions   Decisions: D6, D9, D16, D19, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.promotions-1
