#!/usr/bin/env bash
# Run the whole app locally: setup, then the API server and the admin SPA
# side by side. Ctrl+C stops both. (Production uses scripts/start.sh.)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

bash scripts/setup.sh

# Same override as setup.sh: .env may say production, local dev never is.
export NODE_ENV=development

# Kill both children when this script exits or is interrupted.
trap 'trap - EXIT; kill 0' INT TERM EXIT

echo "==> Starting server (http://localhost:3000) and client-admin (http://localhost:5174)..."
yarn dev:server &
yarn dev:client-admin &
wait
