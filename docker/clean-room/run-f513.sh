#!/usr/bin/env bash
# run-f513.sh — Fast host-side orchestrator for the F513 (merge-init-into-apply) smoke.
#
# What it does, in order:
#   1. Build the clean-room Docker image if it isn't already present.
#   2. Pack the current aigon source into a tarball (skip if a fresh one exists).
#   3. Spin a one-shot container, install aigon from the tarball, run quick-f513-test.sh.
#   4. Exit 0 on full pass, non-zero on any failure. Container is removed in either case.
#
# Designed to take < 90s on a warm cache (image built, tarball packed).
# Pre-warming (this script's "upfront work") is automatic — the first invocation
# builds the image and packs the tarball; subsequent invocations skip both.
#
# Usage:
#   bash docker/clean-room/run-f513.sh           # quick run
#   bash docker/clean-room/run-f513.sh --rebuild # force docker build + npm pack
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_TAG="aigon-fast-f513"
DOCKERFILE="$(dirname "${BASH_SOURCE[0]}")/Dockerfile.fast-f513"
REBUILD=false

for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=true ;;
    -h|--help)
      sed -n '2,/^set/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

log()  { echo "==> $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# ---- 1. Build image if missing ----------------------------------------------
if [[ "$REBUILD" == true ]] || ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  log "Building $IMAGE_TAG (one-time, ~60-120s)…"
  docker build -t "$IMAGE_TAG" -f "$DOCKERFILE" "$SCRIPT_DIR/" >/dev/null
else
  log "$IMAGE_TAG already built — skipping docker build"
fi

# ---- 2. Pack the current source ---------------------------------------------
cd "$REPO_ROOT"
existing_tgz="$(ls senlabsai-aigon-*.tgz 2>/dev/null | sort -V | tail -1 || true)"

needs_pack=false
if [[ "$REBUILD" == true || -z "$existing_tgz" ]]; then
  needs_pack=true
elif [[ -n "$existing_tgz" ]]; then
  # Re-pack if any source file is newer than the tarball.
  newest_src="$(find aigon-cli.js lib templates package.json -type f -newer "$existing_tgz" -print 2>/dev/null | head -1 || true)"
  if [[ -n "$newest_src" ]]; then
    log "Source changed since $existing_tgz (newer: $newest_src) — re-packing"
    rm -f senlabsai-aigon-*.tgz
    needs_pack=true
  fi
fi

if [[ "$needs_pack" == true ]]; then
  log "Packing aigon source (npm pack)…"
  npm pack --silent >/dev/null
fi

TGZ="$(ls senlabsai-aigon-*.tgz | sort -V | tail -1)"
[[ -f "$TGZ" ]] || fail "npm pack did not produce a tarball"
log "Using tarball: $TGZ"

# ---- 3. Run the test in a fresh container -----------------------------------
log "Launching container and running F513 smoke (target < 90s)…"
CONTAINER_NAME="aigon-f513-$$"

set +e
docker run --rm --name "$CONTAINER_NAME" \
  -v "$REPO_ROOT:/host/aigon:ro" \
  -e AIGON_NONINTERACTIVE=1 \
  "$IMAGE_TAG" \
  bash -lc "
    set -e
    echo '==> Installing aigon from packed tarball (node + build tools already in image)'
    sudo npm install -g /host/aigon/$TGZ >/dev/null 2>&1
    hash -r
    aigon --version
    echo '==> Running F513 smoke checks'
    bash /host/aigon/docker/clean-room/quick-f513-test.sh
  "
RC=$?
set -e

if [[ "$RC" -eq 0 ]]; then
  log "✅ F513 smoke PASSED"
else
  log "❌ F513 smoke FAILED (exit $RC)"
fi
exit "$RC"
