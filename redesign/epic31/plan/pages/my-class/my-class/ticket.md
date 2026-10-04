# [31.4.my-class-1] My class picker — kit header, section cards, real states

## Goal
`/my-class` with 2+ homeroom sections shows the kit header (h1 "আমার শ্রেণি" + one-line subtitle) and one link card per section in a responsive grid; the empty, error and loading branches keep the same h1 and use the kit states.

## What and why
The page lets a teacher with more than one homeroom section pick which one to open (with one section the loader redirects straight to it; that stays). Today the h1 is a small `text-lg` line, the empty state has no h1 at all, the error says "this card could not load" for the whole page, the loading label is English, and the cards are full-width rows on a 1440 px screen with a home-made pill. The redesign wraps it in `PageContainer` + `PageHeader`, turns rows into the same link cards the attendance list uses, and gives every branch the kit's empty / error / skeleton look.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/my-class/my-class/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/my-class/my-class/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Container | Every branch (pending, error, empty, list) renders inside `<PageContainer>`; the `p-4` / `gap-3 p-4` wrappers go. | D15 |
| 2 | Header | `<PageHeader title={t('title')} subtitle={t('pickerSubtitle')} />` — "আমার শ্রেণি" / **New** "কোন শাখা দেখবেন, বাছুন।". No actions: each card is the action. Rendered in every branch, so the empty and error pages also have their one h1. | D16, D32 |
| 3 | Section list | Full-width rows → link cards in `grid gap-3 md:grid-cols-2 xl:grid-cols-3`: icon well (the sidebar item's icon), name `text-h3` "সপ্তম শ্রেণি-ক", role as plain secondary text "শ্রেণি শিক্ষক" (the home-made pill goes — a role is not a status), `chevron-right`. | D17, D27 (no fake badge) |
| 4 | Empty | `EmptyState` with icon, **New** title "এখনো কোনো শাখা নেই" (today it repeats the page title) and the existing sentence. No action (a teacher cannot assign themselves). | D28 |
| 5 | Error | `ErrorState` message **New** "আপনার শাখার তালিকা আনা যায়নি।" instead of "এই কার্ডটি লোড করা যায়নি।" (there is no card here). | D28, D32 |
| 6 | Loading | Skeleton shaped like two cards in the same grid; `RoutePending` label translated (**New** key, today hard-coded English "Loading"). | D28, D9 |

## Mobile behaviour
- One column of cards, each ≥ 64 px tall; the whole card is the tap target.
- Bottom bar: the page is in no TEACHER cell, so "আরও" is marked (shell behaviour, nothing to do here).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Role display | StatusBadge / plain text | plain secondary text | D27 is for status; "class teacher" vs "assistant" is a role, and a coloured badge would suggest one is a warning. |
| Extra info per card (today's attendance state) | per-card query / none | none | N extra requests for a page most teachers never see (1 section redirects); `/attendance` already shows that state. |
| Card look | rows in one Card / link cards | link cards | Same pattern as the attendance list (31.4.attendance-1), so the two "pick a section" screens match. |

## Files
- `client-admin/src/routes/_staff/my-class/index.tsx` — container, header, cards grid, states, pending label
- `client-admin/src/routes/_staff/my-class/index.test.tsx` — update
- `ui/src/i18n/locales/bn/myClass.json` — keys below
- `ui/src/i18n/locales/en/myClass.json` — keys below

## Steps
1. **Imports.** From `@biddaloy/ui/components`: `EmptyState`, `ErrorState`, `RoutePending`, `Skeleton`, `PageContainer`, `PageHeader` (kit names, `patterns.md` §3). Icons from `lucide-react`: `ChevronRightIcon` and the same icon `_staff.tsx` gives `academics.myClass` (today `UserCheckIcon`; `BookUserIcon` if the shared request lands — use whichever `_staff.tsx` has when you implement).
2. **Pending label.** Replace `pendingComponent: () => <RoutePending variant="list" label="Loading" />` with a small `MyClassPending` component that calls `useTranslation('myClass')` and renders `<RoutePending variant="list" label={t('loading')} />`.
3. **One frame for every branch.** In `MyClassPickerPage` build `body` per branch and return:
   ```tsx
   <PageContainer>
     <PageHeader title={t('title')} subtitle={t('pickerSubtitle')} />
     {body}
   </PageContainer>
   ```
   - pending: `<div aria-busy="true" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">` with two `<Skeleton className="h-20 rounded-lg" />`.
   - error: `<ErrorState message={t('loadError')} retryLabel={t('retry')} onRetry={() => void query.refetch()} />`.
   - empty: `<EmptyState icon={<NavIcon />} title={t('emptyTitle')} explanation={t('empty')} />`.
   - list: step 4.
4. **Cards.** `<section aria-labelledby="mc-sections"><h2 id="mc-sections" className="sr-only">{t('sectionsHeading')}</h2><ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">`. Each `<li>` keeps today's `Link` (`to="/my-class/$sectionId"`, same `params`) with classes `flex min-h-16 items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 no-underline hover:bg-muted md:p-5`. Inside:
   - `<span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"><NavIcon /></span>`
   - `<span className="min-w-0 flex-1"><span className="block truncate text-h3">{`${section.class_name}-${section.section_name}`}</span><span className="mt-0.5 block text-text-secondary">{t(`roles.${section.assignment_type}`)}</span></span>` — the name uses the same text as the section page's h1 and crumb (see my-class-2).
   - `<ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-text-secondary" />`
   Delete the old pill `span` (`bg-muted … text-xs`).
5. **i18n (`myClass.json`, bn + en).**

   | Key | bn | en |
   |---|---|---|
   | `pickerSubtitle` (**New**) | কোন শাখা দেখবেন, বাছুন। | Pick a section to open. |
   | `sectionsHeading` (**New**) | আপনার শাখা | Your sections |
   | `emptyTitle` (**New**) | এখনো কোনো শাখা নেই | No section yet |
   | `loadError` (**New**) | আপনার শাখার তালিকা আনা যায়নি। | Could not load your sections. |
   | `loading` (**New**) | লোড হচ্ছে… | Loading… |

## Tests
- `index.test.tsx`:
  - empty: h1 "My class" is present, EmptyState title "No section yet" and the sentence render.
  - two sections: h1 "My class" + subtitle "Pick a section to open."; two links named "Class 7-A Class teacher" / "Class 9-B Assistant class teacher" (accessible name = card text) pointing to `/my-class/<id>`.
  - error: h1 still present; message "Could not load your sections."; "Try again" refetches.
  - the two redirect tests stay unchanged.
- No e2e change: the seeded teachers have one section, so `e2e/journeys/my-class.spec.ts` never sees the picker.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary per view (this page has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The empty, error and loading pages each show the h1 "আমার শ্রেণি".
- [ ] Sections sit in a 3-column grid at 1440 px, one column on phone; each card is one link.
- [ ] The loading label is translated.

## Out of scope
- The 1-section redirect and `?then=attendance` (palette) — unchanged.
- Sidebar icon of "আমার শ্রেণি" duplicates কর্মী হাজিরা's planned `user-check` — shared request filed (`_staff.tsx`).
- A bottom-bar cell for "আমার শ্রেণি" for TEACHER (nav-icons.md gives TEACHER ড্যাশবোর্ড / উপস্থিতি / রুটিন / বাড়ির কাজ) — not requested: subject teachers without a homeroom would get an empty cell.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| sidebar icon for My class: `book-user` instead of `user-check` (already used by staff attendance) | Accepted | 31.3.1 | nothing to do in this ticket — the layout ticket sets the icon |
| section crumb as `Class – Section` (spaced en dash) | Accepted | 31.3.5 | write the page title in the same form so h1 = last crumb |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: my-class   Decisions: D9, D15, D16, D17, D27, D28, D32   Depends on: 31.3.8b
