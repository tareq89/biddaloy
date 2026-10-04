# [31.4.calendar-1a] Calendar — month grid with day panel, full-page event form

## Goal
Done = `/calendar` is the D26 month grid with a selected-day panel, a kit header and labelled filters; the 9-field event form is a full-page modal; deleting an event asks first; the upcoming panel counts from the local day (calendar-1b, which runs after this, does the holidays page, the clone dialog and the two shared cards).

## What and why
The page shows the school's events for a month and lets an admin add, edit, publish and delete them. Today the header holds five equal buttons, the month reads "2026-10" between "<" ">" text buttons, a grid/agenda toggle duplicates the phone layout, day numbers and dates use Latin digits, the phone shows only an agenda list, the event form is a 9-field dialog, delete happens without a confirmation, and "upcoming" is computed from the UTC day (B20). This half uses the kit `MonthGrid` + `DayPanel`, one primary action, a More menu, a `FullPageShell` for the event form, and translated, tenant-numeral text on the page.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/calendar/calendar/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Header | `PageHeader` title "ক্যালেন্ডার"; outline "সরকারি ছুটি" (`flag`), outline "আমদানি" (`upload`), primary "ইভেন্ট যোগ করুন" (`plus`), More: "অন্য বছর থেকে ক্লোন করুন" (`copy`), "রপ্তানি" (`download`). All but the page title only with `CALENDAR_MANAGE`. | D16, D29 |
| 2 | Month navigation | The page's own `<` / "2026-10" / `>` / আজ row goes; `MonthGrid`'s built-in header (`অক্টোবর ২০২৬`, আজ, icon prev/next) drives `?month=`. | D26, D5 |
| 3 | View toggle | "মাস / এজেন্ডা" buttons and the `view` search param removed; `AgendaList` no longer used here. | D26 |
| 4 | Filters | Kit `FilterBar`: ইভেন্টের ধরন, শ্রেণি (label fixed from "ক্লাস"). Phone: one "ফিল্টার (n)" button + sheet; chips for active filters. | D24, D32 |
| 5 | Grid | `MonthGrid` with `selectedDate`, `today`, `onDayClick` (selects the day), `onEventClick` (opens details); chips on desktop, dots on phone; Friday/Saturday tinted from `weeklyOffDays`; `terms` still passed. | D26 |
| 6 | Day panel | **New** use of `DayPanel` for the selected day (defaults to today), right of the grid on desktop, under it on phone. Draft events get " · খসড়া" on their type label (shared request filed for a badge). | D26 |
| 7 | Upcoming panel | Kept, under the day panel: Card, title "আসন্ন", next-holiday line, rows = coloured dot + name + date (range when multi-day); today from the local calendar day. | D5, D6, B20 |
| 8 | Event details | `Dialog size="sm"`: name as title, type, date (range), description, a neutral `StatusBadge` "খসড়া" when unpublished, locked note; footer Delete (outline, `trash-2`, opens **New** `ConfirmDialog`), Publish (outline, drafts only), Edit (primary). | D27, D29 |
| 9 | Event form | Becomes a `FullPageShell` (`size="form"`) opened by `?panel=new-event` or `?panel=edit-event&event_id=…`: Card "ইভেন্টের তথ্য" (ধরন, নাম, শুরুর তারিখ, শেষের তারিখ, বিবরণ) + Card "প্রকাশ ও জানানো" (checkbox rows). "এখনই প্রকাশ করুন" only in create mode. | D21, D22, D23, D25 |
| 10 | Holidays picker wiring | "সরকারি ছুটি" now opens the existing holidays dialog through `?panel=holidays` instead of local state (calendar-1b turns that dialog into a full page). | D22 |

## Mobile behaviour
- Header: primary "ইভেন্ট যোগ করুন" `flex-1` + More; "সরকারি ছুটি" and "আমদানি" move into More.
- Filters behind one "ফিল্টার (n)" button.
- Full-width grid with up to 3 coloured dots per day; tapping a day fills the day panel below; no agenda view.
- Day panel, then upcoming panel, one column.
- Event form full-page modal: no bottom bar, sticky header with "বন্ধ করুন", sticky footer.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Which buttons stay inline | all five / primary + 2 outline + More | primary + সরকারি ছুটি + আমদানি; clone and export in More | D16 caps inline at 1 + 2; holidays and import are the setup tasks admins reach for, clone/export are yearly. |
| Upcoming panel | drop (day panel replaces it) / keep under day panel | keep | D1 (no removal of a working feature); it answers "what's next" across month boundaries. |
| How the full-page modals are addressed | own routes / search param on `/calendar` | `?panel=` (+ `event_id`) | D22 allows a search param; no new route (D1, contract). |
| Selected day after month change | keep old date / jump to 1st (today in the current month) | jump | The selected day must be inside the visible month. |

## Files
- `client-admin/src/routes/_staff/calendar/index.tsx` — header, search schema, MonthGrid/DayPanel, panels, confirm delete, B20
- `client-admin/src/routes/_staff/calendar/-event-form-dialog.tsx` — becomes the event FullPageShell (keep file name: listed in `unregistered-actions.ts`)
- `client-admin/src/routes/_staff/calendar/-event-details-sheet.tsx` — Dialog sm, badge, footer, confirm
- `client-admin/src/routes/_staff/calendar/-filters.tsx` — FilterBar fields
- `client-admin/src/routes/_staff/calendar/-upcoming-panel.tsx` — kit card, dots, local today
- `ui/src/i18n/locales/{bn,en}/calendar.json` — keys below (calendar-1b changes it later)
- `client-admin/src/routes/_staff/calendar/index.test.tsx`, `-filters.test.tsx`, `-upcoming-panel.test.tsx` — update
- `client-admin/src/routes/_staff/calendar/-calendar-view.stories.tsx` — show grid + day panel
- `e2e/journeys/calendar.spec.ts` — new flow

## Steps
1. **Search schema** (`index.tsx`): remove `view`; add `panel: z.enum(['new-event', 'edit-event', 'holidays']).optional().catch(undefined)` and `event_id: z.string().optional().catch(undefined)`. Keep `month`, `types`, `class_id`.
2. **Today (B20).** `const today = toIsoDate(new Date())` from `@biddaloy/ui/utils` (local day). Use it for `MonthGrid today`, the default selected day and `UpcomingPanel today`. Delete `new Date().toISOString().slice(0, 10)`. `currentMonth()` stays (it already uses local getters).
3. **Selected day.** `const [selectedDate, setSelectedDate] = useState(today)`. On `onMonthChange(next)`: `setSearch({ month: next })` and `setSelectedDate(next === currentMonth() ? today : `${next}-01`)`.
4. **Header.** Render `PageHeader` (page has no shell): `title={t('page.title')}`, `actions` = `[{ id: 'holidays', label: t('page.governmentHolidays'), icon: <FlagIcon />, priority: 'secondary', allowed: canManage, onClick: () => setSearch({ panel: 'holidays' }) }, { id: 'import', label: tImport('toolbar.import'), icon: <UploadIcon />, priority: 'secondary', allowed: canManage, onClick: () => navigate({ to: '/calendar/import' }) }, { id: 'add', label: t('page.addEvent'), icon: <PlusIcon />, priority: 'primary', allowed: canManage, onClick: () => setSearch({ panel: 'new-event' }) }, { id: 'clone', label: tImport('toolbar.clone'), icon: <CopyIcon />, priority: 'tertiary', allowed: canManage, onClick: () => setCloneOpen(true) }, { id: 'export', label: tImport('toolbar.export'), icon: <DownloadIcon />, priority: 'tertiary', allowed: canManage && !!academicYearId, onClick: () => academicYearId && void downloadCalendarExport(academicYearId, 'xlsx') }]`. Wrap the page once in `PageContainer` (wide) — the route has no shell; no other `max-w-*`.
5. **Filters** (`-filters.tsx`): return `FilterBar` with fields `{ key: 'types', label: t('filters.typesLabel'), type: 'select', options: [all, ...types] }` and `{ key: 'class_id', label: t('filters.classLabel'), type: 'select', options: [all, ...classOptions] }`; keep the single-select-on-array mapping and its comment; keep `CalendarFiltersProps` so `index.tsx` changes little. Sentinels stay.
6. **Grid + panels.** Replace the two `hidden md:block` / `block md:hidden` wrappers and the `AgendaList` with `<div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6"><MonthGrid … className="min-w-0 flex-1" /><div className="flex flex-col gap-4 md:w-80 md:shrink-0 md:gap-6"><DayPanel date={selectedDate} events={eventsOn(selectedDate)} onEventClick={setDetailsId} /><UpcomingPanel …/></div></div>`. `MonthGrid` props: existing ones + `selectedDate`, `today`, `onMonthChange`, `onDayClick={setSelectedDate}`. `eventsOn(d)` = `monthGridEvents.filter(e => e.startDate <= d && e.endDate >= d)`. For drafts: `typeLabel: event.published ? t(`types.${event.type}`) : `${t(`types.${event.type}`)} · ${t('eventDetails.draft')}``. Loading: `MonthGrid`'s skeleton (or `Skeleton` shaped as the grid Card, `aria-busy`); error stays `ErrorState` with Retry.
7. **Upcoming panel** (`-upcoming-panel.tsx`): Card classes `p-4 md:p-5`; `<h2 className="text-h3">{t('upcomingPanel.title')}</h2>`; add the next-holiday line (`upcomingPanel.nextHoliday`, same logic as `UpcomingCalendarCard` — read that file, do not edit it); rows `<button className="flex min-h-11 w-full items-center gap-3 py-2 text-left hover:bg-muted">` with `<span className={`size-2 shrink-0 rounded-full ${DOT[event.type]}`} />`, name `min-w-0 flex-1 truncate font-medium`, date `shrink-0 text-text-secondary` = single `formatDate` or, when `end_date !== start_date`, `formatDate(start) + ' – ' + formatDate(end)` (`ponytail:` swap for `formatDateRange` if the shared request lands). `DOT = { HOLIDAY: 'bg-status-overdue-fg', EXAM: 'bg-status-partial-fg', DEADLINE: 'bg-status-due-fg', EVENT: 'bg-primary', MEETING: 'bg-primary' }`. Empty: `upcomingPanel.empty` as one `text-text-secondary` line.
8. **Event details** (`-event-details-sheet.tsx`): `DialogContent size="sm"`; `dl` with label `text-caption text-text-secondary` / value; dates via `formatDate` (range as step 7); `!event.published` → `<StatusBadge tone="neutral" label={t('eventDetails.draft')} />` next to the title. Footer (manage + not locked): outline Delete (`trash-2`, `text-destructive`) → opens `ConfirmDialog tone="danger"` (title `eventDetails.deleteConfirmTitle`, description `eventDetails.deleteConfirmDescription` with `{name}`, confirm `eventDetails.delete`, `busy` = delete pending) whose `onConfirm` calls the existing `onDelete`; outline Publish only when unpublished; primary Edit → `setSearch({ panel: 'edit-event', event_id: id })`.
9. **Event form → full page** (`-event-form-dialog.tsx`, export renamed `EventFormPage`, file name unchanged): `FullPageShell title={create ? t('eventForm.createTitle') : t('eventForm.editTitle')} size="form" dirty={isDirty} onClose={close} secondary={{ label: t('eventForm.cancel'), onClick: close }} primary={{ label: t('eventForm.save'), onClick: submit, busy: isPending }}`. Body: Card h2 `eventForm.sectionDetails` with `grid gap-4 md:grid-cols-2`: ধরন (Select, required), নাম (required), শুরুর তারিখ / শেষের তারিখ (`DatePicker` with `placeholder` default, required, `min` of end = start), বিবরণ (`Textarea`, `md:col-span-2`). Card h2 `eventForm.sectionOptions`: checkbox rows (`flex min-h-11 items-center gap-3 md:min-h-8`) for কর্মদিবস, এখনই প্রকাশ করুন (**create only** — the update DTO has no `publish`), জানান, এসএমএস (disabled until জানান). Error line above the cards uses the existing code → key mapping (keep `KNOWN_ERROR_CODES`). `isDirty` = any field differs from the initial values. `close` = `setSearch({ panel: undefined, event_id: undefined })`. In `index.tsx`: when `search.panel` is `new-event` / `edit-event`, render `EventFormPage` (edit reads `useCalendarEvent(search.event_id)` and shows the shell's body skeleton until loaded); keep `handleCreateSubmit` / `handleEditSubmit` and `dropUndefined` as they are, closing via `close` on success. Remove the `createOpen` / `editingId` state.
10. **Holidays picker wiring** (`index.tsx` only): delete the `governmentHolidaysOpen` state; mount the existing `GovernmentHolidaysDialog` with `open={search.panel === 'holidays'}` and `onOpenChange={(o) => { if (!o) setSearch({ panel: undefined }) }}`, other props unchanged. Do not edit `-government-holidays-dialog.tsx` or `-clone-dialog.tsx` here — calendar-1b restyles them and keeps their export names and props, so this mount stays valid.
11. **i18n** (`calendar.json`):

    | Key | bn | en |
    |---|---|---|
    | `filters.classLabel` (changed) | শ্রেণি | Class |
    | `filters.allClasses` (changed) | সব শ্রেণি | All classes |
    | `eventForm.errors.CALENDAR_INVALID_CLASS` (changed) | নির্বাচিত শ্রেণিগুলোর একটি সঠিক নয়। | One of the selected classes is not valid. |
    | `eventForm.sectionDetails` (**New**) | ইভেন্টের তথ্য | Event details |
    | `eventForm.sectionOptions` (**New**) | প্রকাশ ও জানানো | Publishing and notifications |
    | `eventForm.typePlaceholder` (**New**) | বাছুন | Select |
    | `eventForm.cancel` (changed) | বাতিল করুন | Cancel |
    | `eventDetails.deleteConfirmTitle` (**New**) | ইভেন্ট মুছে ফেলবেন? | Delete this event? |
    | `eventDetails.deleteConfirmDescription` (**New**) | "{{name}}" ক্যালেন্ডার থেকে মুছে যাবে। এটি আর ফেরানো যাবে না। | "{{name}}" will be removed from the calendar. This can't be undone. |

    Remove unused: `page.viewGrid`, `page.viewAgenda`, `page.previousMonth`, `page.nextMonth`, `page.today`, `page.agendaEmpty` (MonthGrid's header labels come from `common`); before deleting, `rg "calendar:page\.|useTranslation\('calendar'\)"` to confirm no other caller (portal pages use their own `portal` namespace; `upcoming-calendar-card.tsx` reads only `upcomingPanel.*` and `page.errorMessage`).

## Tests
- `index.test.tsx`: header shows one primary and, for a manager, সরকারি ছুটি / আমদানি inline and ক্লোন / রপ্তানি in More; no "মাস/এজেন্ডা" buttons; month header text is `formatMonth` ("অক্টোবর ২০২৬"); clicking a day updates the day panel; "ইভেন্ট যোগ করুন" sets `?panel=new-event` and renders the full-page form; deleting from details asks for confirmation and only deletes on confirm; with the clock mocked to 2026-10-04 23:30 local in a UTC+6 zone the upcoming panel treats 4 Oct as today (B20).
- `-filters.test.tsx`: both fields have visible labels; class label reads "শ্রেণি".
- `-upcoming-panel.test.tsx`: dot colour per type; multi-day range text; drafts excluded (unchanged rule).
- `e2e/journeys/calendar.spec.ts`: create flow now opens the full-page form (`getByRole('heading', { name: t('calendar.eventForm.createTitle') })`), picks dates through the DatePicker trigger instead of `.fill()`, saves, and finds the chip in the day cell; the locked-event and read-only checks stay.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Month label reads "অক্টোবর ২০২৬"; day numbers in tenant numerals; today ringed, selected filled.
- [ ] No grid/agenda toggle; phone shows dots and the selected day's list under the grid.
- [ ] Event form opens as a full-page modal, changes the URL, and Close asks before discarding edits; "সরকারি ছুটি" sets `?panel=holidays`.
- [ ] Deleting an event needs a confirmation.
- [ ] Upcoming panel is correct just before local midnight (B20).

## Out of scope
- Draft badge inside `DayPanel` — shared request filed (`calendar | MonthGrid / DayPanel`).
- `formatDateRange` — shared request filed (`calendar | ui/src/utils`).
- Showing terms differently — `MonthGrid`'s `terms` rendering is the foundation's.
- Exporting as CSV (`toolbar.exportCsv` exists, unused) — not wired today (D1).
- Government holidays full page, clone dialog, `UpcomingCalendarCard`, `CalendarFeedCard` — calendar-1b.
- `unregistered-actions.ts` entry for the event form — handled by 31.5.1b (this ticket keeps the file name so the entry stays valid).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| DayPanel row badge for draft events | Accepted | 31.2.3a | MonthGridEvent.badge: <StatusBadge tone="neutral" label={t('…draft')} /> — shown after the name in DayPanel (not in grid chips) |
| formatDateRange formatter | Accepted | 31.1.2b + 31.2.1a | formatDateRange(from, to, rc) from @biddaloy/ui/utils (same month: ৮ই – ১০ই অক্টোবর) |
| ownership: upcoming-calendar-card.tsx + calendar-feed-card.tsx belong to calendar-1 | Accepted | — | no foundation ticket edits either file; note 31.2.14c restyles SecretField, which calendar-feed-card renders (look changes, file untouched) |

Wave: 9   Lane: calendar   Decisions: D1, D5, D6, D9, D15, D16, D21, D22, D23, D24, D25, D26, D27, D29, D32   Depends on: 31.3.8b
