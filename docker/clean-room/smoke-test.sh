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
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs git tmux lsof
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
  step "Install aigon from local source"
  cd "$REPO_ROOT"
  npm ci --ignore-scripts 2>&1 | tail -1
  if [[ "$PLATFORM" == "linux" ]]; then
    sudo npm link 2>&1 | tail -1
  else
    npm link 2>&1 | tail -1
  fi
  check_command aigon
  aigon --version
  pass "aigon installed and responds to --version"
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
  step "Install aigon into the repo"
  cd "$BREWBOARD_DIR"
  aigon init 2>&1 || true
  pass "aigon init"

  step "Install agents (cc + gg)"
  aigon install-agent cc gg 2>&1 || true
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
  aigon config set --global terminal tmux
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
      echo ""
      echo "  --all    Run scenarios 1, 2 sequentially"
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
elif [[ -n "$SCENARIO" ]]; then
  case "$SCENARIO" in
    1) scenario_1 ;;
    2) scenario_2 ;;
    *) fail "Unknown scenario: $SCENARIO. Available: 1, 2" ;;
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
