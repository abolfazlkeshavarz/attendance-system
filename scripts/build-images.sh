#!/usr/bin/env bash
#
# Builds the two images that must be compiled — backend and web — HERE (a
# development machine) and packs them into a single tarball to carry to the
# server, so the server never has to build anything.
#
# Why this exists: the frontend's Vite/TypeScript build wants well over 1 GB
# of RAM and the face-recognition assets make it slow; on a small VPS (1 core,
# little memory) building in place is slow at best and gets OOM-killed at
# worst. Build where the resources are and ship the result.
#
# Usage (on your own machine, from the project root):
#   ./scripts/build-images.sh
#   make images
#
# Options (environment variables):
#   PLATFORM=linux/arm64          target architecture, if the server is not x86-64
#   INCLUDE_BASE=1                also bundle postgres:16-alpine, for a server
#                                that cannot pull from Docker Hub at all
#   OUT=path/to/file.tar.gz       where to write the bundle
set -euo pipefail

cd "$(dirname "$0")/.."

PLATFORM="${PLATFORM:-linux/amd64}"
OUT="${OUT:-dist/attendance-images.tar.gz}"
INCLUDE_BASE="${INCLUDE_BASE:-0}"

# Kept in step with docker-compose.yml (image: attendance-backend:${IMAGE_TAG:-latest}).
BASE_IMAGES=(postgres:16-alpine)
IMAGES=(attendance-backend:latest attendance-web:latest)

echo "==> Building images for ${PLATFORM}"
echo ""

# compose interpolates the whole file before it will build anything, and a few
# vars are declared required (SECRET_KEY, POSTGRES_PASSWORD, DOMAIN). Their
# *values* never reach a build — they are runtime settings, nothing from them
# is baked into an image — so a throwaway .env is enough and is cleaned up
# afterwards, rather than making you create a real one on a machine that will
# never run the stack.
TEMP_ENV=0
if [[ ! -f .env ]]; then
  TEMP_ENV=1
  cp .env.example .env
  sed -i.bak \
    -e 's|^SECRET_KEY=.*|SECRET_KEY=build-time-placeholder-not-used-at-runtime|' \
    -e 's|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=build-time-placeholder|' \
    -e 's|^DOMAIN=.*|DOMAIN=build.invalid|' \
    .env && rm -f .env.bak
  echo "    (using a temporary .env just to satisfy compose interpolation;"
  echo "     nothing from it is baked into the images)"
  echo ""
fi
cleanup() { [[ "$TEMP_ENV" == "1" ]] && rm -f .env; }
trap cleanup EXIT

DOCKER_DEFAULT_PLATFORM="$PLATFORM" docker compose build

echo ""
echo "==> Verifying the built images really are ${PLATFORM}"
# A mismatch here does not fail the build; it produces images that load fine
# on the server and then die at startup with a bare "exec format error" — a
# confusing symptom to debug remotely. Cheaper to catch it now.
want_os="${PLATFORM%%/*}"
want_arch="${PLATFORM##*/}"
for img in "${IMAGES[@]}"; do
  got="$(docker image inspect "$img" --format '{{.Os}}/{{.Architecture}}')"
  if [[ "$got" != "${want_os}/${want_arch}" ]]; then
    echo "Error: ${img} is ${got}, but ${PLATFORM} was requested." >&2
    echo "       Loading this on the server would fail at runtime with" >&2
    echo "       \"exec format error\". Check your Docker buildx setup." >&2
    exit 1
  fi
  echo "    ${img}: ${got}"
done

if [[ "$INCLUDE_BASE" == "1" ]]; then
  echo ""
  echo "==> Also pulling base images for ${PLATFORM} (INCLUDE_BASE=1)"
  for img in "${BASE_IMAGES[@]}"; do
    docker pull --platform "$PLATFORM" "$img"
  done
  IMAGES+=("${BASE_IMAGES[@]}")
fi

echo ""
echo "==> Packing into ${OUT}"
mkdir -p "$(dirname "$OUT")"
# gzip -1: image layers are mostly already-compressed content, so the higher
# levels cost a lot of time for very little extra saving.
docker save "${IMAGES[@]}" | gzip -1 > "$OUT"

size="$(du -h "$OUT" | cut -f1)"
echo ""
echo "================================================================"
echo " Built: ${size}  ->  ${OUT}"
echo "================================================================"
echo ""
echo "Next, copy it to the server and load it there:"
echo ""
echo "  scp ${OUT} YOUR_USER@YOUR_SERVER:/opt/attendance/"
echo "  ssh YOUR_USER@YOUR_SERVER"
echo "  cd /opt/attendance && ./scripts/load-images.sh"
echo ""
if [[ "$INCLUDE_BASE" != "1" ]]; then
  echo "This bundle contains only the two images that must be built. postgres is"
  echo "pulled from Docker Hub on the server (postgres:16-alpine is very likely"
  echo "already there if another project uses it). If the server cannot reach"
  echo "Docker Hub at all, rebuild with INCLUDE_BASE=1 to bundle it too."
  echo ""
fi
