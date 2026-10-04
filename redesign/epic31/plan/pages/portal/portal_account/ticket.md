# [31.4.portal-10] Portal account — fix push error key, cap devices, tidy contact card

## Goal
`/portal/account` shows a translated push-notification error instead of `push.errors.listFailed`, lists at most 5 signed-in devices (current first) with a "show all" toggle, shows email and phone as labelled rows with a verified badge and a formatted phone, drops the duplicate language/theme card, and sits in the kit header and narrow container, matching the "after" screenshots.

## What and why
This is where a guardian or student keeps their name, contact details, password, notifications and signed-in devices. Today the page is 4,385 px tall: about 20 identical "Chrome · Windows" device rows push everything else away, the push card prints a raw i18n key, the phone number is shown raw, "নির্ধারিত নয়" sits next to a "পরিবর্তন করুন" button for a value that does not exist, and language/theme repeat what the account menu now holds (D12). The redesign fixes the key, caps the device list, makes the contact rows readable and removes the duplicate card — the page drops to about 2,600 px on desktop.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_account/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_account/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_account/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_account/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageContainer size="narrow"` + `PageHeader` (title `account.title`, **New** subtitle). Remove `max-w-2xl` and the hand-made `<h1>`; cards in `space-y-6`. | D15, D16, D17 |
| 2 | Push card | Error text = `tPush(push.error.replace(/^push\./, ''))` — the hook returns `push.errors.listFailed`, already prefixed with the namespace, so `tPush()` looked up `push.push.errors…` and printed the key. | D9 (raw key on screen) |
| 3 | Devices card | Sort current session first, then `last_used_at` newest first; pass only the first 5 to `SessionList` unless expanded; **New** ghost toggle "সব ২২টি ডিভাইস দেখুন" / "কম দেখান" (`aria-expanded`) when there are more than 5. Card gets the existing `auth:sessions.description` line under its title. | ~20 rows made the page 4,400 px tall |
| 4 | Email & phone card | Rows (`div`, icon `mail` / `smartphone`) with the field name as a caption (`account.profile.fields.email` / `.phone`), the value (`formatPhone` for the phone, email `break-all`), and a `StatusBadge`: verified = success "যাচাইকৃত" (**New** key; full "যাচাইকৃত <date>" as its `title`), unverified = warning "যাচাই হয়নি" (wording fix). **New** one-line explanation under the title. | D8, D27; status was plain caption text |
| 5 | Missing value | When email/phone is empty: value "যোগ করা হয়নি" (wording fix of `account.contact.none`) in `text-text-secondary`, and the button reads "যোগ করুন" with a `plus` icon (**New** key) — same `ContactChangeDialog`. | "Change" made no sense for a value that does not exist |
| 6 | Preferences card | Removed (language + theme). | D12: both live in the account menu and the desktop top bar (31.3.2); a third copy only adds length |
| 7 | Sign out | Kept as the last element, outline, `log-out` icon, `w-full md:w-auto`. | A guardian on a shared family phone (file header) |
| 8 | Loading skeleton | Drop `max-w-2xl`; bars shaped like header + cards. | D15, D28 |

## Mobile behaviour
- One column; every Save / Change / toggle button is 44 px (portal density), Save buttons full width.
- Contact rows wrap: icon + label/value on the left, the outline button on the right; a long email breaks instead of being cut.
- The device list shows 5 rows and the toggle; "সব জায়গা থেকে সাইন আউট" stays at the card's foot.
- The bottom bar marks "আরও" (31.3.2).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Primary buttons | one Save for the whole page; split into `?section=` views; one Save per form card | one per form card | the page holds 3 independent forms (profile, contact numbers, password) built by shared components; patterns §9 already allows one filled button per section card when each card is its own form. `SettingsLayout` is the settings lane's local component, not shared |
| Fix for the raw key | change the hook to return `errors.listFailed`; strip the prefix in the route | strip in the route | `ui/src/pwa` is shared; this route is the hook's only consumer (`rg "push.error"`) |
| Device cap | paginate; scroll box; first 5 + toggle | first 5 + toggle | current device + the most recent ones answer "is someone else signed in?"; the rest is one tap away |
| Preferences card | keep; remove | remove | D12 moved language/theme into the account menu for every role |
| Calendar link card | move; keep | keep in place, unchanged | `calendar-feed-card.tsx` belongs to calendar-1b (addendum 8) |

## Files
- `client-admin/src/routes/portal/account.tsx` — header, container, push error key, device cap + toggle, contact rows, remove preferences card, skeleton
- `client-admin/src/routes/portal/account.test.tsx` — updated assertions
- `e2e/journeys/portal-account.spec.ts` — `rowFor(account.phone)` must match the formatted phone
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — new keys, two wording fixes, remove `account.preferences.*` (also changed by portal-1…9, run earlier)

## Steps
1. Imports: add `PageHeader`, `PageContainer`, `StatusBadge` from `@biddaloy/ui/components`; `formatPhone` from `@biddaloy/ui/utils`; `MailIcon`, `SmartphoneIcon`, `PlusIcon`, `ChevronDownIcon`, `ChevronUpIcon` from `lucide-react`. Remove `LocaleSwitcher`, `ThemeToggle`.
2. Loaded frame: `<PageContainer size="narrow"><PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />` then the cards (the container's `space-y-6` spaces them). Pending / error frames keep no `<h1>` (file contract); `AccountSkeleton` drops `max-w-2xl` and gets `h-9 w-2/5` + `h-5 w-3/5` header bars above the card bars.
3. Push: `error={push.error ? tPush(push.error.replace(/^push\./, '')) : null}` with a one-line comment: the hook returns the key with its namespace prefix.
4. Contact card: `<Card asChild padded><section aria-labelledby="account-contact-title">` → `h2.text-h2` (`id`) + `p.mt-1.text-text-secondary` `t('account.contact.explanation')` + `div.mt-3.divide-y.divide-border-subtle.border-t.border-border-subtle` with one row per field. Extract a local `ContactRow({ icon, label, value, verifiedAt, onChange })` in the route file: row `div.flex.flex-wrap.items-center.gap-x-3.gap-y-2.py-3` (keep it a `div` holding both the value and the button — the e2e `rowFor` relies on that); icon `shrink-0 text-text-secondary`; `div.min-w-0.flex-1` → `p.text-caption.text-text-secondary` label + value line `p.flex.flex-wrap.items-center.gap-x-2.gap-y-1`: value `span.break-all.font-medium` (phone = `formatPhone(currentUser.phone, config)`), then `verifiedAt ? <StatusBadge tone="success" label={t('account.contact.verifiedShort')} title={t('account.contact.verified', { date: formatDate(new Date(verifiedAt), config) })} /> : <StatusBadge tone="warning" label={t('account.contact.unverified')} />`. Empty value → `p.text-text-secondary` `t('account.contact.none')`, no badge. Button: outline, `onClick={onChange}`, label `value ? t('account.contact.change') : t('account.contact.add')` (with `PlusIcon size-4` when adding). If `StatusBadge` does not forward `title`, wrap it in `<span title=…>`.
5. Devices: `const [showAllDevices, setShowAllDevices] = React.useState(false)`; `const sortedSessions = [...(sessionsQuery.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || b.last_used_at.localeCompare(a.last_used_at))`; pass `sessions={showAllDevices ? sortedSessions : sortedSessions.slice(0, 5)}`; keep `onRevoke` looking up `sessionsQuery.data` (unchanged). Card: `<Card asChild padded><section aria-labelledby="account-devices-title">` → `h2.text-h2` + `p.mt-1.text-text-secondary` `tAuth('sessions.description')` + `div.mt-3` `SessionList`; after it, when `sortedSessions.length > 5`, a ghost `Button` `className="mt-1 w-full md:w-auto"` `aria-expanded={showAllDevices}` with chevron icon and `showAllDevices ? t('account.devices.showFewer') : t('account.devices.showAll', { count: sortedSessions.length })`.
6. Delete the preferences `Card` (`:433-449`) and its comment.
7. Sign out: keep the handler; `className="w-full md:w-auto md:self-start"`.
8. Locale (en / bn), under `portal.account`: `subtitle` "Your name, contact details, password and signed-in devices." / "আপনার নাম, যোগাযোগ, পাসওয়ার্ড আর সাইন-ইন করা ডিভাইস।"; `contact.explanation` "You sign in with these, and need them if you forget your password." / "সাইন ইন করতে আর পাসওয়ার্ড ভুলে গেলে এগুলো লাগে।"; `contact.verifiedShort` "Verified" / "যাচাইকৃত"; `contact.add` "Add" / "যোগ করুন"; `devices.showAll_one` / `devices.showAll_other` "Show all {{count}} devices" / "সব {{count}}টি ডিভাইস দেখুন"; `devices.showFewer` "Show fewer" / "কম দেখান". Wording fixes: `contact.none` "Not set" → "Not added" / "নির্ধারিত নয়" → "যোগ করা হয়নি"; `contact.unverified` bn "অযাচাইকৃত" → "যাচাই হয়নি". Remove `account.preferences` (title, language, theme).

## Tests
- `account.test.tsx`: drop the "Preferences" heading assertions (both role cases); keep Profile / Email & phone / Change password / Sign out and the zero-`h1` pending/error cases. Add: with 8 sessions (one `current`), 5 rows render, the current one first, and "Show all 8 devices" reveals 8 and flips `aria-expanded`; with `usePushSubscription` failing its list call (mock `GET /me/push/subscriptions` 500), the card shows "Couldn't load your devices…" text and not `push.errors.listFailed`; a user with `phone: null` shows "Not added" and an "Add" button; a verified email shows a "Verified" badge; the phone renders formatted (`01711-000004`).
- `e2e/journeys/portal-account.spec.ts`: `rowFor(account.phone)` → `rowFor(account.phone.slice(-6))` (the displayed phone gains a hyphen after the 5th digit; the last six digits stay contiguous). Other selectors (`#account-guardian-phone`, `#account-change-*`, dialog labels) unchanged.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] One filled primary per form card (Profile, Contact numbers, Password); no other filled button.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The push card never shows `push.errors.*`.
- [ ] With 20+ sessions the devices card shows 5 rows and a "show all" toggle; the current device is first.
- [ ] Email and phone rows show a label, a formatted value and a badge; an empty value reads "যোগ করা হয়নি" with a "যোগ করুন" button.
- [ ] No language / theme card on the page.

## Out of scope
- `SessionList` look (bordered row cards, red filled "sign out everywhere", two meta lines) — filed in `shared-requests.md`; the mockup shows the requested look. Refused → rows keep today's look, still capped at 5.
- `ProfileForm`, `GuardianContactForm`, `ChangePasswordForm`, `PushNotificationSettings` look (titles, two-column fields, right-aligned Save, notice colours) — filed in `shared-requests.md`; the mockup shows the requested look.
- Why `GET /me/push/subscriptions` fails in the audit environment (likely push not configured) — not a page issue; the message is now readable.
- `calendar-feed-card.tsx` — placed unchanged (calendar-1b owns it); the mockup's version is approximate.
- Guardian phone fields still show the raw number inside `GuardianContactForm` — part of the shared form request above.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| session-list compact list: outline red sign-out-all, one ul.divide-y, one meta line, icon sign-out per row, device icon, success badge | Accepted | 31.2.14a | <SessionList variant="compact" …> inside the page's Devices card; the page still slices to 5 rows |
| profile / guardian-contact / change-password / push cards to kit form look | Accepted | 31.2.14a | no prop change — place the four components as today |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: portal   Decisions: D8, D9, D12, D15, D16, D17, D27, D28, D29   Depends on: 31.3.8b, 31.4.portal-9
