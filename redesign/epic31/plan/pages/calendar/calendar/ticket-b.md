# [31.4.calendar-1b] Calendar — holidays full page, clone dialog, shared cards

## Goal
Done = the government-holidays picker on `/calendar?panel=holidays` is a full-page modal, the clone dialog is a kit dialog without its dead checkbox, and the two calendar cards used on other pages (`UpcomingCalendarCard`, `CalendarFeedCard`) match the kit (b runs after calendar-1a).

## What and why
Besides the month grid, the calendar lane owns the screens an admin uses to set up a year — pull in government holidays, clone last year — and two cards shown on the dashboard, the portal and `/security`. Today the holidays picker is a cramped dialog holding a list, the clone dialog shows an always-disabled "ছুটির দিনসহ" checkbox, and the shared cards use hand-rolled `text-sm` styling, a raw error line and a home-made confirm dialog. This half moves the holidays picker into a `FullPageShell`, cleans up the clone dialog, and rebuilds both cards from kit parts.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Government holidays | Becomes a `FullPageShell` (`size="form"`) on `?panel=holidays`: one Card with a checkbox row per suggestion (name + `formatDate`), already-added rows disabled with a neutral badge "ইতিমধ্যে যোগ করা হয়েছে"; footer Cancel + primary "নির্বাচিতগুলো যোগ করুন (n)". | D21 (contains a list), D27 |
| 2 | Clone dialog | `Dialog size="md"`: two labelled Selects (placeholder "বাছুন"), Cancel + primary; the always-disabled "ছুটির দিনসহ" checkbox is removed (it does nothing today). Error = translated `clone.cloneFailed`. | D9, D25 |
| 3 | `UpcomingCalendarCard` (dashboard, portal home) | Kit Card + the same dot rows as the `/calendar` upcoming panel; error = translated sentence + outline Retry; local `toIsoDate` copy replaced by the one in `@biddaloy/ui/utils`. | D28, D5 |
| 4 | `CalendarFeedCard` (`/security`, portal account) | Kit Card, readonly link input with Control classes, Copy / Show as outline buttons, regenerate confirm via `ConfirmDialog` (`tone="default"`); how-to list `text-caption text-text-secondary`. | D29, D17 |

## Mobile behaviour
- Holidays full-page modal: no bottom bar, sticky header with "বন্ধ করুন", sticky footer.
- Clone dialog and both cards: one column, controls `h-11` (Control classes), nothing else differs.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Government holidays | Dialog `lg` / FullPageShell | FullPageShell | D21: a form that contains a list is a full-page modal. |
| "Include holidays" checkbox in clone | keep disabled / remove | remove | It is hard-wired `checked={false} disabled` and never sent — showing it misleads (D1 does not cover dead UI). |
| Holidays component API | rename to `GovernmentHolidaysPage` / keep `GovernmentHolidaysDialog` + `open`/`onOpenChange` | keep | calendar-1a already mounts it from `?panel=holidays` in `index.tsx`; keeping the props means this ticket does not touch `index.tsx`. |

## Files
- `client-admin/src/routes/_staff/calendar/-government-holidays-dialog.tsx` — becomes the holidays FullPageShell (keep file name, export name and props)
- `client-admin/src/routes/_staff/calendar/-clone-dialog.tsx` — kit dialog
- `client-admin/src/components/upcoming-calendar-card.tsx` — kit card, dots, error + retry
- `client-admin/src/components/calendar-feed-card.tsx` — kit card, ConfirmDialog
- `ui/src/i18n/locales/{bn,en}/calendar.json` — holidays keys below (also changed by calendar-1a, runs earlier)
- `ui/src/i18n/locales/{bn,en}/calendarImport.json` — clone keys below
- `client-admin/src/routes/_staff/calendar/-clone-dialog.test.tsx` — update
- `client-admin/src/components/upcoming-calendar-card.test.tsx`, `calendar-feed-card.test.tsx` — update

## Steps
1. **Holidays → full page** (`-government-holidays-dialog.tsx`; keep the export `GovernmentHolidaysDialog` and its `open` / `onOpenChange` props — `index.tsx` already mounts it with `open={search.panel === 'holidays'}` since calendar-1a): render `null` when `!open`; otherwise `FullPageShell size="form" title={t('governmentHolidaysDialog.title')} dirty={checked.size > 0} onClose={() => onOpenChange(false)}`, description line `mt-0.5 text-text-secondary`, one Card with checkbox rows: label = `entry.name` + `text-text-secondary` `formatDate(entry.date)`; already-added rows `aria-disabled` + `<StatusBadge tone="neutral" label={t('governmentHolidaysDialog.alreadyAdded')} />`. Footer secondary Cancel (`eventForm.cancel`, closes via `onOpenChange(false)`), primary `t('governmentHolidaysDialog.addCount', { count: checked.size })`, disabled at 0, `busy` while pending. Empty: `EmptyState` (`calendar-x`, `governmentHolidaysDialog.empty`). Keep `isAlreadyAdded` and its comment, and the reset of `checked` when `open` turns false.
2. **Clone dialog** (`-clone-dialog.tsx`): `DialogContent size="md"`, FormField per Select (both required, placeholder "বাছুন"), delete the disabled "include holidays" checkbox and the `clone.includeHolidays` key; error `t('clone.cloneFailed')` only. Props unchanged (`index.tsx` mounts it).
3. **`upcoming-calendar-card.tsx`:** Card `p-4 md:p-5`, title `text-h2`; rows match `-upcoming-panel.tsx` after calendar-1a — `flex min-h-11 w-full items-center gap-3 py-2 hover:bg-muted`, `<span className={`size-2 shrink-0 rounded-full ${DOT[event.type]}`} />` with `DOT = { HOLIDAY: 'bg-status-overdue-fg', EXAM: 'bg-status-partial-fg', DEADLINE: 'bg-status-due-fg', EVENT: 'bg-primary', MEETING: 'bg-primary' }`, name `min-w-0 flex-1 truncate font-medium`, date `shrink-0 text-text-secondary` = `formatDate` or `formatDate(start) + ' – ' + formatDate(end)` when multi-day (`ponytail:` swap for `formatDateRange` if the shared request lands); rows stay `Link`s to `calendarPath`. Replace the local `toIsoDate` with the `@biddaloy/ui/utils` one; error → `<p className="text-text-secondary">{t('page.errorMessage')}</p>` + outline Retry (`common:actions.retry`, `rotate-ccw`) calling `refetch`; loading skeleton unchanged.
4. **`calendar-feed-card.tsx`:** Card `p-4 md:p-5`, title `text-h2`, description `mt-1 text-text-secondary`; the readonly input uses the Control classes (`h-11 … md:h-8`), Show/Hide and Copy are outline buttons; "লিংক নতুন করে তৈরি করুন" is a ghost button; the regenerate confirm becomes `ConfirmDialog tone="default"` with the existing `regenerate.*` keys; how-to block `text-caption text-text-secondary`. No logic change.
5. **i18n.** `calendar.json`:

    | Key | bn | en |
    |---|---|---|
    | `governmentHolidaysDialog.addCount_one/_other` (**New**) | {{count}}টি যোগ করুন | Add {{count}} holiday / Add {{count}} holidays |

    Remove `governmentHolidaysDialog.add` (replaced by `addCount`). In `calendarImport.json` remove `clone.includeHolidays` and change `clone.cancel` only if it differs from "বাতিল করুন" (it does not).

## Tests
- `-clone-dialog.test.tsx`: no include-holidays checkbox; failure shows `clone.cloneFailed`.
- `upcoming-calendar-card.test.tsx`: error shows Retry and calls refetch.
- `calendar-feed-card.test.tsx`: regenerate opens ConfirmDialog and runs on confirm.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Holidays picker opens as a full-page modal on `?panel=holidays`, and Close asks before discarding ticked rows.
- [ ] Clone dialog has no disabled "ছুটির দিনসহ" checkbox.
- [ ] Dashboard / portal upcoming card and the calendar-feed card look like kit Cards; the feed card's regenerate asks through `ConfirmDialog`.

## Out of scope
- `upcoming-calendar-card.tsx` / `calendar-feed-card.tsx` placement on `/portal`, `/portal/account`, `/security` — those tickets place them, this one owns the files (note filed).
- Month grid, event form, event details, filters, upcoming panel — calendar-1a.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| DayPanel row badge for draft events | Accepted | 31.2.3a | MonthGridEvent.badge: <StatusBadge tone="neutral" label={t('…draft')} /> — shown after the name in DayPanel (not in grid chips) |
| formatDateRange formatter | Accepted | 31.1.2b + 31.2.1a | formatDateRange(from, to, rc) from @biddaloy/ui/utils (same month: ৮ই – ১০ই অক্টোবর) |
| ownership: upcoming-calendar-card.tsx + calendar-feed-card.tsx belong to calendar-1 | Accepted | — | no foundation ticket edits either file; note 31.2.14c restyles SecretField, which calendar-feed-card renders (look changes, file untouched) |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: calendar   Decisions: D1, D5, D9, D15, D17, D21, D25, D27, D28, D29   Depends on: 31.3.8b, 31.4.calendar-1a
