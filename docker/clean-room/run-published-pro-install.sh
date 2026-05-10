#!/usr/bin/env bash
# Published-package confidence test for Aigon + Aigon Pro.
#
# This intentionally mounts no source directories. It tests what a user gets
# from npm: install packages, run `aigon setup`, activate Pro, start the
# dashboard, and launch a BrewBoard autonomous feature in test mode.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${AIGON_DOCKER_IMAGE:-aigon-published-pro-clean-room}"
CONTAINER_NAME="${AIGON_DOCKER_CONTAINER:-aigon-published-pro-test}"
AIGON_PACKAGE="${AIGON_PACKAGE:-@senlabsai/aigon@next}"
PRO_PACKAGE="${AIGON_PRO_PACKAGE:-@senlabsai/aigon-pro@beta}"
AIGON_PRO_KEY="${AIGON_PRO_KEY:-}"
if [[ -z "$AIGON_PRO_KEY" ]]; then
  echo "[published-pro] FAIL: AIGON_PRO_KEY is required." >&2
  echo "[published-pro]       Export your Pro beta key before running, e.g." >&2
  echo "[published-pro]         export AIGON_PRO_KEY=<your-key>" >&2
  echo "[published-pro]         bash $0" >&2
  exit 2
fi

log() { printf '[published-pro] %s\n' "$*"; }
fail() {
  printf '[published-pro] FAIL: %s\n' "$*" >&2
  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    log "Recent dashboard log:"
    docker exec -u dev "$CONTAINER_NAME" bash -lc 'tail -120 ~/.aigon/dashboard.log 2>/dev/null || true' >&2 || true
  fi
  exit 1
}

log "Building clean image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile.published-pro" "$SCRIPT_DIR"

if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  log "Removing previous container: $CONTAINER_NAME"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

log "Starting container without source mounts"
docker run -d \
  --name "$CONTAINER_NAME" \
  --hostname clean-room \
  -p 127.0.0.1::4100 \
  "$IMAGE_NAME" sleep infinity >/dev/null

HOST_PORT="$(docker port "$CONTAINER_NAME" 4100/tcp | sed 's/.*://')"
if [[ -z "$HOST_PORT" ]]; then
  fail "could not resolve mapped dashboard port"
fi

log "Installing from npm: $AIGON_PACKAGE $PRO_PACKAGE"
docker exec -u dev "$CONTAINER_NAME" bash -lc \
  "sudo npm install -g '$AIGON_PACKAGE' '$PRO_PACKAGE'"

log "Running aigon setup with Pro key"
docker exec -u dev \
  -e AIGON_PRO_KEY="$AIGON_PRO_KEY" \
  "$CONTAINER_NAME" bash -lc 'aigon setup --yes'

log "Verifying Pro activation"
docker exec -u dev "$CONTAINER_NAME" bash -lc 'aigon pro status'

log "Waiting for dashboard on host port $HOST_PORT"
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$HOST_PORT/api/health" >/dev/null; then
    break
  fi
  sleep 1
done
curl -sf "http://127.0.0.1:$HOST_PORT/api/health" >/dev/null || fail "dashboard did not become healthy"

log "Starting BrewBoard feature autonomously in AIGON_TEST_MODE"
docker exec -u dev "$CONTAINER_NAME" bash -lc \
  'cd ~/src/brewboard && AIGON_TEST_MODE=1 aigon feature-autonomous-start 08 cc --stop-after=implement'

log "Checking autonomous session status"
docker exec -u dev "$CONTAINER_NAME" bash -lc \
  'cd ~/src/brewboard && aigon feature-autonomous-start status 08 || true; tmux ls | grep "brewboard-f08-auto"'

cat <<EOF

PASS: published npm install + Pro activation + BrewBoard autonomous start works.

Dashboard:
  http://127.0.0.1:$HOST_PORT

Open a shell in the container:
  docker exec -it -u dev $CONTAINER_NAME bash

Stop and remove it:
  docker rm -f $CONTAINER_NAME

EOF
