#!/bin/sh
# Local dev only (docker-compose.build.yml). Production mounts a Cloudflare
# Origin CA pair instead. nginx refuses to start without a certificate, so
# write a short-lived self-signed origin.pem / origin.key into /certs.
set -eu

DOMAIN="${APP_DOMAIN:-localhost}"
CERT_DIR="${CERT_DIR:-/certs}"

if [ -f "$CERT_DIR/origin.pem" ] && [ -f "$CERT_DIR/origin.key" ]; then
  echo "Certificate already present in $CERT_DIR — skipping dummy cert generation."
  exit 0
fi

mkdir -p "$CERT_DIR"
openssl req -x509 -nodes -newkey rsa:2048 \
  -days 30 \
  -keyout "$CERT_DIR/origin.key" \
  -out "$CERT_DIR/origin.pem" \
  -subj "/CN=$DOMAIN"

echo "Generated a temporary self-signed certificate for $DOMAIN in $CERT_DIR."
