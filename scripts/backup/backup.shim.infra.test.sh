#!/usr/bin/env bash
# Runs backup.sh's Docker-free shim cases. Named *.infra.test.sh so the CI
# `infra` job (ci.yml) and `ci:local` pick it up with the other infra tests.
# On a CI runner without rclone it installs it first, so case 8 (real rclone
# --backup-dir / --suffix / --max-delete) runs instead of printing SKIP. Under
# CI a failed install is a failure: case 8 is the only real-rclone check.
# ubuntu apt ships an older rclone (1.60.x) than the Alpine image; the flags
# case 8 uses (incl. --max-delete in --dry-run) behave the same in both.
set -euo pipefail
if [[ -n "${CI:-}" ]] && ! command -v rclone >/dev/null 2>&1; then
  { sudo apt-get update -qq && sudo apt-get install -y -qq rclone >/dev/null; } \
    || { echo "::error::rclone install failed; the real-rclone case cannot run"; exit 1; }
fi
exec bash "$(dirname "$0")/backup.test.sh" --shim
