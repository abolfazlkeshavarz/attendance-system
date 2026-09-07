#!/usr/bin/env bash
#
# ساخت ایمیج‌های داکرِ backend و web روی سیستمِ توسعه و بسته‌بندی‌شان (به‌همراه
# ایمیج پایگاه داده) در یک فایل .tgz. این فایل را به سرور منتقل می‌کنید تا آنجا
# فقط `docker load` + `docker compose up -d` اجرا شود — هیچ build کندی روی VPS.
#
# استفاده:
#   scripts/build-images.sh [TAG]
#
# TAG پیش‌فرض: تاریخ‌وزمان (YYYYmmdd-HHMMSS). خروجی در پوشه‌ی release/.
#
# نیازمندی‌ها: Docker + افزونه‌ی docker compose v2 روی همین سیستم.

set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
OUT_DIR="release"
BUNDLE="$OUT_DIR/attendance-images-$TAG.tgz"

PG_IMAGE="postgres:16-alpine"
BACKEND_IMAGE="attendance-backend:$TAG"
WEB_IMAGE="attendance-web:$TAG"

# VPS تقریباً همیشه linux/amd64 است؛ این خط باعث می‌شود روی مکِ Apple Silicon
# هم ایمیجِ درست برای سرور ساخته شود (روی ویندوز/لینوکسِ x86 بی‌اثر است).
export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"

command -v docker >/dev/null || { echo "خطا: docker نصب نیست." >&2; exit 1; }

# مستقیم با `docker build` می‌سازیم (نه `docker compose build`) تا نیازی به
# .env و متغیرهای اجباریِ compose روی سیستم توسعه نباشد. نامِ ایمیج دقیقاً
# همان چیزی است که compose روی سرور با IMAGE_TAG=$TAG انتظار دارد.
echo "==> ساخت backend  ->  $BACKEND_IMAGE  (پلتفرم: $DOCKER_DEFAULT_PLATFORM)"
docker build --pull -t "$BACKEND_IMAGE" ./backend

echo "==> ساخت web  ->  $WEB_IMAGE"
docker build --pull -t "$WEB_IMAGE" ./frontend

echo "==> دریافت ایمیج پایگاه داده ($PG_IMAGE)"
docker pull "$PG_IMAGE"

mkdir -p "$OUT_DIR"
echo "==> ذخیره‌ی سه ایمیج و فشرده‌سازی در  $BUNDLE"
docker save "$BACKEND_IMAGE" "$WEB_IMAGE" "$PG_IMAGE" | gzip > "$BUNDLE"

echo "$TAG" > "$OUT_DIR/latest-tag.txt"
SIZE="$(du -h "$BUNDLE" | cut -f1)"

cat <<EOF

  بسته آماده شد:  $BUNDLE   ($SIZE)
  تگ ایمیج‌ها:     $TAG

  مرحله‌ی بعد — انتقال به سرور و استقرار (بدون build):

    scp "$BUNDLE" scripts/deploy-images.sh docker-compose.yml USER@HOST:/opt/attendance/
    ssh USER@HOST 'cd /opt/attendance && bash deploy-images.sh attendance-images-$TAG.tgz'

  یا همه‌ی این‌ها در یک فرمان از همین سیستم:

    scripts/release.sh USER@HOST[:/opt/attendance] $TAG
EOF
