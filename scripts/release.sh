#!/usr/bin/env bash
#
# یک فرمان، از ابتدا تا انتها: ساختِ ایمیج‌ها روی همین سیستم، انتقالِ بسته به
# سرور و اجرای استقرار روی سرور (بدون هیچ build ای روی VPS).
#
#   scripts/release.sh  USER@HOST[:/remote/project/dir]  [TAG]
#
# مسیرِ پیش‌فرضِ پروژه روی سرور: /opt/attendance
# نیازمندی: دسترسی ssh/scp بدونِ‌رمز (کلید) به سرور.

set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:?استفاده: scripts/release.sh USER@HOST[:/opt/attendance] [TAG]}"
TAG="${2:-$(date +%Y%m%d-%H%M%S)}"

REMOTE_HOST="${DEST%%:*}"
if [[ "$DEST" == *:* ]]; then REMOTE_DIR="${DEST#*:}"; else REMOTE_DIR="/opt/attendance"; fi

BUNDLE="release/attendance-images-$TAG.tgz"

echo "############################################################"
echo "# ۱/۳  ساخت ایمیج‌ها  (TAG=$TAG)"
echo "############################################################"
scripts/build-images.sh "$TAG"

echo
echo "############################################################"
echo "# ۲/۳  انتقال به  $REMOTE_HOST:$REMOTE_DIR"
echo "############################################################"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"
scp "$BUNDLE" scripts/deploy-images.sh docker-compose.yml "$REMOTE_HOST:$REMOTE_DIR/"

echo
echo "############################################################"
echo "# ۳/۳  استقرار روی سرور"
echo "############################################################"
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && bash deploy-images.sh 'attendance-images-$TAG.tgz' '$TAG'"

echo
echo "==> تمام. تگ  $TAG  روی  $REMOTE_HOST  مستقر شد."
echo "    بسته‌ی محلی برای نگهداری/عقب‌گرد:  $BUNDLE"
