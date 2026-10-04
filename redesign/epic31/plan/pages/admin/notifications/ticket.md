# [31.4.admin-3] Notifications — page header, real button, empty state

## Goal
`/notifications` frames the persisted, step-rendered `NotificationList` (31.2.11) with the kit PageHeader, a real "mark all read" button that is the page's one primary action, the list in a card, and a proper EmptyState.

## What and why
The page shows the full history of the bell's notifications (results of the user's own jobs: imports, payments, SMS…), now kept per user + school in the browser and rendered 20 at a time as the user scrolls (D4). Today it has a raw breadcrumb key (B15, fixed by 31.3.4a), a faint ghost "mark all read" text floating on the right that wraps beside the title on phone, a description that still says "this session" (no longer true after D4), and a bare grey sentence when empty. The redesign only frames the shared list: header with an unread count, one clear button, a card around the list, and an EmptyState.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/notifications/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/notifications/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/notifications/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/notifications/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page frame | `PageContainer size="narrow"` + `PageHeader` replace the hand-rolled `div`/`h1 text-xl` | D15, D16 — a feed is a reading page |
| 2 | Subtitle | "আপনার কাজের ফলাফল, নতুন থেকে পুরনো · ৩টি অপঠিত" — description plus the unread count (count part only when > 0) | D4 made "এই সেশনে" wrong; the count shows the state at a glance |
| 3 | Mark all read | PageHeader action, `priority: 'primary'`, icon `check-check`; shown only when there are unread items (`allowed: unreadCount > 0`) | D29 — it is the page's only action, so it is the one filled button; a disabled ghost text reads as broken |
| 4 | List | `NotificationList` (unchanged shared component, rendering 20 rows per step with "আরও লোড হচ্ছে…") sits in a `Card` (`p-2`) | kit Card; the rows no longer float on the page background |
| 5 | Empty | When `notifications.length === 0` the route renders `EmptyState` (icon `bell`, title + one sentence, no action) instead of `NotificationList`'s grey paragraph | D28 |
| 6 | Breadcrumb | None shown (single-level page); the raw `items.notifications` crumb is gone via 31.3.4a/31.3.5 | B15, D16 |

## Mobile behaviour
- Title, subtitle, then the primary button full width (`flex-1`, `h-11`) — PageHeader's phone rule.
- Rows are full-width buttons ≥ 44 px (shared component).
- Bottom bar: "আরও" is the current cell (the page is not a cell).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Mark-all-read tier | ghost (today) / outline / primary | primary | the page's single action; an outline action would fold into "More" on phone and disappear |
| When nothing is unread | disabled button / hide | hide (`allowed: false`) | kit rule: unavailable actions are hidden, not disabled |
| Empty-state action | none / "go to dashboard" | none | nothing on this page can create a notification; a fake action adds noise |
| Width | wide / narrow | narrow | one-column feed, reading width |

## Files
- `client-admin/src/routes/_staff/notifications.tsx` — PageContainer, PageHeader, Card, EmptyState
- `client-admin/src/routes/_staff/notifications.test.tsx` — cases below

## Steps
1. **Read first:** `PLAN/kit/patterns.md` §3 PageHeader/PageContainer, §5 EmptyState, §10 Card; `PLAN/foundation/31.2.11-notifications-store.md` (store persisted per user + school; `NotificationList` gains step rendering with no new prop — this page passes nothing new).
2. In `NotificationsPage` return:
   ```tsx
   <PageContainer size="narrow">
     <PageHeader
       title={t('notifications.pageTitle')}
       subtitle={unreadCount > 0
         ? `${t('notifications.pageDescription')} · ${t('notifications.unreadCount', { count: unreadCount })}`
         : t('notifications.pageDescription')}
       actions={[{ id: 'mark-all-read', label: t('notifications.markAllRead'), priority: 'primary',
                   icon: <CheckCheck />, allowed: unreadCount > 0, onClick: () => markAllNotificationsRead() }]}
     />
     {notifications.length === 0 ? (
       <EmptyState icon={<Bell />} title={t('notifications.emptyTitle')} explanation={t('notifications.emptyDescription')} />
     ) : (
       <Card className="p-2">
         <NotificationList notifications={notifications} onMarkRead={markNotificationRead} emptyLabel={t('notifications.empty')} />
       </Card>
     )}
   </PageContainer>
   ```
   (`PageContainer`, `PageHeader`, `Card`, `EmptyState` from `@biddaloy/ui`; icons from `lucide-react`.) Remove the `Button` import. Update the file header comment: history is stored per user + school (D4), rendered in steps.
3. **Strings** live in `nav.json` (foundation-owned). `notifications.unreadCount_one/_other`, `notifications.emptyTitle`, `notifications.emptyDescription` and the new `pageDescription` wording are a shared request. If they are not there when this runs: subtitle = `pageDescription` alone, EmptyState title = `t('notifications.empty')` with no explanation — the rest of the ticket is unchanged.

## Tests
- `notifications.test.tsx`:
  - with 2 unread → one `h1` "Notifications", a button "Mark all read" exists; clicking it marks both read and the button disappears.
  - with 0 notifications → EmptyState title shown (`level: 2` heading), no "Mark all read" button, no list.
  - subtitle contains the unread count when > 0 and not when 0.
  - existing "clicking a row marks it read" case unchanged.
- No e2e spec covers this page's selectors.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view (none when everything is read).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No breadcrumb row and no raw `items.notifications` text above the title.
- [ ] "সব পঠিত হিসেবে চিহ্নিত করুন" is a filled button under the title on phone, at the right of the header on desktop.
- [ ] The empty page shows an icon, a title and one sentence inside a card.

## Out of scope
- Shared request filed: `nav.json` — new `notifications.pageDescription` wording, `notifications.unreadCount`, `notifications.emptyTitle`, `notifications.emptyDescription`.
- Shared request filed: `NotificationList` unread dot sits centred on a two-line message (should align to the first line).
- Persistence, the 1000 cap and step rendering are 31.2.11; the bell is 31.2.10.
- Grouping by day ("আজ", "গতকাল") — not asked; relative ages already say it.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| notification-list unread dot aligned to the first line | Accepted | 31.2.11 | nothing to pass; NotificationList row is items-start, dot mt-2 |
| nav.json notifications.* text + new keys | Accepted | 31.3.4a | keys: nav:notifications.pageDescription (new text), notifications.unreadCount_one/_other, notifications.emptyTitle, notifications.emptyDescription |

Wave: 9   Lane: admin   Decisions: D4, D15, D16, D28, D29   Depends on: 31.3.8b, 31.4.admin-2
