# [31.4.admin-4] Security — page header, sessions you can tell apart

## Goal
`/security` has a kit PageHeader titled "নিরাপত্তা" (= the account-menu label and crumb), the current device first in the session list, the sessions block and the calendar-link card as two clear sections in the narrow container, and — once the shared SessionList request lands — each session shows its IP and exact sign-in time so nine "Chrome · Windows / এখন" rows can be told apart.

## What and why
The page is where a staff member checks which devices are signed in to their account and signs out the ones they do not recognise; it also holds their personal calendar-subscription link. Today the crumb is a raw key (`items.security`, B15), the h1 says "সক্রিয় সেশন" while the menu says "নিরাপত্তা" (D16), ~9 identical cards read "Chrome · Windows · সাইন ইন করা হয়েছে এখন" with nothing to tell them apart, the current device can end up anywhere in the list, the "sign out everywhere" button is a red filled-look button outside a confirm dialog (D29), and the route sets its own `max-w-2xl` (D15). The redesign fixes what the route owns (header, order, width, sections) and files the row content as a shared request on `SessionList`.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/security/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/security/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/security/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/admin/security/mobile.webp?raw=true" width="260"> |

Rows in the "after" picture (IP, device icon, absolute sign-in time, one card with divided rows, total, outline "sign out everywhere") are the shared `SessionList` request; this ticket renders whatever `SessionList` provides.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page frame | `PageContainer size="narrow"` replaces `div.max-w-2xl` | D15 |
| 2 | Header | `PageHeader title={t('items.security', { ns: 'nav' })}` = "নিরাপত্তা"; subtitle from the shared request (`nav:security.pageDescription`), omitted until it exists | D16 — title = menu label = crumb |
| 3 | Sessions section | `section` with `h2` "সক্রিয় সেশন" (`auth:sessions.title`) + description (`auth:sessions.description`), then `SessionList` | the old h1 becomes the section title; two sections need two headings |
| 4 | Order | Sessions passed to `SessionList` sorted: current first, then `last_used_at` newest first | the user's own device is the anchor; today the order is whatever the API returns |
| 5 | Calendar section | `CalendarFeedCard` stays below as the second section (component owned by calendar-1b; placed, not edited) | D3 territory |
| 6 | Error | `ErrorState` stays, now inside the PageContainer under the PageHeader, so the title never disappears | D28 |
| 7 | Rows (shared) | IP address, device icon, absolute sign-in date-time, divided rows in one card, "মোট n টি ডিভাইস", outline "সব জায়গা থেকে সাইন আউট" with ConfirmDialog — **shared request on `ui/src/components/session-list.tsx`** | brief: rows cannot be told apart; D5, D29 |

## Mobile behaviour
- One column; header title + subtitle, no header action.
- Each session row: icon + text, the "সাইন আউট" outline button (`h-11`) under the text, aligned with it.
- "সব জায়গা থেকে সাইন আউট" full width at the bottom of the list card.
- Bottom bar: "আরও" is the current cell (the page lives in the account menu).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| h1 text | "সক্রিয় সেশন" (today) / "নিরাপত্তা" | "নিরাপত্তা" | D16: equals the account-menu item and the crumb; the page holds two sections |
| Telling sessions apart | collapse duplicates / show IP + exact time | show IP + exact time (shared) | collapsing hides real sessions a user may need to end; IP + time is what the API already returns (`ip_address`, `started_at`) |
| Sort | API order / current first | current first, then most recently used | "এই ডিভাইস" at the top is the reference point |
| Where row changes live | re-implement rows in the route / change `SessionList` | `SessionList` (shared request) | the portal account page uses the same component; one fix serves both |

## Files
- `client-admin/src/routes/_staff/security.tsx` — PageContainer, PageHeader, sections, sort
- `client-admin/src/routes/_staff/security.test.tsx` — cases below

## Steps
1. **Read first:** `PLAN/kit/patterns.md` §3 PageHeader/PageContainer, §5 ErrorState; `ui/src/components/session-list.tsx` (props: `sessions`, `onRevoke`, `onRevokeAll`, `revokingId`, `loading`, `onRetry`, `config`, `locale`).
2. Loader: `loadRouteNamespaces('auth', 'calendarFeed', 'nav')`.
3. `SecurityPage` render:
   ```tsx
   const { t } = useTranslation(['auth', 'nav']);
   const sessions = React.useMemo(
     () => [...(sessionsQuery.data ?? [])].sort(
       (a, b) => Number(b.current) - Number(a.current) || b.last_used_at.localeCompare(a.last_used_at)),
     [sessionsQuery.data]);
   return (
     <PageContainer size="narrow">
       <PageHeader title={t('items.security', { ns: 'nav' })}
         {...(i18n.exists('nav:security.pageDescription') ? { subtitle: t('security.pageDescription', { ns: 'nav' }) } : {})} />
       {sessionsQuery.isError ? <ErrorState … (unchanged props) /> : (
         <section aria-labelledby="sessions-title" className="space-y-3">
           <div>
             <h2 id="sessions-title" className="text-h2">{t('sessions.title')}</h2>
             <p className="mt-1 text-text-secondary">{t('sessions.description')}</p>
           </div>
           <SessionList sessions={sessions} … (all other props unchanged) />
         </section>
       )}
       <CalendarFeedCard />
     </PageContainer>
   );
   ```
   The `onRevoke` lookup reads from `sessions` (sorted copy) — same ids. If `nav:security.pageDescription` has landed (shared request), drop the `i18n.exists` guard and pass it directly.
4. Keep `handleRevokeAll`, the `RegionConfigProvider` wrapper and the pending component as they are.
5. Do not edit `SessionList` or `CalendarFeedCard` here.

## Tests
- `security.test.tsx`:
  - update "renders the heading and both sessions": h1 is now "Security" (`level: 1`); "Active sessions" is a `level: 2` heading.
  - new: API returns `[other (last_used older), current]` → the first `session-row` is the current one ("This device").
  - new: query error → ErrorState and the h1 "Security" both render.
- `e2e/journeys/sessions.spec.ts` only asserts `heading level 1` is visible and clicks row buttons — run it; no change expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (row content per the shared request; until then rows look like today's `SessionList`).
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] At most one filled primary button per view (this page has none).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The h1 reads "নিরাপত্তা"; no `items.security` text anywhere.
- [ ] The current device ("এই ডিভাইস") is always the first session.
- [ ] Sessions and the calendar link are two sections, each with an `h2`.

## Out of scope
- Shared request filed: `ui/src/components/session-list.tsx` — IP, device icon, absolute sign-in time, one divided card, total, outline "sign out everywhere" + `ConfirmDialog`, empty state without the "retry" action. Until then rows stay as they are (only re-ordered).
- Shared request filed: `nav.json` `security.pageDescription`. Until then no subtitle.
- `CalendarFeedCard` redesign is calendar-1b's.
- Sessions piling up from repeated sign-ins on the same browser (server keeps every refresh-token family) — a server/auth topic, not a page change.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| session-list: IP, sign-in time, device icon, one framed divide-y list, total footer, outline red sign-out-all via ConfirmDialog, no retry in EmptyState | Accepted | 31.2.14a | <SessionList …> as today (variant='full' is the default); new strings live in common.json sessionList.* — do not add them to auth.json |
| nav.json security.pageDescription | Accepted | 31.3.4a | key: nav:security.pageDescription (new security object) |

Wave: 9   Lane: admin   Decisions: D5, D9, D15, D16, D28, D29   Depends on: 31.3.8b, 31.4.admin-3
