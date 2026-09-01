#!/usr/bin/env bash
#
# Shared helpers sourced by other scripts (and by the Makefile). Not meant
# to be run directly.

# ---------------------------------------------------------------------------
# load_env <file>
#
# Loads a .env-style file WITHOUT using `source`/`.`, which executes every
# line as a shell command. A stray line that isn't a comment or a KEY=VALUE
# assignment (e.g. a comment that lost its leading "#") would otherwise be
# run as a command and crash with "command not found". This only exports
# well-formed KEY=VALUE lines and warns (without aborting) about anything
# else.
# ---------------------------------------------------------------------------
load_env() {
  local file="${1:-.env}"
  if [[ ! -f "$file" ]]; then
    echo "Error: $file not found." >&2
    return 1
  fi
  set -a
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    else
      echo "Warning: ignoring malformed line in $file: $line" >&2
    fi
  done < "$file"
  set +a
}

# ---------------------------------------------------------------------------
# start_stack_safely
#
# Brings db and backend up and waits for them to report healthy BEFORE
# starting web. Starting nginx too early can make it fail to resolve
# "backend" on a freshly created Docker network ("host not found in
# upstream backend"), which makes it crash-loop and never bind port 80.
# If web still isn't running after that, do one clean "down && up" and
# try once more before giving up.
# ---------------------------------------------------------------------------
start_stack_safely() {
  echo "==> Starting db and backend, waiting for them to become healthy"
  docker compose up -d --wait db backend

  echo "==> Starting web and certbot"
  docker compose up -d web certbot
  sleep 5

  local status
  status="$(docker compose ps web --format '{{.State}}' 2>/dev/null || echo unknown)"
  if [[ "$status" != "running" ]]; then
    echo "==> web did not come up cleanly (state: $status); recreating the stack once"
    docker compose down
    docker compose up -d --wait db backend
    docker compose up -d web certbot
    sleep 5
    status="$(docker compose ps web --format '{{.State}}' 2>/dev/null || echo unknown)"
    if [[ "$status" != "running" ]]; then
      echo "Error: web is still not running (state: $status)." >&2
      echo "Check the logs: docker compose logs web --tail=50" >&2
      return 1
    fi
  fi
}
