#!/usr/bin/env bash
#
# Obtain an SSL certificate from Let's Encrypt using a manual DNS-01
# challenge instead of the HTTP-01 challenge used by init-ssl.sh.
#
# Use this when port 80 on this server is not reachable from the internet
# (firewall, NAT, provider security group, etc.) so the normal HTTP
# challenge in init-ssl.sh fails with "Connection refused".
#
# How it works: certbot will print a TXT record value and pause. You add
# that TXT record at your DNS provider for _acme-challenge.<domain>, wait
# for it to propagate, then press Enter in this terminal to continue.
#
# Trade-off: unlike init-ssl.sh, this does NOT auto-renew. Every ~90 days
# you'll need to re-run this and update the TXT record again (or switch to
# a certbot DNS plugin for your DNS provider, or fix port 80 and switch
# back to init-ssl.sh / ssl-renew).
#
# Usage:  make ssl-dns
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source scripts/lib.sh

load_env .env || exit 1

: "${DOMAIN:?Set DOMAIN in .env}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL in .env}"

STAGING_FLAG=""
if [[ "${LETSENCRYPT_STAGING:-false}" == "true" ]]; then
  echo "Let's Encrypt staging mode is enabled (certificate will not be valid)."
  STAGING_FLAG="--staging"
fi

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"

# nginx needs *some* certificate at CERT_PATH to start, so create a
# temporary self-signed one first if there's nothing there yet.
if ! docker compose run --rm --entrypoint "test -f ${CERT_PATH}/fullchain.pem" certbot >/dev/null 2>&1; then
  echo "==> Creating a temporary certificate so nginx can start"
  docker compose run --rm --entrypoint "\
    sh -c 'mkdir -p ${CERT_PATH} && \
           openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
             -keyout ${CERT_PATH}/privkey.pem \
             -out ${CERT_PATH}/fullchain.pem \
             -subj \"/CN=${DOMAIN}\"'" certbot
fi

start_stack_safely || exit 1

echo "==> Removing any temporary/previous certificate for ${DOMAIN}"
docker compose run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/${DOMAIN} \
         /etc/letsencrypt/archive/${DOMAIN} \
         /etc/letsencrypt/renewal/${DOMAIN}.conf" certbot

echo ""
echo "==> Requesting a certificate via DNS-01 (manual)"
echo "    certbot will print a TXT record. Add it at your DNS provider under:"
echo "      _acme-challenge.${DOMAIN}"
echo "    then wait ~1-5 minutes for it to propagate before continuing."
echo ""

docker compose run --rm -it certbot certonly \
  --manual --preferred-challenges dns \
  ${STAGING_FLAG} \
  --email "${LETSENCRYPT_EMAIL}" \
  -d "${DOMAIN}" \
  --rsa-key-size 4096 \
  --agree-tos \
  --no-eff-email

echo "==> Reloading nginx with the new certificate"
docker compose exec web nginx -s reload

echo ""
echo "SSL certificate for ${DOMAIN} is ready."
echo "Reminder: this certificate will NOT auto-renew. Re-run \"make ssl-dns\" before it expires,"
echo "or fix inbound port 80 and use \"make ssl-renew\" instead."
