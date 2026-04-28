#!/usr/bin/env bash
# run-e2e.sh — Unattended end-to-end installation test for Aigon.
# Single command that: verifies Docker is up, builds the clean-room image, runs the
# container detached, injects host credentials, runs smoke-test scenario 2 (install +
# dashboard), and optionally drives one BrewBoard feature via an autonomous agent.
#
# Usage:
#   bash docker/clean-room/run-e2e.sh
#
# Environment variables:
#   ANTHROPIC_API_KEY           Required. Forwarded into the container.
#   GOOGLE_API_KEY              Optional. Forwarded if set.
#   OPENAI_API_KEY              Optional. Forwarded if set.
#   AIGON_E2E_SKIP_FEATURE_RUN  Set to 1 to skip the best-effort feature run entirely.
#   AIGON_E2E_FEATURE_ID        Override the brewboard feature ID used in stage 6.
#   AIGON_E2E_STOP_AFTER        Wall-clock seconds before the host kills the agent tmux
#                               session (default 300). Also sets --stop-after for the CLI
#                               stage (default: implement).
#   AIGON_E2E_ALLOW_REMOTE      Must be 1 when not on a local Docker daemon (safety rail).

set -euo pipefail

# ---------- constants ----------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="aigon-clean-room"
CONTAINER_NAME="aigon-e2e"
LOG_FILE="$SCRIPT_DIR/last-run.log"

INSTALL_RESULT="PENDING"
FEATURE_RUN_RESULT="SKIPPED"

# ---------- helpers ----------

log() { echo "[run-e2e] $*"; }
err() { echo "[run-e2e] ERROR: $*" >&2; }

stage_fail() {
  local stage="$1"
  local msg="$2"
  err "STAGE $stage FAILED: $msg"
  exit 1
}

# ---------- teardown (runs on EXIT) ----------

teardown() {
  log "=== Teardown ==="
  if docker inspect "$CONTAINER_NAME" &>/dev/null 2>&1; then
    log "Dumping container logs to $LOG_FILE..."
    docker logs "$CONTAINER_NAME" >"$LOG_FILE" 2>&1 || true
    log "Removing container $CONTAINER_NAME..."
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  else
    log "No container to clean up."
    : >"$LOG_FILE"  # touch so the file always exists
  fi

  echo ""
  echo "======================================================"
  printf "  INSTALL: %-8s  FEATURE-RUN: %-8s  EXIT: %s\n" \
    "$INSTALL_RESULT" "$FEATURE_RUN_RESULT" "${E2E_EXIT_CODE:-?}"
  echo "======================================================"
}

trap 'E2E_EXIT_CODE=$?; teardown' EXIT

# ---------- stage 1: preflight ----------

stage_preflight() {
  log "=== Stage 1: Preflight ==="

  # Safety rail: refuse if inside CI without explicit opt-in
  if [[ -n "${CI:-}" ]]; then
    err "CI environment detected. This script injects host credentials and must NOT run in CI."
    err "If you truly want to run it here, set AIGON_E2E_ALLOW_REMOTE=1."
    exit 1
  fi

  # Safety rail: check Docker context isn't remote unless explicitly allowed
  if [[ "${AIGON_E2E_ALLOW_REMOTE:-0}" != "1" ]]; then
    local ctx
    ctx="$(docker context show 2>/dev/null || echo '')"
    if [[ "$ctx" == *"remote"* ]] || [[ "$ctx" == *"tcp://"* ]]; then
      err "Docker context '$ctx' looks remote. Refusing to inject host credentials."
      err "Set AIGON_E2E_ALLOW_REMOTE=1 to override."
      exit 1
    fi
  fi

  # Verify docker binary
  if ! command -v docker &>/dev/null; then
    stage_fail 1 "docker binary not found — install Docker or OrbStack first."
  fi

  # On macOS, try to wake OrbStack if Docker isn't reachable
  if ! docker info &>/dev/null 2>&1; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      log "Docker not responding — attempting to start OrbStack..."
      open -a OrbStack 2>/dev/null || true
      local waited=0
      while ! docker info &>/dev/null 2>&1; do
        sleep 3
        waited=$((waited + 3))
        if [[ $waited -ge 60 ]]; then
          stage_fail 1 "Docker did not respond after 60s. Start OrbStack manually and retry."
        fi
        log "  Waiting for Docker... ($waited/60s)"
      done
      log "Docker is up."
    else
      stage_fail 1 "Docker daemon not running. Start it and retry."
    fi
  fi

  # Verify ANTHROPIC_API_KEY
  if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    stage_fail 1 "ANTHROPIC_API_KEY is not set. The autonomous agent requires it."
  fi

  # Verify ~/.claude exists (docker-inject-creds.sh copies it)
  if [[ ! -e "$HOME/.claude" ]]; then
    stage_fail 1 "$HOME/.claude not found on host. Claude Code credentials are required for unattended auth."
  fi

  log "Preflight OK."
}

# ---------- stage 2: build ----------

stage_build() {
  log "=== Stage 2: Build image ==="
  docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"
  log "Image built: $IMAGE_NAME"
}

# ---------- stage 3: run detached ----------

stage_run_detached() {
  log "=== Stage 3: Run container detached ==="

  # Remove any leftover container from a previous run
  if docker inspect "$CONTAINER_NAME" &>/dev/null 2>&1; then
    log "Removing stale container $CONTAINER_NAME..."
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi

  DOCKER_ARGS=(
    -d
    --name "$CONTAINER_NAME"
    -v "$REPO_ROOT:/home/dev/src/aigon"
    -p 4100:4100
    -p 3000:3000
    --hostname clean-room
  )

  # Mount aigon-pro if present
  local aigon_pro_dir
  aigon_pro_dir="$(cd "$REPO_ROOT/.." && pwd)/aigon-pro"
  if [[ -d "$aigon_pro_dir" ]]; then
    DOCKER_ARGS+=(-v "$aigon_pro_dir:/home/dev/src/aigon-pro")
    log "  Aigon Pro mounted at ~/src/aigon-pro"
  fi

  # Forward API keys
  for key in ANTHROPIC_API_KEY GOOGLE_API_KEY OPENAI_API_KEY; do
    if [[ -n "${!key:-}" ]]; then
      DOCKER_ARGS+=(-e "$key")
    fi
  done

  docker run "${DOCKER_ARGS[@]}" "$IMAGE_NAME" sleep infinity
  log "Container started: $CONTAINER_NAME"
}

# ---------- stage 4: inject credentials ----------

stage_inject_creds() {
  log "=== Stage 4: Inject credentials ==="
  local inject_output
  inject_output="$(bash "$REPO_ROOT/scripts/docker-inject-creds.sh" "$CONTAINER_NAME" 2>&1)"
  echo "$inject_output"

  # Fail if nothing was copied (only skipped: lines)
  if ! echo "$inject_output" | grep -q "^  copied:"; then
    stage_fail 4 "No credentials were copied into the container. Cannot proceed unattended."
  fi
  log "Credentials injected."
}

# ---------- stage 5: install (smoke-test scenario 2) ----------

stage_install() {
  log "=== Stage 5: Install + server (smoke-test --scenario 2) ==="
  docker exec -u dev "$CONTAINER_NAME" \
    bash /home/dev/src/aigon/docker/clean-room/smoke-test.sh --scenario 2
  INSTALL_RESULT="PASS"
  log "Installation and dashboard check passed."
}

# ---------- stage 6: best-effort feature run ----------

stage_run_feature() {
  log "=== Stage 6: Best-effort feature run ==="

  if [[ "${AIGON_E2E_SKIP_FEATURE_RUN:-0}" == "1" ]]; then
    log "AIGON_E2E_SKIP_FEATURE_RUN=1 — skipping feature run."
    FEATURE_RUN_RESULT="SKIPPED"
    return 0
  fi

  # Check if feature-autonomous-start is available
  if ! docker exec -u dev "$CONTAINER_NAME" bash -c \
      "cd ~/src/brewboard && aigon feature-autonomous-start --help" &>/dev/null 2>&1; then
    log "feature-autonomous-start unavailable or unstable — skipping feature run."
    FEATURE_RUN_RESULT="SKIPPED"
    return 0
  fi

  local stop_after_secs="${AIGON_E2E_STOP_AFTER:-300}"
  local feature_id="${AIGON_E2E_FEATURE_ID:-}"

  # Discover the smallest-numbered seed feature in 01-inbox if not overridden
  if [[ -z "$feature_id" ]]; then
    feature_id="$(docker exec -u dev "$CONTAINER_NAME" bash -c \
      "ls ~/src/brewboard/docs/specs/features/01-inbox/feature-*.md 2>/dev/null \
        | sort | head -1 | sed 's/.*feature-//;s/-.*//' " 2>/dev/null || echo "")"
    if [[ -z "$feature_id" ]]; then
      log "No seed features found in brewboard 01-inbox — skipping feature run."
      FEATURE_RUN_RESULT="SKIPPED"
      return 0
    fi
  fi
  log "Using feature ID: $feature_id"

  # Restart aigon server (smoke-test kills it at the end of scenario 2)
  log "Restarting aigon server inside container..."
  docker exec -u dev "$CONTAINER_NAME" bash -c \
    "cd ~/src/brewboard && nohup aigon server start > /tmp/aigon-server.log 2>&1 & sleep 2 && aigon server add ~/src/brewboard 2>/dev/null || true" || true

  # Launch the autonomous agent in a tmux session inside the container
  log "Launching feature-autonomous-start $feature_id cc --stop-after implement..."
  docker exec -u dev "$CONTAINER_NAME" bash -c \
    "cd ~/src/brewboard && tmux new-session -d -s e2e-feature \
      'aigon feature-autonomous-start $feature_id cc --stop-after implement; echo EXIT_CODE:\$?' 2>&1" \
    || {
      log "tmux session launch failed — skipping feature run."
      FEATURE_RUN_RESULT="SKIPPED"
      return 0
    }

  # Poll for session exit (host side)
  local elapsed=0
  local poll_interval=10
  log "Polling for tmux session exit (timeout ${stop_after_secs}s)..."
  while docker exec -u dev "$CONTAINER_NAME" bash -c \
      "tmux has-session -t e2e-feature" &>/dev/null 2>&1; do
    sleep "$poll_interval"
    elapsed=$((elapsed + poll_interval))
    log "  Waiting... ($elapsed/${stop_after_secs}s)"
    if [[ $elapsed -ge $stop_after_secs ]]; then
      log "Timeout reached — killing tmux session e2e-feature."
      docker exec -u dev "$CONTAINER_NAME" bash -c \
        "tmux kill-session -t e2e-feature" 2>/dev/null || true
      break
    fi
  done

  FEATURE_RUN_RESULT="PASS"  # refined by stage_assert
  log "Feature run stage complete."
}

# ---------- stage 7: best-effort assertions ----------

stage_assert() {
  log "=== Stage 7: Post-run assertions ==="

  if [[ "$FEATURE_RUN_RESULT" == "SKIPPED" ]]; then
    log "Feature run was skipped — no assertions to check."
    return 0
  fi

  local feature_id="${AIGON_E2E_FEATURE_ID:-}"
  if [[ -z "$feature_id" ]]; then
    feature_id="$(docker exec -u dev "$CONTAINER_NAME" bash -c \
      "ls ~/src/brewboard/docs/specs/features/01-inbox/feature-*.md 2>/dev/null \
        | sort | head -1 | sed 's/.*feature-//;s/-.*//' " 2>/dev/null || echo "")"
  fi

  local pass_count=0
  local fail_count=0

  # Assertion a: spec moved out of 01-inbox
  if docker exec -u dev "$CONTAINER_NAME" bash -c \
      "! ls ~/src/brewboard/docs/specs/features/01-inbox/feature-${feature_id}-*.md &>/dev/null 2>&1"; then
    log "  ASSERT a: spec moved out of 01-inbox — PASS"
    pass_count=$((pass_count + 1))
  else
    log "  ASSERT a: spec moved out of 01-inbox — FAIL"
    fail_count=$((fail_count + 1))
  fi

  # Assertion b: worktree branch with ≥1 commit beyond seed HEAD
  local commit_count
  commit_count="$(docker exec -u dev "$CONTAINER_NAME" bash -c \
    "cd ~/src/brewboard && \
     wt=\$(ls -d .aigon/worktrees/feature-${feature_id}-* 2>/dev/null | head -1 || true); \
     if [[ -n \"\$wt\" ]]; then \
       git -C \"\$wt\" log seed..HEAD --oneline 2>/dev/null | wc -l | tr -d ' '; \
     else echo 0; fi" 2>/dev/null || echo "0")"
  if [[ "${commit_count:-0}" -ge 1 ]]; then
    log "  ASSERT b: worktree has $commit_count commit(s) beyond seed HEAD — PASS"
    pass_count=$((pass_count + 1))
  else
    log "  ASSERT b: worktree commit count ($commit_count) < 1 — FAIL"
    fail_count=$((fail_count + 1))
  fi

  # Assertion c: implementation log exists and is non-empty
  if docker exec -u dev "$CONTAINER_NAME" bash -c \
      "find ~/src/brewboard/docs/specs/features/logs/ \
        -name 'feature-${feature_id}-*-log.md' -size +0 2>/dev/null | grep -q ." ; then
    log "  ASSERT c: implementation log exists and non-empty — PASS"
    pass_count=$((pass_count + 1))
  else
    log "  ASSERT c: implementation log not found or empty — FAIL"
    fail_count=$((fail_count + 1))
  fi

  if [[ $fail_count -gt 0 ]]; then
    FEATURE_RUN_RESULT="FAIL"
    log "Feature assertions: $pass_count passed, $fail_count failed."
  else
    FEATURE_RUN_RESULT="PASS"
    log "Feature assertions: all $pass_count passed."
  fi
}

# ---------- main ----------

main() {
  echo ""
  echo "======================================================"
  echo "  Aigon Unattended End-to-End Test"
  echo "======================================================"
  echo ""

  stage_preflight
  stage_build
  stage_run_detached
  stage_inject_creds
  stage_install
  stage_run_feature
  stage_assert

  E2E_EXIT_CODE=0
}

main "$@"
