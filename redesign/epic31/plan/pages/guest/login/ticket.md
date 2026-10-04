# [31.4.guest-1] Sign in and choose school — one card, plain words

## Goal
`/login` and `/select-school` sit in the shared `AuthLayout` (logo, language switcher, one card), the sign-in method tabs live inside the card, every label says "সাইন ইন", and the school picker offers a way out to another account — matching the "after" screenshots.

## What and why
`/login` is the one door for staff, guardians and students; `/select-school` follows it when one account belongs to several schools. Today the method tabs float above the logo, outside the card; the subtitle says "আপনার স্টাফ অ্যাকাউন্টের…" although guardians use the same page; the screen says "লগ ইন" while the account menu says "সাইন আউট"; the phone placeholder is cut off; and the school picker has its own chrome (theme toggle, no logo) and no way back if you signed in with the wrong account. The redesign puts both pages in `AuthLayout`, moves the tabs to the top of the card, uses "সাইন ইন" everywhere and adds "অন্য অ্যাকাউন্টে সাইন ইন করুন".

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — `/login` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/login/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/login/before-mobile.webp?raw=true" width="260"> |
| After — `/login` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/login/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/login/mobile.webp?raw=true" width="260"> |
| Before — `/select-school` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/select-school/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/select-school/before-mobile.webp?raw=true" width="260"> |
| After — `/select-school` | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/select-school/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guest/select-school/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Both routes | Wrap in `AuthLayout` from `@biddaloy/ui` (language switcher top right, logo + "SchoolManager", one `max-w-md` card). `/login` drops `AuthScreen`; `/select-school` drops its own `ThemeToggle` / `LocaleSwitcher` / `useDensity` chrome. | D34; logo only appeared on login, picker had a different frame |
| 2 | `/login` tabs | Tabs move inside the card, first thing in it, full width, kit underline style; labels shortened to "পাসওয়ার্ড দিয়ে" / "ফোনে কোড দিয়ে" (the heading under them already says "সাইন ইন"). | Tabs floated above the logo, detached from the form they switch |
| 3 | Wording | "লগ ইন" → "সাইন ইন" in heading, submit button ("সাইন ইন করুন"), busy label, OTP verify button, back link. | D32 one word per thing; the account menu, sessions and audit log already say "সাইন ইন / সাইন আউট" |
| 4 | Identifier placeholder | "rahim@greenview.edu.bd অথবা ০১XXXXXXXXX" → "01XXXXXXXXX বা ইমেইল" (Latin digits). | Cut off on phone; D6 phone digits stay Latin |
| 5 | Forgot link | Underlined right-aligned text link → full-width ghost button-link, 44 px, centred (kit standalone link). | D29; 44 px target |
| 6 | `/select-school` | **New** ghost button "অন্য অ্যাকাউন্টে সাইন ইন করুন" under "চালিয়ে যান": signs out and goes to `/login`. | No way out when signed in with the wrong account |

The subtitle fix ("যে ইমেইল বা ফোন নম্বর দিয়ে অ্যাকাউন্ট খুলেছেন তা দিন।") is already applied by the glossary (31.3.4b); not repeated here.

## Mobile behaviour
- Same single card; language switcher stays top right (`h-11` at every width — guest pages are comfortable density).
- Card starts near the top (`items-start pt-4`) instead of vertically centred, so the keyboard does not cover the fields.
- Tabs keep one row (`flex-1` each); short labels fit at 360 px.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Sign-in verb | "লগ ইন" (kit starter) / "সাইন ইন" | "সাইন ইন" (heading), "সাইন ইন করুন" (buttons) | Every signed-in surface already says সাইন ইন / সাইন আউট (`nav.json` account menu, `auth.sessions`, `auditLogs`); D32 |
| Where the tabs sit | Above the card (today) / inside card above heading / route renders its own heading above tabs | Inside the card, above the form's own heading | `SignInForm` and `OtpSignInForm` render their own `<h1>`; putting tabs first avoids a second h1 and needs no shared change |
| Placeholder | Keep a full example / help text under the field / short placeholder | Short placeholder "01XXXXXXXXX বা ইমেইল" | The label already names both options; a short hint fits at 360 px |
| Wrong-account way out | None / link to `/login` only / sign out then `/login` | Sign out then `/login` | Going to `/login` with a live session would bounce straight back |

## Files
- `client-admin/src/routes/login.tsx` — `AuthLayout`, tabs inside the card, forgot link classes.
- `client-admin/src/routes/select-school.tsx` — `AuthLayout`, remove own chrome, new sign-out button.
- `client-admin/src/routes/login.test.tsx` — tab name update.
- `client-admin/src/routes/select-school.test.tsx` — new case for the sign-out button.
- `ui/src/i18n/locales/en/auth.json`, `ui/src/i18n/locales/bn/auth.json` — wording below.

## Steps
1. **Locale (`auth.json`, en + bn).** Change these values (keys stay):
   | Key | en | bn |
   |---|---|---|
   | `heading` | Sign in | সাইন ইন |
   | `submit.action` | Sign in | সাইন ইন করুন |
   | `submit.loading` | Signing in | সাইন ইন করা হচ্ছে |
   | `otp.verify` | Sign in | সাইন ইন করুন |
   | `otp.verifying` | Signing in | সাইন ইন করা হচ্ছে |
   | `tabs.password` | With password | পাসওয়ার্ড দিয়ে |
   | `tabs.otp` | With a phone code | ফোনে কোড দিয়ে |
   | `identifier.placeholder` | 01XXXXXXXXX or email | 01XXXXXXXXX বা ইমেইল |
   | `forgot.backToLogin` | Back to sign in | সাইন ইন পাতায় ফিরে যান |
   Add **New** `schoolPicker.signOut`: en "Sign in with another account", bn "অন্য অ্যাকাউন্টে সাইন ইন করুন".
2. **`login.tsx`.** Replace `import { AuthScreen } from './-auth-screen'` with `AuthLayout` from `@biddaloy/ui/components`; `<AuthLayout>` wraps the `<Tabs>`. Inside the layout the forms already drop their own logo and card (foundation 31.2.12). `TabsList className="mb-5 w-full"`, each `TabsTrigger className="flex-1"` (kit Tabs pattern: underline, `h-11`). Do not delete `-auth-screen.tsx` yet — guest-2's routes still import it.
3. **Forgot link** (`secondaryAction` of `SignInForm`): `className="flex h-11 w-full items-center justify-center rounded-md px-3 text-body-lg font-medium text-primary hover:bg-muted"` (kit standalone link — no underline, no `after:` hit-area hack).
4. **`select-school.tsx`.** Remove `ThemeToggle`, `LocaleSwitcher`, `useDensity` imports and the outer `div` chrome; render
   ```tsx
   <AuthLayout>
     <SchoolPicker schools={memberships} onSelect={handleSelect} />
     <Button variant="ghost" className="mt-2 w-full text-primary" onClick={handleSignOut}>
       {t('schoolPicker.signOut')}
     </Button>
   </AuthLayout>
   ```
   with `const { t } = useTranslation('auth')` and `function handleSignOut() { void logout(queryClient).finally(() => void navigate({ to: '/login' })); }` (`logout` is already imported). Keep the mount effect and the `memberships.length < 2` early return unchanged.
5. Run `rtk vitest` for both route tests and `node scripts/check-i18n-keys.mjs` (or the repo's i18n check) for the new key.

## Tests
- `login.test.tsx`: the tab query becomes `getByRole('tab', { name: 'With a phone code' })`; heading/button `'Sign in'` stay valid in English.
- `select-school.test.tsx`: new case — clicking "Sign in with another account" calls `logout` (spy on `@biddaloy/ui/hooks`' `logout`) and navigates to `/login`.
- `e2e/pages/login-page.ts` reads every label through `t('auth.…')`, so it needs no change; `e2e/config.ts` and `e2e/reduced-motion.spec.ts` hold literal Bangla — not in Files; updated by 31.5.0 (wave-4 close).
- Run `e2e/journeys/otp-login.spec.ts` and `e2e/fixtures/session.spec.ts` locally once.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Both pages show one logo, the labelled language switcher and no theme toggle.
- [ ] The method tabs are inside the card, above "সাইন ইন".
- [ ] No "লগ ইন" left on either page; the placeholder is fully visible at 360 px.
- [ ] "পাসওয়ার্ড ভুলে গেছেন?" is a 44 px centred ghost link.
- [ ] `/select-school` "অন্য অ্যাকাউন্টে সাইন ইন করুন" signs out and lands on `/login`.

## Out of scope
- The password field's inset "পাসওয়ার্ড দেখান" toggle and the school cards' `border-input` / `hover:bg-accent` classes live in `ui` (`sign-in-form.tsx`, `school-picker.tsx`) — left as foundation 31.2.12 leaves them.
- `e2e/config.ts` (`shells.app.heading` `'লগ ইন'` → `'সাইন ইন'`) and `e2e/reduced-motion.spec.ts` (button `'লগ ইন'` → `'সাইন ইন করুন'`) — updated by 31.5.0 (wave-4 close); shared request filed.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| e2e/config.ts heading + reduced-motion.spec.ts button literals | Accepted | 31.3.8a | both read auth.heading / auth.submit.action from the locale files after 31.3.8a; guest-1 renames the keys' values and edits neither e2e file |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: guest   Decisions: D6, D9, D29, D32, D34   Depends on: 31.3.8b
