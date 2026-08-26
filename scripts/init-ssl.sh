#!/usr/bin/env bash
#
# گرفتن گواهی SSL از Let's Encrypt برای اولین بار.
#
# مشکلی که این اسکریپت حل می‌کند: پیکربندی nginx به فایل گواهی اشاره می‌کند،
# ولی گواهی هنوز وجود ندارد؛ پس nginx بالا نمی‌آید. از طرف دیگر certbot برای
# تأیید مالکیت دامنه به یک nginx در حال اجرا نیاز دارد.
#
# راه‌حل: اول یک گواهی موقت (self-signed) ساخته می‌شود تا nginx بالا بیاید،
# بعد certbot گواهی واقعی را می‌گیرد و جایش می‌گذارد.
#
# اجرا:  make ssl
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "خطا: فایل .env پیدا نشد. اول «make setup» را اجرا کنید." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

: "${DOMAIN:?DOMAIN را در .env تنظیم کنید}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL را در .env تنظیم کنید}"

STAGING_FLAG=""
if [[ "${LETSENCRYPT_STAGING:-false}" == "true" ]]; then
  echo "حالت آزمایشی Let's Encrypt فعال است (گواهی معتبر نخواهد بود)."
  STAGING_FLAG="--staging"
fi

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"

echo "==> بررسی اینکه دامنه ${DOMAIN} به این سرور اشاره می‌کند"
server_ip="$(curl -fsS --max-time 10 https://api.ipify.org || echo '')"
domain_ip="$(getent hosts "${DOMAIN}" | awk '{print $1}' | head -1 || echo '')"
if [[ -n "$server_ip" && -n "$domain_ip" && "$server_ip" != "$domain_ip" ]]; then
  echo "هشدار: ${DOMAIN} به ${domain_ip} اشاره می‌کند ولی IP این سرور ${server_ip} است."
  echo "        اگر رکورد DNS را تازه عوض کرده‌اید کمی صبر کنید، وگرنه certbot شکست می‌خورد."
  read -r -p "        ادامه می‌دهید؟ [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || exit 1
fi

echo "==> ساخت گواهی موقت تا nginx بتواند بالا بیاید"
docker compose run --rm --entrypoint "\
  sh -c 'mkdir -p ${CERT_PATH} && \
         openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
           -keyout ${CERT_PATH}/privkey.pem \
           -out ${CERT_PATH}/fullchain.pem \
           -subj \"/CN=${DOMAIN}\"'" certbot

echo "==> بالا آوردن nginx"
docker compose up -d web
sleep 5

echo "==> حذف گواهی موقت"
docker compose run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/${DOMAIN} \
         /etc/letsencrypt/archive/${DOMAIN} \
         /etc/letsencrypt/renewal/${DOMAIN}.conf" certbot

echo "==> درخواست گواهی واقعی از Let's Encrypt"
docker compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    ${STAGING_FLAG} \
    --email ${LETSENCRYPT_EMAIL} \
    -d ${DOMAIN} \
    --rsa-key-size 4096 \
    --agree-tos \
    --no-eff-email \
    --force-renewal" certbot

echo "==> بارگذاری مجدد nginx با گواهی جدید"
docker compose exec web nginx -s reload

echo ""
echo "گواهی SSL برای ${DOMAIN} آماده شد."
echo "تمدید خودکار توسط سرویس certbot انجام می‌شود؛ کاری لازم نیست."
