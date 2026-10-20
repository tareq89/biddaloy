#!/usr/bin/env bash
# Runs backup.sh's Docker-free shim cases. Named *.infra.test.sh so the CI
# `infra` job (ci.yml) and `ci:local` pick it up with the other infra tests.
# On a CI runner without rclone it installs it first, so case 8 (real rclone
# --backup-dir / --suffix / --max-delete) runs instead of printing SKIP.
set -euo pipefail
if [[ -n "${CI:-}" ]] && ! command -v rclone >/dev/null 2>&1; then
  { sudo apt-get update -qq && sudo apt-get install -y -qq rclone >/dev/null; } \
    || echo "::warning::rclone install failed; the real-rclone case will SKIP"
fi
exec bash "$(dirname "$0")/backup.test.sh" --shim
