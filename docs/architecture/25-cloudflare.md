# 25. Cloudflare configuration checklist

Cloudflare sits in front of the origin (Epic 75, D1). The code assumes
certain dashboard settings. If one is wrong, users get blocked, caches leak
private data, or the origin IP stays exposed. This page lists every setting,
why it matters and how to check it.

> Operator steps (day 0, first deploy, releases, alerts, restore) live in
> [28-platform-runbook.md](28-platform-runbook.md). This page keeps the dashboard settings.

## Request path

```mermaid
flowchart LR
  V["Visitor"] --> CF["Cloudflare<br/>TLS Full (strict), WAF, rate rule,<br/>cache bypass /api/*, adds CF-Connecting-IP<br/>(items 1-9, 14)"]
  CF --> FW["Host firewall, optional<br/>80/443 from Cloudflare only<br/>(item 12)"]
  FW --> N["nginx<br/>444 catch-all, Cloudflare peers only,<br/>realip from TRUSTED_PROXY_CIDRS<br/>(#2312 / #2313, items 1, 11)"]
  N --> A["Nest app<br/>no-store on /api/*, HSTS, STRICT throttler<br/>(#2328, D5)"]
  X["Direct hit on origin IP"] -. "444, no reply" .-> N
```

Two rules hold the whole thing together:

- DNS must be **proxied** (orange cloud). nginx answers only Cloudflare
  peers, so an unproxied record means users get 444.
- `TRUSTED_PROXY_CIDRS` must be set whenever DNS is proxied, and the other
  way round.

## Checklist

"Applied" is filled by the owner, who has dashboard access. Every cell
starts as `pending (owner)`. Write who, when, and a link or pasted output
from the verify step.

| #   | Setting                                    | Value                                                                                       | Why / code that relies on it                                                                                                                                                                                                                                                                                                                                                 | How to verify                                                                   | Applied (who, date) |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------- |
| 1   | DNS for `APP_DOMAIN`                       | A/AAAA record **proxied**. No unproxied record points at the origin IP.                     | nginx drops non-Cloudflare peers with 444 (#2313, `nginx/templates/default.conf.template`, `$origin_allowed`).                                                                                                                                                                                                                                                               | V1, V5                                                                          | pending (owner)     |
| 2   | SSL/TLS mode                               | **Full (strict)**                                                                           | Origin holds a Cloudflare Origin CA cert (mounted from `TLS_CERT_DIR` into nginx, `docker-compose.yml`). Flexible would loop redirects; Full without strict skips cert checks.                                                                                                                                                                                               | V1                                                                              | pending (owner)     |
| 3   | Minimum TLS version                        | **1.2**; TLS 1.3 on                                                                         | Older TLS is broken. No client we support needs it.                                                                                                                                                                                                                                                                                                                          | V6                                                                              | pending (owner)     |
| 4   | Always Use HTTPS                           | **On**                                                                                      | Matches nginx's port-80 redirect. Nothing needs plain HTTP: the Origin CA cert has no renewal challenge.                                                                                                                                                                                                                                                                     | V7                                                                              | pending (owner)     |
| 5   | HSTS in Cloudflare                         | **Off**                                                                                     | The app sends it (`server/src/security-headers.ts:44`: `max-age=31536000; includeSubDomains`, no preload, D5, production only). Two sources would duplicate the header.                                                                                                                                                                                                      | V4                                                                              | pending (owner)     |
| 6   | Cache rule                                 | **Bypass cache** when URI path starts with `/api/`. No "Cache Everything" rule anywhere.    | `/api/*` sends `no-store` (`server/src/cache-control.ts`, `main.ts:60`); `index.html` and `sw.js` send `no-cache`; `/assets/*` is `public, max-age=31536000, immutable` (nginx `location ~ ^/assets/`). Caching `/api/*` would leak tenant data.                                                                                                                             | V2, V3                                                                          | pending (owner)     |
| 7   | WAF managed ruleset                        | Cloudflare managed ruleset **on**                                                           | First filter before the app. The app has no WAF of its own.                                                                                                                                                                                                                                                                                                                  | Dashboard: Security > WAF shows the ruleset enabled                             | pending (owner)     |
| 8   | Rate-limiting rule                         | One rule, expression covers `/api/v1/auth/` **and** `/api/v1/public/`, per IP, block 10 min | Outer limit. The free plan allows one rule, so one expression covers both. The app's own throttler (`STRICT_RATE_LIMIT` 5/min, `server/src/rate-limit.ts:34`) stays the inner limit.                                                                                                                                                                                         | V10                                                                             | pending (owner)     |
| 9   | Bot Fight Mode                             | **Off**. On a paid plan: Super Bot Fight Mode with skip rules for the paths below.          | It cannot skip paths on the free plan. It would challenge attendance devices (`POST /api/v1/attendance/device-events`, `GET /api/v1/attendance/devices/me/roster`, `device-ingest.controller.ts:58,80`), calendar apps polling `GET /api/v1/calendar/feed/:token.ics` (`calendar-feed.controller.ts:69`), and uptime monitors on `GET /api/health` (`app.controller.ts:12`). | V8, V9                                                                          | pending (owner)     |
| 10  | Authenticated Origin Pulls                 | **Not used**                                                                                | D17 chose the IP allowlist (`TRUSTED_PROXY_CIDRS`) instead.                                                                                                                                                                                                                                                                                                                  | n/a                                                                             | pending (owner)     |
| 11  | `TRUSTED_PROXY_CIDRS` in production `.env` | Current `https://www.cloudflare.com/ips-v4/` + `/ips-v6/`, space separated                  | nginx trusts `CF-Connecting-IP` only from these peers (#2312; example list in `.env.example:59`). Re-check **quarterly** and after any Cloudflare plan change. Runbook: [12-operations.md](12-operations.md) section 3.5.                                                                                                                                                    | V11                                                                             | pending (owner)     |
| 12  | Host firewall (optional)                   | ufw or cloud security group: 80/443 only from the same ranges                               | Defence in depth behind #2313. Skip if the host cannot do it.                                                                                                                                                                                                                                                                                                                | From a non-Cloudflare machine: `nc -vz <origin-ip> 443` times out               | pending (owner)     |
| 13  | Rotate the origin IP                       | New IP, after items 1-12 are on                                                             | The old IP lives in DNS history and internet-wide scan databases. Then repeat items 1 and 14.                                                                                                                                                                                                                                                                                | V1, V5                                                                          | pending (owner)     |
| 14  | Turnstile keys                             | `TURNSTILE_SECRET_KEY` and `VITE_TURNSTILE_SITE_KEY` both set (`.env.example:228-233`)      | Sign-up checks the token. A secret without a site key rejects every sign-up (`.env.example:232` says "set both or neither"). Widget lives in `client-admin/src/features/registration/turnstile.tsx`.                                                                                                                                                                         | Open `/register`: the widget renders. Submit a test sign-up: no Turnstile error | pending (owner)     |

Order for items 11-13: do 11 first, then 12, then 13. Items 11-13 touch the
server and DNS.

## Verify

Set the placeholders once. Use real values only in your own terminal, never
commit them.

```bash
export APP_DOMAIN=<your domain>
export ORIGIN_IP=<origin ip>
```

| Id  | Command                                                                                                                   | Expected                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| V1  | `dig +short $APP_DOMAIN`                                                                                                  | Only Cloudflare addresses, never `$ORIGIN_IP`.                                                    |
| V2  | `curl -sI https://$APP_DOMAIN/api/health`                                                                                 | `cf-cache-status: DYNAMIC` or `BYPASS`, and `cache-control: no-store`.                            |
| V3  | `curl -sI https://$APP_DOMAIN/assets/<real chunk>.js` twice                                                               | Second reply has `cf-cache-status: HIT` and `cache-control: public, max-age=31536000, immutable`. |
| V4  | `curl -sI https://$APP_DOMAIN/ \| grep -ci strict-transport-security`                                                     | `1`, and the value is exactly `max-age=31536000; includeSubDomains`. No Cloudflare duplicate.     |
| V5  | `curl -sv --resolve $APP_DOMAIN:443:$ORIGIN_IP https://$APP_DOMAIN/` from a non-Cloudflare machine                        | Empty reply or reset (#2313).                                                                     |
| V6  | `curl -s --tlsv1.1 --tls-max 1.1 https://$APP_DOMAIN/`                                                                    | Fails (minimum TLS 1.2).                                                                          |
| V7  | `docker compose exec nginx openssl x509 -noout -enddate -in /etc/nginx/certs/origin.pem`                                  | `notAfter` is in the future.                                                                      |
| V8  | `curl -X POST https://$APP_DOMAIN/api/v1/attendance/device-events -H 'X-Device-Key: <test device key>' ...` (test school) | The app's own response (even a 4xx), not a Cloudflare challenge page.                             |
| V9  | `curl -s https://$APP_DOMAIN/api/v1/calendar/feed/<test token>.ics`                                                       | Calendar data or the app's 404, not a challenge page.                                             |
| V10 | 30 rapid `POST /api/v1/auth/login` with a wrong password from one IP                                                      | Cloudflare 429 or block page before the app's own lockout.                                        |
| V11 | `docker compose logs app \| tail`                                                                                         | Request IPs are real visitors, not `104.x` or `172.64.x` (#2312 working).                         |

Paste the real output next to each command in the PR that applies the
checklist. Do not paste it here: this page holds the method, the PR holds
the evidence.

Also confirm nothing broke for: the public invoice page (`/i/:token`), the
public verify page (`/v/:token`), sign-up with Turnstile, cert renewal.

## Access policies

Cloudflare Access puts a login in front of a hostname **at the edge**. nginx trusts it because only Cloudflare can
reach the origin (`$origin_allowed`, D17). So the DNS record must stay proxied, or Access is bypassed.

nginx also drops any request with no `Cf-Access-Jwt-Assertion` header (the token Access adds). That is a
**tripwire, not authentication**. It catches a mis-set Access app: the DNS record added before the Access app, the
app scoped to the wrong path, or a grey-clouded record. In each case no token arrives and nginx answers nothing. It
does not stop a client that reaches the origin from an address nginx trusts: nginx checks only that the header is
there, never its signature, so such a client just sends one.

- With `TRUSTED_PROXY_CIDRS` empty, nginx trusts **every** address, so the header would be the whole gate. A prod
  deploy therefore refuses `OPS_DOMAIN` / `STAGING_DOMAIN` while the list is empty (`infra/ansible/deploy.yml`).
- With the list set, "trusted" still means any Cloudflare IP, which every Cloudflare customer shares. A real origin
  check (Authenticated Origin Pulls with our own CA, a `cloudflared` tunnel, or JWT verification) is a follow-up.

```mermaid
flowchart LR
  U[visitor] --> CF["Cloudflare edge<br/>Access: email = owner?"]
  CF -->|no| L[login page, 302]
  CF -->|yes, adds Cf-Access-Jwt-Assertion| N[origin nginx] --> A[staging app / ops UIs]
```

**Order matters: Access first, DNS second, hostname on the origin last.** Kuma and Beszel give admin to the first
visitor of their setup page, and Dozzle has no login at all, so there must never be a moment where the name resolves
and Access is not yet in front of it.

```mermaid
flowchart LR
  A1["1. Access application<br/>(hostname, Owner only)"] --> A2["2. DNS record, proxied"] --> A3["3. verify: 302 to login"]
  A3 --> A4["4. access_confirmed: true<br/>in inventory/prod.yml"] --> A5["5. OPS_DOMAIN / STAGING_DOMAIN<br/>in prod.enc.env, deploy prod"]
```

A prod deploy refuses a `prod.enc.env` that sets `OPS_DOMAIN` or `STAGING_DOMAIN` while `access_confirmed` is not
`true` or `TRUSTED_PROXY_CIDRS` is empty (`infra/ansible/deploy.yml`). Until those are set, prod nginx serves neither hostname (`*.invalid`).

### Staging (`staging.<domain>`)

1. Zero Trust > Access > Applications > **Add an application** > **Self-hosted**.
2. Name `Staging`. Session duration **24 hours**. Add public hostname `staging.<domain>` (path empty).
3. Add policy: name `Owner only`, action **Allow**, include **Emails** = the owner's email. No other rule.
4. Identity provider: **One-time PIN** is enough. Save.
5. Only now, Cloudflare dashboard > DNS: add `staging` (A record to the origin IP, or CNAME to `app`), **Proxied** (orange cloud).
6. Verify: `curl -sI https://staging.<domain>/` with no cookie gives `302` to `<team>.cloudflareaccess.com`. In a private
   window the same URL asks for a login.
7. Set `access_confirmed: true` in `infra/ansible/inventory/prod.yml`, put `STAGING_DOMAIN=staging.<domain>` in
   `prod.enc.env`, and deploy prod. After that the app loads behind the login.
8. Origin check (from your laptop, which is not a Cloudflare IP). Send a **forged** Access header, so the check tests
   the Cloudflare-only lock and not the header tripwire:
   ```bash
   curl -k --resolve staging.<domain>:443:<origin-ip> -H 'Cf-Access-Jwt-Assertion: x' https://staging.<domain>/
   ```
   It must get an empty reply (`curl: (52)` or `(56)`), never a page. A page means `TRUSTED_PROXY_CIDRS` is not in
   force: fix that before anything else.
9. Also check `curl -sI https://staging.<domain>/ | grep -i x-robots-tag` after login (browser dev tools): `noindex, nofollow`.

### Ops (`ops.<domain>`)

Same steps with name `Ops` and hostname `ops.<domain>` (the ops stack is #1769), and `OPS_DOMAIN` in step 7. Policy
`Owner only` again. Step 8 for it: `curl -k --resolve ops.<domain>:443:<origin-ip> -H 'Cf-Access-Jwt-Assertion: x'
https://ops.<domain>/dozzle/` must get an empty reply too.

The demo host pushes its nightly reset to Kuma through `ops.<domain>`, so the Ops application needs a second
policy for it: Zero Trust > Access > Service credentials > **Create service token** `demo-reset-push`, then add a
policy to `Ops` with action **Service Auth**, include **Service Token** = `demo-reset-push`. The token's id and
secret go in the demo `.env` as `DEMO_RESET_PUSH_ACCESS_CLIENT_ID` / `_SECRET`; `scripts/demo/reset.sh` sends them
as `CF-Access-Client-Id` / `CF-Access-Client-Secret`. Service auth adds `Cf-Access-Jwt-Assertion` like a login does,
so nginx lets it through. A **Bypass** policy would not work: Bypass adds no token, and nginx drops the push. Do this **before** creating the Kuma and Beszel admins through `ops.<domain>`
([12-operations.md §1](12-operations.md#setting-the-tools-up-by-hand-once)).

| Application | Hostname           | Policy                           | Check                                                                                     |
| ----------- | ------------------ | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `Staging`   | `staging.<domain>` | `Owner only`, 24 h, One-time PIN | `curl -sI` gives 302 to `cloudflareaccess.com`                                            |
| `Ops`       | `ops.<domain>`     | `Owner only`, same               | same; `/dozzle/` loads after login (`/kuma/`, `/beszel/`: see 12-operations known limits) |

## Re-check

Quarterly, and after any Cloudflare plan change. Items 7, 8, 9 and 11 are
the ones that drift.

## Rollback (lockout)

If users or devices get blocked, flip the item back in the dashboard first.
It takes effect in seconds.

If the origin lockdown is the cause, set `TRUSTED_PROXY_CIDRS=` (empty) and
run `docker compose up -d nginx`. Empty means no CDN trust at all. Also empty
`OPS_DOMAIN` and `STAGING_DOMAIN`: with no lock, the header tripwire would be
all that guards them (the next prod deploy refuses them anyway). The `up -d`
recreates nginx, which drops its edge networks; then run, from `infra/ansible`,
`ansible-playbook deploy.yml -e env=prod -e version=<running sha> --tags edge`.

Never turn DNS proxying off while `TRUSTED_PROXY_CIDRS` is set. Proxied DNS
must stay on whenever the list is set.
