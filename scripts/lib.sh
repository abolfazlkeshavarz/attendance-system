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
# port_in_use <port>
#
# True if anything — any process, ours or not, containerised or not — is
# already listening on this host port. docker-proxy publishes ports by
# binding them at the OS level like any other process, so a container from an
# unrelated compose project collides just the same, and `ss` sees both.
#
# ss (iproute2) is a base package on every Ubuntu/Debian install this tooling
# targets. Falls back to a raw connect attempt only if ss is missing.
# ---------------------------------------------------------------------------
port_in_use() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -Htln "( sport = :$port )" 2>/dev/null | grep -q .
    return $?
  fi

  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && { exec 3>&-; return 0; }
  return 1
}

# ---------------------------------------------------------------------------
# find_free_port <start>
#
# First free port at or above <start>. Used to pick a localhost-only port for
# the web container when another project is already on this server, so
# deployment proceeds automatically instead of failing on "port is already
# allocated".
# ---------------------------------------------------------------------------
find_free_port() {
  local port="${1:-8081}"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

# ---------------------------------------------------------------------------
# port_owner <port>
#
# Name of the process listening on a host port ("nginx", "docker-proxy", ...),
# or empty if nothing is. "Something already has 443" is two situations with
# opposite fixes: nginx means the reverse proxy we want (just add a site);
# docker-proxy means a container published it and host nginx cannot bind it
# until that is resolved. Needs root to see process names for other users'
# sockets; without it, returns empty and callers treat it as "unknown".
# ---------------------------------------------------------------------------
port_owner() {
  local port="$1"
  command -v ss >/dev/null 2>&1 || return 0

  ss -Htlnp "( sport = :$port )" 2>/dev/null \
    | grep -oE 'users:\(\("[^"]+"' \
    | head -1 \
    | sed -E 's/.*"([^"]+)"/\1/'
}
