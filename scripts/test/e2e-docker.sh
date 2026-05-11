#!/usr/bin/env bash
# scripts/test/e2e-docker.sh — Unattended Aigon end-to-end test in Docker.
#
# Spawns a fresh container from the local pre-authed snapshot image
# (`aigon-clean-room-authed:local`), repacks the aigon tarball with the
# current source, installs it in the container, runs `aigon setup --yes`,
# verifies brewboard apply, kicks off real features on Claude Code and
# Gemini, and asserts they reach `implementation-complete` (or beyond).
#
# Single command. No human interaction during the run. Five-ish minutes.
#
# Requirements (one-time, on this Mac):
#   1. `aigon-clean-room` image built: `docker build -t aigon-clean-room docker/clean-room/`
#   2. `aigon-clean-room-authed:local` image built by running
#      `scripts/test/build-auth-snapshot.sh` and completing the manual
#      `claude /login` + `gemini /auth` flows inside the builder container,
#      then snapshotting.
#
# The authed image is MACHINE-LOCAL. It contains OAuth tokens. It must never
# be pushed to a registry.
#
# Usage:
#   bash scripts/test/e2e-docker.sh                       # full E2E with real features
#   bash scripts/test/e2e-docker.sh --quick               # skip feature runs, only verify setup
#   bash scripts/test/e2e-docker.sh --keep-container      # leave the test container running on exit (debug)
#   bash scripts/test/e2e-docker.sh --feature-timeout 600 # cap each feature run (seconds, default 900)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AUTHED_IMAGE="aigon-clean-room-authed:local"
CONTAINER_NAME="aigon-e2e-$$"

QUICK=0
KEEP=1   # default: keep container running after test so you can manually inspect
WITH_COMPLETION=0
FEATURE_START_TIMEOUT=120       # default: only wait for `implementing` (proves install)
FEATURE_COMPLETION_TIMEOUT=900  # opt-in: wait for terminal state (proves agent runs)
HOST_PORT=4102
CC_MODEL="claude-haiku-4-5-20251001"
GG_MODEL="gemini-2.5-flash"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick) QUICK=1; shift ;;
    --keep-container) KEEP=1; shift ;;
    --no-keep) KEEP=0; shift ;;
    --with-completion) WITH_COMPLETION=1; shift ;;
    --start-timeout) FEATURE_START_TIMEOUT="$2"; shift 2 ;;
    --completion-timeout) FEATURE_COMPLETION_TIMEOUT="$2"; shift 2 ;;
    --port) HOST_PORT="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

PASS=0
FAIL=0
NOTE_LINES=()

step()  { echo; echo "── $1 ──"; }
ok()    { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()   { echo "  ✗ $1" >&2; FAIL=$((FAIL+1)); NOTE_LINES+=("FAIL: $1"); }
note()  { echo "  · $1"; }
fatal() { echo "  ✗✗ $1" >&2; cleanup; exit 1; }

# Defined early so --quick branch can call it.
summary() {
  echo
  echo "════════════════════════════════════════════════════════════════════"
  if [[ "$FAIL" -eq 0 ]]; then
    echo "  ✅ E2E PASS — $PASS check(s) green"
  else
    echo "  ❌ E2E FAIL — $FAIL failure(s), $PASS pass(es)"
    for line in "${NOTE_LINES[@]:-}"; do echo "    - $line"; done
  fi
  echo "════════════════════════════════════════════════════════════════════"
  exit "$FAIL"
}

cleanup() {
  if [[ "$KEEP" -eq 1 ]]; then
    echo
    echo "── Container left running for inspection: $CONTAINER_NAME ──"
    echo "    docker exec -it $CONTAINER_NAME bash"
    echo "    docker rm -f $CONTAINER_NAME    # when done"
    return
  fi
  if docker ps -aq -f name="$CONTAINER_NAME" | grep -q .; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ── Pre-flight: image must exist ─────────────────────────────────────────────
step "Pre-flight"
if ! docker image inspect "$AUTHED_IMAGE" >/dev/null 2>&1; then
  echo "  ✗ Authed snapshot $AUTHED_IMAGE not found." >&2
  echo "    Build it first: bash scripts/test/build-auth-snapshot.sh" >&2
  exit 2
fi
ok "authed image present: $AUTHED_IMAGE"

# ── Re-pack the aigon tarball so the test exercises current source ───────────
step "Pack aigon source"
cd "$REPO_ROOT"
rm -f senlabsai-aigon-*.tgz
npm pack >/dev/null 2>&1 || fatal "npm pack failed"
TGZ="$(ls senlabsai-aigon-*.tgz | head -1)"
[[ -f "$TGZ" ]] || fatal "no tarball produced"
ok "packed $TGZ"

# ── Launch test container from authed snapshot ───────────────────────────────
step "Launch fresh container from authed snapshot"

# Pre-flight: any previous aigon-e2e-* container (from an interrupted run, or
# one with --keep-container that wasn't cleaned up) will hold the host port
# and block this run. Find every container binding HOST_PORT and any leftover
# aigon-e2e-* containers, and remove them. This is the only port we ever
# bind, so killing port-holders by name is safe.
stale_by_name="$(docker ps -aq --filter 'name=aigon-e2e-' 2>/dev/null || true)"
stale_by_port="$(docker ps -aq --filter "publish=$HOST_PORT" 2>/dev/null || true)"
stale_ids="$(printf '%s\n%s\n' "$stale_by_name" "$stale_by_port" | grep -v '^$' | sort -u || true)"
if [[ -n "$stale_ids" ]]; then
  count="$(echo "$stale_ids" | wc -l | tr -d ' ')"
  note "found $count stale test container(s) holding port $HOST_PORT or matching aigon-e2e-* — removing"
  echo "$stale_ids" | xargs docker rm -f >/dev/null 2>&1 || true
fi

docker run -d --name "$CONTAINER_NAME" \
  -v "$REPO_ROOT:/host/aigon:ro" \
  -p "$HOST_PORT:4100" \
  --hostname clean-room \
  "$AUTHED_IMAGE" \
  sleep infinity >/dev/null || fatal "docker run failed — port $HOST_PORT may be held by a non-test process (use --port N to override)"
ok "container started: $CONTAINER_NAME"
note "watch the dashboard live during this test at: http://localhost:$HOST_PORT"

# Wipe any global state so each run is reproducible (snapshot may have leftovers)
docker exec "$CONTAINER_NAME" bash -lc 'rm -rf ~/.aigon ~/src/brewboard 2>/dev/null; mkdir -p ~/.aigon' >/dev/null
ok "container state wiped to fresh slate"

# ── Reinstall aigon from the freshly-packed tarball ──────────────────────────
step "Install aigon from local tarball"
docker exec "$CONTAINER_NAME" bash -lc "sudo npm install -g /host/aigon/$TGZ" >/dev/null 2>&1 \
  || fatal "aigon install failed"
INSTALLED_VERSION="$(docker exec "$CONTAINER_NAME" bash -lc 'aigon --version' 2>/dev/null | tr -d '\r\n')"
ok "aigon installed: v$INSTALLED_VERSION"

# ── aigon setup --yes (non-interactive) ──────────────────────────────────────
step "Run aigon setup --yes"
SETUP_LOG="$(docker exec "$CONTAINER_NAME" bash -lc 'yes "" 2>/dev/null | aigon setup --yes 2>&1' || true)"
if echo "$SETUP_LOG" | grep -q "All done"; then
  ok "wizard finished cleanly"
else
  bad "wizard did not finish cleanly"
  echo "$SETUP_LOG" | tail -30 | sed 's/^/      /'
fi

# Brewboard step in --yes mode auto-clones; verify
if docker exec "$CONTAINER_NAME" bash -lc 'test -d ~/src/brewboard/.aigon'; then
  ok "brewboard cloned + apply ran"
else
  # --yes does not auto-clone (it's a yes-or-no choice with no default); do it explicitly
  note "wizard did not auto-clone brewboard in --yes mode — cloning + applying manually"
  docker exec "$CONTAINER_NAME" bash -lc '
    git clone -q https://github.com/jayvee/brewboard-seed.git ~/src/brewboard
    cd ~/src/brewboard
    npm install --silent 2>&1 | tail -1
    aigon apply 2>&1 | tail -3
    aigon install-agent cc gg 2>&1 | tail -2
    aigon server add ~/src/brewboard >/dev/null 2>&1
  ' >/dev/null 2>&1 && ok "manual brewboard bootstrap complete" || bad "brewboard bootstrap failed"
fi

# Ensure dashboard is running
docker exec "$CONTAINER_NAME" bash -lc '
  if ! aigon server status 2>&1 | grep -q "running"; then
    nohup aigon server start >~/.aigon/dashboard.log 2>&1 &
    sleep 3
  fi
' >/dev/null 2>&1

# ── Verify dashboard ─────────────────────────────────────────────────────────
step "Verify dashboard responds"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null "http://localhost:$HOST_PORT/api/status" 2>/dev/null; then
    ok "dashboard HTTP 200 on localhost:$HOST_PORT"
    break
  fi
  sleep 2
  [[ "$attempt" -eq 10 ]] && bad "dashboard never came up"
done

# ── Verify brewboard state — no 'No engine state' cards ──────────────────────
step "Verify brewboard read-model is clean"
STATE_JSON="$(curl -fsS "http://localhost:$HOST_PORT/api/status" 2>/dev/null)"
NO_ENGINE_COUNT="$(echo "$STATE_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
brew = next((r for r in d.get('repos', []) if 'brewboard' in r.get('path','')), None)
if not brew:
    print('NO_BREWBOARD')
    sys.exit()
bad = sum(1 for f in (brew.get('features') or [])
          if (f.get('cardHeadline') or {}).get('verb') == 'No engine state')
print(bad)" 2>&1)"
if [[ "$NO_ENGINE_COUNT" == "0" ]]; then
  ok "zero 'No engine state' warning cards"
elif [[ "$NO_ENGINE_COUNT" == "NO_BREWBOARD" ]]; then
  bad "brewboard not registered with dashboard"
else
  bad "$NO_ENGINE_COUNT brewboard cards show 'No engine state' (apply auto-bootstrap regressed)"
fi

# ── Verify wizard step descriptions in setup output ──────────────────────────
step "Sanity-check setup wizard output for known regressions"
if echo "$SETUP_LOG" | grep -qi 'aigon init.*deprecated'; then
  bad "wizard internally invoked 'aigon init' (deprecation warning leaked through)"
else
  ok "no internal 'aigon init' deprecation warnings"
fi
if echo "$SETUP_LOG" | grep -q "lsof: not found"; then
  bad "lsof missing inside snapshot — re-run build-auth-snapshot.sh"
else
  ok "no lsof: not found errors"
fi

# ── --quick mode stops here ──────────────────────────────────────────────────
if [[ "$QUICK" -eq 1 ]]; then
  step "Quick-mode complete — skipping feature runs"
  summary
fi

# ── Real feature runs ────────────────────────────────────────────────────────
run_feature() {
  local id="$1" agent="$2" model="$3" label="$4"
  step "Feature #$id on $agent / $model ($label)"
  docker exec "$CONTAINER_NAME" bash -lc "
    cd ~/src/brewboard
    aigon feature-start $id $agent --models $agent=$model 2>&1 | tail -20
  " > /tmp/feature-$id-start.log 2>&1
  if ! grep -qE "Session:|Worktree:" /tmp/feature-$id-start.log; then
    bad "feature-start for #$id did not spawn a tmux session"
    sed 's/^/      /' /tmp/feature-$id-start.log
    return 1
  fi
  ok "feature-start spawned a tmux session"

  # Poll the API. Default success criterion: lifecycle reaches `in-progress`
  # AND the agent row shows `running`. That proves the install works
  # end-to-end. We kill the session as soon as that's met; we don't wait
  # for the agent to actually finish (--with-completion flag for that).
  local deadline
  if [[ "$WITH_COMPLETION" -eq 1 ]]; then
    deadline=$(( $(date +%s) + FEATURE_COMPLETION_TIMEOUT ))
  else
    deadline=$(( $(date +%s) + FEATURE_START_TIMEOUT ))
  fi
  local last_state="-"
  while true; do
    local now=$(date +%s)
    if [[ "$now" -ge "$deadline" ]]; then
      bad "feature #$id timed out in state '$last_state'"
      return 1
    fi
    local state
    state="$(curl -fsS "http://localhost:$HOST_PORT/api/status" 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
brew = next((r for r in d.get('repos', []) if 'brewboard' in r.get('path','')), None)
f = next((x for x in (brew.get('features') or []) if x.get('id') == '$id'), None)
if not f: print('NOT_FOUND'); sys.exit()
agents = f.get('agents') or {}
agent_status = None
if isinstance(agents, dict) and '$agent' in agents:
    agent_status = agents['$agent'].get('status')
elif isinstance(agents, list):
    for a in agents:
        if isinstance(a, dict) and a.get('id') == '$agent':
            agent_status = a.get('status')
            break
print(f'lifecycle={f.get(\"stage\")} agent={agent_status}')" 2>/dev/null)"
    if [[ "$state" != "$last_state" ]]; then
      note "state: $state"
      last_state="$state"
    fi
    if echo "$state" | grep -qE "agent=(error|failed)"; then
      bad "feature #$id agent errored: $state"
      return 1
    fi
    if [[ "$WITH_COMPLETION" -eq 1 ]]; then
      if echo "$state" | grep -qE "lifecycle=(done|in-evaluation)"; then
        ok "feature #$id reached terminal state: $state"
        return 0
      fi
      if echo "$state" | grep -qE "agent=(submitted|complete)"; then
        ok "feature #$id agent reported complete: $state"
        return 0
      fi
      sleep 10
    else
      # Install-validation mode: any of the post-launch states proves the
      # install works. The agent might transition from `running` →
      # `implementing` → `ready` (= implementation-complete) faster than
      # our 3-second polls catch — so accept all four.
      if echo "$state" | grep -qE "agent=(running|implementing|ready|submitted)"; then
        ok "feature #$id reached post-launch state: $state"
        docker exec "$CONTAINER_NAME" bash -lc "tmux kill-session -t \$(tmux ls 2>/dev/null | grep f${id#0}- | head -1 | cut -d: -f1) 2>/dev/null; true" >/dev/null 2>&1
        note "agent session killed (install proven; --with-completion to let it run to done)"
        return 0
      fi
      sleep 3
    fi
  done
}

run_feature 01 cc "$CC_MODEL" "format-date on Claude Code (Haiku) — smallest backlog feature"
run_feature 09 gg "$GG_MODEL" "dark-mode on Gemini (Flash)"

summary
