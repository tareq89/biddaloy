# [31.4.guest-2] Password and link pages — one layout, no dead ends

## Goal
`/forgot-password`, `/reset-password`, `/activate` and `/verify-email` sit in `AuthLayout`, every "link problem" state says in plain words what happened and offers a real next step, and every form step uses the kit heading — matching the "after" screenshots (forgot = identifier step, reset = new-password form, activate = incomplete-link state; verify-email and the remaining states follow the same layout).

## What and why
These four pages finish things that started in an email or SMS: recover a password, set a first password from an invitation, confirm a new email address. Today each state is a dashed card inside the frame, the wording talks about a "টোকেন", the buttons say "লগ ইন" on one page and "সাইন ইন করুন" on another, `/activate` tells the visitor to "request a new link below" but offers only a sign-in button, the "email sent" screen tells you to request a link below although you just did, and a failed check on `/activate` and `/verify-email` shows a "লগ ইন" button that actually retries. The redesign gives all four pages `AuthLayout`, one shared status block, the resend form wherever a new link is the answer, and one wording.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — `/forgot-password` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/forgot-password/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/forgot-password/before-mobile.webp?raw=true" width="260"> |
| After — `/forgot-password` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/forgot-password/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/forgot-password/mobile.webp?raw=true" width="260"> |
| Before — `/reset-password` (no-link state) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/reset-password/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/reset-password/before-mobile.webp?raw=true" width="260"> |
| After — `/reset-password` (form) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/reset-password/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/reset-password/mobile.webp?raw=true" width="260"> |
| Before — `/activate` (no-link state) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/activate/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/activate/before-mobile.webp?raw=true" width="260"> |
| After — `/activate` (no-link state) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/activate/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/activate/mobile.webp?raw=true" width="260"> |
| Before — `/verify-email` (no-link state) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/verify-email/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/verify-email/before-mobile.webp?raw=true" width="260"> |

`/verify-email` has no "after" mockup: its states use the same status block as the `/activate` mockup (icon well, `text-h2` title, sentence, full-width buttons), see the state table in step 7.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | All four routes | `AuthScreen` → `AuthLayout` from `@biddaloy/ui`; delete `client-admin/src/routes/-auth-screen.tsx` (no importer left after guest-1 and this ticket). | D34 |
| 2 | Every status state | `RouteStatusState` (a second, dashed card inside the layout card) → **New** route helper `GuestStatus` (`-guest-status.tsx`): icon well in a status tone, `<h1 class="text-h2">` title, sentence, then the state's buttons full width. Inline SVG icons → `lucide-react`. | Card-in-card (kit Card rule); D27 tones; one look for every link problem |
| 3 | Form steps (forgot identifier, forgot code, inline forms) | Route-owned cards lose their own frame (`rounded-lg border … bg-card p-8`); heading becomes kit `text-h1 text-balance` left-aligned + `mt-0.5 text-text-secondary` subtitle. | The layout owns the card; same heading as the shared forms (31.2.12) |
| 4 | `/forgot-password` identifier step | Heading "পাসওয়ার্ড ভুলে গেছেন?"; subtitle says what happens next (code to a phone, link to an email); button "কোড বা লিংক পাঠান" (was "চালিয়ে যান"); back link → ghost button-link with an arrow. | One obvious action that says what it does |
| 5 | `/forgot-password` "link sent" | Explanation becomes "open the link in that email… check spam" (was "request a new one below", with nothing below). | Wrong instruction |
| 6 | Set-password steps (`/reset-password`, forgot step 3) | Heading "নতুন পাসওয়ার্ড দিন" + subtitle (was "আপনার পাসওয়ার্ড রিসেট করুন" again). `/activate` keeps "স্বাগতম, {name} — {school}" and gains a subtitle. | The step's job, not the flow's name |
| 7 | `/reset-password` bad / expired link | Explanation points to "পাসওয়ার্ড ভুলে গেছেন?"; one primary "নতুন লিংক চান" → `/forgot-password`. | Was "request below" with an outline button named like a question |
| 8 | `/activate` incomplete, unknown, expired or revoked link | Resend form shows in all four (was only expired / revoked), with a visible label and the primary "নতুন লিংক পাঠান"; ghost "সাইন ইন পাতায় যান" under it. | Dead end: copy said "request below", page offered only "লগ ইন" |
| 9 | `/activate` used link / suspended | Used: primary "সাইন ইন করুন" + ghost "পাসওয়ার্ড ভুলে গেছেন?". Suspended: **New** sentence "contact your school office" + ghost "সাইন ইন পাতায় যান". | Each state gets the step that fits it |
| 10 | `/activate`, `/verify-email` check failed (network / 5xx) | Button label "আবার চেষ্টা করুন" (`common:actions.retry`), danger tone. Was labelled "লগ ইন" while it retried. | Bug: label did not match action |
| 11 | Loading skeletons | Lose their own card frame; keep `role="status"` + `aria-label`, add `aria-busy="true"`. | Card-in-card |
| 12 | Wording | Every button that leads to `/login` says "সাইন ইন করুন" or "সাইন ইন পাতায় যান". "টোকেন" is already gone via the glossary (31.3.4b). | D32, D34 |

## Mobile behaviour
- One column; every button full width and `h-11`; the status block's icon, title and sentence are centred, the buttons under it stretch.
- The card starts near the top (`AuthLayout`: `items-start pt-4` below `md`) so the keyboard does not cover the resend field.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| How to show a status inside `AuthLayout` | Keep `RouteStatusState` (nested card) / shared change so it drops its card inside the layout / route-local helper | Route-local `-guest-status.tsx`, shared by the guest routes | Fixes the nested card inside the lane's territory; no shared change needed |
| Activate dead end | Change the copy to drop "below" / show the resend form | Show the resend form in every state where a new link is the answer | The visitor needs a link, not a sign-in button |
| Status title level | `text-h3` like EmptyState / `text-h2` | `text-h2`, as the page's only `<h1>` | It is the page heading here; the sentences are long and need weight |
| Primary in a status | Outline everywhere (EmptyState) / primary when it is the next step | Primary for the next step, ghost for "go to sign in" | D29 one filled primary per view; the step that fixes the problem is the obvious action |

## Files
- `client-admin/src/routes/-guest-status.tsx` — **new** helper `GuestStatus`.
- `client-admin/src/routes/-auth-screen.tsx` — **deleted**.
- `client-admin/src/routes/forgot-password.tsx` — layout, kit headings, new copy, `GuestStatus` for "link sent".
- `client-admin/src/routes/reset-password.tsx` — layout, `GuestStatus` for bad/expired link, new heading.
- `client-admin/src/routes/activate.tsx` — layout, state table, resend form everywhere it fits, retry fix.
- `client-admin/src/routes/verify-email.tsx` — layout, state table, retry fix.
- `client-admin/src/routes/forgot-password.test.tsx`, `reset-password.test.tsx`, `activate.test.tsx`, `verify-email.test.tsx` — cases below.
- `ui/src/i18n/locales/en/auth.json`, `ui/src/i18n/locales/bn/auth.json` — keys below (also changed by guest-1, runs earlier).

## Steps
1. **Locale (`auth.json`, en + bn).** Values to change:
   | Key | en | bn |
   |---|---|---|
   | `forgot.heading` | Forgot your password? | পাসওয়ার্ড ভুলে গেছেন? |
   | `forgot.subtext` | Enter the email or phone number you signed up with. We'll text a code to a phone or email a link. | যে ইমেইল বা ফোন নম্বর দিয়ে অ্যাকাউন্ট খুলেছেন তা দিন। ফোন নম্বর দিলে একটি কোড, ইমেইল দিলে একটি লিংক পাঠাব। |
   | `forgot.linkExplanation` | Ask for a new one from "Forgot password?". | “পাসওয়ার্ড ভুলে গেছেন?” থেকে নতুন একটি লিংক চেয়ে নিন। |
   | `activate.linkExplanation` | Ask whoever invited you for a new link, or request one yourself with your email or phone number below. | যিনি আপনাকে আমন্ত্রণ জানিয়েছেন তার কাছে নতুন লিংক চান, অথবা নিচে আপনার ইমেইল বা ফোন নম্বর দিয়ে নিজেই চেয়ে নিন। |
   **New** keys:
   | Key | en | bn |
   |---|---|---|
   | `toSignIn` | Go to sign in | সাইন ইন পাতায় যান |
   | `forgot.send` | Send code or link | কোড বা লিংক পাঠান |
   | `forgot.sentExplanation` | Open the link in that email to choose a new password. If it hasn't arrived in a few minutes, check your spam folder. | ইমেইলের লিংকে ক্লিক করে নতুন পাসওয়ার্ড দিন। কয়েক মিনিটে না এলে স্প্যাম ফোল্ডার দেখুন। |
   | `forgot.requestNew` | Ask for a new link | নতুন লিংক চান |
   | `reset.heading` | Choose a new password | নতুন পাসওয়ার্ড দিন |
   | `reset.subtext` | You'll use it to sign in from now on. | এরপর থেকে এই পাসওয়ার্ড দিয়ে সাইন ইন করবেন। |
   | `activate.subtext` | Choose a password to switch on your account. | অ্যাকাউন্ট চালু করতে একটি পাসওয়ার্ড বেছে নিন। |
   | `activate.suspendedExplanation` | Contact your school office. | আপনার স্কুলের অফিসে যোগাযোগ করুন। |
   `forgot.continue` stays (code step). `verifyEmail.signIn` / `submit.action` already read "সাইন ইন করুন" after guest-1.
2. **`-guest-status.tsx` (new).**
   ```tsx
   import type { LucideIcon } from 'lucide-react';
   const TONE = {
     info: 'bg-status-partial-bg text-status-partial-fg',
     success: 'bg-status-paid-bg text-status-paid-fg',
     warning: 'bg-status-due-bg text-status-due-fg',
     danger: 'bg-status-overdue-bg text-status-overdue-fg',
   } as const;
   export function GuestStatus({ icon: Icon, tone, title, explanation, headingLevel = 'h1', children }: {
     icon: LucideIcon; tone: keyof typeof TONE; title: string; explanation?: string;
     headingLevel?: 'h1' | 'h2'; children?: React.ReactNode;
   }) {
     const Heading = headingLevel;
     return (
       <div>
         <div role={tone === 'danger' ? 'alert' : 'status'} className="flex flex-col items-center gap-2 text-center">
           <span aria-hidden="true" className={`flex size-12 items-center justify-center rounded-full ${TONE[tone]}`}><Icon className="size-6" /></span>
           <Heading className="text-h2 text-balance">{title}</Heading>
           {explanation && <p className="text-text-secondary">{explanation}</p>}
         </div>
         {children && <div className="mt-5 flex flex-col gap-2">{children}</div>}
       </div>
     );
   }
   ```
   Buttons passed as children: primary `<Button className="w-full">`, ghost `<Button variant="ghost" className="w-full text-primary">` (or a `Link` with the kit standalone-link classes `flex h-11 w-full items-center justify-center rounded-md px-3 font-medium text-primary hover:bg-muted`). guest-3 reuses this helper with `headingLevel="h2"`.
3. **All four routes:** `import { AuthLayout } from '@biddaloy/ui/components'`, replace every `<AuthScreen>` with `<AuthLayout>`, remove the local `LinkIcon` / `MailIcon` SVGs (use `lucide-react` `Link2Off`, `MailCheck`, `CircleCheck`, `TriangleAlert`, `UserX`, `ArrowLeft`). Delete `-auth-screen.tsx`.
4. **`forgot-password.tsx`.**
   - `IdentifierStep`: `<form className="flex flex-col gap-4">` (no frame). Heading block `<div><h1 ref tabIndex={-1} className="text-h1 text-balance outline-none">{t('forgot.heading')}</h1><p className="mt-0.5 text-text-secondary">{t('forgot.subtext')}</p></div>`; error banner unchanged; submit `<Button type="submit" loading className="mt-1 w-full">{t('forgot.send')}</Button>`; back link `<Link to="/login" className="flex h-11 w-full items-center justify-center gap-2 rounded-md px-3 font-medium text-primary hover:bg-muted"><ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t('forgot.backToLogin')}</Link>`.
   - `CodeStep`: same frame removal + heading classes (`forgot.codeHeading` / `forgot.codeSubtext`); OTP label `text-label`; resend stays a ghost button; "চালিয়ে যান" stays the primary, `w-full`.
   - `linkSent`: `<GuestStatus icon={MailCheck} tone="info" title={t('forgot.sent')} explanation={t('forgot.sentExplanation')}><Button variant="outline" className="w-full" onClick={→ /login}>{t('forgot.backToLogin')}</Button></GuestStatus>`.
   - Password step: `SetPasswordForm heading={t('reset.heading')} subtext={t('reset.subtext')}`.
5. **`reset-password.tsx`.** No token → `<GuestStatus icon={Link2Off} tone="warning" title={t('forgot.invalidLink')} explanation={t('forgot.linkExplanation')}>` + primary `<Button className="w-full" onClick={→ /forgot-password}>{t('forgot.requestNew')}</Button>` + ghost `toSignIn` → `/login`. Expired (401) → same with `title={t('forgot.linkExpired')}`. Form → `SetPasswordForm heading={t('reset.heading')} subtext={t('reset.subtext')}`.
6. **`activate.tsx`.** Replace `TerminalCard` with this table (status → `GuestStatus` props + children):
   | State | icon / tone | title | explanation | children |
   |---|---|---|---|---|
   | no token | `Link2Off` / warning | `activate.missingToken` | `activate.linkExplanation` | `ResendForm`, ghost `toSignIn` |
   | `unknown`, `expired`, `revoked` | `Link2Off` / warning | `activate.<status>` | `activate.linkExplanation` | `ResendForm`, ghost `toSignIn` |
   | `consumed` | `CircleCheck` / info | `activate.consumed` | — | primary `submit.action` → `/login`, ghost `forgot.link` → `/forgot-password` |
   | `suspended` | `UserX` / danger | `activate.suspended` | `activate.suspendedExplanation` | ghost `toSignIn` |
   | verify failed (`isError`) | `TriangleAlert` / danger | `errors.generic` | — | outline `t('common:actions.retry')` → `verifyQuery.refetch()` |
   `ResendForm`: `<form className="flex flex-col gap-4 border-t border-border-subtle pt-5">` (inside the children wrapper), visible `<Label htmlFor="activate-resend-identifier">{t('activate.resendLabel')}</Label>` (drop `sr-only`), `Input placeholder={t('identifier.placeholder')} autoComplete="username"`, `<Button type="submit" className="w-full">{t('activate.resendAction')}</Button>`; success text `role="status"` unchanged. Skeleton: `<div role="status" aria-busy="true" aria-label={t('activate.verifying')} className="flex flex-col gap-4">` (no frame). Valid → `SetPasswordForm heading={t('activate.welcome', …)} subtext={t('activate.subtext')}`.
7. **`verify-email.tsx`.**
   | State | icon / tone | title | explanation | children |
   |---|---|---|---|---|
   | no token | `Link2Off` / warning | `verifyEmail.missingToken` | `verifyEmail.linkExplanation` | primary `verifyEmail.signIn` → `/login` |
   | not valid | `Link2Off` / warning | `verifyEmail.linkExpired` | `verifyEmail.linkExplanation` | primary `verifyEmail.signIn` → `/login` |
   | check failed | `TriangleAlert` / danger | `errors.generic` | — | outline `common:actions.retry` → refetch, ghost `toSignIn` |
   | success | `CircleCheck` / success | `verifyEmail.success` | `verifyEmail.successSubtext` | primary `verifyEmail.signIn` → `/login` |
   Skeleton as in step 6. `common` is already loaded for every route by `__root`; if the retry label shows a key, add `loader: () => loadRouteNamespaces('auth', 'common')`.
8. `rtk vitest client-admin/src/routes/{forgot-password,reset-password,activate,verify-email}.test.tsx`, i18n key check, `rtk tsc`.

## Tests
- `forgot-password.test.tsx`: submit button name `'Send code or link'` (was `'Continue'` for step 1 — the code step keeps `'Continue'`); "link sent" shows `forgot.sentExplanation`; the password step heading is `'Choose a new password'`.
- `reset-password.test.tsx`: no-token state has a button `'Ask for a new link'` that navigates to `/forgot-password`.
- `activate.test.tsx`: **new** — no-token state renders the resend field (label `'Email or phone number'`) and `'Send a new link'`; **new** — a failed verify shows a `'Try again'` button that calls the verify endpoint again (no `'Sign in'` button); suspended shows `'Contact your school office.'`.
- `verify-email.test.tsx`: success still has `'Sign in'`; **new** — failed check shows `'Try again'`.
- e2e: `e2e/journeys/activation.spec.ts`, `e2e/journeys/password-recovery.spec.ts` select by `t()` keys or not at all on these pages — run both once; no edit expected.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshots.
- [ ] Mobile at 390 px matches the "after" screenshots; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No card inside the layout card in any state of the four pages; `-auth-screen.tsx` is gone.
- [ ] `/activate` with no / unknown / expired / revoked link shows the resend form; no state tells the user to use something that is not on screen.
- [ ] Every retry button says "আবার চেষ্টা করুন"; every button that goes to `/login` says "সাইন ইন করুন" or "সাইন ইন পাতায় যান".
- [ ] Set-password steps read "নতুন পাসওয়ার্ড দিন" (reset) or the welcome line (activate), each with a subtitle.

## Out of scope
- `SetPasswordForm`, `OtpInput` and the inset password toggle are `ui` components (foundation 31.2.12) — used as they are.
- No shared requests from this ticket.

Wave: 9   Lane: guest   Decisions: D9, D27, D28, D29, D32, D34   Depends on: 31.3.8b, 31.4.guest-1
