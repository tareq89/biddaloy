#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/build-output"

echo "==> Cleaning previous build..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "==> Building server..."
yarn workspace server build

echo "==> Building client-student..."
yarn workspace client-student build

# Future clients:
# echo "==> Building client-teacher..."
# yarn workspace client-teacher build

echo "==> Assembling build-output..."

# Server: copy dist + package.json + install prod deps
mkdir -p "$OUTPUT_DIR/server"
cp -r "$ROOT_DIR/server/dist" "$OUTPUT_DIR/server/dist"
cp "$ROOT_DIR/server/package.json" "$OUTPUT_DIR/server/package.json"

echo "==> Installing production dependencies for server..."
(cd "$OUTPUT_DIR/server" && yarn install --production --frozen-lockfile)

# Clients: copy dist folders
for client_dir in "$ROOT_DIR"/client-*/; do
  client_name=$(basename "$client_dir")
  if [ -d "$client_dir/dist" ]; then
    echo "==> Copying $client_name static files..."
    cp -r "$client_dir/dist" "$OUTPUT_DIR/$client_name"
  fi
done

# Copy start script and env example
cp "$ROOT_DIR/scripts/start.sh" "$OUTPUT_DIR/start.sh"
chmod +x "$OUTPUT_DIR/start.sh"
cp "$ROOT_DIR/.env.example" "$OUTPUT_DIR/.env.example"

echo "==> Done! Build output is at $OUTPUT_DIR"
echo "    Deploy: zip -r deploy.zip build-output/"
echo "    Run on server: unzip deploy.zip && cp .env.example .env && ./start.sh"