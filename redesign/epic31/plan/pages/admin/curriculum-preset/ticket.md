# [31.4.admin-2] Ready-made curriculum — Bangla names, clear blocked state

## Goal
`/curriculum-preset` speaks plain Bangla in all three states: the "already set up" state names what exists in Bangla with counts and links (no English nouns, D9), the "applied" state shows the curriculum's name and a long-form date instead of raw ids, and the pick step has one filled button per view.

## What and why
The page lets an admin load a ready-made curriculum (classes, subjects, exams, grading) into a brand-new school; it has three states — pick (3-step wizard), applied (summary) and custom (blocked). Today the blocked state shows raw server nouns inside Bangla sentences ("academic years — 2 · academic years খুলুন"), the applied state prints the preset id, a user id and a browser-locale date, and the pick cards fill the "selected" button so the step shows two filled buttons. The redesign gives the blocked state a status card plus a tidy "what already exists" list with Bangla names, icons, counts and row links; fixes the applied summary; and calms the cards.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/curriculum-preset/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/curriculum-preset/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/curriculum-preset/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/curriculum-preset/mobile.webp?raw=true" width="260"> |

The mockup shows the blocked (CUSTOM) state, the one captured. The pick and applied states are specified in Changes 6–9.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | All states | Every state renders inside one `PageContainer size="narrow"` with a `PageHeader` (title `t('title')` = "তৈরি শিক্ষাক্রম", **New** subtitle). The hand-rolled `<h1 className="text-lg font-semibold">` goes. The pick state keeps `WizardShell` (which renders the same PageHeader after 31.2.5a) and gets the subtitle too. | D15, D16 |
| 2 | CUSTOM — status card | Card with an info icon well (`bg-status-partial-bg text-status-partial-fg`), **New** `h2` "এই স্কুলে আর তৈরি শিক্ষাক্রম যোগ করা যাবে না" and a sentence that explains why and what to do (`custom.message`, rewritten). `role="status"` moves to this card. | D28 — a state needs a title and one plain sentence; today one bare line |
| 3 | CUSTOM — list | BlockedState becomes a Card titled "যা আগে থেকেই আছে" with one row per blocker: icon well, **Bangla name**, count (`formatNumber`, "২টি" / "১৮ জন"), and a `chevron-right` when the row links to its list. The whole row is the link (`min-h-12`). | D9 — "academic years" etc. are server constants; D6 numerals; D29 no underlined links outside a sentence |
| 4 | CUSTOM — mapping | Server labels map to `{ key, to?, icon }`: academic years → শিক্ষাবর্ষ `/academic-years`; classes → শ্রেণি `/classes`; subjects → বিষয় (no list route); students → শিক্ষার্থী `/students`; exams → পরীক্ষা `/exams`; grading scales → গ্রেডিং পদ্ধতি `/grading-scales`; exam templates → পরীক্ষার কাঠামো `/exams/templates` (**New** link — the route exists). Unknown label → generic "অন্যান্য রেকর্ড", no link. | D9, D32 glossary words |
| 5 | Loading / error | `CardsSkeleton` keeps its shape; ErrorState unchanged (keys exist). | D28 |
| 6 | Pick — cards | Card title `text-h3` (`h2`), board `text-text-secondary`, stages/versions `text-caption text-text-secondary`. Selected card: `border-primary ring-2 ring-primary` + a `circle-check` before the title. "বেছে নিন" stays an **outline** button in both states (selected label "বাছাই করা হয়েছে" + `check` icon, `aria-pressed`). Preview = outline. | D29 — one filled primary per view; the wizard's Next is the filled one |
| 7 | Pick — unverified | The long warning pill becomes `StatusBadge tone="warning"` with the short **New** label "যাচাই করা হয়নি", plus the existing sentence under it in `text-caption text-status-due-fg` | D27; a sentence in a nowrap pill overflows on phone |
| 8 | Applied | `applied.preset` shows the curriculum **name** (looked up in `usePresetList()` by `preset.id`, `pick(name)`; while loading or not found → the version line alone) and version; `appliedAt` uses `formatDate`; the "applied by user {{id}}" line is removed until the server sends a name (shared request); created counts use `formatNumber` | D9, D5, D6 |
| 9 | Applied — look | Card `h2 text-h2`; created counts as `dl grid grid-cols-[1fr_auto] gap-x-4 gap-y-2`, numbers `text-end tabular-nums` | kit Card |

## Mobile behaviour
- One column. Status card: icon well beside the text, title wraps to two lines.
- Blocker rows are full-width 48 px links; count and chevron stay on the right.
- Pick state: cards stack (`grid-cols-1 md:grid-cols-2`, was `sm:`); the card buttons are `h-11`.
- No primary action in the CUSTOM state; the bottom bar shows "আরও" as current.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Translate server labels | ask server for keys / map on client | map on client (fixed list of 7 in `preset-blockers.ts`) | the list is fixed and small; no API change (D1) |
| Blocked list look | sentences with links (today) / table / link rows | link rows in one card | each row is one tap target; no underlined text links (D29) |
| "Applied by" line | show user id / look up via `useUsers` / hide | hide until server sends a name | `useUsers` needs `USER_READ` and would page through users; an id breaks D9 |
| Selected card button | filled / outline + ring on card | outline + ring | keeps the wizard's Next as the only filled button |
| Container width | wide / narrow | narrow (`max-w-3xl`) | reading page and a form-like wizard (D15) |

## Files
- `client-admin/src/routes/_staff/curriculum-preset.test.tsx` — heading assertion if it reads the old title
- `client-admin/src/pages/curriculum-preset/CurriculumPresetPage.tsx` — PageHeader/PageContainer for APPLIED and CUSTOM, subtitle on WizardShell, status card
- `client-admin/src/pages/curriculum-preset/BlockedState.tsx` — mapping, link rows
- `client-admin/src/pages/curriculum-preset/AppliedSummary.tsx` — name, formatDate, formatNumber, no user id
- `client-admin/src/pages/curriculum-preset/PresetCards.tsx` — kit card, outline select, StatusBadge
- `client-admin/src/pages/curriculum-preset/CurriculumPresetPage.test.tsx` — cases below
- `client-admin/src/pages/curriculum-preset/CurriculumPresetPage.stories.tsx` — Custom / Applied stories use the new look and Bangla data
- `ui/src/i18n/locales/en/curriculumPreset.json`, `ui/src/i18n/locales/bn/curriculumPreset.json` — keys below
- `e2e/keyboard/curriculum-preset.spec.ts` — only if the "selected" button query breaks (its name stays `cards.selected`)

## Steps
1. **Read first:** `PLAN/kit/patterns.md` §3 PageHeader/PageContainer, §4 StatusBadge, §5 EmptyState/ErrorState, §10 Card; `server/src/modules/presets/preset-blockers.ts:30-38` (the 7 server labels). 31.3.4b has already renamed the namespace's wording (title "তৈরি শিক্ষাক্রম", submit "এই শিক্ষাক্রম ব্যবহার করুন", applied.title "শিক্ষাক্রম যোগ হয়েছে"…) — do not redo those.
2. **Frame (`CurriculumPresetPage.tsx`).** For APPLIED and CUSTOM return
   `<PageContainer size="narrow"><PageHeader title={title} subtitle={t('subtitle')} />…</PageContainer>` (both from `@biddaloy/ui`). Pass `subtitle={t('subtitle')}` to `WizardShell` (prop added by 31.2.5a). The ErrorState/skeleton early returns also sit inside the same `PageContainer` + `PageHeader` so the title never disappears.
3. **CUSTOM status card.** Replace `<p role="status">{t('custom.message')}</p>` with
   ```tsx
   <Card padded role="status" className="flex items-start gap-3">
     <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-partial-bg text-status-partial-fg"><Info aria-hidden /></span>
     <div className="min-w-0"><h2 className="text-h2">{t('custom.title')}</h2><p className="mt-1 text-text-secondary">{t('custom.message')}</p></div>
   </Card>
   ```
4. **BlockedState.** Replace `ENTITY_ROUTES` with
   ```ts
   const BLOCKERS = {
     'academic years': { key: 'academicYears', to: '/academic-years', icon: CalendarRange },
     classes: { key: 'classes', to: '/classes', icon: School },
     subjects: { key: 'subjects', icon: BookOpen },
     students: { key: 'students', to: '/students', icon: GraduationCap },
     exams: { key: 'exams', to: '/exams', icon: FilePenLine },
     'grading scales': { key: 'gradingScales', to: '/grading-scales', icon: Ruler },
     'exam templates': { key: 'examTemplates', to: '/exams/templates', icon: FileStack },
   } as const;
   ```
   Unknown labels use `{ key: 'other', icon: Database }`. Render `<Card className="overflow-hidden" data-testid="preset-blocked">` (no padding) → header `div px-4 pt-4 pb-2 md:px-5 md:pt-5` with `<h2 className="text-h2">{t('blocked.heading')}</h2>` → `<ul className="divide-y divide-border-subtle border-t border-border-subtle">`. Row inner: icon well `flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-text-secondary`, name `min-w-0 flex-1 truncate font-medium`, count `tabular-nums text-text-secondary` = `t(key === 'students' ? 'blocked.countPeople' : 'blocked.countItems', { count: formatNumber(count, config) })` (config from `useRegionConfig()`), then `ChevronRight size-4 text-text-secondary` when linked, else an empty `span.size-4`. Linked row = `<Link to={to} className="flex min-h-12 items-center gap-3 px-4 py-1.5 hover:bg-muted md:px-5" aria-label={t('blocked.openLabel', { entity: name, count: countText })}>`; unlinked = same classes on the `li`.
5. **AppliedSummary.** New prop `presetName?: string` (page passes `pick(list.data?.find((p) => p.id === preset.id)?.name)` when found). Lines: `applied.preset` → `t('applied.preset', { name: presetName, version: preset.version })` when a name exists, else `t('applied.versionOnly', { version })`; `applied.appliedAt` with `formatDate(preset.appliedAt, config)`; delete the `appliedBy` paragraph and key; counts `formatNumber(count, config)`. Card `padded`, title `text-h2`, created heading `text-h3 pt-2`, `dl` per Change 9. Replace `text-sm`/`text-base`/`text-muted-foreground` with kit text tokens.
6. **PresetCards.** `ul` `grid grid-cols-1 gap-4 md:grid-cols-2`. Card `padded`, `className` adds `border-primary ring-2 ring-primary` when selected. Title row `flex items-center gap-2` with `CircleCheck size-4 text-primary` when selected + `<h2 className="text-h3">`. Unverified: `<StatusBadge tone="warning" label={t('unverifiedBadge')} />` then `<p className="text-caption text-status-due-fg">{t('unverified')}</p>`. Select button `variant="outline"` always, with `<Check />` icon when selected; keep `aria-pressed`, labels and the card's Enter-to-preview handler.
7. **i18n** (`curriculumPreset.json`):
   | key | en | bn |
   |---|---|---|
   | `subtitle` (**New**) | Add classes, subjects, exams and grading to a new school in one go. | নতুন স্কুলে শ্রেণি, বিষয়, পরীক্ষা ও গ্রেডিং একবারে যোগ করুন। |
   | `custom.title` (**New**) | A ready-made curriculum can no longer be added to this school | এই স্কুলে আর তৈরি শিক্ষাক্রম যোগ করা যাবে না |
   | `custom.message` (changed) | A ready-made curriculum can only be added to a brand-new school. Your school already has the records below, so carry on with them as they are. | তৈরি শিক্ষাক্রম শুধু একেবারে নতুন স্কুলে যোগ করা যায়। আপনার স্কুলে নিচের তথ্যগুলো আগে থেকেই আছে, তাই এগুলো নিজের মতো করে চালিয়ে যান। |
   | `blocked.heading` (changed) | Already in your school | যা আগে থেকেই আছে |
   | `blocked.entities.academicYears` … `.examTemplates`, `.other` (**New**) | Academic years · Classes · Subjects · Students · Exams · Grading scales · Exam structures · Other records | শিক্ষাবর্ষ · শ্রেণি · বিষয় · শিক্ষার্থী · পরীক্ষা · গ্রেডিং পদ্ধতি · পরীক্ষার কাঠামো · অন্যান্য রেকর্ড |
   | `blocked.countItems` (**New**) | {{count}} | {{count}}টি |
   | `blocked.countPeople` (**New**) | {{count}} | {{count}} জন |
   | `blocked.openLabel` (**New**) | Open {{entity}}, {{count}} | {{entity}} খুলুন, {{count}} |
   | `blocked.item`, `blocked.open` | (deleted) | (deleted) |
   | `applied.preset` (changed) | {{name}} (version {{version}}) | {{name}} (ভার্সন {{version}}) |
   | `applied.versionOnly` (**New**) | Version {{version}} | ভার্সন {{version}} |
   | `applied.appliedBy` | (deleted) | (deleted) |
   | `unverifiedBadge` (**New**) | Not verified | যাচাই করা হয়নি |
   `count` is passed already formatted (string), so do not add `_one/_other` forms.

## Tests
- `CurriculumPresetPage.test.tsx`:
  - CUSTOM with blockers `[{ entity: 'academic years', count: 2 }, { entity: 'subjects', count: 6 }, { entity: 'exam templates', count: 3 }]` → `preset-blocked` shows "Academic years", "Subjects", "Exam structures"; links exist for academic years (`/academic-years`) and exam templates (`/exams/templates`), none for subjects; the text "academic years" (lower-case server label) is not on screen.
  - CUSTOM shows exactly one `h1` (the title) and the status `h2`.
  - APPLIED with `preset.id` present in the list → shows the preset's name, no `appliedByUserId` value and no preset id string; date rendered via `formatDate` (assert the en long form, e.g. "9th September, 2026").
  - pick step with a selected card → the select button is not `bg-primary` (assert `variant` via its `aria-pressed="true"` + absence of the filled class) and the card has `ring-primary`.
  - an unverified preset shows the "Not verified" badge.
- `curriculum-preset.test.tsx`: update only if it asserts the old title text.
- `e2e/keyboard/curriculum-preset.spec.ts`: the h1 query uses `t('curriculumPreset.title')` and the selected-button name `t('curriculumPreset.cards.selected')` — both unchanged; run it to confirm.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (CUSTOM and APPLIED: none; pick step: the wizard's Next only).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No English noun appears inside a Bangla sentence on the blocked state; every count is in Bangla digits.
- [ ] Each linked blocker row opens its list; subjects has no chevron.
- [ ] The applied summary shows a name and a long date, never a UUID.

## Out of scope
- Shared request filed: `GET /presets/status` to return the applier's name (`appliedByName`); until then the "applied by" line is hidden.
- The reset card on Settings (`PresetLinkCard`, `presetReset`, `presetWarning`) belongs to the settings lane.
- `PresetPreviewSheet` and `ConfirmApplyDialog` keep their behaviour; they pick up Dialog/Sheet sizes from the foundation.
- The wizard's own step header look belongs to `WizardShell` (31.2.5a).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server GET /presets/status appliedByName | Deferred | — | use the fallback in the ticket (applied summary without the "applied by" line) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: admin   Decisions: D5, D6, D9, D15, D16, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.admin-1
