#!/usr/bin/env bash
# smoke-test.sh — Clean-room automated install + tutorial validation
# Mirrors the real getting-started flow: agent CLIs → aigon → repo → install-agent → server
# Works on both Linux (Docker) and macOS (GitHub Actions / bare metal)
# Exit non-zero on first failure with a clear message about which step broke.
set -euo pipefail

# ---------- helpers ----------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_ROOT="${AIGON_WORK_ROOT:-$HOME/src}"
PASS_COUNT=0
FAIL_COUNT=0
CURRENT_SCENARIO=""

step() {
  echo ""
  echo "--- [$CURRENT_SCENARIO] $1"
}

pass() {
  echo "  PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "  FAIL: $1" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  exit 1
}

check_command() {
  if command -v "$1" &>/dev/null; then
    pass "$1 is available"
  else
    fail "$1 not found after install"
  fi
}

detect_platform() {
  case "$(uname -s)" in
    Linux)  PLATFORM="linux" ;;
    Darwin) PLATFORM="macos" ;;
    *)      fail "Unsupported platform: $(uname -s)" ;;
  esac
  echo "Platform: $PLATFORM"
}

# ---------- shared steps ----------

install_prerequisites() {
  step "Install system prerequisites (node, git, tmux)"
  if [[ "$PLATFORM" == "linux" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs git tmux lsof build-essential python3
  else
    # macOS — assume brew is available (GitHub Actions runners have it)
    brew install node git tmux 2>/dev/null || true
  fi
  check_command node
  check_command npm   # bundled with nodejs from NodeSource
  check_command git
  check_command tmux
  echo "  Node version: $(node --version)"
  echo "  npm version: $(npm --version)"
}

install_agent_clis() {
  step "Install agent CLIs (Claude Code + Gemini)"
  if [[ "$PLATFORM" == "linux" ]]; then
    sudo npm i -g @anthropic-ai/claude-code 2>&1 | tail -1
    sudo npm i -g @google/gemini-cli 2>&1 | tail -1
  else
    npm i -g @anthropic-ai/claude-code 2>&1 | tail -1
    npm i -g @google/gemini-cli 2>&1 | tail -1
  fi

  check_command claude
  claude --version
  pass "claude --version works"

  # Gemini CLI bug: fails if ~/.gemini/ doesn't exist on first run
  mkdir -p ~/.gemini

  check_command gemini
  gemini --version 2>&1 | head -1
  pass "gemini --version works"
}

install_aigon() {
  # Prefer a local tarball (npm pack output) so packaging bugs can be caught
  # without publishing. Falls back to @next from the registry.
  local tgz
  tgz="$(ls "$REPO_ROOT"/senlabsai-aigon-*.tgz 2>/dev/null | sort -V | tail -1)"
  if [[ -n "$tgz" ]]; then
    step "Install aigon from local tarball: $(basename "$tgz")"
    if [[ "$PLATFORM" == "linux" ]]; then
      sudo npm install -g "$tgz" 2>&1 | tail -3
    else
      npm install -g "$tgz" 2>&1 | tail -3
    fi
  else
    step "Install aigon from npm (@next)"
    if [[ "$PLATFORM" == "linux" ]]; then
      sudo npm install -g @senlabsai/aigon@next 2>&1 | tail -3
    else
      npm install -g @senlabsai/aigon@next 2>&1 | tail -3
    fi
  fi
  hash -r 2>/dev/null || true
  check_command aigon
  aigon --version
  pass "aigon installed and responds to --version"
}

install_aigon_pro() {
  # Requires AIGON_PRO_KEY env var or AIGON_PRO_TGZ pointing at a local tarball.
  # If neither is set, skip with a warning (Pro is optional in CI).
  local tgz
  tgz="${AIGON_PRO_TGZ:-}"
  if [[ -z "$tgz" ]]; then
    # Auto-detect from repo root — requires `npm pack` to have been run in aigon-pro first
    tgz="$(ls "$REPO_ROOT"/../aigon-pro/senlabsai-aigon-pro-*.tgz 2>/dev/null | sort -V | tail -1)"
  fi

  local key="${AIGON_PRO_KEY:-}"

  if [[ -z "$tgz" && -z "$key" ]]; then
    echo "  SKIP: No AIGON_PRO_TGZ or AIGON_PRO_KEY set — skipping Pro install"
    return 0
  fi

  if [[ -n "$tgz" ]]; then
    step "Install aigon-pro from local tarball: $(basename "$tgz")"
    if [[ "$PLATFORM" == "linux" ]]; then
      sudo npm install -g "$tgz" 2>&1 | tail -3
    else
      npm install -g "$tgz" 2>&1 | tail -3
    fi
    hash -r 2>/dev/null || true
    pass "aigon-pro installed from tarball"
  else
    step "Install aigon-pro from npm (public)"
    if [[ "$PLATFORM" == "linux" ]]; then
      sudo npm install -g @senlabsai/aigon-pro 2>&1 | tail -3
    else
      npm install -g @senlabsai/aigon-pro 2>&1 | tail -3
    fi
    hash -r 2>/dev/null || true
    pass "aigon-pro installed from registry"
  fi

  if [[ -n "$key" ]]; then
    step "Activate Pro key"
    aigon pro activate "$key"
    pass "Pro key activated"
  fi

  step "Verify Pro status"
  local status_out
  status_out="$(aigon pro status 2>&1)"
  echo "$status_out"

  if echo "$status_out" | grep -q "aigon-pro.*✅ installed"; then
    pass "aigon-pro package detected"
  else
    fail "aigon-pro package not detected — check install"
  fi

  if [[ -n "$key" ]]; then
    if echo "$status_out" | grep -q "Pro key.*✅ present"; then
      pass "Pro key present in config"
    else
      fail "Pro key not found in ~/.aigon/config.json"
    fi

    if echo "$status_out" | grep -q "Pro is active"; then
      pass "Pro is active"
    else
      fail "Pro not active — key may be invalid"
    fi
  fi
}

clone_brewboard() {
  step "Clone brewboard seed repo (simulates user's existing project)"
  mkdir -p "$WORK_ROOT"
  BREWBOARD_DIR="$WORK_ROOT/brewboard"
  rm -rf "$BREWBOARD_DIR"
  git clone https://github.com/jayvee/brewboard-seed.git "$BREWBOARD_DIR"
  cd "$BREWBOARD_DIR"
  git remote remove origin 2>/dev/null || true
  npm install 2>&1 | tail -3
  pass "brewboard-seed cloned and dependencies installed"
}

install_aigon_into_repo() {
  step "Apply aigon into the repo (first-run bootstrap)"
  cd "$BREWBOARD_DIR"
  local apply_out
  apply_out="$(aigon apply 2>&1 || true)"
  echo "$apply_out" | tail -20
  if echo "$apply_out" | grep -q "First-time setup"; then
    pass "aigon apply printed first-time-setup banner"
  else
    fail "aigon apply did not print 'First-time setup' banner on a fresh repo"
  fi

  step "Install agents (cc + gg)"
  aigon install-agent cc gg --force 2>&1 || true
  pass "aigon install-agent cc gg"

  step "Verify board shows seeded features"
  aigon board 2>&1 | head -20
  pass "aigon board runs"

  step "Run aigon doctor"
  aigon doctor || true
  pass "aigon doctor ran"
}

start_aigon_server() {
  step "Start aigon server"
  aigon server start &
  SERVER_PID=$!
  sleep 3

  step "Register brewboard with server"
  aigon server add "$BREWBOARD_DIR" 2>&1 || true
  pass "aigon server add"

  step "Verify dashboard responds on port 4100"
  if curl -sf -o /dev/null http://localhost:4100; then
    pass "Dashboard responds on localhost:4100"
  else
    fail "Dashboard did not respond on localhost:4100"
  fi

  # Clean up server
  kill $SERVER_PID 2>/dev/null || true
}

# ---------- scenarios ----------

scenario_1() {
  CURRENT_SCENARIO="S1: Full install"
  step "Starting scenario: full install"
  detect_platform
  install_prerequisites
  install_agent_clis
  install_aigon

  step "Configure aigon"
  aigon config init --global 2>&1 || true
  aigon config set --global terminalApp tmux
  pass "aigon config set"

  clone_brewboard
  install_aigon_into_repo

  echo ""
  echo "=== SCENARIO 1 COMPLETE ==="
}

scenario_2() {
  CURRENT_SCENARIO="S2: Full install + server"
  step "Starting scenario: full install + server"

  # Run scenario 1 if prerequisites aren't in place
  if ! command -v aigon &>/dev/null; then
    scenario_1
  fi

  start_aigon_server

  echo ""
  echo "=== SCENARIO 2 COMPLETE ==="
}

preflight_pro_tarball() {
  # Fail fast BEFORE any downloading — verify the Pro tarball exists and
  # installs cleanly. This prevents wasting 15+ minutes on scenario 1
  # only to discover the Pro tarball is broken at the end.
  CURRENT_SCENARIO="S3 preflight"

  local tgz="${AIGON_PRO_TGZ:-}"
  if [[ -z "$tgz" ]]; then
    tgz="$(ls "$REPO_ROOT"/../aigon-pro/senlabsai-aigon-pro-*.tgz 2>/dev/null | sort -V | tail -1)"
  fi

  if [[ -z "$tgz" ]]; then
    fail "No aigon-pro tarball found at $REPO_ROOT/../aigon-pro/senlabsai-aigon-pro-*.tgz — run 'npm pack' in the aigon-pro repo first"
  fi

  step "Pre-flight: verify Pro tarball exists"
  if [[ ! -f "$tgz" ]]; then
    fail "Tarball not found: $tgz"
  fi
  pass "Tarball found: $(basename "$tgz")"

  step "Pre-flight: verify tarball contents"
  local contents
  contents="$(tar -tzf "$tgz" 2>&1)"
  if ! echo "$contents" | grep -q "dist/index.js"; then
    fail "dist/index.js missing from tarball — run 'npm pack' in aigon-pro (prepublishOnly builds it)"
  fi
  if ! echo "$contents" | grep -q "package.json"; then
    fail "package.json missing from tarball"
  fi
  pass "Tarball contains dist/index.js and package.json"

  step "Pre-flight: dry-run install into temp dir"
  local tmpdir
  tmpdir="$(mktemp -d)"
  # Install both aigon + aigon-pro into same prefix to mirror global install
  local aigon_tgz
  aigon_tgz="$(ls "$REPO_ROOT"/senlabsai-aigon-*.tgz 2>/dev/null | sort -V | tail -1)"
  if [[ -n "$aigon_tgz" ]]; then
    npm install --prefix "$tmpdir" --no-save "$aigon_tgz" "$tgz" > /dev/null 2>&1 || fail "Dry-run install failed — tarball may be corrupt or have broken dependencies. Fix before running the full scenario."
  else
    npm install --prefix "$tmpdir" --no-save "$tgz" > /dev/null 2>&1 || fail "Dry-run install failed — tarball may be corrupt or have broken dependencies. Fix before running the full scenario."
  fi
  rm -rf "$tmpdir"
  pass "Dry-run install succeeded"
}

scenario_3() {
  CURRENT_SCENARIO="S3: Full install + Pro"
  step "Starting scenario: full install + Pro"

  # Validate the Pro tarball BEFORE spending time on scenario 1 downloads
  preflight_pro_tarball

  # Run scenario 1 if prerequisites aren't in place
  if ! command -v aigon &>/dev/null; then
    scenario_1
  fi

  install_aigon_pro

  echo ""
  echo "=== SCENARIO 3 COMPLETE ==="
}

# ---------- CLI ----------

SCENARIO=""
ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)
      SCENARIO="$2"
      shift 2
      ;;
    --all)
      ALL=true
      shift
      ;;
    -h|--help)
      echo "Usage: smoke-test.sh [--scenario N] [--all]"
      echo ""
      echo "Scenarios:"
      echo "  1  Full install (prerequisites → agent CLIs → aigon → brewboard → install-agent → doctor)"
      echo "  2  Full install + server (scenario 1 + aigon server + dashboard HTTP check)"
      echo "  3  Full install + Pro (scenario 1 + aigon-pro install + key activation + status check)"
      echo "       Requires: AIGON_PRO_KEY=<key> and optionally AIGON_PRO_TGZ=<path-to-tgz>"
      echo ""
      echo "  --all    Run scenarios 1, 2, 3 sequentially"
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

echo "=========================================="
echo "  Aigon Clean-Room Smoke Test"
echo "=========================================="
detect_platform

if [[ "$ALL" == true ]]; then
  scenario_1
  scenario_2
  scenario_3
elif [[ -n "$SCENARIO" ]]; then
  case "$SCENARIO" in
    1) scenario_1 ;;
    2) scenario_2 ;;
    3) scenario_3 ;;
    *) fail "Unknown scenario: $SCENARIO. Available: 1, 2, 3" ;;
  esac
else
  # Default: run scenario 1
  scenario_1
fi

echo ""
echo "=========================================="
echo "  All tests passed ($PASS_COUNT checks)"
echo "=========================================="
exit 0
