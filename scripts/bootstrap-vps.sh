#!/usr/bin/env bash
#
# استقرار کامل از صفر روی یک VPS اوبونتو/دبیان کاملاً تازه: نصب Docker،
# تنظیم آینه‌های داخلی (اختیاری، برای سرورهای ایران)، ساخت .env، بالا آوردن
# سامانه و گرفتن گواهی SSL — همه در یک اجرا.
#
# اجرا (از ریشه پروژه، بعد از git clone):
#   ./scripts/bootstrap-vps.sh
#
# می‌توانید دامنه و ایمیل را از قبل بدهید تا چیزی پرسیده نشود:
#   DOMAIN=hozur.example.com LETSENCRYPT_EMAIL=admin@example.com ./scripts/bootstrap-vps.sh
#
# برای دور زدن فیلترینگ/کندی روی سرورهای ایران (آینه‌های apt و docker):
#   MIRRORS=1 ./scripts/bootstrap-vps.sh
#
# اسکریپت خودش با sudo دوباره اجرا می‌شود؛ نیازی به «sudo» گذاشتن جلوی آن نیست.
set -euo pipefail

cd "$(dirname "$0")/.."

# ------------------------------------------------------------- ارتقا به root
if [[ "$(id -u)" != "0" ]]; then
  echo "==> نیاز به دسترسی root برای نصب Docker؛ با sudo دوباره اجرا می‌شود"
  exec sudo -E bash "$0" "$@"
fi

REAL_USER="${SUDO_USER:-root}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "این اسکریپت فقط برای اوبونتو/دبیان (apt) نوشته شده است." >&2
  exit 1
fi

# --------------------------------------------------------- آینه apt (اختیاری)
# اگر لازم است، باید پیش از هر apt-get دیگری اجرا شود.
if [[ "${MIRRORS:-0}" == "1" ]]; then
  echo "==> تنظیم آینه apt"
  make mirrors-apt
fi

# --------------------------------------------------------- بسته‌های پایه
echo "==> نصب بسته‌های پایه"
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg make openssl git

# --------------------------------------------------------------- Docker Engine
if ! command -v docker >/dev/null 2>&1; then
  echo "==> نصب Docker Engine"
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
  echo "    Docker نصب شد."
else
  echo "==> Docker از قبل نصب است"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "==> افزونه Docker Compose v2 پیدا نشد؛ نصب می‌شود"
  make install-compose
fi

if [[ "$REAL_USER" != "root" ]] && ! id -nG "$REAL_USER" | grep -qw docker; then
  echo "==> افزودن کاربر $REAL_USER به گروه docker"
  usermod -aG docker "$REAL_USER"
  echo "    توجه: برای اجرای docker بدون sudo باید دوباره وارد شوید (logout/login)."
fi

# ------------------------------------------------------- آینه docker (اختیاری)
if [[ "${MIRRORS:-0}" == "1" ]]; then
  echo "==> تنظیم آینه دریافت ایمیج داکر"
  make mirrors-docker
fi

# --------------------------------------------------------------- دامنه و ایمیل
if [[ -z "${DOMAIN:-}" ]]; then
  read -r -p "دامنه‌ای که رکورد A آن به IP این سرور اشاره می‌کند: " DOMAIN
fi
if [[ -z "${LETSENCRYPT_EMAIL:-}" ]]; then
  read -r -p "ایمیل برای هشدار انقضای گواهی Let's Encrypt: " LETSENCRYPT_EMAIL
fi
: "${DOMAIN:?دامنه لازم است}"
: "${LETSENCRYPT_EMAIL:?ایمیل لازم است}"

# ------------------------------------------------------------------- .env
echo "==> ساخت فایل .env"
make setup
sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env
sed -i "s|^LETSENCRYPT_EMAIL=.*|LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}|" .env
if [[ -n "${LETSENCRYPT_STAGING:-}" ]]; then
  sed -i "s|^LETSENCRYPT_STAGING=.*|LETSENCRYPT_STAGING=${LETSENCRYPT_STAGING}|" .env
fi

if [[ "$REAL_USER" != "root" ]]; then
  chown "$REAL_USER":"$REAL_USER" .env
fi

# --------------------------------------------------------------- استقرار
echo "==> ساخت ایمیج‌ها و بالا آوردن سامانه"
make deploy

echo "==> گرفتن گواهی SSL از Let's Encrypt"
make ssl

echo ""
echo "سامانه با موفقیت روی https://${DOMAIN} بالا آمد."
echo "پنل مدیریت و تبلت ورودی (kiosk) از همان آدرس در دسترس‌اند."
echo "رمز اولیه مدیر در خروجی «make setup» بالاتر چاپ شده — یادداشتش کنید."
