#!/usr/bin/env bash
# scripts/test/build-auth-snapshot.sh — one-time build of the pre-authed
# Docker snapshot used by e2e-docker.sh.
#
# The output image `aigon-clean-room-authed:local` is MACHINE-LOCAL and must
# never be pushed to any registry. It contains your Claude Code and Gemini
# CLI OAuth tokens.
#
# This script:
#   1. Spawns a clean-room builder container with everything Aigon needs
#      installed except for agent auth (Node, git, build-essential, python3,
#      lsof, tmux, aigon from local tarball, claude-code, gemini CLIs).
#   2. Drops you into an interactive shell inside it to run `claude /login`
#      and `gemini /auth`.
#   3. After you exit, commits the container as `aigon-clean-room-authed:local`.
#   4. Removes the builder container.
#
# Re-run this whenever your OAuth tokens expire (typically 30+ days) or when
# you want a fresh CLI version baked in.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILDER="aigon-auth-builder"
OUT_IMAGE="aigon-clean-room-authed:local"

log()  { echo "==> $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

docker image inspect aigon-clean-room >/dev/null 2>&1 \
  || fail "aigon-clean-room image missing — run: docker build -t aigon-clean-room docker/clean-room/"

log "Packing aigon source"
cd "$REPO_ROOT"
rm -f senlabsai-aigon-*.tgz
npm pack >/dev/null
TGZ="$(ls senlabsai-aigon-*.tgz | head -1)"
[[ -f "$TGZ" ]] || fail "npm pack did not produce a tarball"

log "Spawning builder container"
docker rm -f "$BUILDER" 2>/dev/null || true
docker run -d --name "$BUILDER" \
  -v "$REPO_ROOT:/host/aigon:ro" \
  --hostname clean-room \
  aigon-clean-room \
  sleep infinity >/dev/null

log "Installing prereqs + aigon + agent CLIs (no auth yet — ~2 minutes)"
docker exec "$BUILDER" bash -lc "
  set -e
  sudo apt-get update -qq 2>&1 | tail -1
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - >/dev/null 2>&1
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    nodejs git build-essential python3 lsof tmux >/dev/null
  sudo npm install -g /host/aigon/$TGZ >/dev/null 2>&1
  sudo npm install -g @anthropic-ai/claude-code @google/gemini-cli >/dev/null 2>&1
  hash -r
  mkdir -p ~/.gemini
  git config --global user.email 'test@example.com'
  git config --global user.name 'Aigon Test'
  echo
  echo '  aigon : '\$(aigon --version)
  echo '  claude: '\$(claude --version 2>&1 | head -1)
  echo '  gemini: '\$(gemini --version 2>&1 | head -1)
"

cat <<'EOF'

════════════════════════════════════════════════════════════════════
  Interactive auth step — do this once, then exit the container shell
════════════════════════════════════════════════════════════════════

You are about to be dropped into the builder container's shell. Inside it:

  1. Authenticate Claude Code:
       claude
       /login            ← opens an OAuth URL; copy → Mac browser → paste code back
       /exit

  2. Authenticate Gemini:
       gemini
       /auth             ← same flow as above
       /exit

  3. Type 'exit' to leave the container.

When you exit, this script will commit the container as the local snapshot.

Press Enter to continue…
EOF
read -r _

docker exec -it "$BUILDER" bash

log "Committing snapshot as $OUT_IMAGE (machine-local only, never pushed)"
docker commit "$BUILDER" "$OUT_IMAGE" >/dev/null
docker rm -f "$BUILDER" >/dev/null

log "Done. Snapshot ready."
echo
docker image inspect "$OUT_IMAGE" --format '  {{.RepoTags}}  {{.Size}} bytes'
echo
echo "Run the E2E suite any time with:"
echo "  bash scripts/test/e2e-docker.sh           # full (with real feature runs)"
echo "  bash scripts/test/e2e-docker.sh --quick   # setup+brewboard only, no feature runs"
