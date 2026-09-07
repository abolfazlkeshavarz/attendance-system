#!/usr/bin/env bash
#
# استقرار روی سرور از روی بسته‌ی ایمیج‌های از پیش ساخته‌شده. هیچ build ای اجرا
# نمی‌شود؛ فقط `docker load` و سپس `docker compose up -d`.
#
# این اسکریپت را کنارِ docker-compose.yml و .env پروژه روی سرور بگذارید و اجرا
# کنید:
#
#   bash deploy-images.sh  attendance-images-YYYYmmdd-HHMMSS.tgz  [TAG]
#
# اگر TAG داده نشود، از نام فایلِ بسته استخراج می‌شود.

set -euo pipefail
cd "$(dirname "$0")"

BUNDLE="${1:?استفاده: bash deploy-images.sh <bundle.tgz> [TAG]}"
[[ -f "$BUNDLE" ]] || { echo "خطا: فایل بسته پیدا نشد: $BUNDLE" >&2; exit 1; }

TAG="${2:-}"
if [[ -z "$TAG" ]]; then
  TAG="$(basename "$BUNDLE")"; TAG="${TAG#attendance-images-}"; TAG="${TAG%.tgz}"
fi
[[ -n "$TAG" ]] || { echo "خطا: نتوانستم TAG را تشخیص بدهم؛ آن را دستی بدهید." >&2; exit 1; }

[[ -f docker-compose.yml ]] || { echo "خطا: docker-compose.yml کنار همین اسکریپت نیست." >&2; exit 1; }
[[ -f .env ]] || { echo "خطا: .env پیدا نشد. اول «make setup» را اجرا کنید." >&2; exit 1; }
command -v docker >/dev/null || { echo "خطا: docker نصب نیست." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "خطا: افزونه‌ی docker compose v2 لازم است." >&2; exit 1; }

echo "==> بارگذاری ایمیج‌ها از  $BUNDLE"
gunzip -c "$BUNDLE" | docker load

# تگ را در .env می‌نویسیم تا docker compose (و make status/logs/down بعدی) همان
# ایمیج‌های بارگذاری‌شده را ببیند، نه ساختِ محلی.
if grep -q '^IMAGE_TAG=' .env; then
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$TAG|" .env
else
  printf '\n# تگ ایمیج‌های از پیش ساخته‌شده — scripts/deploy-images.sh آن را ست می‌کند\nIMAGE_TAG=%s\n' "$TAG" >> .env
fi
echo "==> IMAGE_TAG=$TAG در .env ثبت شد"

echo "==> راه‌اندازی سرویس‌ها (بدون build)"
IMAGE_TAG="$TAG" docker compose up -d --no-build --remove-orphans

echo
echo "==> وضعیت سرویس‌ها:"
docker compose ps

echo "==> پاک‌سازی ایمیج‌های بی‌استفاده"
docker image prune -f >/dev/null 2>&1 || true

cat <<EOF

  استقرار با موفقیت انجام شد — تگ  $TAG

  لاگ بک‌اند:   docker compose logs -f --tail=100 backend
  وضعیت:        docker compose ps
  اگر پشت nginx سطح میزبان تازه راه افتاده:   make ssl
EOF
