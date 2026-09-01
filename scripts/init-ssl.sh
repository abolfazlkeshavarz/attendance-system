#!/usr/bin/env bash
#
# Obtain an SSL certificate from Let's Encrypt for the first time.
#
# The problem this script solves: the nginx config points at a certificate
# file, but the certificate doesn't exist yet, so nginx won't start. On the
# other hand, certbot needs a running nginx to verify domain ownership.
#
# Solution: first generate a temporary self-signed certificate so nginx can
# start, then have certbot obtain the real certificate and put it in place.
#
# By default this uses the HTTP-01 challenge, which requires the domain to
# resolve directly to this server on port 80. If your domain instead points
# to a CDN/proxy in front of this server (so certbot can't be reached on
# port 80), use the DNS-01 challenge instead: certbot will print a TXT
# record for you to add manually in your DNS provider's dashboard, then
# pause and wait for you to confirm before continuing.
#
# Usage:
#   make ssl                  # HTTP-01 challenge (default)
#   make ssl CHALLENGE=dns    # DNS-01 challenge (manual TXT record)
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source scripts/lib.sh

load_env .env || exit 1

: "${DOMAIN:?Set DOMAIN in .env}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL in .env}"

CHALLENGE="${CHALLENGE:-http}"
if [[ "$CHALLENGE" != "http" && "$CHALLENGE" != "dns" ]]; then
  echo "Error: CHALLENGE must be \"http\" or \"dns\" (got \"${CHALLENGE}\")." >&2
  exit 1
fi

STAGING_FLAG=""
if [[ "${LETSENCRYPT_STAGING:-false}" == "true" ]]; then
  echo "Let's Encrypt staging mode is enabled (certificate will not be valid)."
  STAGING_FLAG="--staging"
fi

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"

echo "==> Checking that ${DOMAIN} points to this server"
server_ip="$(curl -fsS --max-time 10 https://api.ipify.org || echo '')"
domain_ip="$(getent hosts "${DOMAIN}" | awk '{print $1}' | head -1 || echo '')"
if [[ -n "$server_ip" && -n "$domain_ip" && "$server_ip" != "$domain_ip" ]]; then
  echo "Warning: ${DOMAIN} points to ${domain_ip} but this server's IP is ${server_ip}."
  echo "         If you just changed the DNS record, wait a bit; otherwise certbot will fail."
  read -r -p "         Continue anyway? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || exit 1
fi

echo "==> Creating a temporary certificate so nginx can start"
docker compose run --rm --entrypoint "\
  sh -c 'mkdir -p ${CERT_PATH} && \
         openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
           -keyout ${CERT_PATH}/privkey.pem \
           -out ${CERT_PATH}/fullchain.pem \
           -subj \"/CN=${DOMAIN}\"'" certbot

start_stack_safely || exit 1

echo "==> Removing the temporary certificate"
docker compose run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/${DOMAIN} \
         /etc/letsencrypt/archive/${DOMAIN} \
         /etc/letsencrypt/renewal/${DOMAIN}.conf" certbot

echo "==> Requesting the real certificate from Let's Encrypt"
docker compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    ${STAGING_FLAG} \
    --email ${LETSENCRYPT_EMAIL} \
    -d ${DOMAIN} \
    --rsa-key-size 4096 \
    --agree-tos \
    --no-eff-email \
    --force-renewal" certbot

echo "==> Reloading nginx with the new certificate"
docker compose exec web nginx -s reload

echo ""
echo "SSL certificate for ${DOMAIN} is ready."
echo "Automatic renewal is handled by the certbot service; no action needed."
