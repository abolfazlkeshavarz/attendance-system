#!/usr/bin/env bash
#
# Configures the HOST's nginx (not a container) as the reverse proxy and
# TLS terminator for this app, and obtains its Let's Encrypt certificate.
#
# Why host-level: this server runs several projects, each on its own
# (sub)domain, all on port 443. Only one process can bind 443, so nginx
# lives on the host and every project gets its own vhost file pointing at
# a local-only port that project's "web" container publishes (see
# APP_HTTP_PORT in .env / docker-compose.yml). This script only ever touches
# files specific to THIS project (named by domain, or prefixed
# "attendance-"); it never edits or removes another project's vhost.
#
# What it does:
#   1. Installs nginx/certbot on the host if not already present (safe to
#      run if another project already installed them).
#   2. Writes a temporary HTTP-only vhost so certbot's HTTP-01 challenge
#      has something to answer on port 80.
#   3. Requests the certificate from Let's Encrypt via the shared
#      /var/www/certbot webroot.
#   4. Replaces the vhost with the full HTTP->HTTPS + reverse-proxy config
#      from deploy/nginx/app.conf.template, and reloads nginx.
#   5. Installs a certbot renewal hook that reloads nginx (idempotent,
#      shared across all projects on this host).
#
# Usage:
#   make ssl                  # HTTP-01 challenge (default) — auto-renews
#   make ssl CHALLENGE=dns    # DNS-01, manual TXT record — does NOT
#                             # auto-renew; re-run this before the cert
#                             # expires, or switch to a certbot DNS plugin
set -euo pipefail

cd "$(dirname "$0")/.."

# ------------------------------------------------------------- elevate to root
if [[ "$(id -u)" != "0" ]]; then
  echo "==> Root access is required to configure nginx/certbot; re-running with sudo"
  exec sudo -E bash "$0" "$@"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script is written only for Ubuntu/Debian (apt)." >&2
  exit 1
fi

# shellcheck disable=SC1091
source scripts/lib.sh

load_env .env || exit 1

: "${DOMAIN:?Set DOMAIN in .env}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL in .env}"
APP_HTTP_PORT="${APP_HTTP_PORT:-8081}"

CHALLENGE="${CHALLENGE:-http}"
if [[ "$CHALLENGE" != "http" && "$CHALLENGE" != "dns" ]]; then
  echo "Error: CHALLENGE must be \"http\" or \"dns\" (got \"${CHALLENGE}\")." >&2
  exit 1
fi

STAGING_FLAG=()
if [[ "${LETSENCRYPT_STAGING:-false}" == "true" ]]; then
  echo "Let's Encrypt staging mode is enabled (certificate will not be valid)."
  STAGING_FLAG=(--staging)
fi

VHOST_PATH="/etc/nginx/sites-available/${DOMAIN}.conf"
VHOST_LINK="/etc/nginx/sites-enabled/${DOMAIN}.conf"
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"
WEBROOT="/var/www/certbot"

# --------------------------------------------------------------- packages
echo "==> Installing nginx/certbot if needed (leaves any existing install alone)"
apt-get update
apt-get install -y --no-install-recommends nginx certbot gettext-base

if [[ ! -d /etc/nginx/sites-enabled ]]; then
  echo "Error: /etc/nginx/sites-enabled not found. This script assumes the" >&2
  echo "       Debian/Ubuntu nginx package's sites-available/sites-enabled layout." >&2
  exit 1
fi

systemctl enable --now nginx

mkdir -p "$WEBROOT"

echo "==> Installing this project's security-headers snippet"
cp deploy/nginx/security-headers.conf /etc/nginx/snippets/attendance-security-headers.conf

echo "==> Installing the shared certbot-renewal nginx-reload hook"
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/sh
# Shared across every project on this host that uses host-level nginx +
# certbot webroot: certbot's own authenticator doesn't know to reload
# nginx after renewing, so every renewal runs this.
nginx -t && systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# ---------------------------------------------------------- DNS sanity check
if [[ "$CHALLENGE" == "http" ]]; then
  echo "==> Checking that ${DOMAIN} points to this server"
  server_ip="$(curl -fsS --max-time 10 https://api.ipify.org || echo '')"
  domain_ip="$(getent hosts "${DOMAIN}" | awk '{print $1}' | head -1 || echo '')"
  if [[ -n "$server_ip" && -n "$domain_ip" && "$server_ip" != "$domain_ip" ]]; then
    echo "Warning: ${DOMAIN} points to ${domain_ip} but this server's IP is ${server_ip}."
    echo "         If you just changed the DNS record, wait a bit; otherwise certbot will fail."
    read -r -p "         Continue anyway? [y/N] " reply
    [[ "$reply" == "y" || "$reply" == "Y" ]] || exit 1
  fi
fi

# --------------------------------------------------------- obtain certificate
if [[ -d "$CERT_PATH" ]]; then
  echo "==> Certificate for ${DOMAIN} already exists — skipping issuance, just re-rendering the vhost"
else
  if [[ "$CHALLENGE" == "http" ]]; then
    echo "==> Writing a temporary HTTP-only vhost so the ACME challenge can be answered"
    cat > "$VHOST_PATH" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
        default_type "text/plain";
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_HTTP_PORT};
        proxy_set_header Host \$host;
    }
}
EOF
    ln -sf "$VHOST_PATH" "$VHOST_LINK"
    nginx -t
    systemctl reload nginx

    echo "==> Requesting the certificate from Let's Encrypt (HTTP-01)"
    certbot certonly --webroot -w "$WEBROOT" \
      "${STAGING_FLAG[@]}" \
      --email "${LETSENCRYPT_EMAIL}" \
      -d "${DOMAIN}" \
      --rsa-key-size 4096 \
      --agree-tos \
      --no-eff-email \
      --non-interactive
  else
    echo "==> Requesting the certificate from Let's Encrypt (DNS-01, manual)"
    echo "    certbot will print a TXT record — add it in your DNS provider,"
    echo "    wait for it to propagate, then confirm when it asks."
    certbot certonly --manual --preferred-challenges dns \
      "${STAGING_FLAG[@]}" \
      --email "${LETSENCRYPT_EMAIL}" \
      -d "${DOMAIN}" \
      --rsa-key-size 4096 \
      --agree-tos \
      --no-eff-email
  fi
fi

# ------------------------------------------------------------- final vhost
echo "==> Writing the full HTTPS vhost from deploy/nginx/app.conf.template"
DOMAIN="$DOMAIN" APP_HTTP_PORT="$APP_HTTP_PORT" \
  envsubst '${DOMAIN} ${APP_HTTP_PORT}' < deploy/nginx/app.conf.template > "$VHOST_PATH"
ln -sf "$VHOST_PATH" "$VHOST_LINK"

nginx -t
systemctl reload nginx

echo ""
echo "Done: https://${DOMAIN} is now served by the host nginx and proxies to"
echo "127.0.0.1:${APP_HTTP_PORT} (this project's \"web\" container)."
echo "Renewal is automatic via certbot's own systemd timer (certbot.timer)."
