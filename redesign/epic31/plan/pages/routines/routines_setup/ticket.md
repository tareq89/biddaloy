# [31.4.routines-4a] Routine setup — tabs, rooms table, rules section

## Goal
`/routines/setup` gets the kit page header and three line tabs in the URL (শিফট ও পিরিয়ড · কক্ষ · রুটিনের নিয়ম); the rooms tab becomes a kit table with an add dialog and a confirmed delete, and the rules tab becomes one `SettingsSection` with plain labels and help text. Split: the shifts and period-times card are `routines-4b` (`ticket-b.md`), which runs after this one.

## What and why
This page is where an admin sets up, once, what every routine is built on: shifts, the start and end time of every period, the rooms, and limits such as the gap between periods. Today it is one long column of four bare sections with four filled buttons, raw times (`08:00:00`), English server errors shown verbatim (`Cannot delete room "<uuid>": …`), deletes with no confirmation, and labels like "রুম" and "পরিবর্তন বিরতি" that a school admin has to guess at. The redesign splits the page into three tabs so each view has one job and one primary, uses the kit `DataTable`, `Dialog`, `ConfirmDialog` and `SettingsSection`, and translates every error.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_setup/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_setup/before-mobile.webp?raw=true" width="260"> |
| After (tab শিফট ও পিরিয়ড, built by 4a + 4b) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_setup/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/routines/routines_setup/mobile.webp?raw=true" width="260"> |

The rooms and rules tabs have no mockup: rooms is `PATTERN: DataTable (unpaginated)` inside a Card with the header described in Change 4; rules is `PATTERN: SettingsLayout`'s section card.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame | `PageContainer` (wide) + `PageHeader` title `setupPage.title` ("রুটিন সেটআপ") + **New** subtitle. Remove `mx-auto max-w-3xl p-6` and the raw `<h1>`. | D15, D16 |
| 2 | Tabs | **New** kit `Tabs` (line): "শিফট ও পিরিয়ড" (`periods`, default) · "কক্ষ" (`rooms`) · "রুটিনের নিয়ম" (`rules`); selected tab in `?tab=`; only the selected panel renders. Tab 1 holds `ShiftsPanel` + `PeriodSlotsPanel` (restyled by 4b). | D20; four unrelated jobs on one scroll, four filled buttons |
| 3 | Rooms wording | "রুম" → "কক্ষ" (legend, room no., add). | D32 — one word per thing; the routine pages say "কক্ষ" |
| 4 | Rooms card | `Card` (`padded={false}`, `overflow-hidden`): header `flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between md:p-5` with `h2.text-h2` "কক্ষ" + **New** subtitle and the tab's one primary "কক্ষ যোগ করুন" (`plus`); then `DataTable paginated={false}`: কক্ষ নং (`font-medium`), ভবন ("—" when empty), ধারণক্ষমতা (`align: 'end'`, `formatNumber`, "—"), row action `delete`. Total "মোট ৫টি". Inline add form row goes. | D19, D6, D29 |
| 5 | Add room | **New** `Dialog size="sm"` "কক্ষ যোগ করুন": কক্ষ নং (required), ভবন, ধারণক্ষমতা (number); Cancel outline + primary "যোগ করুন". | D21 |
| 6 | Delete room | `ConfirmDialog tone="danger"` "কক্ষ 101 মুছবেন?"; a 409 (room used by routine periods) → toast **New** `roomsPanel.inUseError`; other errors → `roomsPanel.deleteError`. `MutationErrorMessage` goes. | D29, D9 |
| 7 | Rooms empty | **New** `EmptyState` (`door-open`) "এখনো কোনো কক্ষ নেই" + sentence; no action (header primary). | D28 |
| 8 | Rules | `FormShell` + `FormSection` → `SettingsSection` (title "রুটিনের নিয়ম", **New** description, `onSubmit`, `saving`): fields in `grid gap-4 md:grid-cols-2`, each with **New** help text; Save is the section's primary; success → toast `save.success`; error → toast **New** `settingsPanel.saveError` (no server text). | D30 pattern, D17, D9 |
| 9 | Rules wording | "রুটিন সেটিংস" → "রুটিনের নিয়ম"; "পরিবর্তন বিরতি (মিনিট)" → "দুই পিরিয়ডের মাঝে ফাঁক (মিনিট)"; "প্রতি শিক্ষকের প্রতিদিন সর্বোচ্চ পিরিয়ড" → "একজন শিক্ষক দিনে সর্বোচ্চ কয়টি পিরিয়ড নেবেন"; "সর্বোচ্চ ধারাবাহিক পিরিয়ড" → "টানা সর্বোচ্চ কয়টি পিরিয়ড". | D32, plain words |

## Mobile behaviour
- The three tabs fit on one row at 390 px; the row scrolls sideways if a language makes them wider.
- Rooms: compact two-line rows ("কক্ষ 101" / "প্রধান ভবন · ৩৫ জন") with a 44 px delete icon; the header primary is full width under the title.
- Rules: fields one column; Save full width at the card's foot.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Page structure | one long page (today) · settings side list (D30) · line tabs | Line tabs in `?tab=` | Three parts, one job each; a side list is for the 7-category Settings page |
| Shifts and periods together? | separate tabs · one tab | One tab | Periods belong to a shift; the shift list and its periods are edited together |
| Container width | narrow (today `max-w-3xl`) · wide | Wide | Tab 1 holds a 6-column editable table (4b) |
| Room delete | instant (today) · ConfirmDialog | ConfirmDialog | D29; irreversible |
| Rules form shell | `FormShell` (renders its own PageContainer) · `SettingsSection` | `SettingsSection` | A container inside a tab would nest PageContainers; SettingsSection is a card form with its own Save |
| Room numbers | tenant numerals · as typed | As typed (`room_no` is free text, e.g. "Exam Hall 1") | D6 — an identifier people copy |

## Files
- `client-admin/src/routes/_staff/routines/setup.tsx` — PageContainer, PageHeader, tabs + `?tab=`
- `client-admin/src/routes/_staff/routines/setup.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-setup/rooms-panel.tsx` — Card + DataTable + dialogs
- `client-admin/src/routes/_staff/routines/-setup/rooms-panel.test.tsx` — updated
- `client-admin/src/routes/_staff/routines/-setup/routine-settings-panel.tsx` — SettingsSection, help text, toasts
- `client-admin/src/routes/_staff/routines/-setup/routine-settings-panel.test.tsx` — updated
- `ui/src/i18n/locales/en/routines.json`, `ui/src/i18n/locales/bn/routines.json` — keys below (also changed by routines-1a … 3b, run earlier)

## Steps
1. **Locale keys** (en / bn). Change: `roomsPanel.legend` → "Rooms" / "কক্ষ"; `roomsPanel.roomNo` → "Room no." / "কক্ষ নং"; `roomsPanel.addAction` → "Add room" / "কক্ষ যোগ করুন"; `settingsPanel.legend` → "Routine rules" / "রুটিনের নিয়ম"; `settingsPanel.defaultChangeoverMinutes` → "Gap between periods (minutes)" / "দুই পিরিয়ডের মাঝে ফাঁক (মিনিট)"; `settingsPanel.maxPeriodsPerTeacherPerDay` → "Most periods a teacher takes in a day" / "একজন শিক্ষক দিনে সর্বোচ্চ কয়টি পিরিয়ড নেবেন"; `settingsPanel.maxConsecutivePeriods` → "Most periods in a row" / "টানা সর্বোচ্চ কয়টি পিরিয়ড".
   Add: `setupPage.subtitle` "Set shifts, period times, rooms and rules before building a routine." / "রুটিন সাজানোর আগে শিফট, পিরিয়ডের সময়, কক্ষ আর নিয়ম ঠিক করুন।"; `setupPage.tabsLabel` "Routine setup sections" / "রুটিন সেটআপের অংশ"; `setupPage.tabs.periods` "Shifts and periods" / "শিফট ও পিরিয়ড"; `setupPage.tabs.rooms` "Rooms" / "কক্ষ"; `setupPage.tabs.rules` "Routine rules" / "রুটিনের নিয়ম";
   `roomsPanel.subtitle` "Rooms you can put a period in." / "যে কক্ষগুলোতে পিরিয়ড বসানো যায়।"; `roomsPanel.caption` "Rooms" / "কক্ষের তালিকা"; `roomsPanel.capacityValue` "{{count}} seats" / "{{count}} জন"; `roomsPanel.roomName` "Room {{roomNo}}" / "কক্ষ {{roomNo}}"; `roomsPanel.dialogTitle` "Add room" / "কক্ষ যোগ করুন"; `roomsPanel.dialogConfirm` "Add" / "যোগ করুন"; `roomsPanel.cancel` "Cancel" / "বাতিল করুন"; `roomsPanel.deleteTitle` "Delete room {{roomNo}}?" / "কক্ষ {{roomNo}} মুছবেন?"; `roomsPanel.deleteDescription` "The room is removed from the list. This can't be undone." / "কক্ষটি তালিকা থেকে মুছে যাবে। এটি আর ফেরানো যাবে না।"; `roomsPanel.deleteConfirm` "Delete" / "মুছে ফেলুন"; `roomsPanel.inUseError` "Periods in the routine use this room, so it can't be deleted. Move those periods to another room first." / "রুটিনের কিছু পিরিয়ড এই কক্ষে বসানো আছে, তাই মোছা যাবে না। আগে সেই পিরিয়ডগুলো অন্য কক্ষে সরান।"; `roomsPanel.deleteError` "Couldn't delete the room. Try again." / "কক্ষটি মোছা যায়নি। আবার চেষ্টা করুন।"; `roomsPanel.saveError` "Couldn't add the room. Try again." / "কক্ষটি যোগ করা যায়নি। আবার চেষ্টা করুন।"; `roomsPanel.emptyTitle` "No rooms yet" / "এখনো কোনো কক্ষ নেই"; `roomsPanel.emptyExplanation` "Add the rooms periods can be held in." / "যে কক্ষগুলোতে পিরিয়ড হয়, সেগুলো যোগ করুন।";
   `settingsPanel.description` "These limits are checked while you build a routine." / "রুটিন সাজানোর সময় এই নিয়মগুলো মিলিয়ে দেখা হয়।"; `settingsPanel.defaultChangeoverHelp` "A new period starts this many minutes after the one before it." / "নতুন পিরিয়ড আগেরটি শেষ হওয়ার এত মিনিট পরে শুরু হয়।"; `settingsPanel.noCapHelp` "Leave empty for no limit." / "খালি রাখলে কোনো সীমা নেই।"; `settingsPanel.saveError` "Couldn't save the rules. Check the numbers and try again." / "নিয়মগুলো সংরক্ষণ করা যায়নি। সংখ্যাগুলো দেখে আবার চেষ্টা করুন।".
2. **`setup.tsx`**: `validateSearch: z.object({ tab: z.enum(['periods', 'rooms', 'rules']).optional().catch(undefined) })`; `const tab = search.tab ?? 'periods'`. Render `PageContainer` → `PageHeader title={t('setupPage.title')} subtitle={t('setupPage.subtitle')}` → `Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v === 'periods' ? undefined : v }, replace: true })}` with `TabsList aria-label={t('setupPage.tabsLabel')}` and three `TabsTrigger`s; panels: `periods` → `div.space-y-6` with today's `ShiftsPanel` and `PeriodSlotsPanel` (props unchanged here; 4b changes them), `rooms` → `RoomsPanel`, `rules` → `RoutineSettingsPanel schoolId`. Keep `pendingComponent`. Only the selected `TabsContent` mounts (D20).
3. **`rooms-panel.tsx`**: layout per Change 4. `DataTable caption={t('roomsPanel.caption')} paginated={false} data={rooms} loading={roomsQuery.isPending}` columns: room no. (`t('roomsPanel.roomName', { roomNo })`, `font-medium`; phone second line `building · capacityValue`), building, capacity (`align: 'end'`, `t('roomsPanel.capacityValue', { count: formatNumber(capacity, config) })` or "—"), `rowActions={(room) => [{ intent: 'delete', label: t('delete.action'), onClick: () => setDeleting(room) }]}`, `emptyState={{ icon: <DoorOpen />, title: t('roomsPanel.emptyTitle'), explanation: t('roomsPanel.emptyExplanation') }}`. Add dialog: `DialogContent size="sm"`, fields as `FormField` + `Input` (`room-no` required first, then `room-building`, `room-capacity` `type="number" min={1}` `inputMode="numeric"`), submit keeps today's mutate payload; on success close + reset; on error inline `p role="alert"` `roomsPanel.saveError`. Delete: `ConfirmDialog tone="danger" title={t('roomsPanel.deleteTitle', { roomNo })} description={t('roomsPanel.deleteDescription')} confirmLabel={t('roomsPanel.deleteConfirm')} cancelLabel={t('roomsPanel.cancel')} busy={deleteRoom.isPending}`; `onError: (e) => toast.error(t(e instanceof ApiError && e.statusCode === 409 ? 'roomsPanel.inUseError' : 'roomsPanel.deleteError'))`. Remove `MutationErrorMessage` and update the docblock (409 is translated, not shown verbatim).
4. **`routine-settings-panel.tsx`**: keep the zod schema, `useForm`, `useWarnUnsavedChanges`, and `handleSave` payload. Replace `FormShell`/`FormSection`/the loose Save button with `SettingsSection title={t('settingsPanel.legend')} description={t('settingsPanel.description')} onSubmit={form.handleSubmit(handleSave)} saving={updateSettings.isPending}`; fields `FormField` + `Input` `inputMode="numeric"` with `FormDescription` help (`defaultChangeoverHelp`, `noCapHelp`, `noCapHelp`) inside `grid gap-4 md:grid-cols-2`. Success → `toast.success(t('save.success'))`; error → `toast.error(t('settingsPanel.saveError'))`. Remove the `role="status"` paragraph, `MutationErrorMessage` and `buildFormShellErrors`.
5. Logical classes only; no `max-w-*`, `mx-auto`, `text-sm` left in these files.

## Tests
- `setup.test.tsx`: the h1 is "Routine setup"; three tabs, "Shifts and periods" selected by default; clicking "Rooms" sets `?tab=rooms` and shows only the rooms panel; `?tab=rules` opens the rules panel; an invalid `tab` falls back to the first.
- `rooms-panel.test.tsx`: rows show "Room 101", building, "35 seats"; empty building/capacity render "—"; "Add room" opens a dialog and submits `{ building, room_no, capacity }`; delete asks first (ConfirmDialog) and only then calls the mutation; a mocked 409 shows `roomsPanel.inUseError` and never the server message; empty list shows the EmptyState.
- `routine-settings-panel.test.tsx`: labels use the new wording; help text visible; Save sends the same payload as before; a failed save shows the translated toast, not the server text.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (tab 1, after 4b also lands).
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per tab panel (rooms: "কক্ষ যোগ করুন"; rules: "সংরক্ষণ করুন").
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); numbers follow D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The selected tab is in the URL and survives a reload.
- [ ] Deleting a room asks first; a room in use gives a Bangla sentence.
- [ ] No server error text appears anywhere on the rooms or rules tab.

## Out of scope
- Editing a room's details (no edit UI today) — new behaviour.
- Shifts card and period-times card: `routines-4b`.

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: routines   Decisions: D6, D9, D15, D16, D17, D19, D20, D21, D25, D28, D29, D30, D32   Depends on: 31.3.8b, 31.4.routines-3b
