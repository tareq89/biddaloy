#!/usr/bin/env sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Set production environment
export NODE_ENV=production

# Check for .env
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "ERROR: .env file not found at $SCRIPT_DIR/.env"
  echo "Copy .env.example to .env and fill in your credentials."
  exit 1
fi

echo "==> Starting beton-boi server on port ${PORT:-3000}..."
cd "$SCRIPT_DIR/server"
exec node dist/main.js