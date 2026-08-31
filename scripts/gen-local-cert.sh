#!/usr/bin/env bash
#
# گواهی HTTPS خودامضا برای دسترسی از شبکه داخلی (cert.pem/key.pem در ریشه
# پروژه) — هم توسط استقرار محلی Docker (docker-compose.local.yml) و هم سرور
# توسعه بدون Docker (vite.config.ts) استفاده می‌شود.
#
# چرا لازم است: مرورگرها فقط در «بستر امن» (localhost یا HTTPS) به دوربین
# دسترسی می‌دهند. وقتی از گوشی به‌عنوان تبلت ورودی روی شبکه داخلی وصل می‌شوید،
# آدرس IP است نه localhost، پس بدون HTTPS دوربین اصلاً باز نمی‌شود.
#
# اجرا:
#   ./scripts/gen-local-cert.sh              # تشخیص خودکار IP شبکه داخلی
#   ./scripts/gen-local-cert.sh 192.168.1.23  # یا مشخص کردن دستی
#   IP=192.168.1.23 ./scripts/gen-local-cert.sh
set -euo pipefail
cd "$(dirname "$0")/.."

IP="${1:-${IP:-}}"

detect_ip() {
  for py in python3 python py; do
    if command -v "$py" >/dev/null 2>&1; then
      "$py" -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(('8.8.8.8', 80))
    print(s.getsockname()[0])
except Exception:
    pass
finally:
    s.close()
" 2>/dev/null && return 0
    fi
  done
  # جایگزین برای لینوکس/WSL
  hostname -I 2>/dev/null | awk '{print $1}'
}

if [[ -z "$IP" ]]; then
  IP="$(detect_ip || true)"
fi

if [[ -z "$IP" ]]; then
  echo "IP شبکه داخلی به‌صورت خودکار پیدا نشد." >&2
  echo "آن را با ipconfig (ویندوز) یا ip addr (لینوکس) پیدا کنید و اجرا کنید:" >&2
  echo "  ./scripts/gen-local-cert.sh <IP شبکه داخلی شما>" >&2
  exit 1
fi

echo "==> ساخت گواهی خودامضا برای: localhost، 127.0.0.1، ${IP}"
# MSYS_NO_PATHCONV: روی Git Bash ویندوز، جلوی تبدیل ناخواسته "/CN=..." به مسیر فایل را می‌گیرد
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout key.pem \
  -out cert.pem \
  -subj "/CN=${IP}" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${IP}" \
  2>/dev/null

if [[ -f .env.local ]]; then
  if grep -q '^LOCAL_LAN_IP=' .env.local; then
    sed -i "s|^LOCAL_LAN_IP=.*|LOCAL_LAN_IP=${IP}|" .env.local
  else
    printf 'LOCAL_LAN_IP=%s\n' "$IP" >> .env.local
  fi
fi

echo ""
echo "cert.pem و key.pem در ریشه پروژه ساخته شدند (در .gitignore هستند)."
echo ""
echo "حالا: make local-up"
echo "روی گوشی (در همان شبکه/Wi-Fi) به این آدرس بروید: https://${IP}:8443/kiosk"
echo "مرورگر بار اول هشدار «گواهی نامعتبر» می‌دهد — رد کنید (Advanced → Proceed)."
echo "برای اینکه دیگر این هشدار را نبینید، cert.pem را روی گوشی به‌عنوان گواهی معتبر نصب کنید."
