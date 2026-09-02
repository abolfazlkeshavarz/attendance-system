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
