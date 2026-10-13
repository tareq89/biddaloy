# Security

This is the deep rationale behind the auth/data-protection posture — moved
here from the root README so that README stays a practical "get the app
running" doc. See also [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md)
for the higher-level shape (diagrams) this detail sits underneath.

## The layers, at a glance

```mermaid
flowchart TD
    A["POST /auth/login"] --> B["Per-IP rate limit\n(5 req/60s)"]
    B --> C["Per-identifier lockout\n(5 fails / 15 min)"]
    C --> D["Progressive delay\n(500ms → 2s per fail)"]
    D --> E["bcrypt.compare\n(same code path whether user\nexists or not — no enumeration)"]
    E --> F["Access token (15 min)\n+ refresh token cookie (30 days)"]

    F --> G["Every API request"]
    G --> H["Bearer token in header\n→ no CSRF risk, browser never\nauto-attaches it"]

    F --> I["POST /auth/refresh or /logout"]
    I --> J["Refresh cookie\n(ambient credential)"]
    J --> K["SameSite=Strict\n+ SameOriginGuard\n+ __Host- prefix"]

    E -.->|"every significant action"| L["Audit log\n(write-only, redacted)"]
```

**PermissionsGuard fails closed.** A route behind it needs `@RequirePermissions(...)` or `@AuthenticatedOnly()` (identity-scoped, e.g. `GET /users/me`). A route with neither gets `403 This route declares no permission`, so a forgotten permission is a runtime refusal, not a silent allow.

Each box below is one paragraph in this doc — read the section with the
matching name for the full reasoning.

Before any of that runs, **boot-time config refusal** (`assertProductionConfig`
in `server/src/config/env.validation.ts`): with `NODE_ENV=production` the
server will not start on a placeholder or weak secret, a malformed
`CORS_ORIGINS`, or a missing `SETTINGS_ENCRYPTION_KEY` / `APP_BASE_URL` /
`PUBLIC_APP_URL`. `yarn config:check` runs those checks on demand, plus the
`DB_SSL`, encryption-key shape and https URL checks (07-deployment.md). Dev, test and CI are
unaffected.

## Login brute-force protection

`POST /auth/login` layers three controls, defined in
`server/src/modules/auth/`:

- **Per-IP rate limit** — the same `strict` tier (5 requests/60s) used on
  other expensive endpoints (see `rate-limit.ts`).
- **Per-identifier lockout** (`login-attempt.service.ts`) — the normalized
  email/phone is locked out after **5 failed attempts** within a **15-minute
  window**, both Redis-backed and configurable via `LOGIN_LOCKOUT_THRESHOLD`
  and `LOGIN_LOCKOUT_WINDOW_MS`. A successful login resets the counter. The
  lock expires automatically after the window — there is no admin-reset
  path, since a pure admin-reset lock is itself a denial-of-service vector
  against a known account.
- **Progressive delay** — failures before the lockout threshold add an
  increasing delay (500ms per attempt, capped at 2s), to blunt a slow
  distributed attack without hard-locking real users on a couple of typos.

The response body, status, and code path are identical for "no such user",
"wrong password", and "locked out" — `AuthService.validateUser` always runs
`bcrypt.compare` (against a dummy hash when no user is found), so there's no
timing or content difference an attacker could use to enumerate accounts.

Both lockout and the strict rate-limit tier are disabled under
`NODE_ENV=test` — the e2e suite logs in repeatedly against the same seeded
account and would otherwise lock itself out.

### When Redis is down (75.18)

Most of the app keeps working; only the routes where "no rate limit" means "unlimited password guessing" stop.

```mermaid
flowchart TD
  R[Request] --> T{"rate-limit store<br/>(Redis) reachable?"}
  T -- yes --> N[normal limit, 429 when over]
  T -- no --> A{"route marked<br/>@FailClosedWithoutRedis()?"}
  A -- yes --> X["503 This action is temporarily unavailable"]
  A -- no --> O["served; error logged (fails open)"]
```

The mark is a decorator on the handler or controller, read by `AppThrottlerGuard` through
`Reflector`, so the rule moves with the route. `app-throttler.guard.spec.ts` pins the exact set
of marked routes: a new password- or code-checking route must be added there on purpose.

| Part                                                                                                                                                              | Redis down                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sign-in, activation, OTP, reset, register, step-up, `change-password`, social sign-in/link/unlink, Meta's data-deletion callback, `POST /users/me/contact-change` | 503 (`@FailClosedWithoutRedis()`)                                                                                    |
| `POST /auth/refresh`, `logout`, `logout-all`, `GET/DELETE /auth/sessions`                                                                                         | work (refresh tokens are DB rows)                                                                                    |
| `GET /auth/social/providers`, `/identities`, `/facebook/data-deletion/status`                                                                                     | work (read-only)                                                                                                     |
| Every other route                                                                                                                                                 | served, no rate limit (fails open)                                                                                   |
| Login lockout, access-token denylist                                                                                                                              | fail open                                                                                                            |
| "Log out everywhere", member removal                                                                                                                              | still ends every session: they set `users.tokens_valid_after` in Postgres, which `JwtStrategy` reads on each request |
| Single-session revoke (`DELETE /auth/sessions/:id`)                                                                                                               | waits out the 15-minute access token                                                                                 |
| `/health/ready`                                                                                                                                                   | `degraded` (HTTP 200), not `fail`                                                                                    |

### Password hashing (75.11)

Every password hash comes from one place, `auth/password-hash.ts`: bcrypt, cost **12**.

```mermaid
flowchart LR
  A["Good sign-in<br/>(hash is cost 10)"] --> B["needsRehash?"]
  B -- yes --> C["UPDATE users SET password_hash = new<br/>WHERE id = ? AND password_hash = old"]
  B -- no --> D[done]
```

- **Upgrade on sign-in.** After the password is proven, a cheaper hash is rewritten. The `AND password_hash = old` condition means a password changed in the meantime always wins. A failed sign-in never rewrites anything.
- **72-byte limit.** bcrypt ignores bytes past 72, so a _new_ password longer than that is refused with `PASSWORD_TOO_LONG` (72 Latin letters, or 24 Bangla letters). Sign-in is never checked, so an older long password keeps working.
- **Dummy hash.** When no user matches, login compares against `DUMMY_PASSWORD_HASH` so the response takes as long as a real one. It is a precomputed cost-12 literal (hashing at import cost every process ~250 ms); `password-hash.spec.ts` fails if its cost ever differs from `BCRYPT_COST`.

## Password recovery

`POST /auth/forgot-password` and `POST /auth/reset-password`
(`server/src/modules/account-access/recovery.service.ts`) let a locked-out
user recover on their own, without an admin's help. The channel is picked
by **which field on the account the typed identifier matched** — not by
preference:

```mermaid
flowchart TD
    A["POST /auth/forgot-password<br/>{ identifier }"] --> B{Matches a user's<br/>email or phone?}
    B -- "no match, or not ACTIVE" --> Z["202 Accepted<br/>(nothing sent — enumeration-safe)"]
    B -- "matched phone" --> C["SMS: 6-digit OTP<br/>(OtpService, Redis, 5 min TTL)"]
    B -- "matched email" --> D["Email: reset link<br/>(AuthTokenService, 1 hour TTL)"]
    C --> E["POST /auth/reset-password<br/>{ phone, otp, new_password }"]
    D --> F["POST /auth/reset-password<br/>{ token, new_password }"]
    E --> G["Password changed"]
    F --> G
    G --> H["All refresh tokens revoked<br/>+ PASSWORD_RESET audit row"]
    H --> I["Caller signed in<br/>(fresh session, same response as login)"]
```

Both endpoints are public and `strict`-rate-limited, same as `/auth/login`.

- **Enumeration safety.** An unknown identifier, a suspended account, or an
  account with no matching contact all return the exact same `202` as a
  real request that dispatched something — `RecoveryService.forgot()`
  never lets the caller distinguish "sent" from "nothing to send".
- **OTP lockout** is `OtpService`'s own counter (D3, epic #409), separate
  from `login-attempt.service.ts`'s: **6 digits, 5-minute code TTL, 5 wrong
  guesses locks the identifier for 15 minutes, with a 60-second cooldown**
  between two OTP requests for the same identifier. A reset link instead
  expires outright after **1 hour** and is single-use (`AuthTokenService
.consume`) — there's no "wrong guess" to lock out.
- **Multi-tenant wrinkle (D28).** A login identifier lives on the `users` row,
  not on any one school, but a message still needs a sender. The rule depends
  on how many distinct schools the user has a live membership in
  (`AuthService.primaryTenantId()`). Roles don't count: a teacher who is also
  a guardian in the same school has two membership rows but one school.

  | User belongs to               | Message sender     | Gateway                              | Audit row `tenant_id` | School comm log      |
  | ----------------------------- | ------------------ | ------------------------------------ | --------------------- | -------------------- |
  | 1 school, any number of roles | that school's name | that school's (or platform fallback) | that school           | yes                  |
  | 2+ schools                    | "SchoolManager"    | platform env config                  | `NULL` (platform)     | no (one Logger line) |

  For forgot-password and OTP sign-in, a user in no school gets nothing (same 202 as an unknown account).
  A signed-in user in no school who asks to change their phone or email gets a
  `403 no_school`, so platform-paid codes never go to an address they pick. So
  one school never sees another school's logins and never pays for their codes.

- **Sessions.** On success, every refresh token for the account is revoked
  (`RefreshTokenService.revokeAllForUser`) before the caller is signed back
  in with a fresh session — mirrors `AuthService.changePassword`'s "kill
  every other session" behavior, since a password reset is exactly the
  moment an attacker who guessed or leaked the old password must be cut
  off.
- **Recovery prefers a verified contact (12.7, D5 extension).** If the
  contact that matched is itself unverified (`email_verified_at`/
  `phone_verified_at` is `NULL`) **and** the account's other contact IS
  verified, the reset goes to the verified one instead — a stronger
  guarantee the right person receives it. An unverified-only account (no
  verified contact at all) still gets the reset at its one contact:
  refusing outright would make such an account unrecoverable except by an
  admin, which is worse. Either way the response is still the same `202`.
- **Admin-initiated reset** (`POST /users/:id/reset-password`, ADMIN only)
  is the same machinery with one difference: the target's sessions are
  revoked **immediately**, before the OTP/link is even sent — an admin
  resetting a compromised account must not leave a live session running
  while the reset is in flight.

## Contact verification (12.7)

`users.email_verified_at`/`users.phone_verified_at` record the moment a
contact was PROVEN owned, not just "typed into a form". Every path that
proves ownership stamps one of them, with a `CONTACT_VERIFIED` audit row:

- **Activation** (accepting an invite) verifies whichever contact the
  invite actually went out on.
- **OTP login** verifies the phone or email the code was sent to.
- **Password reset** verifies the OTP branch's phone / the link branch's
  email.
- **The contact-change flow below** verifies the NEW value, once
  confirmed.

An **admin edit** to `email`/`phone` (`PATCH /users/:id`) clears the
matching `*_verified_at` back to `NULL` — the admin route has no
proof-of-ownership step, so its own edit cannot leave a stale "verified"
label standing.

**Changing your own contact** (`PATCH /users/me` no longer accepts
`email`/`phone` at all — a 400 pointing here) is commit-on-verify: the OLD
value stays on the account until the NEW one is proven owned.

```mermaid
sequenceDiagram
    participant U as User (own device)
    participant S as Server
    participant N as New contact (phone/email)

    U->>S: POST /users/me/contact-change<br/>{ phone|email, current_password }
    Note over S: current_password checked against<br/>the CALLER's own hash (403 if wrong,<br/>400 no_password if passwordless)
    alt phone
        S->>N: SMS: 6-digit OTP
        S-->>U: 202 { channel: "otp" }
        U->>S: POST .../confirm-phone { otp }
        S->>S: users.phone = new value<br/>phone_verified_at = now()
    else email
        S->>N: Email: confirm link (1h TTL)
        S-->>U: 202 { channel: "link" }
        Note over N: link clicked, possibly logged out
        N->>S: POST /auth/verify-email { token }
        S->>S: users.email = new value<br/>email_verified_at = now()
    end
    S->>S: CONTACT_VERIFIED audit row (via: "contact_change")
```

The old value is never touched until the confirm step succeeds — a
mistyped new number/address just leaves the request expiring unconfirmed,
with the account's real contact untouched throughout.

**A school admin changing a shared person's contact (75.1, D3/D23).** If the
person also belongs to another school, `PATCH /users/:id` does **not** write a
new email/phone. It holds the change until the person approves it:

```mermaid
sequenceDiagram
  participant A as School B admin
  participant S as Server
  participant U as Person (current contact)
  participant O as School A admins
  participant N as New phone/email
  A->>S: PATCH /users/U {phone: new}
  S-->>A: 200 {phone: OLD, pending_contact_change: "phone"}
  S->>U: link to the CURRENT email/phone (message masks the new value)
  S->>O: notice "School B asked to change U's phone" (no new value)
  U->>S: open link: POST /auth/verify-email {token} (shows it, changes nothing)
  U->>S: press Approve: {token, action: approve} (or Decline: cancels, tells School B)
  S-->>U: 200 {status: "confirm"}
  S->>N: 6-digit code to the NEW phone/email (nothing written yet)
  U->>S: {token, action: approve, phone_code: "482913"}
  S->>S: one transaction: lock user, re-check, write (verified), consume link
  S->>S: revoke refresh tokens, then cut off sessions
```

Why two steps (D23, review M1 on #2460): the masked value can't tell
`john@gmail.com` from `jack@gmail.com`, so a person could approve an address
a malicious admin typed. Approving is only **consent** from the current
contact; the code to the **new** contact is **ownership**. Until the code
comes back, the old value stays the login, so OTP sign-in and password
recovery can never reach the proposed value. A removal (`null`) needs no code.

- The link goes to the person's current verified email, else current verified
  phone, else whatever they have; never to the proposed value. No contact on
  file: `409 NO_CONTACT`.
- It is an `EMAIL_VERIFY` token with `metadata.kind = 'ADMIN_PROPOSAL'` (3-day
  TTL); the latest proposal from a school revokes its earlier proposal only
  (never the person's own email-change link). The token stores where the link
  was sent; if that contact has changed by approval time the link is refused.
- Opening the link never approves: the page shows the school and the **full**
  new value (`+8801712345998`, `jack@gmail.com`) with Approve and Decline. The
  message itself masks it (`+88017••••998`); the page can show it in full
  because only the person reaches it, through a link sent to their own current
  contact (D25). Seeing the full value lets them spot an address that is not
  theirs, such as one the admin typed for themselves to receive the code.
- Approval re-checks, under a row lock, that the account keeps an email or
  phone and that the new value is still unique; a refusal leaves the link usable.
- Approval also re-checks that School B still has the person and that the
  admin who asked is still an active ADMIN there (or a platform SUPER_ADMIN,
  who has no ADMIN row in the school); if not, the link is revoked and the
  answer is `409 PROPOSAL_WITHDRAWN`. These membership rows are read
  `FOR SHARE`, so a removal committing at the same moment is waited for. The
  person's `users` row is locked `FOR NO KEY UPDATE` (not `FOR UPDATE`), so the
  person leaving that school at the same moment, whose audit row points at the
  same `users` row, does not deadlock with the approval.
- Re-saving the form with the same pending value **by the same admin** sends
  nothing again, but only once the link was really delivered (the token is
  stamped `sent: true` as the very last step, after the notices and the audit
  row, so a save that answered 503 is never deduped). A different admin's save
  sends a fresh link and revokes the old one.
- The delivery service reports a gateway outage as `FAILED`; it never throws.
  So the server checks the result: an approval link that was not `SENT` is
  revoked and the admin gets a 503 (other fields stay saved). A code that
  could not reach the new contact is a 503 to the person, never `confirm`.
- The codes use their own OTP purpose, `CONTACT_PROPOSAL`, so a self-service
  phone change to the same number can't overwrite, cool down or lock them.
  Before a re-send, every value's cooldown and cap are checked, and only then
  are codes issued and sent. So a 429 on one value sends nothing **and** keeps
  the code the person already holds for the other (a new code replaces the old
  one, so issuing it first would have wiped it).
  Approving with only one of two codes re-sends just the missing one.
- Any contact change that is written (approved, or a single-school user's
  admin edit) sets `users.tokens_valid_after` and revokes refresh tokens, so
  whoever held the old contact is signed out everywhere.
- `POST /users/:id/reset-password` on a shared user still returns
  `409 SHARED_IDENTITY`.

## Passwordless sign-in (OTP login)

`POST /auth/otp/request` and `POST /auth/otp/verify`
(`server/src/modules/account-access/otp-login.service.ts`) let an account with
no password (a guardian who was never given one) sign in without one, by phone or
email.
It reuses the same building blocks as password recovery above: `OtpService`
for the code, `AuthService.startSession()` for the session.

```mermaid
flowchart TD
    A["POST /auth/otp/request<br/>{ phone } or { email }"] --> B{Known ACTIVE phone or email,<br/>OTP login allowed?}
    B -- "no" --> Z["202 Accepted<br/>(nothing sent — enumeration-safe)"]
    B -- "yes" --> C["SMS: 6-digit OTP<br/>(OtpService, Redis, 5 min TTL)"]
    C --> D["POST /auth/otp/verify<br/>{ phone | email, otp }"]
    D -- "wrong/expired/locked" --> E["401 'Invalid credentials'<br/>(same message as password login)"]
    D -- "right code" --> F["LOGIN audit row, method: otp"]
    F --> G["Caller signed in<br/>(identical LoginResponse shape to password login)"]
```

- **Same response shape as password login.** Both `/auth/login` and
  `/auth/otp/verify` return `{ access_token, memberships }` plus the same
  `__Host-refresh_token` cookie — a client can't tell which credential type
  was used from the response alone.
- **Same failure message.** Unknown phone, wrong code, expired code, an
  inactive user, and a tenant that switched OTP login off all throw the
  identical `401 "Invalid credentials"` password login uses — none of those
  reasons is distinguishable from the outside.
- **OTP lockout** is `OtpService`'s own counter — the same 6-digit/5-minute
  TTL, 5-wrong-guesses/15-minute lock, 60-second resend cooldown that
  password recovery's OTP branch uses (see above). A locked-out phone gets
  `429` with `Retry-After: 900`.
- **Per-tenant switchable, deny wins.** `auth.otpLoginEnabled` on tenant
  settings (default `true`) lets a school turn this off. A user can belong
  to more than one school; OTP login is allowed only if **every** tenant
  they belong to has it enabled — one school opting out can't be bypassed
  by signing in through a different membership (`OtpLoginService.allowed`).
- **The OTP itself is never logged** — `OtpService` only ever logs
  purpose/identifier, matching the rule password recovery's OTP already
  follows.

## Public sign-up route (Epic 13.0)

`POST /auth/register/start | resend | verify` are open to strangers, so each
layer below stops a different abuse.

```mermaid
flowchart TD
    A["POST /auth/register/start"] --> T{"Turnstile token valid?"}
    T -- "no" --> E1["400 Captcha verification failed"]
    T -- "yes" --> P{"Phone prefix allowed for SMS?"}
    P -- "yes" --> S["SMS code"]
    P -- "no" --> M["Code to email instead"]
    S --> R["verify: 5 wrong guesses lock 15 min"]
    M --> R
```

| Protection       | Detail                                                                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Captcha          | Cloudflare Turnstile, checked on `start` (`registration/turnstile.service.ts`). With no `TURNSTILE_SECRET_KEY`, dev and test skip it; **production returns 503** and the routes stay closed (never fail open).                                              |
| Rate limit       | `STRICT_RATE_LIMIT`, 5 requests per 60 s per client, on all three routes.                                                                                                                                                                                   |
| Per-number limit | Resend cooldown 60 s, at most 3 resends per stage, and the OTP lockout above. One captcha buys one stage.                                                                                                                                                   |
| Allowed prefixes | SMS only to `OTP_SMS_ALLOWED_PREFIXES` (default `+880`), so the route cannot be used to run up SMS bills abroad. Others get an email code.                                                                                                                  |
| Enumeration      | `start` and `resend` always answer 202 and never say whether the contact is known. **Exception:** `verify` answers `409 CONTACT_IN_USE` or `SIGN_IN_REQUIRED` once the code is proven. This reveals that an account exists and is an accepted product call. |
| Consent          | Terms acceptance is stored in the audit log with the school id.                                                                                                                                                                                             |

Gaps: the server has no captcha-specific error code (#1700) and does not
normalise phone numbers (#1701). See [22-onboarding.md](22-onboarding.md).

## Connecting a social account (75.3)

A stolen or borrowed session must not be able to plant a permanent Google or
Facebook sign-in. So connecting one asks for the account's **current password**
first. The reverse also holds: a password reset removes every connected social
account (`RecoveryService.applyNewPassword`, #2239).

```mermaid
sequenceDiagram
  participant B as Browser (Security page)
  participant S as Server
  B->>S: POST /auth/social/google/link-start {current_password}
  alt account has no password
    S-->>B: 400 {details.code: NO_PASSWORD}
  else wrong password
    S-->>B: 403 "Current password is incorrect"
  else ok
    S-->>B: 200 {url} + state cookie
  end
```

- 403, not 401, on a wrong password, so the client's 401 refresh-and-replay never re-sends it.
- A passwordless (OTP-only) account must set a password first (`NO_PASSWORD`).
- The route keeps `STRICT_RATE_LIMIT`, which is now also the password-guess limit.
- Social sign-in, sign-up, disconnect and the Facebook data-deletion routes are unchanged.

## Session & token lifecycle

`POST /auth/login` returns two things: a short-lived (**15 minutes** by
default, `ACCESS_TOKEN_TTL_MS`) bearer access token in the JSON body, and a
long-lived (**30 days** by default, `REFRESH_TOKEN_TTL_MS`) refresh token
set as an `httpOnly`, `__Host-`-prefixed cookie (`server/src/modules/auth/token-cookie.ts`).

**Transport decision:** bearer access token + httpOnly-cookie refresh token,
per the plan in issue #42. This is why the API's CORS config sets
`credentials: true` — it carries a cookie, not just a header — and why
**CSRF protection (issue #48) was real, required work**, not the N/A verdict
it would have been under a pure-bearer design. See "CSRF posture" below for
how that's addressed.

**Rotation and reuse detection** (`server/src/modules/auth/refresh-token.service.ts`):
every refresh token belongs to a rotation "family" started at login. Using a
refresh token invalidates it and issues a new one in the same family
(`POST /auth/refresh`). Presenting an already-used token is treated as
theft — the **entire family is revoked** and a `TOKEN_REUSE_DETECTED` audit
row is written — _unless_ it's within a 10-second grace window of its own
rotation, which is treated as two concurrent requests racing on the same
token rather than an attack, and both get a valid fresh pair instead of one
being wrongly logged out.

Refresh tokens are stored as a hash (SHA-256 of a 256-bit random secret,
selector/validator split) — the raw token is never persisted, only ever
seen by the client.

**Revocation:**

- `POST /auth/logout` revokes the presented refresh token. It does **not**
  require a live access token — the access token has likely already expired
  by the time a user gets around to logging out, and that must not block
  revoking the refresh token.
- `POST /auth/logout-all` (requires a valid access token) revokes every
  refresh token for the user and denylists the access token used to call it,
  so that specific session ends immediately rather than riding out its
  remaining ~15-minute lifetime. The denylist
  (`server/src/modules/auth/access-token-denylist.service.ts`) is a Redis
  key per `jti` with a TTL matching the access token's own lifetime — viable
  specifically because that lifetime is now short; this is not a full
  blacklist of every issued token.
- A tenant/role change (`user_tenants`) takes effect on the _next refresh_,
  not after the old token's full lifetime — `POST /auth/refresh` re-fetches
  memberships rather than copying them from the token being replaced.
  Removal from a school is faster still (#2297): it also sets a per-user
  cut-off key (`access-denylist:user:<id>`, holding the removal time in ms),
  and every access token whose `iat_ms` is at or before it is refused on the
  very next request. `iat_ms` is taken before the memberships are read, so a
  token signed during the removal never outlives it.

**Session cut-off (75.2, D12)** — the DB-backed cut-off. One column,
`users.tokens_valid_after`, and one primary-key read per request in
`JwtStrategy` (`server/src/modules/auth/strategies/jwt.strategy.ts`). No Redis.

```mermaid
flowchart LR
  R["Request + access token"] --> S{"signature ok?"}
  S -- no --> X[401]
  S -- yes --> D{"jti / user denylisted? (Redis)"}
  D -- yes --> X
  D -- no --> U{"users row live, ACTIVE,<br/>token newer than tokens_valid_after?"}
  U -- no --> X
  U -- yes --> OK[allow]
```

- What sets it (`SessionCutoffService.cutOff`): removing or leaving a school
  (same transaction as the membership delete), a completed password reset
  (self-service or admin-started).
- What does not: `POST /auth/change-password` (the caller keeps their own
  token), `logout-all` and `DELETE /auth/sessions/:id` (still the `jti` denylist).
- A user who is soft-deleted or not `ACTIVE` (for example `SUSPENDED`) is also
  refused on the next request.
- Precision: the token's `iat_ms` is compared with the cut-off in milliseconds.
  A legacy token with only whole-second `iat` that was minted in the same
  second as the cut-off survives (`<`, not `<=`, so a refresh racing the
  cut-off is never rejected in a loop).
- Example: admin removes Rahim from school A at 10:00:00.000 -> his token
  issued 09:55 gets 401 -> the client refreshes -> the new token has no school A.
- Refresh rotation vs "revoke every refresh token" (review m-new-2 on #2460):
  both lock the user row first, so a rotation in flight either finishes first
  (and its successor is revoked too) or waits and finds its token already
  revoked. Without the lock, a successor inserted just after the revoke stayed
  live.

  ```mermaid
  sequenceDiagram
    participant R as Refresh (rotateRow)
    participant V as revokeAllForUser
    participant DB as Postgres
    R->>DB: users row FOR SHARE (granted)
    V->>DB: users row FOR UPDATE (waits for R)
    R->>DB: claim old token, INSERT successor, COMMIT
    V->>DB: lock granted, revoke every live token (successor included)
    Note over R,V: Other order: V locks first, R waits,<br/>then finds its old token revoked (401)
  ```

Expired `refresh_tokens` rows (revoked or not) are deleted by an hourly
BullMQ job (`refresh-token-cleanup.processor.ts`/`.scheduler.ts`).

### Token signing and rotating `JWT_SECRET` (75.9)

Every JWT is signed **HS256** with issuer `biddaloy`. Access tokens also carry
audience `biddaloy:access`; the Passport strategy requires all three, so an
HS512 token, an `alg: none` token, or an approval token used as a Bearer all
get 401. Approval tokens (`X-Approval-Token`) are checked for algorithm and
issuer too, and the rate-limit tracker verifies the same way.

To rotate the secret without logging anyone out, the old value moves to
`JWT_SECRET_PREVIOUS`. It is tried **for verification only** (after
`JWT_SECRET`); new tokens are always signed with `JWT_SECRET`. An empty
`JWT_SECRET_PREVIOUS` counts as unset.

```mermaid
flowchart LR
  A["Generate new secret<br/>openssl rand -base64 48"] --> L{"Was the old secret leaked?"}
  L -- no --> B["Set JWT_SECRET_PREVIOUS = old<br/>JWT_SECRET = new; deploy"]
  B --> C["Wait at least the access-token lifetime<br/>(ACCESS_TOKEN_TTL_MS, 15 min by default)"]
  C --> D["Remove JWT_SECRET_PREVIOUS; deploy"]
  L -- yes --> H["Set JWT_SECRET = new only; deploy<br/>(never put a leaked secret in JWT_SECRET_PREVIOUS)"]
```

Why the wait is minutes, not 30 days: only access tokens (15 min) and approval
tokens (5 min) are signed with `JWT_SECRET`. Refresh tokens are opaque DB rows,
so they keep working through any rotation and re-mint access tokens with the new
secret.

**After a leak, rotate hard.** Do not set `JWT_SECRET_PREVIOUS`: that would keep
the leaked secret valid for verification. Every access token gets one 401, the
client's refresh path re-mints it with the new secret, and nobody types a
password again. Anyone holding only a forged token is out at once.

There is no transition window for the format change itself (D21): tokens minted
before this change have no `iss`/`aud` and get 401 once. The client's refresh
path re-mints them, because refresh tokens are opaque DB rows, not JWTs.

### Self-service revocation (12.8)

A "session" in the API is a refresh-token **family**, not a row — rotation
means many rows can belong to one family over its lifetime, but at most one
is ever live. `GET /auth/sessions` lists the caller's live families (device
hint, first-seen, last-used, a `current` marker); `DELETE
/auth/sessions/:id` revokes one. Both routes are identified entirely by
`JwtPayload.sub` — no `X-Tenant-ID`, since a session spans every tenant the
user belongs to, not one of them.

```json
// GET /auth/sessions
{
  "data": [
    {
      "id": "b2b1c1b0-....",
      "started_at": "2026-08-01T09:00:00.000Z",
      "last_used_at": "2026-09-07T04:12:00.000Z",
      "user_agent": "Mozilla/5.0 (iPhone; ...) Safari",
      "ip_address": "203.0.113.5",
      "current": true
    }
  ]
}
```

```mermaid
sequenceDiagram
    participant DeviceA as Device A (still signed in)
    participant DeviceB as Device B (stolen phone)
    participant API as Server

    DeviceA->>API: GET /auth/sessions
    API-->>DeviceA: [A (current), B]
    DeviceA->>API: DELETE /auth/sessions/{B's family id}
    API-->>DeviceA: 204, family B revoked

    Note over DeviceB: Device B's access token is<br/>still valid for up to ~15 min
    DeviceB->>API: POST /auth/refresh (family B's cookie)
    API-->>DeviceB: 401 — family revoked
    Note over DeviceB: SPA redirects to /login
```

Revoking the **current** family (the one behind the caller's own refresh
cookie) also denylists the caller's access token and clears the cookie, so
that device is cut off immediately, exactly like `logout`. Revoking any
other family only takes effect at that device's _next_ refresh — up to ~15
minutes of access-token life remains on it, same as every other revocation
path in this section.

A family that doesn't belong to the caller is a **404, never a 403** — a 403
would confirm to the caller that some other user's family id exists. An
already-revoked family is an idempotent 204. Each successful revoke writes a
`SESSION_REVOKED` audit row with `tenant_id` from the request's active
tenant if present, else `null` — a session isn't tenant-scoped, so `null` is
the honest value when there's no active tenant to record.

Out of scope for this ticket: a "new sign-in to your account" notification
(needs a per-user notification-preference surface that doesn't exist yet).

## Dev seed safety (75.12)

`yarn seed`, `db:reset` and `db:clear` call `assertLocalSeedTarget` first and exit 1 when:

1. `NODE_ENV=production`, or
2. `DATABASE_URL` is missing or not a URL, or
3. its host is not `localhost`, `127.0.0.1` or `::1` (an SSH tunnel to localhost works for a deliberate remote seed).

The message names the script and host, never the password. The dev seed's attendance device gets a fresh random key per database, printed once as `Seed attendance device key (shown once): bd_...`; re-runs do not reprint it. Specs that call `ensureAttendanceSeed` directly keep the fixed `SEED_DEVICE_KEY` from `seed.util.ts`; `e2e/seed-contract.ts` no longer exports one, since a Playwright spec cannot know the random key.

## CSRF posture

The API splits cleanly into two authentication modes, and the CSRF argument
depends entirely on which one a route uses:

- **Bearer-authenticated routes** — everything except `POST /auth/login`
  and the two cookie-authenticated routes below — read the access token
  from the `Authorization` header. Browsers never attach that header
  automatically to a request they didn't construct, so a cross-site page
  cannot make an authenticated call to these routes no matter what it does
  — there's no ambient credential to ride. This is the vast majority of
  the API and needs no CSRF handling at all; adding blanket CSRF
  middleware here would add token plumbing to every request for zero
  additional protection, which is why there isn't any.
- `POST /auth/login` requires no authentication at all — it's how a client
  obtains a token in the first place, so there's nothing for a cross-site
  request to ride: it can trigger a login with attacker-known credentials,
  but not act as the victim.
- **Cookie-authenticated routes** — `POST /auth/refresh` and
  `POST /auth/logout` — read the refresh cookie, which _is_ an ambient
  credential a browser attaches automatically. These are the only routes
  where CSRF is a real question, and they're deliberately layered:
  1. **`SameSite=Strict`** on the cookie (`token-cookie.ts`) is the primary
     defense: the browser simply never attaches it to a cross-site
     request in the first place. This alone closes the practical attack
     for this deployment, where the SPAs are served same-origin by this
     same app (`main.ts`).
  2. **`SameOriginGuard`** (`server/src/modules/auth/guards/same-origin.guard.ts`)
     checks the `Origin` header against the request's own origin as a
     second, independent layer — in case `SameSite` is ever bypassed by a
     legacy browser or a future relaxation to `Lax`. A request with no
     `Origin` header (not something a browser sends for a state-changing
     method) passes through rather than being rejected, since that shape
     of request is outside this check's threat model, not a bypass of it.
  3. The `__Host-` cookie prefix (`token-cookie.ts`) is a related but
     separate guarantee: it stops a compromised sibling origin on the same
     parent domain from ever setting a cookie that shadows this one.
- `POST /auth/logout-all` is bearer-authenticated (`AuthGuard('jwt')`, not
  the cookie) despite being auth-adjacent, so it falls in the first
  category and needs neither of the above.

**The invariant this rests on:** the SPAs are same-origin with the API. If
that ever stops being true — the SPAs move to their own domain/CDN — `Origin`
becomes cross-origin by definition and `SameOriginGuard` needs a real
allowlist (reusing `CORS_ORIGINS`) instead of a same-origin check, and
double-submit CSRF tokens become worth adding on top. Nothing about today's
implementation prevents that; it just isn't needed yet.

## Audit trail

Every significant action — login/logout, a fee-structure edit, an invoice
being generated, a payment received, a reminder sent, a student bulk upload —
is recorded to the write-only `audit_logs` table via a single entry point,
`AuditService.record()` (`server/src/modules/audit/`). No other module holds
a direct repository for this table.

- **Tenant scoping.** `audit_logs.tenant_id` is nullable, unlike other
  tenant-scoped tables: `LOGIN`/`LOGIN_FAILED` can happen against an
  unrecognized identifier _before_ a tenant is ever selected, and there is
  genuinely no tenant to attribute that attempt to. Every other action is
  tenant-scoped and always gets one. The admin read endpoint
  (`GET /audit-logs`) is itself tenant-scoped, so an unattributed row simply
  never surfaces on any tenant's trail — that's correct, not a gap.
- **Redaction.** `old_values`/`new_values` are `jsonb` snapshots, recursively
  scrubbed against a denylist (`password_hash`, `token`, `refresh_token`,
  `api_key`, `secret`, `jti`, and variants — see `redact.util.ts`) before
  they're ever written, since the write-only trigger means a bad value here
  can never be corrected after the fact.
- **Transactional vs. ancillary writes.** `record()` takes an optional
  `EntityManager`. Passed one (payment receipt, invoice-from-payment), the
  write participates in the caller's transaction and a failure rolls back
  with it — the audit row is part of the record of truth. Without one
  (login, a fee-structure edit, a reminder send), the write is ancillary to
  an already-decided outcome and fails open (catches, logs, never throws) —
  a DB hiccup on the audit write must not turn a successful action into a 500.
- **Mechanical CRUD vs. direct calls.** The `@Audited()` decorator +
  `AuditInterceptor` cover the one case where a response body alone is
  enough to write a useful record (`POST /invoices` — a pure create with no
  prior state to diff). Deliberately not a blanket interceptor: an update
  needs old-vs-new diffing the response can't provide (fee-structure
  changes call `AuditService.record()` directly, using the pre-update
  entity already fetched for validation), and a batch send needs one row
  per action rather than one per response (bulk/single reminders do the
  same).

**Retention.** The write-only trigger (`block_audit_logs_write_only`, added
in the initial migration) blocks `UPDATE` and `DELETE` on every row, so a
naive "delete rows older than N days" job cannot work — it would hit the
same trigger a manual edit would. This is documented rather than
implemented, since the table has not yet grown large enough to need it: the
mechanism that respects the write-only guarantee is range partitioning by
`created_at` (e.g. yearly), with old partitions retired via `DROP TABLE`
rather than `DELETE FROM` — a table drop isn't a row-level write the
trigger fires on. An archival job that copies old partitions to cold
storage before dropping them is the natural next step once retention
actually needs enforcing.

## Data protection: transit, at rest, and logs

This app handles student/guardian PII and payment records. The posture below
covers connection security, storage, and what does (and deliberately does
not) get encrypted at the column level.

**Transit to Postgres.** `DATABASE_URL` carries the DB password, and every
query carries whatever PII it touches, over whatever transport TypeORM is
given — a bare TCP socket unless told otherwise. `DB_SSL` (`server/src/db-ssl.ts`)
controls this:

- Unset or not `production`: SSL is off by default (a local docker-compose
  Postgres has none to negotiate), but can still be opted into by setting
  `DB_SSL=true`.
- `NODE_ENV=production`: `DB_SSL` **must** be exactly `"true"` — the app
  refuses to boot otherwise, the same "loud failure beats a silent gap"
  posture as `ENABLE_API_DOCS`'s Basic Auth requirement. Use an
  `sslmode=require`-style `DATABASE_URL` (or the managed provider's
  equivalent) alongside it.
- `DB_SSL_REJECT_UNAUTHORIZED=false` disables certificate verification —
  sometimes genuinely necessary for a managed Postgres with a self-signed
  cert, but logs a boot-time warning every time it's set, since it's also a
  common copy-paste that silently defeats the whole point of enabling TLS.
- This requirement is unconditional — it does not matter whether Postgres
  happens to be on the same private Docker network as the app. The bundled
  `docker-compose.yml`'s `db` service does not configure TLS today, so
  deploying it as-is with `NODE_ENV=production` will refuse to boot until
  that's addressed (see [07-deployment.md](07-deployment.md)) — a known gap,
  not an oversight papered over here.

**Transit to SeaweedFS/S3.** Same shape of gap as Postgres above: `StorageService`
and the `backup`/`restore` scripts reject a plaintext `http://` `S3_ENDPOINT`
by default and require an explicit `S3_ALLOW_INSECURE_HTTP=true` opt-in to
accept one (see [`server/src/modules/storage/storage.service.ts`](../../server/src/modules/storage/storage.service.ts)
and [`scripts/backup/backup.sh`](../../scripts/backup/backup.sh)). The bundled
`docker-compose.yml` sets that opt-in for its `app`/`backup` services,
because the SeaweedFS container there isn't TLS-terminated. SeaweedFS S3 is
published on host loopback `127.0.0.1:9000` only; its filer (`:8888`) and
volume HTTP ports are reachable without credentials from other containers on
the Compose network — the same trust boundary already accepted for the
unauthenticated `redis` on that network — but are not published to the host
or internet. That network transport is still cleartext. Standing up
SeaweedFS with TLS (a CA, certs distributed to every client container) is
tracked as follow-up work, not done here — deploying the bundled Compose
stack as-is means SeaweedFS traffic stays unencrypted between containers,
the same trade-off already accepted for `db` above.

**At rest.** Required as a deployment property, not an optional hardening
step: the Postgres data volume must sit on encrypted storage — either the
self-hosted compose stack's volume backed by a LUKS-encrypted (or
cloud-provider-encrypted) disk, or a managed Postgres with encryption at
rest enabled (the default on every major provider today). There is
currently no automated check for this; it's an operational requirement on
whoever provisions the host/database.

**PII column inventory** (for any future data-subject/erasure request):

| Entity               | Column(s)                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`               | `email`, `phone`, `full_name`, `password_hash` (bcrypt, already hashed), `profile_picture_url`                                                                                                                                   |
| `Guardian`           | `full_name`, `phone`, `alternate_phone`, `email`, `address`, `occupation`                                                                                                                                                        |
| `Student`            | `full_name`, `date_of_birth`, `gender`, `home_address`                                                                                                                                                                           |
| `AdmissionApplicant` | applicant name, `date_of_birth`, `gender`, guardian name/phone/email, `home_address`, and its `admission-documents/` files in storage                                                                                            |
| `School`             | `address`, `phone`, `email` (tenant-level contact info)                                                                                                                                                                          |
| `RefreshToken`       | `ip_address`, `user_agent`                                                                                                                                                                                                       |
| `AuditLog`           | `ip_address`, `user_agent`, and `old_values`/`new_values` jsonb snapshots — redacted for credentials/tokens (`redact.util.ts`), but can still carry names/emails/phones since those aren't secrets by that redactor's definition |
| `CommunicationLog`   | `recipient_address`, `recipient_name`, `message_body` (free text)                                                                                                                                                                |
| `Payment`            | `remarks` (free text)                                                                                                                                                                                                            |
| `Invoice`            | `notes` (free text)                                                                                                                                                                                                              |

Admission documents of a REJECTED applicant can be deleted by hand (`DELETE /admission/applicants/:id/documents`, audited). The retention period is #1792's decision.

**Column-level encryption: deliberately deferred.** The original ask was to
evaluate encrypting PII columns directly. Evaluated and not done, because it
breaks core access patterns this app depends on:

- Login (`AuthService.validateUser`) looks users up by **exact match** on
  `email`/`phone`. Encrypting those columns makes login impossible without
  a deterministic scheme or a blind index — and a deterministic scheme
  leaks equality anyway (two rows with the same email produce the same
  ciphertext), buying much less protection than it costs in complexity.
- Student/guardian name search and sort are core to every list view.
  Encrypted columns can't be `LIKE`-searched, range-scanned, or usefully
  indexed.
- The threat model volume/managed encryption at rest actually addresses is
  **stolen storage media** — a disk, volume, snapshot, or backup taken
  without valid database credentials. It does _not_ protect a `pg_dump`
  (or any other logical export) taken by someone who already has DB
  credentials: Postgres decrypts pages before returning query results, so a
  logical dump is plaintext regardless of what the underlying storage does.
  That scenario is a credential/access-control problem — least-privilege DB
  roles, credential rotation, and the audit trail (#37) — not a storage-
  encryption one, and column-level encryption wouldn't fully close it either
  (an attacker with valid app-level credentials can just query the API).

Neither at-rest volume encryption nor this deferral claims to fully defend
against a compromised, credentialed actor — that requires the access-control
and credential-hygiene work above, not a storage or column-encryption
mechanism.

This would be revisited if either changes: a regulatory requirement forcing
column-level encryption regardless of the login/search cost, or a KMS
becoming available that makes searchable/blind-index encryption practical
without hand-rolling one.

**Logs.** TypeORM's query logger (`server/src/db-logger.ts`) logs query text
but never bound parameters — the default logger appends them as a trailing
`-- PARAMETERS: [...]` comment, which is exactly where an email or phone
passed into a `WHERE` clause would otherwise land in plaintext. The global
exception filter (`AllExceptionsFilter`) redacts email- and phone-shaped
substrings, plus known-sensitive query-param values, from the request URL
and error detail before logging (`common/redact-log.util.ts`) — verified
against a _failing_ request, not just a successful one, since the leak is
usually in an error log written under debugging pressure. Request bodies
(the login path carries a plaintext password) are never logged at all.
nginx uses the `redacted` access-log format (`nginx/templates/default.conf.template`):
it logs the path without the query string, masks the calendar-feed,
public-verify and public-invoice path tokens and the SPA share pages
(`/i/<token>`, `/v/<token>`), and omits the Referer, because
reset/invite/verify links are bearer secrets and must not sit in log files.
`redactPii` masks the same three API path tokens plus the two SPA pages, so
the pino request serializer, the exception filter and Sentry all hide them.
All server blocks, including the two catch-all default servers, use the
`redacted` format, so scanner traffic is logged in the same safe shape.

| URL shape                      | nginx access log | pino / exception filter / Sentry |
| ------------------------------ | ---------------- | -------------------------------- |
| `/api/v1/public/invoices/:tok` | masked           | masked                           |
| `/api/v1/public/verify/:tok`   | masked           | masked                           |
| `/api/v1/calendar/feed/:tok`   | masked           | masked                           |
| `/i/:tok`, `/v/:tok` (SPA)     | masked           | masked, also in full URLs        |
| `?token=` (reset, activate…)   | query dropped    | `token=[REDACTED]`               |

The audit's national-ID item was checked: no NID number field exists in
server code (NID is only an uploaded document file), so there is nothing to
redact.

Example: `GET /api/v1/calendar/feed/abc123.ics` is logged as
`GET /api/v1/calendar/feed/[REDACTED]`.

Known gap: nginx's **error** log (502/504, client aborts) still writes the
full request line, token included. Only the access log is masked.

## Repository and GitHub settings

Some protection lives in GitHub settings, not in code. Reporters are sent to
[`.github/SECURITY.md`](../../.github/SECURITY.md); risky paths auto-request the
owner's review through `.github/CODEOWNERS` (requested, not enforced).

```mermaid
flowchart LR
    R[Researcher] -->|"Security > Report a vulnerability"| P[Private advisory]
    P --> O[Owner @tareq89]
    PR[PR touching /nginx/, /server/src/modules/auth/ ...] -->|CODEOWNERS| O
```

State read with `gh api` on 2026-10-12 (**Today**) and the value to reach (**Target**).
Rows marked **owner to apply** are writes to repo settings; the implementer did not
make them, and the **Today** column stays until the owner does and updates it.

| Setting                                         | Today                                     | Target                                                   | Status                 |
| ----------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- | ---------------------- |
| Visibility                                      | public                                    | -                                                        | -                      |
| Private vulnerability reporting                 | disabled                                  | enabled (SECURITY.md points at it)                       | owner to apply         |
| Secret scanning / push protection               | enabled / enabled                         | keep                                                     | ok                     |
| Secret scanning non-provider patterns, validity | disabled / disabled                       | enabled / enabled                                        | owner to apply         |
| Dependabot security updates                     | enabled                                   | keep                                                     | ok                     |
| Default `GITHUB_TOKEN` permission               | `read`, cannot approve PRs                | keep                                                     | ok                     |
| Fork PR workflow approval                       | `first_time_contributors`                 | `all_external_contributors`                              | owner to apply         |
| Branch protection / rulesets on `main`          | none                                      | minimal ruleset: block deletion and force-push of `main` | owner decision pending |
| `--frozen-lockfile` in CI                       | yes (`.github/actions/setup`, Dockerfile) | keep                                                     | ok                     |
| CodeQL                                          | `.github/workflows/codeql.yml`            | keep                                                     | ok                     |

Branch protection: the recommended option is the last two rules of
`scripts/apply-main-ruleset.sh` (no deletion, no force-push), with no required checks and
no merge queue. The full `main-gate` changes how every PR merges and needs the merge
queue to have run green once, so it is a separate decision. Record the chosen option,
the date and the reason here when the owner decides.

Apply (the repo owner runs these; they change live GitHub settings):

```bash
# private vulnerability reporting on
gh api -X PUT repos/tareq89/biddaloy/private-vulnerability-reporting
# secret scanning: non-provider patterns + validity checks
gh api -X PATCH repos/tareq89/biddaloy \
  -F 'security_and_analysis[secret_scanning_non_provider_patterns][status]=enabled' \
  -F 'security_and_analysis[secret_scanning_validity_checks][status]=enabled'
# fork PRs from any outside contributor wait for approval before workflows run
gh api -X PUT repos/tareq89/biddaloy/actions/permissions/fork-pr-contributor-approval \
  -f approval_policy=all_external_contributors
```

Verify after applying (each should match **Target**):

```bash
gh api repos/tareq89/biddaloy/codeowners/errors --jq '.errors'                       # []
gh api repos/tareq89/biddaloy/private-vulnerability-reporting --jq .enabled         # true
gh api repos/tareq89/biddaloy --jq '.security_and_analysis'
gh api repos/tareq89/biddaloy/actions/permissions/workflow
gh api repos/tareq89/biddaloy/actions/permissions/fork-pr-contributor-approval --jq .approval_policy
gh api repos/tareq89/biddaloy/rulesets --jq '.[].name'
```

## Accepted dependency risks (Epic 51.0)

`yarn audit` (this is a Yarn 1 repo, so `npm audit` does not work) still
reports three advisories after Epic 51.0. We looked at each one and chose not
to force a version. If `yarn audit` shows anything else, it is new: fix it.

CI enforces this with `scripts/ci-audit.js`. All three advisories are entries
in its `ALLOWLIST`, each with a `recheckBy` date (next: **2027-01-24**). Past
that date the job fails until someone re-reviews. The `tmp` advisory no longer
needs an entry, because the `resolutions` block below forces a patched version.

| Mode       | Command                                 | Blocks on                       |
| ---------- | --------------------------------------- | ------------------------------- |
| default    | `node scripts/ci-audit.js`              | high/critical, all dependencies |
| production | `node scripts/ci-audit.js --production` | moderate+, production deps only |

The `uuid` row below is the one production-reachable advisory, which is why
it must be an allowlist entry and not just prose.

```mermaid
flowchart LR
  lhci["@lhci/cli (dev/CI only)"] --> lh["lighthouse 12.6.1"] --> pp["puppeteer-core 24.x"] --> pb["@puppeteer/browsers 2.x"] --> ez["extract-zip 2.0.1<br/>no patched version"]
  server["@biddaloy/server"] --> xl["exceljs 4.4.0"] --> uuid["uuid 8.3.2<br/>only v4 is called"]
  lhci --> uuid
```

| Advisory            | Package                                                                                                              | Why we accept it                                                                                                                                                                                                                                                                                                                                                              | Revisit when                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GHSA-7pqw-9j4j-h8q3 | `extract-zip` 2.0.1 (arbitrary file write via symlink entries)                                                       | No patched version exists. Dev/CI only, and it only runs if something triggers a browser download (`@puppeteer/browsers install`). lhci does not: it launches the Chrome already installed on the machine (via chrome-launcher).                                                                                                                                              | `@lhci/cli` ships a lighthouse that uses puppeteer-core 25 or later (`@puppeteer/browsers` 3.x has no `extract-zip`; our own root `puppeteer` 25 already uses 3.x), or a patched `extract-zip` appears |
| GHSA-jmr9-qjv8-65gv | `extract-zip` 2.0.1 (symlink path traversal)                                                                         | Same as above.                                                                                                                                                                                                                                                                                                                                                                | Same as above                                                                                                                                                                                          |
| GHSA-w5hq-g745-h8pq | `uuid` 8.3.2 via `exceljs` and `@lhci/cli` (missing buffer bounds check in v3/v5/v6 when a `buf` argument is passed) | Both callers only use v4 with no buffer, so the vulnerable path is never called. `exceljs` does `const {v4: uuidv4} = require('uuid')` (`node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js:1`); `@lhci/cli` calls `uuid.v4()` (`node_modules/@lhci/cli/src/collect/node-runner.js:65`). Forcing uuid 11 on them is a 3-major jump for code we do not use. | `exceljs` or `@lhci/cli` bumps `uuid`, or we replace `exceljs`                                                                                                                                         |

So `yarn audit` lists `uuid` on two paths, `@biddaloy/server>exceljs>uuid`
and `@lhci/cli>uuid`. Both are this one accepted advisory, not a new finding.

Re-check the `uuid` claim after any `exceljs` or `@lhci/cli` upgrade:
`rg -n "require\(['\"]uuid" node_modules/exceljs/lib node_modules/@lhci/cli/src`
must show only `v4`.

### Forced versions (`resolutions`)

Epic 51.0 also forced three patched versions through the root
`package.json` `resolutions` block. Yarn 1 does not allow comments there, so
the reason for each one, and when it can go, lives here.

All three exist only because `@lhci/cli` 0.15.1 (dev/CI only) still pulls in
old ranges. The production server does not need any of them.

| Resolution                | Advisory                                 | What forces it (from `yarn.lock`)                                                                                                                                                                                                                    | Remove when                                                             |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `"qs": "^6.16.0"`         | GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx | `@lhci/cli` → `express` 4.22.2 and `body-parser` 1.20.6, which both ask for `qs ~6.15.1` (6.16 is out of a tilde range). The server's `express` 5.2.1 (`qs ^6.14.0`) and `body-parser` 2.x (`qs ^6.15.2`) already allow 6.16 without the resolution. | `@lhci/cli` moves off express 4 (or its express 4 asks for `qs` ≥ 6.16) |
| `"tmp": "^0.2.7"`         | GHSA-ph9p-34f9-6g65, GHSA-52f5-9888-hmc6 | `@lhci/cli` asks for `tmp ^0.1.0` directly, and through `inquirer` 6 → `external-editor` for `tmp ^0.0.33`                                                                                                                                           | `@lhci/cli` (and its `inquirer`) ask for `tmp` ≥ 0.2.7                  |
| `"compression": "^1.8.2"` | GHSA-vc2v-76pw-4v95                      | `@lhci/cli` asks for `compression ^1.7.4`. 1.8.2 is in that range; the resolution makes sure a fresh install can never pick an older one.                                                                                                            | `@lhci/cli` asks for `compression` ≥ 1.8.2                              |

A row can go only when **every** upstream range in `yarn.lock` excludes the
vulnerable versions. A clean `yarn audit` after deleting the row does not
prove this: Yarn 1 keeps the already-locked patched version, so the audit
stays clean even though a fresh lockfile could resolve an old one.

Example: `compression ^1.7.4` still allows the vulnerable 1.8.1. Delete the
row today and `yarn audit` stays clean, because `yarn.lock` still says 1.8.2.
The row can go once `@lhci/cli` asks for `^1.8.2` or higher.

To check, read the ranges, not the audit:

```bash
grep -E '^"?compression@' yarn.lock   # every range listed must start at >= 1.8.2
```

## Learnings log (Epic 75)

Raw notes from each wave close. 75.36 turns them into rules later; they are not
polished on purpose. Format: what surprised us — what it cost — fix — rule
candidate.

### Wave 0 — 2026-10-13

- The first route-status snapshot had one `SUPER_ADMIN` column, but a tenant-local super admin and a platform super admin (no tenant) are guarded differently, so the column hid real 401/403 differences — one review round — fix: `PLATFORM_SA` column in `server/src/route-status-snapshot.e2e-spec.ts` (#2439) — rule candidate: a snapshot gets one column per distinct guard path, not per role name.
- Snapshot diff since wave start is one line, `POST /api/v1/invoices/:id/share/regenerate` (new route, same guards as the other share routes) — none; the 403 → 404 teacher changes are in services, which a guard-only snapshot never sees — fix: #2438 — rule candidate: the snapshot proves guards only; handler-level scope needs its own e2e spec.
- Opening a contact-change approval link applied the change on GET, so a mail scanner or anyone holding the link could take over a shared person's email/phone (D11) — a rework of 75.1 — fix: explicit Approve/Decline under a row lock (#2309, b95ed16a2) — rule candidate: a link in a message never changes state on open; it shows a page with a button.
- Flipping `PermissionsGuard` to fail closed was safe only because every identity route got a readable `@AuthenticatedOnly()` marker first, checked both ways against `IDENTITY_SCOPED` — two tickets instead of one — fix: #2315 then #2436 — rule candidate: a deny-by-default flip ships behind a marker plus a two-way CI check, never on a hand list.
- Teacher scope has to be current academic year only (D2): a past-year SUBJECT assignment kept leaking students. One exception survives (D31): marks read and write stay open for last year's section while its class still has a DRAFT exam (X-07), so the marks-due alerts and the marks gate agree. The window keys on DRAFT only, so after rollover a PROCESSED (not yet published) exam of last year is corrected by an admin, not by its subject teacher, who gets the teacher-miss 404 (D45) — fix: `teacher-scope.service.ts` (#2314, `rolesInSection().inYearWindow`) — rule candidate: every "which sections does this teacher see" question goes through `TeacherScopeService`, never a raw `teacher_class_sections` query.
- `TeacherScopeService` lived in `ClassModule`, which fees, fines and communications cannot import (load-order cycle), so #2434 was blocked until it was exported from `StudentModule` — a blocked lane — fix: 6c7a4a121 — rule candidate: a cross-cutting scope service is exported from the module its consumers already import, decided in the plan.
- Under a full `ci:local` (4 busy workers) specs leak into each other and slow tests pass the 5 s timeout, then pass alone — repeated red runs to triage — fix: #2456 (open) — rule candidate: a spec that fails only under load is checked alone and against #2456 before anyone "fixes" it.
- Review found three ways past the first xlsx zip-bomb guard: a crafted EOCD (count 0, decoy prefix, zip64 sentinel), directory entries that reuse the same compressed bytes, and the calendar import that was not guarded at all — three fix commits — fix: `server/src/common/utils/xlsx-guard.util.ts` (#2330) — rule candidate: a parser guard is reviewed against crafted inputs, and every upload path is listed in the ticket by grep, not memory.
- The Lighthouse login waited for a `লগ ইন` button that the Epic 31 sign-in rework renamed to `সাইন ইন করুন`; the job broke silently on main too — a red lighthouse section to diagnose — fix: b6ce4ba00 — rule candidate: e2e/Lighthouse helpers find buttons by i18n key or test id, never by copied UI text.

### Wave 1 — 2026-10-14

Closed on the PR 4 accumulating branch (`epic/75.0/accum-4`), which stands in
for `main` (D21). Wave start = `0d6254672` (accum-3 head).

```mermaid
flowchart LR
  L["POST /auth/login"] --> T{"Redis up?"}
  T -- no --> X["503, sign-in closed (75.18)"]
  T -- yes --> J["JWT HS256 + iss + aud (75.9)"]
  L --> P["verifyPassword: always one cost-12 unit (75.11)"]
  R["Redis probe every 30 s"] -- "3 fails" --> A["platform_alerts row + SMS (75.34)"]
  A --> B["GET /platform/alerts<br/>PlatformSuperAdminGuard → red banner (75.35)"]
```

- **JWT pin and rotation.** Pinning HS256 + issuer + audience logs out every token minted before the change once (no `iss`/`aud`), by design (D21) — none in practice, the client's refresh path re-mints because refresh tokens are DB rows — fix: #2317 — rule candidate: a token-format change ships with a note that names who gets one 401 and why it self-heals; secret rotation is "old value to `JWT_SECRET_PREVIOUS`, wait out the access-token lifetime (15 min), remove", and after a leak a hard swap with no `JWT_SECRET_PREVIOUS` (refresh re-mints, so nobody signs in again).
- **bcrypt timing padding.** Raising the cost to 12 _reversed_ the enumeration oracle instead of closing it: every real account still had a cost-10 hash (~80 ms) while an unknown identifier paid the cost-12 dummy (~320 ms) — one review round — fix: `verifyPassword` in `auth/password-hash.ts` pads a cost-`r` check with throw-away hashes at costs `r..11`, run one after another, and every password check (login, change-password, step-up, social connect, contact-change) goes through it (#2319, 9e41e1404) — rule candidate: a security cost change is checked for _every_ stored-data state the system is in on deploy day, not just new rows; no `bcrypt.compare` on a password outside `password-hash.ts`.
- **Redis-down policy.** "Fail open everywhere" would mean unlimited password guessing while Redis is down, and "fail closed everywhere" would take the whole app down with it — the split is per route (D4) — fix: `AppThrottlerGuard` returns 503 only for routes marked `@FailClosedWithoutRedis()` (first a hand-kept route-string list, which was too wide, closing read-only social GETs, and fragile, since a renamed route failed open silently: review r1, F11); refresh, logout and every other route fail open; `/health/ready` reports `degraded` (#2326) — rule candidate: each Redis-backed control states its own down-mode in the ticket, and an e2e spec with a throwing store proves it (`app-throttler.guard.e2e-spec.ts`).
- **Platform-only guards.** `@Roles(SUPER_ADMIN)` is also passed by a _school-local_ SUPER_ADMIN, so `GET /platform/alerts` and `GET /platform/attention/health` were open to every school's super admin, and the alert SMS went to them too — one review round — fix: `PlatformSuperAdminGuard` after `ContextGuard` on both routes (snapshot `TENANT_SA` PASS → 403), SMS recipients limited to the platform tenant's SUPER_ADMINs (da142ff55, 749d6954f) — rule candidate: a `/platform/*` route always carries `PlatformSuperAdminGuard`; the snapshot's `TENANT_SA` column must read 403 on every `/platform/*` row. `route-permissions.txt` does not record this guard, so only the route-status snapshot catches it.
- **Enum-order drift is real, not a macOS artifact.** After the platform-alert backend (#2441), `api:types` reordered the literals of 12 enum unions in `ui/src/api/schema.d.ts` (e.g. `"TERM" | "MONTHLY" | "MODEL" | "OTHER"` → `"TERM" | "OTHER" | "MONTHLY" | "MODEL"`). It was written off as "macOS only" and reverted by hand, and CI's `check-api-types` then failed, so the integration and server e2e suites never ran on that head. Cause: the `@nestjs/swagger` CLI plugin writes a string-literal union in the order TypeScript created those literal types. `health.module.ts` started importing the SMS gateways and the platform-alerts service, which moved files that mention `'OTHER'`, `'WEEKLY'`, `'ACCEPTED'` and `'REJECTED'` earlier in the program, so the checker created those literals first. The order is the same on macOS and Linux for the same code (the base branch had 0 drift on both) — fix: regenerate and commit the reorder (review r1, F1) — rule candidate: an `api:types` reorder is real drift; commit it, never revert it by hand. If it only shows up on one machine, rebuild from clean (`rm -rf server/dist`) before calling it platform noise.
- **Cost 12 slows every test login.** The shared test fixture hash (`server/test/constants.ts`) was cost 10, so each fixture login paid the cost-12 padding _plus_ a rehash write (~580 ms instead of ~70 ms). Specs that sign in ten roles per test hit the 10 s hook timeout, and bcrypt work still running when the vitest thread was torn down aborted the whole server e2e run (`libc++abi: Napi::Error`, SIGABRT) — two red full runs — fix: fixture hash at cost 12 (311161f67); a login is still ~4x slower than before, so login-heavy specs (documents journey: 1.3 s → 2.9 s alone) have less headroom under load (#2456) — rule candidate: when a security cost goes up, test fixtures move to the same cost in the same ticket, and the slowest login-heavy spec is timed before and after.
- **Global tables and parallel e2e.** The banner Playwright spec opened and cleared the one global `platform_alerts` table from four tests running in parallel, so one test's clear hid another's banner — flaky first tries — fix: `test.describe.configure({ mode: 'serial' })` (3c8f48444) — rule candidate: a Playwright spec that writes a table with no tenant column runs serial.
- **Transient URLs under load.** Slower activation (cost-12 hash) made `toHaveURL(/dashboard/)` miss the brief `/dashboard` before the first-visit gate moved a new school's admin to `/welcome` — fix: accept either (4e1a940a1) — rule candidate: assert the URL a page settles on, never one it passes through.
- **Seed device key.** The dev seed printed the "shown once" key when only the _revoked_ seed device was inserted, because `devices` counted both rows — a review LOW — fix: `ensureAttendanceSeed` returns `activeDeviceCreated` and the print keys on it (#2320) — rule candidate: a "shown once" secret is printed on the flag of the exact row that holds it, never on a count.
- **Redis-down drill not run live (D48).** Stopping the shared `redis` container would break every other agent's test-env slice, so the drill in #2444 is an owner action after deploy. What covers it until then: `app-throttler.guard.e2e-spec.ts` (throwing store → 503), `platform-alerts.service.spec.ts` (3 fails open one row, one "recovered" text, the hourly repeat sends only when its conditional UPDATE wins), `platform-alerts.controller.e2e-spec.ts` (platform-only), and `e2e/platform/platform-alert-banner.spec.ts` (banner) — rule candidate: a drill that needs a shared container stopped runs on a deploy target, never on the shared local stack.
