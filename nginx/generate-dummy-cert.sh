#!/bin/sh
# Nginx refuses to start if ssl_certificate/ssl_certificate_key don't exist,
# but no cert exists until certbot has issued one — and certbot's webroot
# challenge needs nginx already listening on 80 to serve it. This breaks that
# chicken-and-egg problem: generate a short-lived self-signed cert so nginx
# can boot, then the real first-issuance command (see README) replaces it.
set -eu

DOMAIN="${APP_DOMAIN:-localhost}"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

if [ -f "$CERT_DIR/fullchain.pem" ]; then
  echo "Certificate already present for $DOMAIN — skipping dummy cert generation."
  exit 0
fi

mkdir -p "$CERT_DIR"
openssl req -x509 -nodes -newkey rsa:2048 \
  -days 1 \
  -keyout "$CERT_DIR/privkey.pem" \
  -out "$CERT_DIR/fullchain.pem" \
  -subj "/CN=$DOMAIN"

echo "Generated a temporary self-signed certificate for $DOMAIN."
echo "Run the first-issuance certbot command (see README) to replace it with a real one."
