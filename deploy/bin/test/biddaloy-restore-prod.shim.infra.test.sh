#!/usr/bin/env bash
# Runs the Docker-free restore tests. Named *.infra.test.sh so the CI `infra` job (ci.yml) and
# `ci:local` pick them up with the other infra tests (same pattern as backup.shim.infra.test.sh).
set -euo pipefail
here="$(dirname "$0")"
bash "$here/biddaloy-restore-prod.test.sh"
bash "$here/restore-guards.test.sh"
