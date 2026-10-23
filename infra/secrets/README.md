# Secrets (sops + age)

Every secret lives here **encrypted**. Only the operator's, the recovery and the host age keys can open it.
Plaintext never gets committed (CI guard: `scripts/check-tracked-files.mjs`).

```mermaid
flowchart LR
  A[operator laptop<br/>age private key] -->|sops edit| B[infra/secrets/*.enc.env<br/>in git, encrypted]
  B -->|sops -d with the host key, on the VM| C[write-env.yml]
  C -->|copy, 0640 root:deploy| D["/opt/biddaloy/<env>/.env on the VPS"]
  R[recovery key<br/>offline, Epic 65] -.can also decrypt.-> B
```

| File (`infra/secrets/`) | Stack | Who reads it | On the host (W3.01 writes it, `0640 root:deploy`) |
| --- | --- | --- | --- |
| `prod.enc.env` | prod | `deploy/stack.yml` (`ENV_NAME=prod`), `config:check --env prod`, the smoke test | `/opt/biddaloy/prod/.env` |
| `staging.enc.env` | staging | `deploy/stack.yml` (`ENV_NAME=staging`), the nightly refresh | `/opt/biddaloy/staging/.env` |
| `demo.enc.env` | demo | `deploy/stack.yml` (`ENV_NAME=demo`), `scripts/demo/reset.sh` | `/opt/biddaloy/demo/.env` |
| `edge.enc.env` | edge | `deploy/edge.yml`, `deploy/edge.direct.yml`, deploy messages | `/opt/biddaloy/edge/.env` |
| `ops.enc.env` | ops | `deploy/ops.yml` (Beszel, Kuma, Dozzle) | `/opt/biddaloy/ops/.env` |
| `*.example.env` | all | people | nowhere: committed key lists with empty values |

Staging has no OAuth or SMS keys on purpose (D6); its Turnstile pair is Cloudflare's public
always-pass test pair. The examples hold a value only for public defaults (stack name, memory
limits, that test pair): the list is in `scripts/check-tracked-files.mjs`.

Paths and switches the deploy sets itself are not in any example (`EDGE_DIR`, `REPO_DIR`,
`OPS_DIR`, `PG_TLS_DIR`, `EDGE_TRUSTED_CIDR`, `BACKUP_AGE_KEY_DIR`).

`BESZEL_KEY` is in both `edge.example.env` (the agent in `edge.yml`) and `ops.example.env`
(the hub); it is the same public value.

### Check a file before it ships

```bash
sops -d infra/secrets/staging.enc.env | yarn config:check --env staging --file /dev/stdin
# from the app image, nothing else needed:
#   node server/dist/scripts/config-check.js --env <prod|staging|demo> --file /dev/stdin
```

It fails on a missing required variable, a wrong `ENV_NAME`, a lone Turnstile key, and on a
staging or demo file that points at the prod database or bucket. Errors name variables, never
values.

## One-time setup

Install `sops` (3.9 or newer, for `--filename-override`) and `age` (`brew install sops age`).

1. **Operator key** (on your laptop):
   ```bash
   mkdir -p ~/.config/sops/age
   age-keygen -o ~/.config/sops/age/keys.txt   # prints "Public key: age1..."
   export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
   ```
2. **Recovery key**: run `age-keygen` once on a *different* machine. Store the
   private half as Epic 65 (#1737) says. Never on a laptop that also holds the
   operator key.
3. Put the three **public** keys (`age1...`: operator, recovery, host) into
   `.sops.yaml`, replacing the `REPLACE_WITH_...` placeholders. Make the host
   key on the VPS (`age-keygen`) and copy only its public half. Commit that. If a
   file already exists, run `sops updatekeys infra/secrets/<file>` for each.
4. Create each file with the sops editor, so no plaintext copy touches disk:
   ```bash
   sops infra/secrets/prod.enc.env     # opens $EDITOR on a new file; paste the keys from prod.example.env and fill values
   ```
   Make each random value with `openssl rand -hex 32`. Hex only: compose
   expands `$` in unquoted `.env` values, and `POSTGRES_PASSWORD` goes into
   `DATABASE_URL` without URL-encoding, so `@`, `/`, `:` and `$` break it.
   Never fill the values into `prod.example.env` itself: the CI guard fails on
   any value there.
   Repeat for `demo`, `staging`, `edge` and `ops`. No certificate file is kept here:
   tunnel mode needs none at the origin, and direct mode gets Let's Encrypt on the VM.
5. Check **both** keys work. Run the recovery check on a clean machine, or with
   an empty home so nothing is cached, then lock that key away:
   ```bash
   sops -d infra/secrets/prod.enc.env >/dev/null && echo laptop ok
   HOME=$(mktemp -d) SOPS_AGE_KEY_FILE=/Volumes/usb/recovery.txt sops -d infra/secrets/prod.enc.env >/dev/null && echo recovery ok
   ```

CI guard: `scripts/check-tracked-files.mjs` checks content, not just names.

| Tracked file | Must be |
| --- | --- |
| `infra/secrets/*.enc.env` | sops output: every value line is `KEY=ENC[AES256_GCM,...`, every comment is `#ENC[AES256_GCM,...`, and only the `sops_*` metadata keys sops writes (version, mac, lastmodified, unencrypted_suffix, age recipients). One plaintext line or comment added in a normal editor fails it. |
| `infra/secrets/*.enc.pem` | sops JSON: `data` starts with `ENC[`, and a `sops` block. |
| any `*.example.env` | every `KEY=` empty, and no commented-out `# KEY=value`. Only the public defaults listed in `check-tracked-files.mjs` are allowed (stack name, memory limits, the Turnstile test pair). The same script also fails when a `${VAR}` in `deploy/*.yml` is not a key of its stack's example file. |
| any other `*.env`, `*.env.bak` / `.txt` / `~`, `*.dotenv`, `.envrc` | not tracked at all (a decrypted `sops -d ... > prod.env` copy). `*.example.env` is fine. |
| `infra/ansible/.vault*` | not tracked at all. |
| anything | no age private key, no PEM private key, and no line like `POSTGRES_PASSWORD=<12+ chars>` for the main secret keys unless it is `ENC[...]` or a test value. |

## Everyday

| Do                    | Command                                                |
| --------------------- | ------------------------------------------------------ |
| Edit                  | `sops infra/secrets/prod.enc.env`                      |
| View                  | `sops -d infra/secrets/prod.enc.env`                   |
| Change recipients     | edit `.sops.yaml`, then `sops updatekeys infra/secrets/<file>` for each file |
| Push to the server    | commit the changed file, push to main, then a full `deploy.yml` of that NEW commit (the playbooks read secrets from the checkout; rotation steps: `docs/architecture/12-operations.md` section 8). `--tags env` only rewrites `.env` and restarts nothing |

**Add a new key:**

1. Use it in the compose file as `${NAME}` (or `${NAME:-default}`).
2. Add `NAME=` with a one-line comment (what, where to get it, example shape) to the matching
   `*.example.env`. `node scripts/check-tracked-files.mjs` fails until you do.
3. `sops infra/secrets/<stack>.enc.env`, add the value, commit, deploy.

**Rotate a key:** edit the value with `sops`, commit, run a full `deploy.yml`. For `JWT_SECRET` and
`SETTINGS_ENCRYPTION_KEY`, move the old value to `*_PREVIOUS` first so nobody is signed out; the
steps per secret are in `docs/architecture/12-operations.md` section 8.

## Laptop lost

1. Decrypt with the recovery key (step 5 above, on a clean machine).
2. Make a new operator key, update `.sops.yaml`, run `sops updatekeys` on every file.
3. Assume the old key is stolen: **rotate every secret** (section 8 of
   `12-operations.md`), then commit the re-encrypted files.
