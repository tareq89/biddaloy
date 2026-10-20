# Ansible: provision the host

One command turns a fresh Ubuntu LTS VM into the hardened Docker host.

```mermaid
flowchart LR
  A[fresh VM] -->|provision.yml| B[deploy user + key-only SSH]
  B --> C[ufw 22/80/443 + fail2ban + auto-updates + chrony]
  C --> D[Docker, log rotation, weekly prune]
  D --> E[/opt/biddaloy: prod demo staging ops certs/]
```

```bash
pip install ansible                      # or: brew install ansible
cd infra/ansible
ansible-galaxy install -r requirements.yml
ansible-galaxy collection install -r requirements.yml
export BIDDALOY_PROD_HOST=203.0.113.10   # the VM's public IP
# first run on a fresh VM, as the image's admin user:
ansible-playbook provision.yml -e ansible_user=root
# re-run as deploy; must end with changed=0:
ansible-playbook provision.yml | tail -3
```

Needs `~/.ssh/id_ed25519.pub` (or `-e operator_ssh_pubkey="ssh-ed25519 ..."`).
Secrets are not here: see `infra/secrets`. Local `.vault*` files are ignored by version control.
Docker bypasses ufw, so compose binds everything but nginx to `127.0.0.1`; the play fails if any other port listens publicly.
Lint: `ansible-lint infra/ansible`.

## Deploy a version

```bash
ansible-playbook deploy.yml -e env=prod -e version=<git-sha>   # add --check to see the plan
```

Pulls, backs up (prod), migrates, restarts, waits for ready, smoke-tests, and logs to `/opt/biddaloy/<env>/deploys.log`. On failure it redeploys the last good version (migrations are not reverted). Before deploying: check out `<git-sha>` (files are copied from your checkout) and export `SMOKE_{ADMIN,TEACHER,SUPER_ADMIN}_{EMAIL,PASSWORD}` for the smoke test. Staging (`-e env=staging`) runs `config:check --env staging` first and skips the smoke test (Cloudflare Access). Full flow and rollback: `docs/architecture/07-deployment.md`.
