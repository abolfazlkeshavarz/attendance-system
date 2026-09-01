#!/usr/bin/env bash
#
# Self-signed HTTPS certificate for access from the local network (cert.pem/
# key.pem in the project root) — used by both the local Docker deployment
# (docker-compose.local.yml) and the Dockerless dev server (vite.config.ts).
#
# Why it's needed: browsers only grant camera access on a "secure context"
# (localhost or HTTPS). When you connect from a phone as the check-in tablet
# over the local network, the address is an IP, not localhost, so without
# HTTPS the camera won't open at all.
#
# Usage:
#   ./scripts/gen-local-cert.sh              # auto-detect local network IP
#   ./scripts/gen-local-cert.sh 192.168.1.23  # or specify it manually
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
  # fallback for Linux/WSL
  hostname -I 2>/dev/null | awk '{print $1}'
}

if [[ -z "$IP" ]]; then
  IP="$(detect_ip || true)"
fi

if [[ -z "$IP" ]]; then
  echo "Could not auto-detect the local network IP." >&2
  echo "Find it with ipconfig (Windows) or ip addr (Linux), then run:" >&2
  echo "  ./scripts/gen-local-cert.sh <your local network IP>" >&2
  exit 1
fi

echo "==> Generating self-signed certificate for: localhost, 127.0.0.1, ${IP}"
# MSYS_NO_PATHCONV: on Windows Git Bash, prevents "/CN=..." from being
# mangled into a file path
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
echo "cert.pem and key.pem were created in the project root (they're in .gitignore)."
echo ""
echo "Now run: make local-up"
echo "On your phone (same network/Wi-Fi), go to: https://${IP}:8443/kiosk"
echo "The browser will show an \"invalid certificate\" warning the first time — dismiss it (Advanced -> Proceed)."
echo "To stop seeing that warning, install cert.pem as a trusted certificate on the phone."
