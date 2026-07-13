#!/usr/bin/env bash
# Copy host agent credentials into a running clean-room Docker container (~ → container ~).
# See docker/clean-room/README.md — "Skip auth during testing".

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: bash scripts/docker-inject-creds.sh <container_id>

Copy Claude Code, Gemini, Codex (config only), and GitHub CLI auth from this machine
into a running clean-room container as user dev. Paths that are missing on the host
are skipped (summary printed). Safe to run more than once.

Requires: Docker, a running container ID from docker ps.
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi
if [[ "${1:-}" == '-h' ]] || [[ "${1:-}" == '--help' ]]; then
  usage
  exit 0
fi

CONTAINER_ID="$1"

# ~/.claude is the full Claude Code data dir and can be many GB of conversation
# history. Only copy the auth token file and settings — not the whole directory.
# NOTE: .claude/settings.json is deliberately NOT in this list. It carries
# host-specific hooks, statusLine, and interpreter paths (e.g. an fnm node path
# and /Users/<you>/.claude/hooks/*) that do not exist in the Linux container and
# spam every tool call with non-blocking "No such file or directory" errors.
# It is injected separately below, sanitized (auth-irrelevant host keys stripped).
CREDENTIAL_RELS=(
  '.claude.json'
  '.claude/.credentials.json'
  '.gemini'
  '.codex/config.toml'
  '.config/gh'
)

if ! docker inspect "$CONTAINER_ID" &>/dev/null; then
  echo "docker-inject-creds: no such container: $CONTAINER_ID" >&2
  exit 1
fi

running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_ID" 2>/dev/null || true)"
if [[ "$running" != 'true' ]]; then
  echo "docker-inject-creds: container is not running: $CONTAINER_ID" >&2
  exit 1
fi

paths_to_tar=()
for rel in "${CREDENTIAL_RELS[@]}"; do
  if [[ -e "$HOME/$rel" ]]; then
    paths_to_tar+=("$rel")
    echo "  copied: $rel"
  else
    echo "  skipped: $rel (not on host)"
  fi
done

if [[ ${#paths_to_tar[@]} -eq 0 ]]; then
  echo 'docker-inject-creds: nothing to copy — no credential paths exist on host.' >&2
  exit 0
fi

tar -czf - -C "$HOME" "${paths_to_tar[@]}" 2>/dev/null \
  | docker exec -i -u dev "$CONTAINER_ID" bash -c 'set -euo pipefail; cd ~ && mkdir -p .codex .config/gh && tar -xzf -'

# Inject a sanitized ~/.claude/settings.json: keep auth-neutral prefs (model,
# theme, permissions) but strip host-specific keys that reference paths absent
# in the container (hooks, statusLine, plugins/marketplaces). Without this the
# agent session spams non-blocking hook errors for /Users/<host>/... paths.
if [[ -f "$HOME/.claude/settings.json" ]]; then
  if sanitized="$(node -e '
      const fs = require("fs");
      const s = JSON.parse(fs.readFileSync(process.env.HOME + "/.claude/settings.json", "utf8"));
      for (const k of ["hooks", "statusLine", "enabledPlugins", "extraKnownMarketplaces"]) delete s[k];
      process.stdout.write(JSON.stringify(s, null, 2));
    ' 2>/dev/null)"; then
    printf '%s' "$sanitized" \
      | docker exec -i -u dev "$CONTAINER_ID" bash -c 'set -euo pipefail; mkdir -p ~/.claude && cat > ~/.claude/settings.json'
    echo '  copied: .claude/settings.json (sanitized — hooks/statusLine/plugins stripped)'
  else
    echo '  skipped: .claude/settings.json (could not sanitize; agent session would inherit host hooks)'
  fi
fi

echo 'docker-inject-creds: done.'
