#!/usr/bin/env bash
#
# Full zero-to-deployed setup on a brand-new Ubuntu/Debian VPS: installs
# Docker, configures internal mirrors (optional, for Iranian servers),
# creates .env, brings the system up, and configures this server's nginx +
# an SSL certificate for it — all in one run.
#
# This app runs fine alongside OTHER projects on the same VPS, each on its
# own (sub)domain: only this project's Docker containers are installed by
# this script, and the SSL/reverse-proxy step (make ssl) reuses the host's
# single nginx + certbot rather than trying to own port 443 itself — see
# scripts/deploy-host-nginx.sh. If nginx/certbot are already installed for
# another project, this leaves them and every other project's config alone.
#
# Usage (from the project root, after git clone):
#   ./scripts/bootstrap-vps.sh
#
# You can supply the domain and email up front so nothing is prompted:
#   DOMAIN=hozur.example.com LETSENCRYPT_EMAIL=admin@example.com ./scripts/bootstrap-vps.sh
#
# If this is not the first project on this VPS, also set a free local port
# (must be unique per project — default 8081):
#   APP_HTTP_PORT=8082 DOMAIN=... LETSENCRYPT_EMAIL=... ./scripts/bootstrap-vps.sh
#
# To work around filtering/throttling on Iranian servers (apt and docker mirrors):
#   MIRRORS=1 ./scripts/bootstrap-vps.sh
#
# The script re-execs itself with sudo; you don't need to put "sudo" in front of it.
set -euo pipefail

cd "$(dirname "$0")/.."

# ------------------------------------------------------------- elevate to root
if [[ "$(id -u)" != "0" ]]; then
  echo "==> Root access is required to install Docker; re-running with sudo"
  exec sudo -E bash "$0" "$@"
fi

REAL_USER="${SUDO_USER:-root}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script is written only for Ubuntu/Debian (apt)." >&2
  exit 1
fi

# --------------------------------------------------------- apt mirror (optional)
# If needed, this must run before any other apt-get calls.
if [[ "${MIRRORS:-0}" == "1" ]]; then
  echo "==> Setting apt mirror"
  make mirrors-apt
fi

# --------------------------------------------------------- base packages
echo "==> Installing base packages"
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg make openssl git

# --------------------------------------------------------------- Docker Engine
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  echo "    Docker installed."
else
  echo "==> Docker is already installed"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "==> Docker Compose v2 plugin not found; installing"
  make install-compose
fi

if [[ "$REAL_USER" != "root" ]] && ! id -nG "$REAL_USER" | grep -qw docker; then
  echo "==> Adding user $REAL_USER to the docker group"
  usermod -aG docker "$REAL_USER"
  echo "    Note: you must log out/in again to run docker without sudo."
fi

# ------------------------------------------------------- docker mirror (optional)
if [[ "${MIRRORS:-0}" == "1" ]]; then
  echo "==> Setting Docker image pull mirror"
  make mirrors-docker
fi

# --------------------------------------------------------------- domain and email
if [[ -z "${DOMAIN:-}" ]]; then
  read -r -p "Domain whose A record points to this server's IP: " DOMAIN
fi
if [[ -z "${LETSENCRYPT_EMAIL:-}" ]]; then
  read -r -p "Email for Let's Encrypt expiry warnings: " LETSENCRYPT_EMAIL
fi
: "${DOMAIN:?DOMAIN is required}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL is required}"

if [[ -z "${APP_HTTP_PORT:-}" ]] && [[ -d /etc/nginx || -x /usr/sbin/nginx ]]; then
  echo ""
  echo "nginx is already on this server, which usually means another project"
  echo "is already deployed here. This app's containers must publish their"
  echo "local port on a number no other project uses (default: 8081)."
  read -r -p "Local port for this app [8081]: " APP_HTTP_PORT
fi
APP_HTTP_PORT="${APP_HTTP_PORT:-8081}"

# ------------------------------------------------------------------- .env
echo "==> Creating .env file"
make setup
sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env
sed -i "s|^LETSENCRYPT_EMAIL=.*|LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}|" .env
sed -i "s|^APP_HTTP_PORT=.*|APP_HTTP_PORT=${APP_HTTP_PORT}|" .env
if [[ -n "${LETSENCRYPT_STAGING:-}" ]]; then
  sed -i "s|^LETSENCRYPT_STAGING=.*|LETSENCRYPT_STAGING=${LETSENCRYPT_STAGING}|" .env
fi

if [[ "$REAL_USER" != "root" ]]; then
  chown "$REAL_USER":"$REAL_USER" .env
fi

# --------------------------------------------------------------- deploy
echo "==> Building images and bringing the system up"
make deploy

echo "==> Obtaining SSL certificate from Let's Encrypt"
make ssl

echo ""
echo "System is up successfully at https://${DOMAIN}"
echo "The admin panel and kiosk check-in tablet page are both available at that address."
echo "The initial admin password was printed above in the \"make setup\" output — write it down."
